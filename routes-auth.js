const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const { issueToken, setAuthCookie, clearAuthCookie, requireAuth } = require('./jwt');

const router = express.Router();

/* ---------- Самостоятельной регистрации больше нет ----------
   Раньше сотрудник мог завести себе аккаунт сам, с главного экрана входа.
   По просьбе Ирины эту возможность убрали полностью — теперь завести
   сотрудника может только руководитель (кабинет руководителя) или бухгалтер
   (кабинет бухгалтера, только в свой проект), см. POST /api/reports/employees
   в routes-reports.js. Сам маршрут ниже оставлен закрытым (всегда 410), а не
   удалён совсем — на случай, если где-то в кэше/старой версии сайта на
   телефоне у кого-то осталась старая кнопка "Зарегистрироваться". */
router.post('/register', (req, res) => {
  res.status(410).json({ error: 'Самостоятельная регистрация отключена. Обратитесь к руководителю или бухгалтеру, чтобы вам завели доступ.' });
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
        legalEntity: user.legal_entity, legalEntityOkpo: user.legal_entity_okpo,
        employeeCategory: user.employee_category,
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
    'SELECT id, email, role, full_name, project_code, project_customer, legal_entity, legal_entity_okpo, employee_category, must_change_password, advance_amount FROM users WHERE id = $1',
    [req.user.sub]
  );
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ user });
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
