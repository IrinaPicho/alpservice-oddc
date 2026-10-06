-- Альпсервис — ОДДС: схема базы данных
-- Роли: sotr (сотрудник), buh (бухгалтер), ruk (руководитель)

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- для gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  role            text NOT NULL CHECK (role IN ('sotr', 'buh', 'ruk')),
  full_name       text,
  phone           text,
  position        text,            -- должность (прораб и т.п.)
  tabel_number    text,            -- табельный номер — нужен для АО-1
  project_code    text,            -- шифр проекта: у sotr — свой проект, у buh — проект, который проверяет
  project_customer text,           -- заказчик по проекту (для sotr)
  must_change_password boolean NOT NULL DEFAULT false, -- true после создания руководителем, пока бухгалтер не задал свой пароль
  advance_amount  numeric(12,2) NOT NULL DEFAULT 0, -- сколько выдано на руки сотруднику (вводит сам), для остатка на дашборде
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_no         integer NOT NULL, -- номер отчета у этого сотрудника (№1, №2... свой счет у каждого)
  project_code      text,          -- копия с сотрудника — чтобы бухгалтер фильтровал без join
  type              text NOT NULL CHECK (type IN ('expense', 'income')),
  statya            text NOT NULL,
  sum               numeric(12,2) NOT NULL,
  date_iso          date NOT NULL,
  comment           text DEFAULT '',
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id       uuid REFERENCES users(id),
  reviewer_comment  text DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL, пока файл только загружен и ещё не привязан к отчету (см. POST /api/uploads
  -- и POST /api/reports) — отчет на фронтенде собирается в несколько шагов, файл
  -- может быть прикреплён раньше, чем создана сама запись отчета.
  report_id   uuid REFERENCES reports(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('image', 'pdf')),
  url         text NOT NULL,       -- относительный путь /uploads/... (на проде — ссылка на R2/S3)
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_employee ON reports(employee_id);
CREATE INDEX IF NOT EXISTS idx_reports_project_code ON reports(project_code);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_report_files_report ON report_files(report_id);
