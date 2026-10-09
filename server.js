require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes-auth');
const reportsRoutes = require('./routes-reports');
const accountantsRoutes = require('./routes-accountants');
const uploadsRoutes = require('./routes-uploads');
const storage = require('./storage');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/accountants', accountantsRoutes);
app.use('/api/uploads', uploadsRoutes);

/* ---------- Файлы, загруженные через форму отчета (чеки/документы) ----------
   Если настроено облачное хранилище Backblaze B2 (см. storage.js) — отдаём
   файлы из него. Если нет — как раньше, с диска сервера (подходит для
   разработки, но не для продакшена: на большинстве хостингов, включая
   Railway, диск не переживает редеплой). */
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

if (storage.isConfigured()) {
  app.get('/uploads/:key', async (req, res) => {
    try {
      const obj = await storage.getFileStream(req.params.key);
      if (!obj || !obj.Body) return res.status(404).end();
      res.setHeader('Content-Type', obj.ContentType || 'application/octet-stream');
      if (obj.ContentLength) res.setHeader('Content-Length', obj.ContentLength);
      obj.Body.pipe(res);
    } catch (e) {
      res.status(404).end();
    }
  });
} else {
  app.use('/uploads', express.static(uploadsDir));
}

/* ---------- Сам сайт ----------
   Файлы лежат в том же репозитории, что и сервер (без вложенных папок — так
   надёжнее грузится через веб-интерфейс GitHub), но наружу отдаём только
   этот список — файлы сервера (server.js, db.js, routes-*.js, schema.sql
   и т.д.) по этому списку не проходят и из браузера не открываются. */
const SITE_FILES = [
  'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'sw.js',
  'logo.png', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'demo-receipt-1.png', 'demo-receipt-2.png', 'demo-receipt-3.png', 'demo-receipt-4.png',
  'demo-receipt-1.pdf', 'demo-receipt-2.pdf',
];
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/:file', (req, res, next) => {
  if (!SITE_FILES.includes(req.params.file)) return next();
  res.sendFile(path.join(__dirname, req.params.file));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Альпсервис слушает на порту ${PORT}`));
