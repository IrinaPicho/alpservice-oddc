const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

/* Официальный унифицированный бланк АО-1 ("Авансовый отчет"), утвержден
   постановлением Госкомстата России от 01.08.2001 №55. Файл ao1-template.xlsx —
   точная копия этого бланка (прислан клиентом), мы в код сам бланк не рисуем,
   а каждый раз открываем этот файл заново и дописываем в него данные —
   поэтому вид документа всегда совпадает с официальной формой. */
const TEMPLATE_PATH = path.join(__dirname, 'ao1-template.xlsx');

const FIRST_ROW = 66; // первая строка таблицы операций на обороте бланка
const TEMPLATE_ROWS = 8; // столько строк под операции в бланке "из коробки"

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function formatDateRu(value) {
  var d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
}

/* employee: { fullName, tabelNumber, position, legalEntity, advanceAmount }
   reports: только одобренные отчеты-расходы за период, отсортированные по дате
   projectLabel: "шифр проекта — заказчик", как в выгрузке УО
   directorName: ФИО руководителя (если есть в базе) — подставляется в шапку
   periodTo: конец периода — идёт в дату отчета в шапке бланка */
async function buildAo1Workbook({ employee, reports, projectLabel, directorName, periodTo }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  const ws = wb.getWorksheet('Лист_1');

  const totalSpent = reports.reduce(function (sum, r) { return sum + Number(r.sum); }, 0);
  const advance = Number(employee.advanceAmount || 0);

  /* ---------- Шапка ---------- */
  ws.getCell('B5').value = employee.legalEntity || projectLabel || '';
  if (directorName) ws.getCell('T13').value = directorName; // "ФИО" руководителя — уже известно из базы
  ws.getCell('J13').value = formatDateRu(periodTo || new Date());

  ws.getCell('R9').value = Math.floor(totalSpent);
  ws.getCell('X9').value = Math.round((totalSpent % 1) * 100);

  ws.getCell('H19').value = projectLabel || '';
  // K21:O21 в бланке не объединены (просто несколько клеток подряд с общим
  // подчеркиванием) и у них стоит перенос по словам — длинное ФИО в одной
  // узкой клетке становится нечитаемым. Объединяем и отключаем перенос,
  // чтобы имя отображалось одной строкой, как и остальные подписанные поля.
  ws.mergeCells('K21:O21');
  var fioCell = ws.getCell('K21');
  fioCell.value = employee.fullName || '';
  fioCell.alignment = Object.assign({}, fioCell.alignment, { wrapText: false, horizontal: 'left' });
  ws.getCell('T21').value = employee.tabelNumber || '';
  ws.getCell('G23').value = employee.position || '';
  ws.getCell('Q23').value = 'Хозяйственные нужды';

  /* ---------- Получено/израсходовано ----------
     Упрощенно: вся выданная сотруднику сумма ("выдано на руки" на дашборде)
     считается полученной из кассы, без разбивки на валюту/карту — в этом
     приложении так и устроен учет аванса (одна сумма на сотрудника). */
  ws.getCell('J28').value = advance;
  ws.getCell('J32').value = advance;
  ws.getCell('J33').value = totalSpent;
  var diff = advance - totalSpent;
  if (diff >= 0) { ws.getCell('J34').value = diff; } else { ws.getCell('J35').value = -diff; }

  ws.getCell('E37').value = reports.length;
  ws.getCell('J37').value = reports.length;

  /* ---------- Оборотная сторона: построчно операции ----------
     В бланке "из коробки" — 8 строк. Если одобренных отчетов больше,
     вставляем дополнительные строки той же высоты/границ прямо перед
     строкой "Итого" (а не рисуем новую таблицу) — чтобы бланк остался
     тем же официальным документом.
     ExcelJS при duplicateRow портит объединения ячеек в новых строках —
     пересобираем их вручную сразу после вставки. */
  var COLUMN_SPANS = ['B:C', 'D:E', 'F:G', 'H:K', 'L:N', 'O:Q', 'R:T', 'U:W', 'X:Y'];
  if (reports.length > TEMPLATE_ROWS) {
    // ExcelJS.duplicateRow портит объединения ячеек непредсказуемо (часть
    // строк получается нормальной, часть — нет), поэтому строки вставляем
    // как пустые (spliceRows это умеет надежно), а оформление — границы,
    // шрифт, объединения — переносим вручную с последней "родной" строки 73.
    var extra = reports.length - TEMPLATE_ROWS;
    var lastTemplateRow = FIRST_ROW + TEMPLATE_ROWS - 1; // 73 — последняя "родная" строка таблицы
    var blanks = [];
    for (var b = 0; b < extra; b++) blanks.push([]);
    ws.spliceRows.apply(ws, [lastTemplateRow + 1, 0].concat(blanks));

    for (var k = 0; k < extra; k++) {
      var newRow = lastTemplateRow + 1 + k;
      ws.getRow(newRow).height = ws.getRow(lastTemplateRow).height;
      for (var col = 2; col <= 25; col++) {
        var srcCell = ws.getCell(lastTemplateRow, col);
        var dstCell = ws.getCell(newRow, col);
        dstCell.style = JSON.parse(JSON.stringify(srcCell.style));
      }
      COLUMN_SPANS.forEach(function (span) {
        var cols = span.split(':');
        var range = cols[0] + newRow + ':' + cols[1] + newRow;
        try { ws.unMergeCells(range); } catch (e) { /* не была объединена — не страшно */ }
        ws.mergeCells(range);
      });
      ws.getCell('B' + newRow).value = TEMPLATE_ROWS + k + 1; // номер по порядку: 9, 10, 11...
    }
  }
  reports.forEach(function (r, i) {
    var row = FIRST_ROW + i;
    ws.getCell('D' + row).value = formatDateRu(r.date_iso);
    ws.getCell('H' + row).value = r.statya + (r.comment ? ' — ' + r.comment : '');
    ws.getCell('L' + row).value = Number(r.sum);
    ws.getCell('R' + row).value = Number(r.sum);
  });

  var totalRow = FIRST_ROW + Math.max(reports.length, TEMPLATE_ROWS);
  ws.getCell('L' + totalRow).value = totalSpent;
  ws.getCell('R' + totalRow).value = totalSpent;

  var signRow = totalRow + 2;
  ws.getCell('N' + signRow).value = employee.fullName || '';

  return wb;
}

/* ---------- Исправление "битого" АО-1 ----------
   Сам официальный бланк (ao1-template.xlsx, прислан клиентом) внутри себя
   уже содержит небольшую нестыковку: у части ячеек в адресе указан не тот
   номер строки, в которой они на самом деле находятся (например, ячейка
   лежит в строке 2, а в её собственном адресе написано "V3"). Excel при
   обычном открытии именно этого файла такую мелочь не замечает и прощает,
   но как только файл проходит через пересборку (а мы именно это и делаем,
   дописывая туда данные через ExcelJS) — Excel начинает считать файл
   поврежденным ("ошибка в части содержимого") и после "восстановления"
   теряет часть данных (поэтому скачанный бланк открывался пустым).
   Чтобы это исправить, перед отправкой файла проходим по каждой строке
   листа и для каждой её ячейки подставляем номер именно этой строки
   (колонку ячейки не трогаем) — адреса становятся согласованными, и Excel
   больше не считает файл повреждённым. */
async function fixRowAddressMismatches(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sheetPath = 'xl/worksheets/sheet1.xml';
  const file = zip.file(sheetPath);
  if (!file) return buffer;

  let xml = await file.async('string');
  /* Важно: строки без единой ячейки (пустые) ExcelJS пишет "самозакрывающимся"
     тегом <row .../> — без ячеек внутри. Предыдущая версия регулярки этого не
     учитывала: она ловила символ "/" перед закрывающей ">" как часть атрибутов
     и "захватывала" следующую за пустой строкой строку целиком как бы её
     содержимым — из-за этого для части строк (там, где прямо перед данными
     стоит пустая строка) исправление не срабатывало и битый адрес ячейки
     уезжал в финальный файл как есть. Теперь самозакрывающиеся строки явно
     отделены первой веткой regexp и не трогаются (чинить там нечего — ячеек
     нет), а вторая ветка ловит только настоящие строки с содержимым. */
  xml = xml.replace(
    /<row r="(\d+)"([^>]*?)\/>|<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g,
    function (whole, selfRowNum, selfAttrs, rowNum, rowAttrs, inner) {
      if (selfRowNum !== undefined) return whole; // пустая строка — нечего чинить
      const fixedInner = inner.replace(/(<c r=")([A-Z]+)\d+(")/g, function (m, before, col, after) {
        return before + col + rowNum + after;
      });
      return '<row r="' + rowNum + '"' + rowAttrs + '>' + fixedInner + '</row>';
    }
  );

  zip.file(sheetPath, xml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = { buildAo1Workbook, fixRowAddressMismatches };
