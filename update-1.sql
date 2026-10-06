-- Альпсервис — ОДДС: обновление базы данных №1
-- Добавляет то, что нужно для подключения сайта к серверу:
--  - остаток (сальдо) на главной странице сотрудника
--  - свой номер отчета у каждого сотрудника (№1, №2, №3...)
-- Выполнить один раз в окне запроса базы данных на Railway (так же, как schema.sql).

ALTER TABLE users ADD COLUMN IF NOT EXISTS advance_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_no integer;

UPDATE reports r SET report_no = sub.rn FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY created_at) AS rn FROM reports
) sub WHERE r.id = sub.id AND r.report_no IS NULL;

ALTER TABLE reports ALTER COLUMN report_no SET NOT NULL;
