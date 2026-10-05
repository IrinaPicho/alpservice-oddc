const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('./db');
const { requireAuth, requireRole } = require('./jwt');

const router = express.Router();

/* ---------- Хранилище файлов ----------
   Сейчас — локальный диск (папка uploads/), подходит для разработки и для теста
   здесь, в сессии. На проде локальный диск НЕ подходит: большинство хостингов
   (включая Railway) не гарантируют, что файлы переживут редеплой или перезапуск
   контейнера. Для продакшена эту часть нужно заменить на Cloudflare R2 / S3 —
   меняется только этот файл, остальной бэкенд не трогаем. */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, crypto.randomUUID() + ext);
  },
});
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ACCEPTED.includes(file.mimetype)),
});

/* ---------- Загрузить вложение(я) к отчету ----------
   Возвращает id записей в report_files — их передают в fileIds при создании отчета
   (POST /api/reports), чтобы привязать уже загруженные файлы к новой записи. */
router.post('/', requireAuth, requireRole('sotr'), upload.array('files', 10), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Файлы не получены (PNG, JPEG, WebP или PDF)' });
  try {
    const inserted = [];
    for (const file of files) {
      const kind = file.mimetype === 'application/pdf' ? 'pdf' : 'image';
      const url = '/uploads/' + file.filename;
      const result = await pool.query(
        // report_id временно NULL — привязывается при создании отчета
        `INSERT INTO report_files (report_id, kind, url, name)
         VALUES (NULL, $1, $2, $3) RETURNING id, kind, url, name`,
        [kind, url, file.originalname]
      );
      inserted.push(result.rows[0]);
    }
    res.status(201).json({ files: inserted });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Не удалось загрузить файлы' });
  }
});

module.exports = router;
