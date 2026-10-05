/* Разовый скрипт — наполняет пустую базу стартовыми аккаунтами для проверки.
   Запуск: npm run seed */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function main() {
  const hash = await bcrypt.hash('demo1234', 10);

  await pool.query(
    `INSERT INTO users (email, password_hash, role, full_name, project_code, project_customer, position)
     VALUES ($1, $2, 'sotr', $3, $4, $5, $6)
     ON CONFLICT (email) DO NOTHING`,
    ['ivan@alpservice-group.ru', hash, 'Иванов Иван Иванович', '30-155', 'ПАО «Роснефть»', 'Прораб']
  );

  await pool.query(
    `INSERT INTO users (email, password_hash, role, project_code)
     VALUES ($1, $2, 'buh', $3)
     ON CONFLICT (email) DO NOTHING`,
    ['buh@alpservice-group.ru', hash, '30-155']
  );

  await pool.query(
    `INSERT INTO users (email, password_hash, role, full_name)
     VALUES ($1, $2, 'ruk', $3)
     ON CONFLICT (email) DO NOTHING`,
    ['director@alpservice-group.ru', hash, 'Макаренко Алексей']
  );

  console.log('Готово: ivan@/buh@/director@alpservice-group.ru, пароль у всех demo1234');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
