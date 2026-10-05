const express = require('express');
const { pool } = require('./db');
const { requireAuth, requireRole } = require('./jwt');

const router = express.Router();

async function attachFiles(reports) {
  if (!reports.length) return reports;
  const ids = reports.map((r) => r.id);
  const filesResult = await pool.query(
    'SELECT * FROM report_files WHERE report_id = ANY($1) ORDER BY created_at',
    [ids]
  );
  const byReport = {};
  filesResult.rows.forEach((f) => {
    if (!byReport[f.report_id]) byReport[f.report_id] = [];
    byReport[f.report_id].push({ id: f.id, kind: f.kind, url: f.url, name: f.name });
  });
  return reports.map((r) => ({ ...r, files: byReport[r.id] || [] }));
}

function serializeReport(row, employee) {
  return {
    id: row.id,
    employee: employee ? { id: employee.id, fullName: employee.full_name } : undefined,
    projectCode: row.project_code,
    type: row.type,
    statya: row.statya,
    sum: Number(row.sum),
    dateIso: row.date_iso,
    comment: row.comment,
    status: row.status,
    reviewerComment: row.reviewer_comment,
    createdAt: row.created_at,
  };
}

/* ---------- Сотрудник: создать отчет ---------- */
router.post('/', requireAuth, requireRole('sotr'), async (req, res) => {
  const { type, statya, sum, dateIso, comment, fileIds } = req.body || {};
  if (!type || !statya || !sum || !dateIso) {
    return res.status(400).json({ error: 'Заполните статью, сумму и дату' });
  }
  try {
    const userResult = await pool.query('SELECT project_code FROM users WHERE id = $1', [req.user.sub]);
    const projectCode = userResult.rows[0] ? userResult.rows[0].project_code : null;

    const result = await pool.query(
      `INSERT INTO reports (employee_id, project_code, type, statya, sum, date_iso, comment, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending') RETURNING *`,
      [req.user.sub, projectCode, type, statya, sum, dateIso, comment || '']
    );
    const report = result.rows[0];

    if (Array.isArray(fileIds) && fileIds.length) {
      await pool.query('UPDATE report_files SET report_id = $1 WHERE id = ANY($2)', [report.id, fileIds]);
    }

    res.status(201).json({ report: serializeReport(report) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось создать отчет' });
  }
});

/* ---------- Сотрудник: мои отчеты ---------- */
router.get('/mine', requireAuth, requireRole('sotr'), async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM reports WHERE employee_id = $1 ORDER BY date_iso DESC, created_at DESC',
    [req.user.sub]
  );
  const withFiles = await attachFiles(result.rows);
  res.json({ reports: withFiles.map((r) => serializeReport(r)) });
});

/* ---------- Сотрудник: отредактировать и повторно отправить отклонённый/любой свой отчет ---------- */
router.patch('/:id', requireAuth, requireRole('sotr'), async (req, res) => {
  const { statya, sum, dateIso, comment } = req.body || {};
  try {
    const existing = await pool.query('SELECT * FROM reports WHERE id = $1 AND employee_id = $2', [req.params.id, req.user.sub]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Отчет не найден' });
    if (existing.rows[0].status === 'approved') {
      return res.status(400).json({ error: 'Одобренный отчет нельзя редактировать' });
    }
    const result = await pool.query(
      `UPDATE reports SET statya = COALESCE($1, statya), sum = COALESCE($2, sum),
        date_iso = COALESCE($3, date_iso), comment = COALESCE($4, comment),
        status = 'pending', reviewer_comment = '', updated_at = now()
       WHERE id = $5 RETURNING *`,
      [statya, sum, dateIso, comment, req.params.id]
    );
    res.json({ report: serializeReport(result.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось изменить отчет' });
  }
});

/* ---------- Бухгалтер: все отчеты своего проекта (+ руководитель видит всё) ---------- */
router.get('/', requireAuth, requireRole('buh', 'ruk'), async (req, res) => {
  const { status } = req.query;
  try {
    let query = `SELECT r.*, u.full_name AS employee_full_name FROM reports r
                 JOIN users u ON u.id = r.employee_id WHERE 1=1`;
    const params = [];

    if (req.user.role === 'buh') {
      const userResult = await pool.query('SELECT project_code FROM users WHERE id = $1', [req.user.sub]);
      const projectCode = userResult.rows[0] ? userResult.rows[0].project_code : null;
      params.push(projectCode);
      query += ` AND r.project_code = $${params.length}`;
    }
    if (status && status !== 'all') {
      params.push(status);
      query += ` AND r.status = $${params.length}`;
    }
    query += ' ORDER BY r.date_iso DESC, r.created_at DESC';

    const result = await pool.query(query, params);
    const withFiles = await attachFiles(result.rows);
    res.json({
      reports: withFiles.map((r) => serializeReport(r, { id: r.employee_id, full_name: r.employee_full_name })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось загрузить отчеты' });
  }
});

/* ---------- Бухгалтер: одобрить/отклонить (в т.ч. поменять уже принятое решение) ---------- */
router.patch('/:id/decision', requireAuth, requireRole('buh'), async (req, res) => {
  const { status, reviewerComment } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status должен быть approved или rejected' });
  }
  if (status === 'rejected' && !reviewerComment) {
    return res.status(400).json({ error: 'При отклонении нужен комментарий' });
  }
  try {
    const userResult = await pool.query('SELECT project_code FROM users WHERE id = $1', [req.user.sub]);
    const projectCode = userResult.rows[0] ? userResult.rows[0].project_code : null;

    const existing = await pool.query('SELECT * FROM reports WHERE id = $1 AND project_code = $2', [req.params.id, projectCode]);
    if (!existing.rows[0]) return res.status(404).json({ error: 'Отчет не найден' });

    const result = await pool.query(
      `UPDATE reports SET status = $1, reviewer_comment = $2, reviewer_id = $3, updated_at = now()
       WHERE id = $4 RETURNING *`,
      [status, reviewerComment || '', req.user.sub, req.params.id]
    );
    res.json({ report: serializeReport(result.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось сохранить решение' });
  }
});

module.exports = router;
