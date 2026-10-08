const express = require('express');
const ExcelJS = require('exceljs');
const { pool } = require('./db');
const { requireAuth, requireRole } = require('./jwt');
const { buildAo1Workbook } = require('./ao1');

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
    files: row.files || [],
  };
}

/* ---------- Сотрудник: создать отчет ---------- */
router.post('/', requireAuth, requireRole('sotr'), async (req, res) => {
  const { type, statya, sum, dateIso, contractor, comment, fileIds } = req.body || {};
  if (!type || !statya || !sum || !dateIso || !contractor) {
    return res.status(400).json({ error: 'Заполните статью, сумму, дату и контрагента' });
  }
  try {
    const userResult = await pool.query('SELECT project_code FROM users WHERE id = $1', [req.user.sub]);
    const projectCode = userResult.rows[0] ? userResult.rows[0].project_code : null;

    // Свой порядковый номер у каждого сотрудника (№1, №2, №3... независимо от остальных)
    const seqResult = await pool.query(
      'SELECT COALESCE(MAX(report_no), 0) + 1 AS next_no FROM reports WHERE employee_id = $1',
      [req.user.sub]
    );
    const reportNo = seqResult.rows[0].next_no;

    const result = await pool.query(
      `INSERT INTO reports (employee_id, report_no, project_code, type, statya, sum, date_iso, contractor, comment, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending') RETURNING *`,
      [req.user.sub, reportNo, projectCode, type, statya, sum, dateIso, contractor, comment || '']
    );
    const report = result.rows[0];

    if (Array.isArray(fileIds) && fileIds.length) {
      await pool.query('UPDATE report_files SET report_id = $1 WHERE id = ANY($2)', [report.id, fileIds]);
    }

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

/* ---------- Бухгалтер: список сотрудников своего проекта ----------
   Нужен для страницы "Выгрузка отчетов" — показать список, по кому можно
   сделать выгрузку, без отдельного запроса по каждому отчету. */
router.get('/employees', requireAuth, requireRole('buh'), async (req, res) => {
  try {
    const userResult = await pool.query('SELECT project_code FROM users WHERE id = $1', [req.user.sub]);
    const projectCode = userResult.rows[0] ? userResult.rows[0].project_code : null;

    const result = await pool.query(
      "SELECT id, full_name FROM users WHERE role = 'sotr' AND project_code = $1 ORDER BY full_name",
      [projectCode]
    );
    res.json({ employees: result.rows.map((r) => ({ id: r.id, fullName: r.full_name })) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось загрузить список сотрудников' });
  }
});

/* ---------- Бухгалтер: выгрузка в Excel для управленческого учета ----------
   Таблица строго по шаблону клиента: 9 колонок в этом порядке, названия не
   менять. По умолчанию — только одобренные отчеты (неподтвержденные решения
   еще не "случились" официально), за период from..to (по дате операции).
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

    const employeeResult = await pool.query(
      "SELECT full_name FROM users WHERE id = $1 AND role = 'sotr' AND project_code = $2",
      [employeeId, projectCode]
    );
    if (!employeeResult.rows[0]) {
      return res.status(404).json({ error: 'Сотрудник не найден' });
    }
    const employeeName = employeeResult.rows[0].full_name || 'sotrudnik';

    let query = `SELECT r.*, u.full_name AS employee_full_name, u.legal_entity AS employee_legal_entity,
                   u.project_customer AS employee_project_customer
                 FROM reports r JOIN users u ON u.id = r.employee_id
                 WHERE r.project_code = $1 AND r.employee_id = $2`;
    const params = [projectCode, employeeId];

    params.push(status && status !== 'all' ? status : 'approved');
    query += ` AND r.status = $${params.length}`;

    if (from) { params.push(from); query += ` AND r.date_iso >= $${params.length}`; }
    if (to) { params.push(to); query += ` AND r.date_iso <= $${params.length}`; }
    query += ' ORDER BY r.date_iso ASC, r.created_at ASC';

    const result = await pool.query(query, params);

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

    result.rows.forEach((r) => {
      ws.addRow({
        dateOperation: new Date(r.date_iso),
        sum: r.type === 'income' ? Number(r.sum) : -Number(r.sum),
        statya: r.statya,
        comment: r.comment || '',
        project: [r.project_code, r.employee_project_customer].filter(Boolean).join(' — '),
        contractor: r.contractor || '',
        account: r.employee_full_name || '',
        accrualDate: new Date(r.created_at),
        legalEntity: r.employee_legal_entity || '',
      });
    });
    ws.getColumn('dateOperation').numFmt = 'dd.mm.yyyy';
    ws.getColumn('accrualDate').numFmt = 'dd.mm.yyyy';
    ws.getColumn('sum').numFmt = '#,##0.00';

    const asciiName = 'upravlenchesky-uchet-' + (from || 'vse') + '_' + (to || 'vse') + '.xlsx';
    const prettyName = 'УО ' + employeeName + ' ' + (from || 'весь период') + '—' + (to || 'весь период') + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodeURIComponent(prettyName)
    );
    await wb.xlsx.write(res);
    res.end();
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

    const employeeResult = await pool.query(
      "SELECT full_name, tabel_number, position, legal_entity, project_customer, advance_amount FROM users WHERE id = $1 AND role = 'sotr' AND project_code = $2",
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

    const projectLabel = [projectCode, emp.project_customer].filter(Boolean).join(' — ');
    const wb = await buildAo1Workbook({
      employee: {
        fullName: emp.full_name,
        tabelNumber: emp.tabel_number,
        position: emp.position,
        legalEntity: emp.legal_entity,
        advanceAmount: emp.advance_amount,
      },
      reports: result.rows,
      projectLabel,
      directorName,
      periodTo: to,
    });

    const asciiName = 'ao1-' + (from || 'vse') + '_' + (to || 'vse') + '.xlsx';
    const prettyName = 'АО-1 ' + emp.full_name + ' ' + (from || 'весь период') + '—' + (to || 'весь период') + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodeURIComponent(prettyName)
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось сформировать АО-1' });
  }
});

/* ---------- Бухгалтер: одобрить/отклонить (в т.ч. поменять уже принятое решение) ---------- */
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
    res.json({ report: serializeReport(result.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось сохранить решение' });
  }
});

module.exports = router;
