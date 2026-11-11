const ExcelJS = require('exceljs');
const { pool } = require('./db');
const { sendMail } = require('./mail');

/* ---------- Сводка дня бухгалтерам ----------
   Каждый день в 18:00 по московскому времени каждому бухгалтеру уходит одно
   письмо с Excel-файлами по его сотрудникам: один сотрудник — один файл
   (вложение), в файле — все ЕГО отчеты за сегодня (и приходы, и расходы,
   любого статуса — это сводка "что сегодня происходило", а не только
   одобренное, как в выгрузке УО). Если у сотрудника сегодня отчетов не
   было — вложение для него просто не делается. Если у бухгалтера вообще
   ни у кого за сегодня отчетов нет — письмо этому бухгалтеру не шлем.

   Время московское (не время сервера) — потому что это часовой пояс, в
   котором живет и работает клиент, а сервер может технически стоять где
   угодно и с другим системным временем. */

function todayMoscowIso() {
  // en-CA формат у toLocaleDateString сразу дает готовую строку YYYY-MM-DD
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

function moscowHourMinute() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const hour = (parts.find((p) => p.type === 'hour') || {}).value;
  const minute = (parts.find((p) => p.type === 'minute') || {}).value;
  return hour + ':' + minute;
}

/* ---------- Доп. получатели сводки дня — по юрлицу ----------
   Кроме обычной рассылки бухгалтерам (по проекту, см. ниже), эта же сводка
   дублируется на отдельный адрес для ВСЕХ сотрудников конкретного юрлица —
   независимо от того, в каком они шифре проекта и кто у них бухгалтер.
   Текст юрлица должен совпадать буквально с тем, что стоит в карточке
   сотрудника (поле "Юридическое лицо"), кавычки-елочки «» включительно.
   Если понадобится добавить такую же рассылку для второго юрлица — просто
   добавить еще одну строку в этот список. */
const LEGAL_ENTITY_DIGEST_RECIPIENTS = [
  { legalEntity: 'ООО «ВТР ЗиС»', email: ['vtrzic@yandex.ru', 'irinapichugn@gmail.com'] },
];

const STATUS_LABEL = { pending: 'На проверке', approved: 'Одобрено', rejected: 'Отклонено' };

async function buildEmployeeDayWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Отчеты за день');
  ws.columns = [
    { header: 'Дата операции', key: 'dateOperation', width: 14 },
    { header: 'Тип', key: 'type', width: 12 },
    { header: 'Сумма', key: 'sum', width: 16 },
    { header: 'Статья', key: 'statya', width: 34 },
    { header: 'Назначение платежа', key: 'comment', width: 36 },
    { header: 'Контрагент', key: 'contractor', width: 26 },
    { header: 'Статус', key: 'status', width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => {
    ws.addRow({
      dateOperation: new Date(r.date_iso),
      type: r.type === 'income' ? 'Приход' : 'Расход',
      sum: Number(r.sum),
      statya: r.statya,
      comment: r.comment || '',
      contractor: r.contractor || '',
      status: STATUS_LABEL[r.status] || r.status,
    });
  });
  ws.getColumn('dateOperation').numFmt = 'dd.mm.yyyy';
  ws.getColumn('sum').numFmt = '#,##0.00';
  return wb.xlsx.writeBuffer();
}

/* Для списка сотрудников (id, full_name) собирает вложения — по одному
   Excel-файлу на сотрудника, у кого сегодня были отчеты. У кого отчетов не
   было — для того вложения просто нет. */
async function buildAttachmentsForEmployees(employees, todayIso) {
  const attachments = [];
  for (const emp of employees) {
    const repResult = await pool.query(
      'SELECT * FROM reports WHERE employee_id = $1 AND date_iso = $2 ORDER BY created_at ASC',
      [emp.id, todayIso]
    );
    if (!repResult.rows.length) continue;
    const buffer = await buildEmployeeDayWorkbook(repResult.rows);
    attachments.push({
      filename: 'Отчеты ' + emp.full_name + ' ' + todayIso + '.xlsx',
      content: buffer,
    });
  }
  return attachments;
}

async function sendDailyDigest() {
  const todayIso = todayMoscowIso();
  try {
    const buhResult = await pool.query("SELECT id, email, project_code FROM users WHERE role = 'buh'");
    for (const buh of buhResult.rows) {
      if (!buh.email || !buh.project_code) continue;
      const empResult = await pool.query(
        "SELECT id, full_name FROM users WHERE role = 'sotr' AND project_code = $1 ORDER BY full_name",
        [buh.project_code]
      );

      const attachments = await buildAttachmentsForEmployees(empResult.rows, todayIso);
      if (!attachments.length) continue;

      await sendMail({
        to: buh.email,
        subject: 'Альпсервис — сводка отчетов за ' + todayIso,
        text:
          'Сводка отчетов за сегодня (' + todayIso + ').\n\n' +
          'По каждому сотруднику, у кого сегодня были отчеты (приход или расход, любой статус) — ' +
          'отдельный Excel-файл во вложении.',
        attachments,
      });
    }

    // Дополнительно — по юрлицу, см. LEGAL_ENTITY_DIGEST_RECIPIENTS выше.
    for (const recipient of LEGAL_ENTITY_DIGEST_RECIPIENTS) {
      const empResult = await pool.query(
        "SELECT id, full_name FROM users WHERE role = 'sotr' AND legal_entity = $1 ORDER BY full_name",
        [recipient.legalEntity]
      );
      if (!empResult.rows.length) continue;

      const attachments = await buildAttachmentsForEmployees(empResult.rows, todayIso);
      if (!attachments.length) continue;

      await sendMail({
        to: recipient.email,
        subject: 'Альпсервис — сводка отчетов за ' + todayIso + ' (' + recipient.legalEntity + ')',
        text:
          'Сводка отчетов за сегодня (' + todayIso + ') по сотрудникам юрлица ' + recipient.legalEntity + '.\n\n' +
          'По каждому сотруднику, у кого сегодня были отчеты (приход или расход, любой статус) — ' +
          'отдельный Excel-файл во вложении.',
        attachments,
      });
    }
  } catch (e) {
    console.error('[daily-digest] Не удалось отправить сводку дня:', e.message);
  }
}

/* Простой планировщик без внешних библиотек: раз в минуту проверяем
   московское время, и как только оно стало 18:00 — отправляем сводку (один
   раз за календарный день, см. lastSentIso). Если сервер перезапускался
   ровно в 18:00 и минута была пропущена — сводка просто не уйдет в этот
   день, ничего страшного (если это будет происходить часто — стоит
   перейти на отдельную библиотеку-планировщик). */
let lastSentIso = null;
function startDailyDigestScheduler() {
  setInterval(() => {
    if (moscowHourMinute() !== '18:00') return;
    const todayIso = todayMoscowIso();
    if (lastSentIso === todayIso) return;
    lastSentIso = todayIso;
    sendDailyDigest();
  }, 60 * 1000);
}

module.exports = { startDailyDigestScheduler, sendDailyDigest };
