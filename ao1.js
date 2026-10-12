const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

/* ==========================================================================
   Официальный унифицированный бланк АО-1 ("Авансовый отчет"), утвержден
   постановлением Госкомстата России от 01.08.2001 №55. Файл ao1-template.xlsx —
   точная копия этого бланка (прислан клиентом).

   ВАЖНО (почему этот файл написан именно так): раньше мы открывали шаблон
   через библиотеку ExcelJS, дописывали в него данные через её же API и
   отдавали результат. ExcelJS устроена так, что она не "дописывает" файл —
   она ПОЛНОСТЬЮ разбирает весь файл на составные части и заново пересобирает
   его целиком с нуля (это видно даже по размеру: её версия styles.xml и
   theme.xml заметно отличается от родного файла клиента, хотя мы их вообще
   не трогали). Получавшийся файл проходил вообще все проверки, которые
   существуют (целостность архива, сверка стилей, сверка строк, визуальная
   проверка через LibreOffice) — но некоторым копиям настоящего Excel на
   настоящих компьютерах (в том числе у бухгалтера клиента) этого было
   недостаточно: он все равно показывал "ошибка в части содержимого".
   Разумное предположение — Excel проверяет файл строже, чем любая другая
   программа, и какая-то мелочь при полной пересборке через ExcelJS всё
   равно терялась так, что это заметно только настоящему Excel.

   Поэтому здесь используется другой, более надежный способ: мы НИКОГДА не
   пересобираем файл целиком. Мы берем оригинальный файл клиента как есть
   (байт в байт) и редактируем только то, что действительно нужно поменять —
   содержимое конкретных ячеек на обратной стороне бланка. Всё остальное
   (стили, шрифты, тема, связи между частями файла) остаётся ровно таким,
   каким его сделал сам клиент (точнее, тот Excel, в котором он когда-то
   сохранил этот бланк) — а значит, и настоящий Excel при открытии увидит
   файл, устройство которого ему привычно. */

const TEMPLATE_PATH = path.join(__dirname, 'ao1-template.xlsx');
const SHEET_PATH = 'xl/worksheets/sheet1.xml';
const STYLES_PATH = 'xl/styles.xml';

const FIRST_ROW = 66; // первая строка таблицы операций на обороте бланка
const TEMPLATE_ROWS = 8; // столько строк под операции в бланке "из коробки"
const LAST_TEMPLATE_ROW = FIRST_ROW + TEMPLATE_ROWS - 1; // 73 — последняя "родная" строка таблицы
const COLUMN_SPANS = ['B:C', 'D:E', 'F:G', 'H:K', 'L:N', 'O:Q', 'R:T', 'U:W', 'X:Y'];

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function formatDateRu(value) {
  var d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
}
function escapeXml(s) {
  return String(s).replace(/[&<>]/g, function (c) {
    return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;';
  });
}

/* ---------- Разбор <sheetData> на отдельные строки ----------
   Та же регулярка, что и раньше (с учетом самозакрывающихся пустых строк —
   см. историю правок ниже), но теперь используется не для "исправления"
   чужого вывода, а для того, чтобы разобрать родной файл клиента на строки,
   которыми можно управлять по отдельности (взять строку, подвинуть её номер,
   склонировать её оформление для новой строки). */
function parseRows(sheetDataInner) {
  const re = /<row r="(\d+)"([^>]*?)\/>|<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g;
  const rows = [];
  let m;
  while ((m = re.exec(sheetDataInner))) {
    if (m[1] !== undefined) {
      rows.push({ num: parseInt(m[1], 10), selfClosing: true, attrs: m[2], inner: '' });
    } else {
      rows.push({ num: parseInt(m[3], 10), selfClosing: false, attrs: m[4], inner: m[5] });
    }
  }
  return rows;
}

function serializeRow(row) {
  if (row.selfClosing && !row.inner) {
    return '<row r="' + row.num + '"' + row.attrs + '/>';
  }
  return '<row r="' + row.num + '"' + row.attrs + '>' + row.inner + '</row>';
}

/* Переносит все адреса ячеек внутри строки (col+старыйНомер -> col+новыйНомер),
   когда строку целиком сдвигаем на новое место (вставка новых строк выше). */
function renumberRow(row, newNum) {
  const fixedInner = row.inner.replace(/(<c r=")([A-Z]+)\d+(")/g, function (m, before, col, after) {
    return before + col + newNum + after;
  });
  return { num: newNum, selfClosing: row.selfClosing, attrs: row.attrs, inner: fixedInner };
}

/* Клонирует оформление (только стили ячеек s="N", без значений) строки-образца
   под новый номер строки — используется, когда нужно вставить дополнительную
   строку таблицы операций (когда одобренных отчетов больше 8). */
function cloneRowStyleOnly(templateRow, newNum) {
  const cellRe = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:(?!<\/c>)[\s\S])*<\/c>)/g;
  let inner = '';
  let cm;
  while ((cm = cellRe.exec(templateRow.inner))) {
    const col = cm[1];
    let attrs = cm[2];
    // оставляем только s="N" (стиль) — значение и тип ячейки не копируем,
    // новая строка должна быть "пустой", данные в неё впишет вызывающий код
    const sMatch = /\ss="(\d+)"/.exec(attrs);
    const sAttr = sMatch ? ' s="' + sMatch[1] + '"' : '';
    inner += '<c r="' + col + newNum + '"' + sAttr + '/>';
  }
  return { num: newNum, selfClosing: false, attrs: templateRow.attrs, inner: inner };
}

/* ---------- Запись значения в конкретную ячейку строки ----------
   type: 'number' | 'text'. Сохраняем стиль ячейки (s="N"), если он был —
   это единственное, что должно остаться от старого содержимого ячейки.
   Текст пишем как "inline string" (t="inlineStr"), а не через sharedStrings —
   так совсем не нужно трогать файл xl/sharedStrings.xml (он останется
   стопроцентно таким же, как у клиента). */
function setCell(row, col, value, type) {
  const addr = col + row.num;
  const cellRe = new RegExp('<c r="' + addr + '"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)');
  const m = cellRe.exec(row.inner);
  const existingAttrs = m ? m[1] : '';
  const sMatch = /\ss="(\d+)"/.exec(existingAttrs);
  const sAttr = sMatch ? ' s="' + sMatch[1] + '"' : '';

  let replacement;
  if (type === 'number') {
    const num = Number(value);
    if (value === '' || value === null || value === undefined || isNaN(num)) {
      replacement = '<c r="' + addr + '"' + sAttr + '/>';
    } else {
      replacement = '<c r="' + addr + '"' + sAttr + '><v>' + num + '</v></c>';
    }
  } else {
    const text = value === null || value === undefined ? '' : String(value);
    if (text === '') {
      replacement = '<c r="' + addr + '"' + sAttr + '/>';
    } else {
      replacement = '<c r="' + addr + '"' + sAttr + ' t="inlineStr"><is><t xml:space="preserve">' + escapeXml(text) + '</t></is></c>';
    }
  }

  if (m) {
    row.inner = row.inner.slice(0, m.index) + replacement + row.inner.slice(m.index + m[0].length);
  } else {
    // в этой строке вообще не было ячейки с таким адресом (редкий случай,
    // например в самозакрывающейся пустой строке) — просто добавляем её
    row.selfClosing = false;
    row.inner = (row.inner || '') + replacement;
  }
}

/* ---------- mergeCells: сдвиг и добавление диапазонов ---------- */
function parseMergeCells(xml) {
  const m = /<mergeCells count="(\d+)">([\s\S]*?)<\/mergeCells>/.exec(xml);
  if (!m) return { count: 0, refs: [], found: false };
  const refs = [];
  const re = /<mergeCell ref="([^"]+)"\s*\/>/g;
  let cm;
  while ((cm = re.exec(m[2]))) refs.push(cm[1]);
  return { count: parseInt(m[1], 10), refs: refs, found: true, fullMatch: m[0] };
}

function shiftMergeRef(ref, boundaryRow, extra) {
  // "B74:C74" -> и начало, и конец диапазона сдвигаем, если они на/после границы
  return ref.replace(/([A-Z]+)(\d+)/g, function (whole, col, rowStr) {
    const rowNum = parseInt(rowStr, 10);
    return rowNum >= boundaryRow ? col + (rowNum + extra) : whole;
  });
}

/* ---------- Добавление одного нового стиля в styles.xml ----------
   Единственное изменение оформления, которого нет готового в бланке:
   ФИО сотрудника в поле K21:O21 должно быть прижато влево и без переноса
   по словам (без этого длинное ФИО в узкой склеенной ячейке превращалось
   бы в нечитаемую "лестницу" из нескольких строк). Готового такого стиля
   в бланке нет, поэтому один стиль дописывается в конец списка — это не
   пересборка файла, а обычное безопасное добавление в конец существующего
   списка (ровно так Excel сам добавляет новый стиль, когда человек меняет
   оформление ячейки). Если такой стиль уже есть (например, после повторного
   запуска на уже пропатченном шаблоне) — используем его, а не дублируем. */
function ensureLeftNoWrapStyle(stylesXml, borderId) {
  const wanted = new RegExp(
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="' + borderId + '" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>'
  );
  const cellXfsMatch = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!cellXfsMatch) throw new Error('styles.xml: cellXfs не найден');
  const count = parseInt(cellXfsMatch[1], 10);
  const body = cellXfsMatch[2];

  const existingIndex = findXfIndex(body, wanted);
  if (existingIndex !== -1) return { xml: stylesXml, index: existingIndex };

  const newXf = '<xf numFmtId="0" fontId="0" fillId="0" borderId="' + borderId + '" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left"/></xf>';
  const newBody = body + newXf;
  const newCount = count + 1;
  const newBlock = '<cellXfs count="' + newCount + '">' + newBody + '</cellXfs>';
  const newXml = stylesXml.slice(0, cellXfsMatch.index) + newBlock + stylesXml.slice(cellXfsMatch.index + cellXfsMatch[0].length);
  return { xml: newXml, index: count }; // новый элемент встал на старый count (0-based)
}

/* ВАЖНО: регулярка написана как альтернатива ДВУХ ПОЛНЫХ вариантов (а не
   общий префикс "<xf[^>]*" с общим выбором окончания) — ровно та же ошибка,
   что раньше ловили на самозакрывающихся строках <row .../> (см. историю
   правок в fixRowAddressMismatches): при общем префиксе "жадный" [^>]*
   сначала "съедает" символ "/" перед закрывающей ">" самозакрывающегося
   тега, после чего вариант "/>" перестаёt совпадать, а механизм отката
   пробует второй вариант ">...</xf>" ПРЯМО С ТЕКУЩЕЙ (уже слишком длинной)
   позиции — и вместо одного самозакрывающегося <xf/> результатом становится
   склейка сразу двух соседних <xf> элементов. Нелинивый [^>]* в начале
   каждой ветки такого не допускает. */
function findXfIndex(cellXfsBody, wantedRe) {
  const re = /<xf[^>]*?\/>|<xf[^>]*?>[\s\S]*?<\/xf>/g;
  let i = 0, m;
  while ((m = re.exec(cellXfsBody))) {
    if (wantedRe.test(m[0])) return i;
    i++;
  }
  return -1;
}

/* employee: { fullName, tabelNumber, position, legalEntity, advanceAmount }
   reports: только одобренные отчеты-расходы за период, отсортированные по дате
   projectLabel: "шифр проекта — заказчик", как в выгрузке УО
   directorName: ФИО руководителя (если есть в базе) — подставляется в шапку
   periodTo: конец периода — идёт в дату отчета в шапке бланка */
async function buildAo1Workbook({ employee, reports, projectLabel, directorName, periodTo }) {
  const templateBuffer = await fs.promises.readFile(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(templateBuffer);

  let sheetXml = await zip.file(SHEET_PATH).async('string');
  let stylesXml = await zip.file(STYLES_PATH).async('string');

  const totalSpent = reports.reduce(function (sum, r) { return sum + Number(r.sum); }, 0);
  const advance = Number(employee.advanceAmount || 0);
  const extra = Math.max(0, reports.length - TEMPLATE_ROWS);

  const sheetDataMatch = /<sheetData>([\s\S]*?)<\/sheetData>/.exec(sheetXml);
  if (!sheetDataMatch) throw new Error('ao1-template.xlsx: не найден <sheetData>');
  const rows = parseRows(sheetDataMatch[1]);
  const byNum = {};
  rows.forEach(function (r) { byNum[r.num] = r; });

  /* ---------- Вставка дополнительных строк (если отчетов больше 8) ---------- */
  let finalRows = [];
  if (extra === 0) {
    finalRows = rows;
  } else {
    const templateRow = byNum[LAST_TEMPLATE_ROW];
    rows.forEach(function (r) {
      if (r.num <= LAST_TEMPLATE_ROW) {
        finalRows.push(r);
      }
    });
    for (let k = 0; k < extra; k++) {
      const newRow = cloneRowStyleOnly(templateRow, LAST_TEMPLATE_ROW + 1 + k);
      setCell(newRow, 'B', TEMPLATE_ROWS + k + 1, 'number');
      finalRows.push(newRow);
    }
    rows.forEach(function (r) {
      if (r.num > LAST_TEMPLATE_ROW) {
        finalRows.push(renumberRow(r, r.num + extra));
      }
    });
    byNum.length = 0; // больше не актуален после сдвига
  }
  const finalByNum = {};
  finalRows.forEach(function (r) { finalByNum[r.num] = r; });

  /* ---------- mergeCells: сдвиг старых диапазонов + новые для вставленных строк ---------- */
  const mc = parseMergeCells(sheetXml);
  let newRefs = mc.refs.map(function (ref) {
    return extra > 0 ? shiftMergeRef(ref, LAST_TEMPLATE_ROW + 1, extra) : ref;
  });
  for (let k = 0; k < extra; k++) {
    const newRowNum = LAST_TEMPLATE_ROW + 1 + k;
    COLUMN_SPANS.forEach(function (span) {
      const cols = span.split(':');
      newRefs.push(cols[0] + newRowNum + ':' + cols[1] + newRowNum);
    });
  }

  /* ---------- Значения ---------- */
  function cell(rowNum) {
    const r = finalByNum[rowNum];
    if (!r) throw new Error('ao1: строка ' + rowNum + ' не найдена после сборки листа');
    return r;
  }

  setCell(cell(5), 'B', employee.legalEntity || projectLabel || '', 'text');
  if (directorName) setCell(cell(13), 'T', directorName, 'text');
  setCell(cell(13), 'J', formatDateRu(periodTo || new Date()), 'text');

  setCell(cell(9), 'R', Math.floor(totalSpent), 'number');
  setCell(cell(9), 'X', Math.round((totalSpent % 1) * 100), 'number');

  setCell(cell(19), 'H', projectLabel || '', 'text');

  /* K21:O21 в бланке не объединены и имеют перенос по словам — для длинного
     ФИО это превращается в нечитаемую "лестницу". Объединяем и подставляем
     стиль без переноса, прижатый влево (см. ensureLeftNoWrapStyle выше). */
  const k21 = cell(21);
  const origK21Style = (function () {
    const m = /<c r="K21" s="(\d+)"/.exec(k21.inner);
    return m ? parseInt(m[1], 10) : null;
  })();
  const origBorderId = (function () {
    if (origK21Style === null) return 0;
    const cellXfsMatch = /<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
    // см. комментарий у findXfIndex выше про [^>]*? в начале каждой ветки —
    // та же самая ловушка с "жадным" регэкспом на самозакрывающихся <xf/>.
    const re = /<xf[^>]*?\/>|<xf[^>]*?>[\s\S]*?<\/xf>/g;
    let i = 0, m;
    while ((m = re.exec(cellXfsMatch[1]))) {
      if (i === origK21Style) {
        const bm = /borderId="(\d+)"/.exec(m[0]);
        return bm ? parseInt(bm[1], 10) : 0;
      }
      i++;
    }
    return 0;
  })();
  const styleResult = ensureLeftNoWrapStyle(stylesXml, origBorderId);
  stylesXml = styleResult.xml;
  setCell(k21, 'K', employee.fullName || '', 'text');
  // подставляем новый индекс стиля в только что записанную ячейку K21
  k21.inner = k21.inner.replace(/(<c r="K21")( s="\d+")?/, '$1 s="' + styleResult.index + '"');
  newRefs.push('K21:O21');

  setCell(cell(21), 'T', employee.tabelNumber || '', 'text');
  setCell(cell(23), 'G', employee.position || '', 'text');
  setCell(cell(23), 'Q', 'Хозяйственные нужды', 'text');

  setCell(cell(28), 'J', advance, 'number');
  setCell(cell(32), 'J', advance, 'number');
  setCell(cell(33), 'J', totalSpent, 'number');
  var diff = advance - totalSpent;
  if (diff >= 0) { setCell(cell(34), 'J', diff, 'number'); }
  else { setCell(cell(35), 'J', -diff, 'number'); }

  setCell(cell(37), 'E', reports.length, 'number');
  setCell(cell(37), 'J', reports.length, 'number');

  /* ---------- Оборотная сторона: построчно операции ---------- */
  reports.forEach(function (r, i) {
    const rowNum = FIRST_ROW + i;
    setCell(cell(rowNum), 'D', formatDateRu(r.date_iso), 'text');
    setCell(cell(rowNum), 'H', r.statya + (r.comment ? ' — ' + r.comment : ''), 'text');
    setCell(cell(rowNum), 'L', Number(r.sum), 'number');
    setCell(cell(rowNum), 'R', Number(r.sum), 'number');
  });

  const totalRow = FIRST_ROW + Math.max(reports.length, TEMPLATE_ROWS);
  setCell(cell(totalRow), 'L', totalSpent, 'number');
  setCell(cell(totalRow), 'R', totalSpent, 'number');

  const signRow = totalRow + 2;
  setCell(cell(signRow), 'N', employee.fullName || '', 'text');

  /* ---------- Пересборка sheet1.xml ---------- */
  const orderedNums = Object.keys(finalByNum).map(Number).sort(function (a, b) { return a - b; });
  const newSheetData = orderedNums.map(function (n) { return serializeRow(finalByNum[n]); }).join('');
  sheetXml = sheetXml.slice(0, sheetDataMatch.index) + '<sheetData>' + newSheetData + '</sheetData>' + sheetXml.slice(sheetDataMatch.index + sheetDataMatch[0].length);

  const lastRowNum = orderedNums[orderedNums.length - 1];
  sheetXml = sheetXml.replace(/<dimension ref="[^"]*"\s*\/>/, '<dimension ref="B1:Y' + lastRowNum + '"/>');

  const newMergeBlock = '<mergeCells count="' + newRefs.length + '">' + newRefs.map(function (r) { return '<mergeCell ref="' + r + '"/>'; }).join('') + '</mergeCells>';
  if (mc.found) {
    sheetXml = sheetXml.slice(0, sheetXml.indexOf(mc.fullMatch)) + newMergeBlock + sheetXml.slice(sheetXml.indexOf(mc.fullMatch) + mc.fullMatch.length);
  }

  /* createFolders: false — иначе JSZip при перезаписи этих двух файлов
     молча добавит в архив служебные "записи-папки" (xl/, xl/worksheets/),
     которых в родном файле клиента нет (см. историю правок в
     fixRowAddressMismatches ниже — это тот же самый эффект). */
  zip.file(SHEET_PATH, sheetXml, { createFolders: false });
  zip.file(STYLES_PATH, stylesXml, { createFolders: false });

  return zip;
}

/* buildAo1Workbook теперь возвращает уже готовый JSZip с вшитыми данными —
   отдельного шага "починки" после сборки больше не требуется (раньше он был
   нужен, потому что сама пересборка через ExcelJS и портила файл; сейчас
   пересборки целиком нет вообще, поэтому и чинить нечего). Функция оставлена
   как есть (просто отдаёт готовый буфер) — чтобы не менять вызывающий код
   в routes-reports.js больше, чем нужно. */
async function fixRowAddressMismatches(zipOrBuffer) {
  if (Buffer.isBuffer(zipOrBuffer)) return zipOrBuffer; // на всякий случай, если где-то вызовут со старым аргументом
  return zipOrBuffer.generateAsync({ type: 'nodebuffer' });
}

module.exports = { buildAo1Workbook, fixRowAddressMismatches };
