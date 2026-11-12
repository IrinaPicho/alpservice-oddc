const https = require('https');
const { pool } = require('./db');

/* ---------- Telegram-бот для напоминаний сотрудникам ----------
   Каждый сотрудник один раз пишет боту (находит его в Telegram по имени
   пользователя, нажимает Start), бот просит прислать рабочую почту (ту
   же, что для входа в приложение) и сохраняет chat_id в карточке
   сотрудника. Дальше каждый день в 18:00 по московскому времени, если у
   сотрудника ещё нет отчёта за сегодня — бот присылает напоминание.

   Работает через long polling (без вебхука и отдельного домена) — бот
   сам раз за разом спрашивает Telegram "есть что-то новое?" и обрабатывает
   ответ. Если TELEGRAM_BOT_TOKEN не задан — бот просто не запускается,
   сайт при этом продолжает работать как обычно, без бота. */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let offset = 0;
let warned = false;

function isConfigured() {
  return !!TOKEN;
}

function tgCall(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params || {});
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/${method}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendMessage(chatId, text) {
  return tgCall('sendMessage', { chat_id: chatId, text }).catch((e) => {
    console.error('[telegram] Не удалось отправить сообщение:', e.message);
  });
}

async function handleMessage(msg) {
  const chatId = msg.chat && msg.chat.id;
  const text = (msg.text || '').trim();
  if (!chatId) return;

  if (text.startsWith('/start')) {
    await sendMessage(
      chatId,
      'Здравствуйте! Чтобы получать напоминание о заполнении отчёта, пришлите, пожалуйста, вашу рабочую почту (ту же, что для входа в приложение Альпсервис).'
    );
    return;
  }

  const email = text.toLowerCase();
  if (!email.includes('@')) {
    await sendMessage(chatId, 'Это не похоже на почту. Пришлите, пожалуйста, вашу рабочую почту для входа в приложение.');
    return;
  }

  try {
    const result = await pool.query(
      "SELECT id, full_name FROM users WHERE role = 'sotr' AND email = $1",
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      await sendMessage(
        chatId,
        'Не нашла такую почту среди сотрудников. Проверьте, пожалуйста, что ввели её без опечаток — именно ту, с которой входите в приложение.'
      );
      return;
    }
    await pool.query('UPDATE users SET telegram_chat_id = $1 WHERE id = $2', [chatId, user.id]);
    await sendMessage(
      chatId,
      `Готово, ${user.full_name}! Теперь, если вы не заполните отчёт за день, в 18:00 по Москве пришлю напоминание сюда.`
    );
  } catch (e) {
    console.error('[telegram] Ошибка привязки почты:', e.message);
    await sendMessage(chatId, 'Что-то пошло не так, попробуйте ещё раз чуть позже.');
  }
}

async function pollOnce() {
  const result = await tgCall('getUpdates', { offset, timeout: 30 });
  if (!result || !result.ok || !Array.isArray(result.result)) return;
  for (const update of result.result) {
    offset = update.update_id + 1;
    if (update.message) {
      await handleMessage(update.message);
    }
  }
}

async function pollLoop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pollOnce();
    } catch (e) {
      console.error('[telegram] Ошибка при опросе Telegram:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

/* ---------- Напоминание в 18:00 тем, кто ещё не заполнил отчёт сегодня ---------- */
function todayMoscowIso() {
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

async function sendReportReminders() {
  const todayIso = todayMoscowIso();
  try {
    const result = await pool.query(
      `SELECT u.id, u.telegram_chat_id FROM users u
       WHERE u.role = 'sotr' AND u.telegram_chat_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM reports r WHERE r.employee_id = u.id AND r.date_iso = $1
         )`,
      [todayIso]
    );
    for (const row of result.rows) {
      await sendMessage(
        row.telegram_chat_id,
        'Напоминание: сегодня вы ещё не заполнили отчёт. Пожалуйста, не забудьте внести его в приложение.'
      );
    }
  } catch (e) {
    console.error('[telegram] Не удалось разослать напоминания:', e.message);
  }
}

let lastSentIso = null;
function startReminderScheduler() {
  setInterval(() => {
    if (moscowHourMinute() !== '18:00') return;
    const todayIso = todayMoscowIso();
    if (lastSentIso === todayIso) return;
    lastSentIso = todayIso;
    sendReportReminders();
  }, 60 * 1000);
}

function startTelegramBot() {
  if (!isConfigured()) {
    if (!warned) {
      console.warn('[telegram] TELEGRAM_BOT_TOKEN не задан — напоминания сотрудникам работать не будут.');
      warned = true;
    }
    return;
  }
  pollLoop();
  startReminderScheduler();
  console.log('[telegram] Бот запущен, ждёт сообщений сотрудников.');
}

module.exports = { startTelegramBot, sendReportReminders };
