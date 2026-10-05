const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway managed Postgres требует SSL снаружи своей внутренней сети — локально (127.0.0.1) он не нужен.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false },
});

module.exports = { pool };
