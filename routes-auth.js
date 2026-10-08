const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { issueToken, setAuthCookie, clearAuthCookie, requireAuth } = require('./jwt');

const router = express.Router();

/* ---------- Регистрация сотрудника (самостоятельная, роль всегда 'sotr') ---------- */
router.post('/register', async (req, res) => {
  const { email, password, fullName, phone, position, projectCode, projectCustomer, legalEntity } = req.body || {};
  if (!email || !password || !fullName) {
    return res.status(400).json({ error: 'Укажите почту, пароль и ФИО' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Такая почта уже зарегистрирована' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, full_name, phone, position, project_code, project_customer, legal_entity)
       VALUES ($1, $2, 'sotr', $3, $4, $5, $6, $7, $8)
       RETURNING id, email, role, full_name, project_code, project_customer, legal_entity`,
      [normalizedEmail, hash, fullName, phone || null, position || null, projectCode || null, projectCustomer || null, legalEntity || null]
    );
    const user = result.rows[0];
    const token = issueToken({ id: user.id, role: user.role, email: user.email });
    setAuthCookie(res, token);
    res.status(201).json({ user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось зарегистрировать' });
  }
});

/* ---------- Вход ----------
   role в теле запроса — та вкладка/ссылка, которую выбрал человек на экране входа
   (sotr / buh / ruk). Если роль аккаунта в базе не совпадает с выбранной вкладкой —
   это тот же "неверная почта или пароль", что и в текущем демо: не говорим, что
   аккаунт вообще существует под другой ролью. */
router.post('/login', async (req, res) => {
  const { email, password, role } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const genericError = () => res.status(401).json({ error: 'Неверная почта или пароль' });

  if (!normalizedEmail || !password || !role) return genericError();

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    const user = result.rows[0];
    if (!user || user.role !== role) return genericError();

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return genericError();

    const token = issueToken({ id: user.id, role: user.role, email: user.email });
    setAuthCookie(res, token);
    res.json({
      user: {
        id: user.id, email: user.email, role: user.role, fullName: user.full_name,
        projectCode: user.project_code, projectCustomer: user.project_customer,
        mustChangePassword: user.must_change_password, advanceAmount: Number(user.advance_amount || 0),
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query(
    'SELECT id, email, role, full_name, project_code, project_customer, legal_entity, must_change_password, advance_amount FROM users WHERE id = $1',
    [req.user.sub]
  );
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ user });
});

/* ---------- Сотрудник: указать/обновить сумму, выданную на руки ----------
   Основа для остатка (сальдо) на дашборде: остаток = эта сумма минус сумма
   собственных отчетов по расходам. */
router.patch('/advance', requireAuth, async (req, res) => {
  const amount = Number((req.body || {}).amount);
  if (!(amount >= 0)) return res.status(400).json({ error: 'Укажите сумму не меньше нуля' });
  try {
    const result = await pool.query(
      'UPDATE users SET advance_amount = $1 WHERE id = $2 RETURNING advance_amount',
      [amount, req.user.sub]
    );
    res.json({ advanceAmount: Number(result.rows[0].advance_amount) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось сохранить сумму' });
  }
});

/* ---------- Смена пароля (сотрудник/бухгалтер сами себе) ---------- */
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Новый пароль должен быть не короче 6 символов' });
  }
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.sub]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Пользователь не найден' });

    // Если пароль ещё не задавался (аккаунт создан руководителем с временным паролем),
    // currentPassword всё равно нужно проверить — это и есть временный пароль.
    const ok = await bcrypt.compare(currentPassword || '', row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Текущий пароль неверен' });

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2',
      [newHash, req.user.sub]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось сменить пароль' });
  }
});

module.exports = router;
