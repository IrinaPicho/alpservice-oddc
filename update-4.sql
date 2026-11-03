-- Альпсервис — ОДДС: обновление базы данных №4
-- Добавляет:
--  - код ОКПО юридического лица (у сотрудника и "снимок" в каждом отчете) —
--    нужен для бланка АО-1, строка "по ОКПО" (раньше там стояло "ЗАПОЛНИТЬ").
--  - категорию сотрудника ("itr" / "aup") — определяет, какой из двух списков
--    статей расходов/приходов (подробный или короткий) ему показывать при
--    отправке отчета. По умолчанию всем существующим сотрудникам ставится
--    "aup" — поменять на "itr" тому, кому нужно, можно в кабинете
--    руководителя/бухгалтера при регистрации новых или через карточку
--    "Проект/юрлицо" у уже существующих.
-- Выполнить один раз в окне запроса базы данных (так же, как schema.sql и
-- предыдущие update-*.sql). Можно выполнять по одной строке, если разом не
-- сработает.

ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_entity_okpo text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS legal_entity_okpo text;

ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_category text NOT NULL DEFAULT 'aup';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_employee_category_check;
ALTER TABLE users ADD CONSTRAINT users_employee_category_check CHECK (employee_category IN ('itr', 'aup'));

-- Два реальных юрлица клиента — если у кого-то из уже существующих сотрудников
-- в legal_entity стоит одно из этих названий (как есть, без опечаток), ОКПО
-- проставится сам. У остальных (если название не совпало в точности, или
-- юрлицо ещё не заполнено) legal_entity_okpo останется пустым — заполнить
-- вручную через "Проект/юрлицо" в кабинете бухгалтера.
UPDATE users SET legal_entity_okpo = '36874476' WHERE legal_entity = 'ООО «ВТР ЗиС»' AND legal_entity_okpo IS NULL;
UPDATE users SET legal_entity_okpo = '55814646' WHERE legal_entity = 'ООО «ЦОТ и ТБ»' AND legal_entity_okpo IS NULL;
