const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('./db');
const { requireAuth, requireRole } = require('./jwt');
const storage = require('./storage');

const router = express.Router();

/* ---------- Хранилище файлов ----------
   Файлы принимаются в память (не сразу на диск), а дальше:
   - если настроено облачное хранилище Backblaze B2 (см. storage.js) — файл
     уходит туда, это надежный вариант для продакшена (переживает редеплои);
   - если не настроено — как раньше, сохраняется на диск сервера (uploads/),
     этого достаточно для разработки/теста. */
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const upload = multer({
  storage: multer.memoryStorage(),
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
      const ext = path.extname(file.originalname) || (file.mimetype === 'application/pdf' ? '.pdf' : '.jpg');
      const key = crypto.randomUUID() + ext;
      const kind = file.mimetype === 'application/pdf' ? 'pdf' : 'image';

      const savedToCloud = await storage.uploadFile(key, file.buffer, file.mimetype);
      if (!savedToCloud) {
        const dir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, key), file.buffer);
      }

      const url = '/uploads/' + key;
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
