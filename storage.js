const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

/* ---------- Облачное хранилище файлов (чеков) — Backblaze B2 ----------
   Backblaze B2 понимает тот же "язык" (протокол), что и Amazon S3, поэтому
   используем обычный S3-клиент, просто указываем ему адрес Backblaze.

   Настройки берутся из переменных окружения (.env на компьютере,
   Variables — на Railway):
     B2_ENDPOINT — адрес сервера, например https://s3.eu-central-003.backblazeb2.com
                   (показывается в Backblaze на странице бакета, поле "Endpoint")
     B2_KEY_ID   — keyID ключа приложения Backblaze
     B2_APP_KEY  — applicationKey ключа приложения Backblaze
     B2_BUCKET   — имя бакета, например alpservice-cheki

   Если что-то из этого не заполнено — приложение тихо переключается на
   старый способ (хранение файлов на диске сервера), без ошибок. Это удобно
   для разработки/тестов, но для реального сайта на Railway нужно, чтобы
   Backblaze был настроен — иначе фото чеков будут пропадать при каждом
   обновлении сайta. */

function isConfigured() {
  return !!(
    process.env.B2_ENDPOINT &&
    process.env.B2_KEY_ID &&
    process.env.B2_APP_KEY &&
    process.env.B2_BUCKET
  );
}

let client = null;
let warned = false;

function getClient() {
  if (!isConfigured()) {
    if (!warned) {
      console.warn('[storage] B2_ENDPOINT/B2_KEY_ID/B2_APP_KEY/B2_BUCKET не заданы — файлы будут сохраняться на диске сервера (не переживут редеплой).');
      warned = true;
    }
    return null;
  }
  if (!client) {
    const endpoint = process.env.B2_ENDPOINT;
    const host = endpoint.replace(/^https?:\/\//, '');
    // Из адреса вида s3.eu-central-003.backblazeb2.com достаём "eu-central-003" —
    // это нужно S3-клиенту просто как технический параметр, на работу не влияет.
    const region = host.split('.')[1] || 'us-east-1';
    client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.B2_KEY_ID,
        secretAccessKey: process.env.B2_APP_KEY,
      },
    });
  }
  return client;
}

/* Загружает файл в облако. Возвращает true, если получилось, false — если
   облако не настроено (тогда вызывающий код сам сохранит файл на диск). */
async function uploadFile(key, buffer, contentType) {
  const c = getClient();
  if (!c) return false;
  await c.send(
    new PutObjectCommand({
      Bucket: process.env.B2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return true;
}

/* Отдает файл из облака (поток + тип файла), чтобы сервер мог переслать его
   в браузер. Возвращает null, если облако не настроено. */
async function getFileStream(key) {
  const c = getClient();
  if (!c) return null;
  return c.send(
    new GetObjectCommand({
      Bucket: process.env.B2_BUCKET,
      Key: key,
    })
  );
}

module.exports = { isConfigured, uploadFile, getFileStream };
