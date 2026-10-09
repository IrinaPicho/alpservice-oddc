const nodemailer = require('nodemailer');

/* ---------- Отправка писем бухгалтеру о новых отчетах ----------
   Настройки берутся из переменных окружения (.env на компьютере,
   Variables — на Railway):
     SMTP_HOST  — адрес почтового сервера (для Яндекс.Почты: smtp.yandex.ru)
     SMTP_PORT  — порт (для Яндекс.Почты: 465)
     SMTP_USER  — с какой почты отправлять письма (например, notify@alpservice-group.ru)
     SMTP_PASS  — пароль приложения (НЕ обычный пароль от почты! — создается
                  отдельно в настройках Яндекс ID: Пароли и авторизация →
                  Пароли приложений → "Почта")
     SMTP_FROM  — необязательно, что показывать в поле "От кого" (если не
                  указано — используется SMTP_USER)
   Если эти переменные не заполнены — отправка писем просто тихо
   пропускается (один раз выводится предупреждение в лог сервера), сайт
   при этом продолжает работать как обычно, без писем. */

let transporter = null;
let warned = false;

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!isConfigured()) {
    if (!warned) {
      console.warn('[mail] SMTP_HOST/SMTP_USER/SMTP_PASS не заданы — письма о новых отчетах отправляться не будут.');
      warned = true;
    }
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465, // true для 465, false для 587
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

/* to — один email или массив email'ов. Ошибку отправки никогда не
   выбрасываем наружу — письмо это "по возможности", а не обязательное
   условие для того, чтобы отчет сохранился. */
async function sendMail({ to, subject, text }) {
  const t = getTransporter();
  if (!t || !to || (Array.isArray(to) && !to.length)) return;
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
    });
  } catch (e) {
    console.error('[mail] Не удалось отправить письмо:', e.message);
  }
}

module.exports = { sendMail, isConfigured };
