const { Pool, types } = require('pg');

// Колонки типа "date" (date_iso) node-postgres по умолчанию превращает в объект Date
// в полночь по UTC — при выводе в JSON это может сдвинуть дату на день назад/вперед
// в зависимости от часового пояса сервера. Отчету важна именно календарная дата, без
// часового пояса, поэтому возвращаем ее как обычную строку "YYYY-MM-DD".
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway managed Postgres требует SSL снаружи своей внутренней сети — локально (127.0.0.1) он не нужен.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
});

module.exports = { pool };
