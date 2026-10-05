const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { requireAuth, requireRole } = require('./jwt');

const router = express.Router();

/* ---------- Список бухгалтеров (только почта и шифр проекта — пароли нигде не отдаются) ---------- */
router.get('/', requireAuth, requireRole('ruk'), async (req, res) => {
  const result = await pool.query(
    "SELECT id, email, project_code, created_at FROM users WHERE role = 'buh' ORDER BY created_at"
  );
  res.json({ accountants: result.rows.map((r) => ({ id: r.id, email: r.email, projectCode: r.project_code })) });
});

/* ---------- Добавить бухгалтера ----------
   Пароль руководителю не нужен и не показывается навсегда — только временный,
   один раз, в ответе на этот запрос, чтобы передать бухгалтеру для первого входа.
   Дальше бухгалтер обязан сменить его сам через POST /api/auth/change-password
   (must_change_password это форсирует на стороне фронтенда). */
router.post('/', requireAuth, requireRole('ruk'), async (req, res) => {
  const { email, projectCode } = req.body || {};
  if (!email || !projectCode) {
    return res.status(400).json({ error: 'Укажите почту и шифр проекта' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Такая почта уже добавлена' });
    }
    const tempPassword = crypto.randomBytes(6).toString('base64url'); // напр. "kQ3f9ZL2"
    const hash = await bcrypt.hash(tempPassword, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role, project_code, must_change_password)
       VALUES ($1, $2, 'buh', $3, true) RETURNING id, email, project_code`,
      [normalizedEmail, hash, projectCode]
    );
    res.status(201).json({
      accountant: { id: result.rows[0].id, email: result.rows[0].email, projectCode: result.rows[0].project_code },
      tempPassword, // показать один раз в интерфейсе руководителя и передать бухгалтеру лично
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось добавить бухгалтера' });
  }
});

/* ---------- Удалить бухгалтера ---------- */
router.delete('/:id', requireAuth, requireRole('ruk'), async (req, res) => {
  const result = await pool.query("DELETE FROM users WHERE id = $1 AND role = 'buh'", [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Бухгалтер не найден' });
  res.json({ ok: true });
});

module.exports = router;
