const express = require('express');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('./db');
const { requireAuth, requireRole } = require('./jwt');
const { buildAo1Workbook, fixRowAddressMismatches } = require('./ao1');
const { sendMail } = require('./mail');

const router = express.Router();

async function attachFiles(reports) {
  if (!reports.length) return reports;
  const ids = reports.map((r) => r.id);
  const filesResult = await pool.query(
    'SELECT * FROM report_files WHERE report_id = ANY($1) ORDER BY created_at',
    [ids]
  );
  const byReport = {};
  filesResult.rows.forEach((f) => {
    if (!byReport[f.report_id]) byReport[f.report_id] = [];
    byReport[f.report_id].push({ id: f.id, kind: f.kind, url: f.url, name: f.name });
  });
  return reports.map((r) => ({ ...r, files: byReport[r.id] || [] }));
}

function serializeReport(row, employee) {
  return {
    id: row.id,
    reportNo: row.report_no,
    employee: employee ? { id: employee.id, fullName: employee.full_name } : undefined,
    projectCode: row.project_code,
    type: row.type,
    statya: row.statya,
    sum: Number(row.sum),
    dateIso: row.date_iso,
    contractor: row.contractor,
    comment: row.comment,
    status: row.status,
    reviewerComment: row.reviewer_comment,
    createdAt: row.created_at,
    isAdvance: !!row.is_advance,
    files: row.files || [],
  };
}

/* Статья и контрагент для операции "Поступление под отчет" — вместо того,
   чтобы спрашивать статью у сотрудника, подставляем сами ту же статью, что
   есть и в обычном списке статей прихода ("поступление подотчетных средств
   (ДДС)", см. ITR_STATYA_SECTIONS/AUP_STATYA_SECTIONS в app.js) — это один и
   тот же смысл (деньги выданы сотруднику на руки), просто с удобной
   вкладкой-ярлыком, а не как отдельная, отличающаяся по названию операция. */
const ADVANCE_STATYA = 'поступление подотчетных средств (ДДС)';
const ADVANCE_CONTRACTOR = 'Касса компании';

/* Дата отчета не может быть в будущем (проверяем и здесь, на сервере, а не
   только в календаре на сайте — защита на случай прямого запроса мимо сайта). */
function isFutureDate(dateIso) {
  if (!dateIso) return false;
  const todayIso = new Date().toISOString().slice(0, 10);
  return String(dateIso) > todayIso;
}

/* Дата операции должна быть строго в рамках ТЕКУЩЕГО календарного месяца
   (по названию, а не "последние 30 дней") — например, 1 октября нельзя
   отправить отчет за 29 сентября, зато 1 ноября сразу можно за 1 ноября.
   Тот же "YYYY-MM" кусок строки, что и в isFutureDate (там же и совпадающий
   часовой пояс — UTC, чтобы не разъезжалось с проверкой на будущее). */
function isOutsideCurrentMonth(dateIso) {
  if (!dateIso) return false;
  const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  return String(dateIso).slice(0, 7) !== currentMonth;
}

/* Письмо бухгалтеру(ам) о новом отчете сотрудника — на все почты бухгалтеров
   этого же проекта (их может быть несколько). Если почта не настроена
   (см. mail.js) — просто ничего не произойдет, отчет при этом всё равно
   сохранится как обычно. */
async function notifyBuhOfNewReport({ employeeName, projectCode, type, statya, sum, dateIso, contractor, comment, reportNo, isAdvance }) {
  try {
    const buhResult = await pool.query(
      "SELECT email FROM users WHERE role = 'buh' AND project_code = $1",
      [projectCode]
    );
    const emails = buhResult.rows.map((r) => r.email).filter(Boolean);
    if (!emails.length) return;

    const typeLabel = isAdvance ? 'Поступление под отчет' : type === 'income' ? 'Приход' : 'Расход';
    const sumLabel = Number(sum).toLocaleString('ru-RU') + ' ₽';
    const lines = [
      (isAdvance ? 'Новая заявка на выдачу денег под отчет от сотрудника ' : 'Новый отчет на проверку от сотрудника ')
        + employeeName + ' (№' + reportNo + ').',
      '',
      'Тип: ' + typeLabel,
      'Сумма: ' + sumLabel,
      'Дата: ' + dateIso,
    ];
    if (!isAdvance) {
      lines.push('Статья: ' + statya, 'Контрагент: ' + contractor);
    }
    if (comment) lines.push('Комментарий: ' + comment);
    lines.push('', 'Проверить и одобрить можно в кабинете бухгалтера на сайте.');

    await sendMail({
      to: emails,
      subject: 'Альпсервис — новый отчет №' + reportNo + ' (' + employeeName + ')',
      text: lines.join('\n'),
    });
  } catch (e) {
    console.error('[mail] Не удалось отправить уведомление о новом отчете:', e.message);
  }
}

/* ---------- Сотрудник: создать отчет ---------- */
router.post('/', requireAuth, requireRole('sotr'), async (req, res) => {
  let { type, statya, sum, dateIso, contractor, comment, fileIds, isAdvance } = req.body || {};
  isAdvance = !!isAdvance;
  /* "Поступление под отчет" — это всегда приход, без статьи из обычного
     списка и без контрагента (сотрудник выбирает только сумму и дату) —
     остальное подставляем сами, см. ADVANCE_STATYA/ADVANCE_CONTRACTOR выше. */
  if (isAdvance) {
    type = 'income';
    statya = ADVANCE_STATYA;
    contractor = ADVANCE_CONTRACTOR;
  }
  if (!type || !statya || !sum || !dateIso || !contractor) {
    return res.status(400).json({ error: 'Заполните статью, сумму, дату и контрагента' });
  }
  if (isFutureDate(dateIso)) {
    return res.status(400).json({ error: 'Дата отчета не может быть в будущем' });
  }
  if (isOutsideCurrentMonth(dateIso)) {
    return res.status(400).json({ error: 'Дата операции должна быть в пределах текущего месяца' });
  }
  try {
    const userResult = await pool.query(
      'SELECT project_code, legal_entity, legal_entity_okpo, project_customer, full_name FROM users WHERE id = $1',
      [req.user.sub]
    );
    const projectCode = userResult.rows[0] ? userResult.rows[0].project_code : null;
    /* legal_entity и project_customer "фотографируем" с сотрудника именно в
       момент отправки отчета (как и project_code) — если бухгалтер потом
       переведет сотрудника в другой проект или юрлицо, этот уже отправленный
       отчет навсегда останется с тем юрлицом/заказчиком, какие были сейчас. */
    const legalEntity = userResult.rows[0] ? userResult.rows[0].legal_entity : null;
    const legalEntityOkpo = userResult.rows[0] ? userResult.rows[0].legal_entity_okpo : null;
    const projectCustomer = userResult.rows[0] ? userResult.rows[0].project_customer : null;
    const employeeName = userResult.rows[0] ? userResult.rows[0].full_name : '';

    // Свой порядковый номер у каждого сотрудника (№1, №2, №3... независимо от остальных)
    const seqResult = await pool.query(
      'SELECT COALESCE(MAX(report_no), 0) + 1 AS next_no FROM reports WHERE employee_id = $1',
      [req.user.sub]
    );
    const reportNo = seqResult.rows[0].next_no;

    const result = await pool.query(
      `INSERT INTO reports (employee_id, report_no, project_code, legal_entity, legal_entity_okpo, project_customer, type, statya, sum, date_iso, contractor, comment, status, is_advance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13) RETURNING *`,
      [req.user.sub, reportNo, projectCode, legalEntity, legalEntityOkpo, projectCustomer, type, statya, sum, dateIso, contractor, comment || '', isAdvance]
    );
    const report = result.rows[0];

    if (Array.isArray(fileIds) && fileIds.length) {
      await pool.query('UPDATE report_files SET report_id = $1 WHERE id = ANY($2)', [report.id, fileIds]);
    }

    notifyBuhOfNewReport({
      employeeName, projectCode, type, statya, sum, dateIso, contractor, comment, reportNo,
      isAdvance,
    });

    res.status(201).json({ report: serializeReport(report) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось создать отчет' });
  }
});

/* ---------- Сотрудник: мои отчеты ---------- */
router.get('/mine', requireAuth, requireRole('sotr'), async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM reports WHERE employee_id = $1 ORDER BY date_iso DESC, created_at DESC',
    [req.user.sub]
  );
  const withFiles = await attachFiles(result.rows);
  res.json({ reports: withFiles.map((r) => serializeReport(r)) });
});

/* ---------- Сотрудник: отредактировать и повторно отправить отклонённый/любой свой отчет ---------- */
router.patch('/:id', requireAuth, requireRole('sotr'), async (req, res) => {
  const { statya, sum, dateIso, contractor, comment } = req.body || {};
  if (isFutureDate(dateIso)) {
    return res.status(400).json({ error: 'Дата отчета не может быть в будущем' });
  }
  if (isOutsideCurrentMonth(dateIso)) {
    return res.status(400).json({ error: 'Дата операции должна быть в пределах текущего месяца' });
  }
  try {
    const existing = await pool.query('SELECT * FROM reports WHERE id = $1 AND employee_id = $2', [req.params.id, req.user.sub]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Отчет не найден' });
    if (existing.rows[0].status === 'approved') {
      return res.status(400).json({ error: 'Одобренный отчет нельзя редактировать' });
    }
    const result = await pool.query(
      `UPDATE reports SET statya = COALESCE($1, statya), sum = COALESCE($2, sum),
        date_iso = COALESCE($3, date_iso), contractor = COALESCE($4, contractor), comment = COALESCE($5, comment),
        status = 'pending', reviewer_comment = '', updated_at = now()
       WHERE id = $6 RETURNING *`,
      [statya, sum, dateIso, contractor, comment, req.params.id]
    );
    res.json({ report: serializeReport(result.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось изменить отчет' });
  }
});

/* ---------- Бухгалтер: все отчеты своего проекта (+ руководитель видит всё) ---------- */
router.get('/', requireAuth, requireRole('buh', 'ruk'), async (req, res) => {
  const { status } = req.query;
  try {
    let query = `SELECT r.*, u.full_name AS employee_full_name FROM reports r
                 JOIN users u ON u.id = r.employee_id WHERE 1=1`;
    const params = [];

    if (req.user.role === 'buh') {
      const userResult = await pool.query('SELECT project_code FROM users WHERE id = $1', [req.user.sub]);
      const projectCode = userResult.rows[0] ? userResult.rows[0].project_code : null;
      params.push(projectCode);
      query += ` AND r.project_code = $${params.length}`;
    }
    if (status && status !== 'all') {
      params.push(status);
      query += ` AND r.status = $${params.length}`;
    }
    query += ' ORDER BY r.date_iso DESC, r.created_at DESC';

    const result = await pool.query(query, params);
    const withFiles = await attachFiles(result.rows);
    res.json({
      reports: withFiles.map((r) => serializeReport(r, { id: r.employee_id, full_name: r.employee_full_name })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось загрузить отчеты' });
  }
});

/* ---------- Регистрация сотрудника (кабинет руководителя или бухгалтера) ----------
   Раньше сотрудник мог зарегистрироваться сам, с главного экрана входа —
   теперь эту возможность убрали (см. routes-auth.js POST /register), и
   завести нового сотрудника может только руководитель (любой проект) или
   бухгалтер (только в свой собственный проект — шифр проекта в этом случае
   подставляется автоматически, даже если в запросе прислали другой, чтобы
   бухгалтер не мог "завести" сотрудника в чужой проект).
   Пароль, как и у бухгалтеров (см. routes-accountants.js), — временный,
   показывается один раз в ответе на этот запрос, дальше сотрудник обязан
   сменить его сам при первом входе. */
router.post('/employees', requireAuth, requireRole('buh', 'ruk'), async (req, res) => {
  const {
    email, fullName, phone, position, tabelNumber,
    projectCode, projectCustomer, legalEntity, legalEntityOkpo, employeeCategory,
  } = req.body || {};
  if (!email || !fullName) {
    return res.status(400).json({ error: 'Укажите почту и ФИО' });
  }
  if (!legalEntity) {
    return res.status(400).json({ error: 'Укажите юридическое лицо' });
  }
  const category = employeeCategory === 'itr' ? 'itr' : 'aup';
  const normalizedEmail = String(email).trim().toLowerCase();
  try {
    let finalProjectCode = projectCode || null;
    if (req.user.role === 'buh') {
      const myResult = await pool.query('SELECT project_code FROM users WHERE id = $1', [req.user.sub]);
      finalProjectCode = myResult.rows[0] ? myResult.rows[0].project_code : null;
    } else if (!finalProjectCode) {
      return res.status(400).json({ error: 'Укажите шифр проекта' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Такая почта уже зарегистрирована' });
    }
    const tempPassword = crypto.randomBytes(6).toString('base64url');
    const hash = await bcrypt.hash(tempPassword, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, full_name, phone, position, tabel_number,
         project_code, project_customer, legal_entity, legal_entity_okpo, employee_category, must_change_password)
       VALUES ($1, $2, 'sotr', $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
       RETURNING id, email, full_name, project_code, project_customer, legal_entity, legal_entity_okpo, employee_category`,
      [normalizedEmail, hash, fullName, phone || null, position || null, tabelNumber || null,
        finalProjectCode, projectCustomer || null, legalEntity, legalEntityOkpo || null, category]
    );
    const r = result.rows[0];
    res.status(201).json({
      employee: {
        id: r.id, email: r.email, fullName: r.full_name, projectCode: r.project_code,
        projectCustomer: r.project_customer, legalEntity: r.legal_entity,
        legalEntityOkpo: r.legal_entity_okpo, employeeCategory: r.employee_category,
      },
      tempPassword,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось зарегистрировать сотрудника' });
  }
});

/* ---------- Список сотрудников ----------
   Бухгалтер видит только сотрудников своего проекта (как и раньше — нужно
   для страницы "Выгрузка отчетов"). Руководитель видит всех сотрудников
   во всех проектах (своего отдельного проекта у него нет). */
/* "Выдано" и "потрачено" считаем ЖИВЬЕМ, суммой ОДОБРЕННЫХ отчетов сотрудника:
   выдано — сумма его отчетов прихода (income), потрачено — сумма отчетов
   расхода (expense). Раньше "выдано" было отдельным полем advance_amount,
   которое сотрудник вписывал вручную (или которое прибавлялось при одобрении
   операции "Поступление под отчет") — по просьбе клиента это убрали: ручного
   поля больше нет, и быть отдельного "особого" случая для операции "Под
   отчет" тоже больше не должно — она такой же приходный отчет, как и любой
   другой, и участвует в сумме наравне со всеми. */
const EMPLOYEE_LIST_COLUMNS = `
  u.id, u.full_name, u.project_code, u.legal_entity, u.legal_entity_okpo,
  u.employee_category, u.project_customer,
  COALESCE((
    SELECT SUM(r.sum) FROM reports r
    WHERE r.employee_id = u.id AND r.type = 'income' AND r.status = 'approved'
  ), 0) AS advance_amount,
  COALESCE((
    SELECT SUM(r.sum) FROM reports r
    WHERE r.employee_id = u.id AND r.type = 'expense' AND r.status = 'approved'
  ), 0) AS spent
`;

router.get('/employees', requireAuth, requireRole('buh', 'ruk'), async (req, res) => {
  try {
    let result;
    if (req.user.role === 'ruk') {
      result = await pool.query(
        `SELECT ${EMPLOYEE_LIST_COLUMNS} FROM users u WHERE u.role = 'sotr' ORDER BY u.full_name`
      );
    } else {
      const userResult = await pool.query('SELECT project_code FROM users WHERE id = $1', [req.user.sub]);
      const projectCode = userResult.rows[0] ? userResult.rows[0].project_code : null;
      result = await pool.query(
        `SELECT ${EMPLOYEE_LIST_COLUMNS} FROM users u WHERE u.role = 'sotr' AND u.project_code = $1 ORDER BY u.full_name`,
        [projectCode]
      );
    }
    res.json({
      employees: result.rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        projectCode: r.project_code,
        legalEntity: r.legal_entity,
        legalEntityOkpo: r.legal_entity_okpo,
        employeeCategory: r.employee_category,
        projectCustomer: r.project_customer,
        advanceAmount: Number(r.advance_amount),
        spent: Number(r.spent),
        remain: Number(r.advance_amount) - Number(r.spent),
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось загрузить список сотрудников' });
  }
});

/* ---------- Бухгалтер: перевести сотрудника в другой проект/юрлицо ----------
   Меняет ТОЛЬКО project_code / legal_entity / project_customer — пароль,
   почту, ФИО и остальные данные сотрудника не трогаем, менять их не нужно.
   Разрешено только для сотрудника, который сейчас числится в проекте этого
   же бухгалтера (иначе чужой бухгалтер мог бы "перетащить к себе" кого-то
   из другого проекта одним запросом).
   Важно: уже отправленные отчеты сотрудника не меняются — у каждого отчета
   свой "снимок" проекта/юрлица на момент отправки (см. комментарий в
   schema.sql), поэтому старые выгрузки и АО-1 останутся как были. Меняется
   только то, что будет происходить ДАЛЬШЕ: в какой кабинет бухгалтера
   сотрудник попадет при следующей отправке отчета и кто сможет её проверить.
   Если бухгалтера нового проекта в системе еще нет — его нужно сначала
   завести в разделе "Бухгалтеры" (это делает руководитель), иначе отчеты
   сотрудника дальше просто не будут попадать ни к какому бухгалтеру. */
router.patch('/employees/:id', requireAuth, requireRole('buh', 'ruk'), async (req, res) => {
  const { projectCode, legalEntity, legalEntityOkpo, employeeCategory, projectCustomer } = req.body || {};
  try {
    if (req.user.role === 'buh') {
      const userResult = await pool.query('SELECT project_code FROM users WHERE id = $1', [req.user.sub]);
      const myProjectCode = userResult.rows[0] ? userResult.rows[0].project_code : null;
      const existing = await pool.query(
        "SELECT id FROM users WHERE id = $1 AND role = 'sotr' AND project_code = $2",
        [req.params.id, myProjectCode]
      );
      if (!existing.rows[0]) {
        return res.status(404).json({ error: 'Сотрудник не найден в вашем проекте' });
      }
    } else {
      const existing = await pool.query("SELECT id FROM users WHERE id = $1 AND role = 'sotr'", [req.params.id]);
      if (!existing.rows[0]) return res.status(404).json({ error: 'Сотрудник не найден' });
    }

    const category = employeeCategory === 'itr' ? 'itr' : employeeCategory === 'aup' ? 'aup' : null;
    const result = await pool.query(
      `UPDATE users SET project_code = $1, legal_entity = $2, legal_entity_okpo = $3,
         project_customer = $4, employee_category = COALESCE($5, employee_category)
       WHERE id = $6
       RETURNING id, full_name, project_code, legal_entity, legal_entity_okpo, employee_category, project_customer`,
      [projectCode || null, legalEntity || null, legalEntityOkpo || null, projectCustomer || null, category, req.params.id]
    );
    const r = result.rows[0];
    res.json({
      employee: {
        id: r.id, fullName: r.full_name, projectCode: r.project_code,
        legalEntity: r.legal_entity, legalEntityOkpo: r.legal_entity_okpo,
        employeeCategory: r.employee_category, projectCustomer: r.project_customer,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось обновить данные сотрудника' });
  }
});

/* ---------- Общая сборка файла "Управленческий учет" (УО) ----------
   Используется и выгрузкой бухгалтера (/export, по любому сотруднику его
   проекта), и собственной выгрузкой сотрудника (/export/mine, только свои
   отчеты) — чтобы формат файла (колонки, названия) был гарантированно
   одинаковым в обоих местах. employeeName — имя "по умолчанию" для колонки
   "Банковский счёт", если у строки нет своего employee_full_name (так и
   бывает при /export/mine, где строки не джойнятся с users). */
function buildUoWorkbook(rows, employeeName) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Управленческий учет');
  ws.columns = [
    { header: 'Дата операции', key: 'dateOperation', width: 14 },
    { header: 'Сумма операции', key: 'sum', width: 16 },
    { header: 'Статья', key: 'statya', width: 34 },
    { header: 'Назначение платежа', key: 'comment', width: 36 },
    { header: 'Проект', key: 'project', width: 30 },
    { header: 'Контрагент', key: 'contractor', width: 26 },
    { header: 'Банковский счёт', key: 'account', width: 26 },
    { header: 'Дата начисления', key: 'accrualDate', width: 16 },
    { header: 'Юридическое лицо', key: 'legalEntity', width: 26 },
  ];
  ws.getRow(1).font = { bold: true };

  rows.forEach((r) => {
    ws.addRow({
      dateOperation: new Date(r.date_iso),
      /* Сумма всегда положительная — приход это или расход, видно по статье
         (она сама называется "расход..." или "приход..."), отдельный знак
         "минус" не нужен и только путает. */
      sum: Number(r.sum),
      statya: r.statya,
      comment: r.comment || '',
      project: [r.project_code, r.project_customer].filter(Boolean).join(' — '),
      contractor: r.contractor || '',
      account: r.employee_full_name || employeeName || '',
      accrualDate: new Date(r.created_at),
      legalEntity: r.legal_entity || '',
    });
  });
  ws.getColumn('dateOperation').numFmt = 'dd.mm.yyyy';
  ws.getColumn('accrualDate').numFmt = 'dd.mm.yyyy';
  ws.getColumn('sum').numFmt = '#,##0.00';
  return wb;
}

/* ---------- Бухгалтер: выгрузка в Excel для управленческого учета ----------
   Таблица строго по шаблону клиента: 9 колонок в этом порядке, названия не
   менять. По умолчанию — только одобренные отчеты (неподтвержденные решения
   еще не "случились" официально), за период from..to (по дате операции).
   Если период (from/to) не выбран — показываем ВЕСЬ период, а не только
   текущий месяц: иначе сотрудник со старыми (например, перенесенными)
   отчетами в выгрузке выглядел бы так, будто у него вообще нет отчетов,
   хотя они просто вне "умолчательного" месяца.
   Выгрузка всегда по одному конкретному сотруднику (employeeId) — общей
   выгрузки по всем сотрудникам сразу нет (решили не делать, это усложнение). */
router.get('/export', requireAuth, requireRole('buh'), async (req, res) => {
  const { from, to, status, employeeId } = req.query;
  if (!employeeId) {
    return res.status(400).json({ error: 'Не указан сотрудник для выгрузки' });
  }
  try {
    const userResult = await pool.query('SELECT project_code FROM users WHERE id = $1', [req.user.sub]);
    const projectCode = userResult.rows[0] ? userResult.rows[0].project_code : null;

    /* Сотрудника пускаем сюда не только если он СЕЙЧАС числится в проекте
       этого бухгалтера, но и если у него раньше уже были отчеты по этому
       проекту (вдруг его потом перевели в другой проект) — иначе бухгалтер
       потерял бы доступ к выгрузке по своим же старым, уже одобренным
       отчетам только из-за того, что сотрудник позже сменил проект. */
    const employeeResult = await pool.query(
      `SELECT full_name FROM users u WHERE u.id = $1 AND u.role = 'sotr'
       AND (u.project_code = $2 OR EXISTS (SELECT 1 FROM reports r WHERE r.employee_id = u.id AND r.project_code = $2))`,
      [employeeId, projectCode]
    );
    if (!employeeResult.rows[0]) {
      return res.status(404).json({ error: 'Сотрудник не найден' });
    }
    const employeeName = employeeResult.rows[0].full_name || 'sotrudnik';

    /* legal_entity и project_customer теперь берем из самого отчета (снимок
       на момент отправки), а не живым JOIN-ом с users — иначе смена юрлица
       сотрудника задним числом поменяла бы уже сформированные ранее отчеты. */
    let query = `SELECT r.*, u.full_name AS employee_full_name
                 FROM reports r JOIN users u ON u.id = r.employee_id
                 WHERE r.project_code = $1 AND r.employee_id = $2`;
    const params = [projectCode, employeeId];

    params.push(status && status !== 'all' ? status : 'approved');
    query += ` AND r.status = $${params.length}`;

    if (from) { params.push(from); query += ` AND r.date_iso >= $${params.length}`; }
    if (to) { params.push(to); query += ` AND r.date_iso <= $${params.length}`; }
    query += ' ORDER BY r.date_iso ASC, r.created_at ASC';

    const result = await pool.query(query, params);

    const wb = buildUoWorkbook(result.rows, employeeName);

    const asciiName = 'upravlenchesky-uchet-' + (from || 'vse') + '_' + (to || 'vse') + '.xlsx';
    const prettyName = 'УО ' + employeeName + ' ' + (from || 'весь период') + '—' + (to || 'весь период') + '.xlsx';
    /* Важно: сначала полностью собираем файл в памяти (writeBuffer), и только
       потом одним куском отправляем его целиком (res.end(buffer)), с точным
       Content-Length. Раньше файл писался сразу "в сокет" (wb.xlsx.write(res))
       прямо во время скачивания — на медленном или нестабильном интернете
       (как на настоящем хостинге, не на локальном компьютере) это иногда
       обрывало файл на середине, и Excel potom не мог его открыть ("ошибка
       в части содержимого", пустой файл после восстановления). Способ ниже
       от этого не зависит. */
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodeURIComponent(prettyName)
    );
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось сформировать выгрузку' });
  }
});

/* ---------- Сотрудник: собственная выгрузка в Excel ----------
   Тот же файл "Управленческий учет" (УО), что скачивает бухгалтер, но
   только по своим отчетам — сотруднику не нужен employeeId (это всегда он
   сам), и доступ не привязан к проекту бухгалтера. Если период (from/to) не
   выбран — выгружаются вообще все свои одобренные отчеты, за всё время. */
router.get('/export/mine', requireAuth, requireRole('sotr'), async (req, res) => {
  const { from, to } = req.query;
  try {
    const userResult = await pool.query('SELECT full_name FROM users WHERE id = $1', [req.user.sub]);
    const employeeName = userResult.rows[0] ? userResult.rows[0].full_name : 'sotrudnik';

    let query = `SELECT * FROM reports WHERE employee_id = $1 AND status = 'approved'`;
    const params = [req.user.sub];
    if (from) { params.push(from); query += ` AND date_iso >= $${params.length}`; }
    if (to) { params.push(to); query += ` AND date_iso <= $${params.length}`; }
    query += ' ORDER BY date_iso ASC, created_at ASC';
    const result = await pool.query(query, params);

    const wb = buildUoWorkbook(result.rows, employeeName);

    const asciiName = 'moy-otchet-' + (from || 'vse') + '_' + (to || 'vse') + '.xlsx';
    const prettyName = 'ОДДС ' + employeeName + ' ' + (from || 'весь период') + '—' + (to || 'весь период') + '.xlsx';
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodeURIComponent(prettyName)
    );
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось сформировать выгрузку' });
  }
});

/* ---------- Бухгалтер: официальный бланк АО-1 ----------
   Унифицированная форма №АО-1 (постановление Госкомстата России от 01.08.2001
   №55), заполненная данными одного сотрудника за период — одобренные отчеты
   по расходам (приходы в АО-1 не включаются, это форма только по авансу). */
router.get('/ao1', requireAuth, requireRole('buh'), async (req, res) => {
  const { from, to, employeeId } = req.query;
  if (!employeeId) {
    return res.status(400).json({ error: 'Не указан сотрудник для выгрузки' });
  }
  try {
    const userResult = await pool.query('SELECT project_code FROM users WHERE id = $1', [req.user.sub]);
    const projectCode = userResult.rows[0] ? userResult.rows[0].project_code : null;

    /* Та же логика, что и в /export: пускаем сотрудника сюда, если он сейчас
       в проекте этого бухгалтера, ИЛИ если у него раньше уже были тут отчеты
       (на случай, если его потом перевели в другой проект) — чтобы перевод
       сотрудника не отрезал бухгалтера от его же старых одобренных отчетов. */
    const employeeResult = await pool.query(
      `SELECT u.full_name, u.tabel_number, u.position, u.legal_entity, u.legal_entity_okpo, u.project_customer,
         COALESCE((
           SELECT SUM(r.sum) FROM reports r
           WHERE r.employee_id = u.id AND r.type = 'income' AND r.status = 'approved'
         ), 0) AS advance_amount
       FROM users u
       WHERE u.id = $1 AND u.role = 'sotr'
       AND (u.project_code = $2 OR EXISTS (SELECT 1 FROM reports r WHERE r.employee_id = u.id AND r.project_code = $2))`,
      [employeeId, projectCode]
    );
    if (!employeeResult.rows[0]) {
      return res.status(404).json({ error: 'Сотрудник не найден' });
    }
    const emp = employeeResult.rows[0];

    const directorResult = await pool.query("SELECT full_name FROM users WHERE role = 'ruk' ORDER BY created_at LIMIT 1");
    const directorName = directorResult.rows[0] ? directorResult.rows[0].full_name : '';

    let query = `SELECT * FROM reports WHERE project_code = $1 AND employee_id = $2 AND type = 'expense' AND status = 'approved'`;
    const params = [projectCode, employeeId];
    if (from) { params.push(from); query += ` AND date_iso >= $${params.length}`; }
    if (to) { params.push(to); query += ` AND date_iso <= $${params.length}`; }
    query += ' ORDER BY date_iso ASC, created_at ASC';
    const result = await pool.query(query, params);

    /* Юрлицо и заказчика проекта для бланка берем из снимка в самих отчетах
       (если в выборке есть хоть один отчет), а не из текущей карточки
       сотрудника — так бланк за старый период не "переедет" на новое
       юрлицо, если сотрудника к этому моменту уже перевели. Если отчетов за
       период нет (бланк будет пустой) — берем текущие данные сотрудника. */
    const snapshotLegalEntity = result.rows[0] ? result.rows[0].legal_entity : null;
    const snapshotLegalEntityOkpo = result.rows[0] ? result.rows[0].legal_entity_okpo : null;
    const snapshotProjectCustomer = result.rows[0] ? result.rows[0].project_customer : null;
    const projectLabel = [projectCode, snapshotProjectCustomer || emp.project_customer].filter(Boolean).join(' — ');
    const zip = await buildAo1Workbook({
      employee: {
        fullName: emp.full_name,
        tabelNumber: emp.tabel_number,
        position: emp.position,
        legalEntity: snapshotLegalEntity || emp.legal_entity,
        legalEntityOkpo: snapshotLegalEntityOkpo || emp.legal_entity_okpo,
        advanceAmount: emp.advance_amount,
      },
      reports: result.rows,
      projectLabel,
      directorName,
      periodTo: to,
    });

    const asciiName = 'ao1-' + (from || 'vse') + '_' + (to || 'vse') + '.xlsx';
    const prettyName = 'АО-1 ' + emp.full_name + ' ' + (from || 'весь период') + '—' + (to || 'весь период') + '.xlsx';
    /* Собираем файл целиком в памяти и отдаем одним куском, а не "на лету"
       прямо в скачивание, чтобы файл не мог оборваться на середине при
       нестабильном интернете. buildAo1Workbook теперь не пересобирает файл
       целиком через ExcelJS (это и было источником проблем с "ошибка в
       части содержимого") — она берет оригинальный бланк клиента и меняет
       в нем только нужные ячейки, поэтому дополнительная "починка" после
       сборки больше не нужна. */
    const buffer = await fixRowAddressMismatches(zip);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodeURIComponent(prettyName)
    );
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось сформировать АО-1' });
  }
});

/* ---------- Бухгалтер: одобрить/отклонить (в т.ч. поменять уже принятое решение) ----------
   "Выдано на руки" у сотрудника теперь считается сам живым подсчетом суммы
   его одобренных отчетов прихода (см. EMPLOYEE_LIST_COLUMNS выше и /ao1
   ниже) — поэтому отдельно обновлять какое-то число на самом сотруднике
   здесь больше не нужно: как только отчет "Поступление под отчет" (или
   любой другой приход) становится одобренным, он тут же учтется в этой
   сумме сам, без какого-то отдельного шага. */
router.patch('/:id/decision', requireAuth, requireRole('buh'), async (req, res) => {
  const { status, reviewerComment } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status должен быть approved или rejected' });
  }
  if (status === 'rejected' && !reviewerComment) {
    return res.status(400).json({ error: 'При отклонении нужен комментарий' });
  }
  try {
    const userResult = await pool.query('SELECT project_code FROM users WHERE id = $1', [req.user.sub]);
    const projectCode = userResult.rows[0] ? userResult.rows[0].project_code : null;

    const existing = await pool.query('SELECT * FROM reports WHERE id = $1 AND project_code = $2', [req.params.id, projectCode]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Отчет не найден' });

    const result = await pool.query(
      `UPDATE reports SET status = $1, reviewer_comment = $2, reviewer_id = $3, updated_at = now()
       WHERE id = $4 RETURNING *`,
      [status, reviewerComment || '', req.user.sub, req.params.id]
    );
    const report = result.rows[0];

    res.json({ report: serializeReport(report) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось сохранить решение' });
  }
});

module.exports = router;
