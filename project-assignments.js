const { pool } = require('./db');

/* ---------- Дополнительные проекты пользователя ----------
   Общая логика для сотрудников И бухгалтеров: кроме основного шифра проекта
   (users.project_code) у любого пользователя может быть любое число
   дополнительных (таблица employee_projects — название осталось от первой
   версии фичи, когда это было только для сотрудников, но по схеме это
   просто "employee_id -> любой users.id", работает одинаково для обеих ролей).

   Для сотрудника: при отправке отчета он сам выбирает, по какому из своих
   проектов отчитывается (см. POST / в routes-reports.js).
   Для бухгалтера: он должен видеть и проверять отчеты по ЛЮБОМУ из своих
   проектов, не только по основному (см. getAllProjectCodes ниже и его
   использование в routes-reports.js/routes-accountants.js). */

function sanitizeAdditionalProjects(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((p) => ({
      projectCode: String((p && p.projectCode) || '').trim(),
      projectCustomer: String((p && p.projectCustomer) || '').trim() || null,
    }))
    .filter((p) => p.projectCode);
}

async function getUserProjects(userId) {
  const result = await pool.query(
    'SELECT project_code, project_customer FROM employee_projects WHERE employee_id = $1 ORDER BY created_at',
    [userId]
  );
  return result.rows.map((r) => ({ projectCode: r.project_code, projectCustomer: r.project_customer }));
}

/* Полная замена списка доп. проектов — проще и надежнее, чем вычислять
   точечный diff добавленных/убранных строк. */
async function replaceUserProjects(userId, list) {
  const clean = sanitizeAdditionalProjects(list);
  await pool.query('DELETE FROM employee_projects WHERE employee_id = $1', [userId]);
  for (const p of clean) {
    await pool.query(
      'INSERT INTO employee_projects (employee_id, project_code, project_customer) VALUES ($1, $2, $3)',
      [userId, p.projectCode, p.projectCustomer]
    );
  }
  return clean;
}

/* Все шифры проекта, с которыми связан пользователь, одним плоским массивом:
   основной (primaryProjectCode) + все дополнительные, без повторов. Удобно
   для бухгалтера — вместо "project_code = $1" везде, где раньше сравнивали
   с его единственным проектом, теперь "project_code = ANY($1::text[])". */
async function getAllProjectCodes(userId, primaryProjectCode) {
  const extra = await getUserProjects(userId);
  const codes = extra.map((p) => p.projectCode);
  if (primaryProjectCode) codes.unshift(primaryProjectCode);
  return [...new Set(codes)];
}

module.exports = {
  sanitizeAdditionalProjects,
  getUserProjects,
  replaceUserProjects,
  getAllProjectCodes,
};
