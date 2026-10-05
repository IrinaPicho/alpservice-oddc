/* ==========================================================================
   Альпсервис — ОДДС
   ========================================================================== */

/* ---------- PWA: service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}

/* ---------- Навигация: экраны входа/регистрации ---------- */
function showScreen(name) {
  document.querySelectorAll('#auth-wrap .screen').forEach(function (el) {
    el.hidden = el.id !== 'screen-' + name;
  });
  document.getElementById('back-btn').hidden = name !== 'register';
  document.getElementById('brand-sub').hidden = name === 'register';
  window.scrollTo(0, 0);
}

var activeLoginRole = 'sotr';

function setRole(role) {
  activeLoginRole = role;
  var isRuk = role === 'ruk';
  document.getElementById('tab-sotr').classList.toggle('active', role === 'sotr');
  document.getElementById('tab-buh').classList.toggle('active', role === 'buh');
  /* Вход руководителя — не отдельная вкладка рядом с "Сотрудник"/"Бухгалтер",
     а отдельная ссылка внизу экрана: на время входа руководителя сами вкладки
     прячем, остаются только поля почты/пароля. */
  document.getElementById('login-role-tabs').hidden = isRuk;
  document.getElementById('field-project').hidden = role !== 'sotr';
  document.getElementById('field-project-customer').hidden = role !== 'sotr';
  document.getElementById('register-link').hidden = role !== 'sotr';
  document.getElementById('role-hint').textContent = role === 'sotr'
    ? 'Добавляйте платежи и отправляйте отчет на проверку'
    : role === 'buh'
      ? 'Проверяйте платежи сотрудников и выгружайте отчеты'
      : 'Управляйте бухгалтерами и их доступом к проектам';
  document.getElementById('mail').placeholder = role === 'sotr' ? 'ivan@alpservice-group.ru' : role === 'buh' ? 'buh@alpservice-group.ru' : 'director@alpservice-group.ru';
  document.getElementById('director-link').textContent = isRuk ? 'Назад ко входу' : 'Войти как руководитель';
  document.getElementById('login-error').hidden = true;
}

function toggleDirectorLogin() {
  setRole(activeLoginRole === 'ruk' ? 'sotr' : 'ruk');
}

var DEMO_EMAIL = 'ivan@alpservice-group.ru';
var DEMO_PASSWORD = 'demo1234';
var DEMO_NAME = 'Иванов Иван Иванович';

var BUH_EMAIL = 'buh@alpservice-group.ru';
var BUH_PASSWORD = 'demo1234';
var BUH_NAME = 'Смирнова Елена Викторовна';

var RUK_EMAIL = 'director@alpservice-group.ru';
var RUK_PASSWORD = 'demo1234';
var RUK_NAME = 'Макаренко Алексей';

function attemptLogin() {
  var mail = document.getElementById('mail').value.trim().toLowerCase();
  var pass = document.getElementById('pass').value;
  var errorEl = document.getElementById('login-error');

  /* Логин проверяется только против той роли, вкладка (или ссылка) которой выбрана —
     почта бухгалтера не должна пускать во вкладке "Сотрудник", и наоборот. */
  if (activeLoginRole === 'sotr' && mail === DEMO_EMAIL && pass === DEMO_PASSWORD) {
    errorEl.hidden = true;
    enterWorkspace(DEMO_NAME);
  } else if (activeLoginRole === 'buh' && mail === BUH_EMAIL && pass === BUH_PASSWORD) {
    errorEl.hidden = true;
    enterBuhWorkspace(BUH_NAME);
  } else if (activeLoginRole === 'ruk' && mail === RUK_EMAIL && pass === RUK_PASSWORD) {
    errorEl.hidden = true;
    enterRukWorkspace(RUK_NAME);
  } else {
    errorEl.hidden = false;
  }
}

function completeRegistration() {
  var fio = document.getElementById('r-fio').value.trim();
  enterWorkspace(fio || DEMO_NAME);
}

function enterWorkspace(name) {
  document.getElementById('dash-employee-name').textContent = name;
  document.getElementById('dash-employee-name-side').textContent = name;
  document.getElementById('auth-wrap').hidden = true;
  document.getElementById('workspace').hidden = false;
  showView('dashboard');
  renderAll();
}

function enterBuhWorkspace(name) {
  document.getElementById('buh-name').textContent = name;
  document.getElementById('buh-name-side').textContent = name;
  document.getElementById('auth-wrap').hidden = true;
  document.getElementById('workspace-buh').hidden = false;
  buhFilter = 'all';
  document.querySelectorAll('#view-buh-all .tab').forEach(function (el, idx) {
    el.classList.toggle('active', idx === 0);
  });
  showView('buh-dashboard');
  renderBuhAll();
}

function enterRukWorkspace(name) {
  document.getElementById('ruk-name').textContent = name;
  document.getElementById('ruk-name-side').textContent = name;
  document.getElementById('auth-wrap').hidden = true;
  document.getElementById('workspace-ruk').hidden = false;
  showView('ruk-buh');
  renderRukAll();
}

function doLogout() {
  document.getElementById('workspace').hidden = true;
  document.getElementById('workspace-buh').hidden = true;
  document.getElementById('workspace-ruk').hidden = true;
  document.getElementById('auth-wrap').hidden = false;
  showScreen('login');
}

/* ---------- Навигация: разделы кабинета ---------- */
function showView(name) {
  document.querySelectorAll('.view').forEach(function (el) {
    el.hidden = el.id !== 'view-' + name;
  });
  document.querySelectorAll('.side-nav-item, .bottom-nav-item').forEach(function (el) {
    el.classList.toggle('is-active', el.dataset.view === name);
  });
  if (name === 'report') { scrollChatToBottom(); }
  window.scrollTo(0, 0);
}

document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('[data-view]').forEach(function (el) {
    el.addEventListener('click', function () { showView(el.dataset.view); });
  });
  function openCompose() {
    showView('report');
    setComposeType(activeComposeType);
  }
  document.getElementById('add-btn-desktop').addEventListener('click', openCompose);
  document.getElementById('add-btn-mobile').addEventListener('click', openCompose);
  document.getElementById('dashboard-send-btn').addEventListener('click', openCompose);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var lb = document.getElementById('lightbox-overlay');
    var rm = document.getElementById('report-modal-overlay');
    if (lb && !lb.hidden) { closeLightbox(); }
    else if (rm && !rm.hidden) { closeReportModal(); }
  });
});

function openDatePicker(evt) {
  var input = document.getElementById('chat-date');
  if (input.showPicker) {
    try { input.showPicker(); } catch (e) { input.focus(); }
  } else {
    input.focus();
  }
}

function formatDate(iso) {
  var parts = iso.split('-');
  return parts[2] + '.' + parts[1] + '.' + parts[0];
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function togglePass(id, btn) {
  var input = document.getElementById(id);
  var showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.innerHTML = showing
    ? '<svg class="icon"><use href="#i-eye"/></svg>'
    : '<svg class="icon"><use href="#i-eye-off"/></svg>';
}

/* ---------- Статьи и категории ---------- */

var EXPENSE_STATYI = [
  'Аренда автотранспорта (прокат авто, каршеринг)',
  'Аренда оборудования',
  'Аренда помещения (вагончик, бытовка, туалет, контейнер)',
  'Аренда спецтехники (кран, агп, пеканиска, воровайка)',
  'ГСМ (бензин, масла, смазка)',
  'Доставка документов (почта, курьер)',
  'Доставка материала',
  'Доставка оборудования',
  'Доставка сотрудников (жд, авиа, автобус, блаблакар, такси)',
  'Вывоз и утилизация мусора',
  'Покупка материалов',
  'Покупка оборудования',
  'Покупка инструмента',
  'Покупка спецодежды (обувь в счет оплаты)',
  'Покупка снаряжения',
  'Покупка канцтоваров (распечатка документов)',
  'Покупка оргтехники (компьютер, принтер, телефон)',
  'Покупка мебели (матрац, кухонная утварь и тд)',
  'Проживание ИТР',
  'Проживание Исполнителя (подрядчик)',
  'Питание (суточные) ИТР',
  'Питание (суточные) Исполнителя (подрядчика)',
  'Обучение (ОТ и ТБ)',
  'Ремонт оборудования',
  'Ремонт транспорта',
  'Связь, интернет',
  'Представительские расходы (конфеты, кофе/чай, алкоголь, благодарность)',
  'ФОТ ИТР',
  'ФОТ Исполнителя (подрядчик)',
  'ФОТ ПТО (смета, КСки, ППР, исполнительная документация)',
  'ФОТ РП'
];
var INCOME_STATYI = ['Аванс от заказчика', 'Оплата по акту'];

var CATEGORY_GROUPS = {
  transport:      { label: 'Транспорт',            color: '--g-transport',      soft: '--g-transport-soft',      icon: 'i-car' },
  rent:           { label: 'Аренда и площадка',    color: '--g-rent',           soft: '--g-rent-soft',           icon: 'i-building' },
  logistics:      { label: 'Логистика и доставка', color: '--g-logistics',      soft: '--g-logistics-soft',      icon: 'i-truck' },
  supply:         { label: 'Закупки и снабжение',  color: '--g-supply',         soft: '--g-supply-soft',         icon: 'i-box' },
  living:         { label: 'Проживание и питание', color: '--g-living',         soft: '--g-living-soft',         icon: 'i-bed' },
  staff:          { label: 'Персонал и ФОТ',       color: '--g-staff',          soft: '--g-staff-soft',          icon: 'i-users' },
  comms:          { label: 'Связь и обслуживание', color: '--g-comms',          soft: '--g-comms-soft',          icon: 'i-wifi' },
  representation: { label: 'Представительские',    color: '--g-representation', soft: '--g-representation-soft', icon: 'i-gift' },
  income:         { label: 'Приход',               color: '--g-income',         soft: '--g-income-soft',         icon: 'i-income' },
  other:          { label: 'Прочее',                color: '--g-other',          soft: '--g-other-soft',          icon: 'i-other' }
};

var STATYA_GROUP = {};
[
  ['transport', ['Аренда автотранспорта (прокат авто, каршеринг)', 'Аренда спецтехники (кран, агп, пеканиска, воровайка)', 'ГСМ (бензин, масла, смазка)', 'Доставка сотрудников (жд, авиа, автобус, блаблакар, такси)', 'Ремонт транспорта']],
  ['rent', ['Аренда оборудования', 'Аренда помещения (вагончик, бытовка, туалет, контейнер)']],
  ['logistics', ['Доставка документов (почта, курьер)', 'Доставка материала', 'Доставка оборудования', 'Вывоз и утилизация мусора']],
  ['supply', ['Покупка материалов', 'Покупка оборудования', 'Покупка инструмента', 'Покупка спецодежды (обувь в счет оплаты)', 'Покупка снаряжения', 'Покупка канцтоваров (распечатка документов)', 'Покупка оргтехники (компьютер, принтер, телефон)', 'Покупка мебели (матрац, кухонная утварь и тд)', 'Ремонт оборудования']],
  ['living', ['Проживание ИТР', 'Проживание Исполнителя (подрядчик)', 'Питание (суточные) ИТР', 'Питание (суточные) Исполнителя (подрядчика)']],
  ['staff', ['ФОТ ИТР', 'ФОТ Исполнителя (подрядчик)', 'ФОТ ПТО (смета, КСки, ППР, исполнительная документация)', 'ФОТ РП', 'Обучение (ОТ и ТБ)']],
  ['comms', ['Связь, интернет']],
  ['representation', ['Представительские расходы (конфеты, кофе/чай, алкоголь, благодарность)']],
  ['income', ['Аванс от заказчика', 'Оплата по акту']]
].forEach(function (pair) {
  var group = pair[0];
  pair[1].forEach(function (statya) { STATYA_GROUP[statya] = group; });
});

function groupFor(statya, type) {
  var key = STATYA_GROUP[statya];
  if (!key) key = type === 'income' ? 'income' : 'other';
  return CATEGORY_GROUPS[key] || CATEGORY_GROUPS.other;
}

function catIconChip(group, size) {
  /* Правило по всему сайту: серая плашка, тонкая красная иконка. */
  return '<span class="cat-icon-chip">' +
    '<svg class="icon' + (size === 'sm' ? ' icon-sm' : '') + '"><use href="#' + group.icon + '"/></svg></span>';
}

/* ---------- Лента отчетов (состояние) ---------- */

var ICON_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';

var THREAD = [];      // {kind:'divider', label} | {kind:'user', ...report} | {kind:'bot', status, text}
var ALL_REPORTS = []; // сквозной список отчетов всех сотрудников — источник данных для кабинета бухгалтера
var REPORT_SEQ = 1;
var activeComposeType = 'expense';
var editingId = null;

function addDivider(label) { THREAD.push({ kind: 'divider', label: label }); }

function addReport(type, statya, sum, dateIso, comment, attached, status, files, reviewerComment) {
  var report = {
    kind: 'user', id: 'r' + (REPORT_SEQ++), employee: DEMO_NAME, type: type, statya: statya, sum: Number(sum),
    dateIso: dateIso, comment: comment || '', attached: !!attached, status: status, files: files || [],
    reviewerComment: reviewerComment || ''
  };
  THREAD.push(report);
  ALL_REPORTS.push(report);
  return report;
}

function addBot(status, text) { THREAD.push({ kind: 'bot', status: status, text: text }); }

function findReport(id) {
  for (var i = 0; i < THREAD.length; i++) {
    if (THREAD[i].kind === 'user' && THREAD[i].id === id) return THREAD[i];
  }
  return null;
}

/* ---------- Отчеты других сотрудников (демо-данные для кабинета бухгалтера) ---------- */

function addForeignReport(employee, type, statya, sum, dateIso, comment, status, files, reviewerComment) {
  var report = {
    kind: 'other', id: 'r' + (REPORT_SEQ++), employee: employee, type: type, statya: statya, sum: Number(sum),
    dateIso: dateIso, comment: comment || '', attached: true, status: status, files: files || [],
    reviewerComment: reviewerComment || ''
  };
  ALL_REPORTS.push(report);
  return report;
}

function demoFile(kind, name) {
  return { type: kind, url: 'demo-' + name, name: name };
}

function seedOtherEmployees() {
  addForeignReport('Петров Пётр Петрович', 'expense', 'Аренда спецтехники (кран, агп, пеканиска, воровайка)', 32000, '2026-09-18', 'Кран для монтажа конструкций, 2 смены', 'pending', [demoFile('pdf', 'receipt-1.pdf')]);
  addForeignReport('Петров Пётр Петрович', 'expense', 'Связь, интернет', 2100, '2026-09-10', '', 'approved', [demoFile('image', 'receipt-3.png')]);
  addForeignReport('Петров Пётр Петрович', 'expense', 'Представительские расходы (конфеты, кофе/чай, алкоголь, благодарность)', 4800, '2026-09-08', 'Встреча с заказчиком', 'rejected', [demoFile('image', 'receipt-4.png')], 'Нет детализации по позициям, приложите чек из заведения.');

  addForeignReport('Сидорова Анна Игоревна', 'expense', 'Покупка оргтехники (компьютер, принтер, телефон)', 56000, '2026-09-20', 'Ноутбук для ПТО', 'pending', [demoFile('pdf', 'receipt-2.pdf')]);
  addForeignReport('Сидорова Анна Игоревна', 'expense', 'Доставка материала', 9100, '2026-09-21', '', 'pending', [demoFile('image', 'receipt-2.png')]);
  addForeignReport('Сидорова Анна Игоревна', 'income', 'Оплата по акту', 240000, '2026-09-12', '', 'approved', [demoFile('pdf', 'receipt-1.pdf')]);

  addForeignReport('Козлов Дмитрий Сергеевич', 'expense', 'Проживание ИТР', 27300, '2026-09-23', 'Гостиница, 7 суток, 2 чел.', 'pending', [demoFile('image', 'receipt-4.png')]);
  addForeignReport('Козлов Дмитрий Сергеевич', 'expense', 'ГСМ (бензин, масла, смазка)', 3200, '2026-09-14', '', 'rejected', [demoFile('image', 'receipt-1.png')], 'Сумма не совпадает с чеком, уточните и пересчитайте.');
}

function seedChatHistory() {
  addDivider('15 сентября');
  addReport('expense', 'Хознужды', 1350, '2026-09-15', 'Такси до объекта и канцтовары', true, 'rejected', [demoFile('image', 'receipt-3.png')], 'Чек нечитаем, приложите новый.');
  addBot('rejected', 'Отчет отклонен бухгалтером. Комментарий: чек нечитаем, приложите новый.');

  addDivider('19 сентября');
  addReport('expense', 'Покупка материалов', 18600, '2026-09-19', '', true, 'approved', [demoFile('image', 'receipt-2.png')]);
  addBot('approved', 'Отчет согласован бухгалтером.');

  addDivider('22 сентября');
  addReport('expense', 'ГСМ (бензин, масла, смазка)', 4200, '2026-09-22', '', true, 'pending', [demoFile('image', 'receipt-1.png')]);
  addBot('pending', 'Отчет принят и отправлен на проверку бухгалтеру.');
}

/* ---------- Рендер чат-ленты ---------- */

function renderThread() {
  var thread = document.getElementById('chat-thread');
  thread.innerHTML = '';
  THREAD.forEach(function (entry) {
    if (entry.kind === 'divider') {
      var el = document.createElement('div');
      el.className = 'chat-date';
      el.textContent = entry.label;
      thread.appendChild(el);
    } else if (entry.kind === 'bot') {
      var wrap = document.createElement('div');
      wrap.className = 'msg msg-bot';
      var icon = entry.status === 'pending' ? '⏳' : entry.status === 'approved' ? '✅' : '⚠️';
      wrap.innerHTML =
        '<div class="msg-avatar">А</div>' +
        '<div class="msg-bubble msg-bubble-' + entry.status + '">' + icon + ' ' + escapeHtml(entry.text) + '</div>';
      thread.appendChild(wrap);
    } else {
      thread.appendChild(renderReportCard(entry));
    }
  });
}

function renderReportCard(report) {
  var group = groupFor(report.statya, report.type);
  var wrap = document.createElement('div');
  wrap.className = 'msg msg-user';
  var card = document.createElement('div');
  card.className = 'msg-card';
  var editable = report.status !== 'approved';
  card.innerHTML =
    (editable ? '<button class="msg-card-edit" type="button" onclick="startEditReport(\'' + report.id + '\')" aria-label="Редактировать">' + ICON_PENCIL + '</button>' : '') +
    '<div class="msg-card-head">' + catIconChip(group, 'sm') +
      '<div><div class="msg-card-type">' + (report.type === 'expense' ? 'Отчет по расходу' : 'Приход') + '</div></div>' +
    '</div>' +
    '<div class="msg-card-title">' + escapeHtml(report.statya) + '</div>' +
    '<div class="msg-card-sum">' + report.sum.toLocaleString('ru-RU') + ' ₽</div>' +
    (report.comment ? '<div class="msg-card-comment">' + escapeHtml(report.comment) + '</div>' : '') +
    '<div class="msg-time">' + formatDate(report.dateIso) + '</div>';
  wrap.appendChild(card);
  return wrap;
}

function scrollChatToBottom() {
  var thread = document.getElementById('chat-thread');
  thread.scrollTop = thread.scrollHeight;
}

/* ---------- Компоновка формы ---------- */

function populateStatyaSelect(type) {
  var list = type === 'expense' ? EXPENSE_STATYI : INCOME_STATYI;
  var sel = document.getElementById('chat-statya');
  sel.innerHTML = '<option>Выберите статью</option>' + list.map(function (s) { return '<option>' + s + '</option>'; }).join('');
}

function activateComposeTab(type) {
  activeComposeType = type;
  document.getElementById('chat-tab-expense').classList.toggle('active', type === 'expense');
  document.getElementById('chat-tab-income').classList.toggle('active', type === 'income');
  populateStatyaSelect(type);
}

var ACCEPTED_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
var selectedFiles = [];
var keepExistingAttachment = false;

function resetComposeFields() {
  document.getElementById('chat-statya').selectedIndex = 0;
  document.getElementById('chat-sum').value = '';
  document.getElementById('chat-date').value = '';
  document.getElementById('chat-comment').value = '';
  document.getElementById('chat-file').value = '';
  selectedFiles = [];
  keepExistingAttachment = false;
  document.getElementById('chat-attach').classList.remove('attached');
  document.getElementById('chat-attach-label').textContent = activeComposeType === 'expense' ? 'Прикрепить чек (можно несколько)' : 'Прикрепить документ (можно несколько)';
  renderFilePreviews();
}

function setComposeType(type) {
  editingId = null;
  document.getElementById('chat-submit').textContent = 'Отправить';
  document.getElementById('chat-cancel-edit').hidden = true;
  activateComposeTab(type);
  resetComposeFields();
  checkChatForm();
}

function checkChatForm() {
  var statya = document.getElementById('chat-statya').value;
  var sum = document.getElementById('chat-sum').value;
  var date = document.getElementById('chat-date').value;
  var hasFile = selectedFiles.length > 0 || keepExistingAttachment;
  var valid = statya && statya.indexOf('Выберите') !== 0 && sum !== '' && Number(sum) > 0 && date !== '' && hasFile;
  document.getElementById('chat-submit').disabled = !valid;
}

function updateAttachLabel() {
  var btn = document.getElementById('chat-attach');
  var label = document.getElementById('chat-attach-label');
  var baseLabel = activeComposeType === 'expense' ? 'чек' : 'документ';
  if (selectedFiles.length) {
    btn.classList.add('attached');
    label.textContent = selectedFiles.length === 1 ? selectedFiles[0].name : selectedFiles.length + ' файла прикреплено';
  } else if (keepExistingAttachment) {
    btn.classList.add('attached');
    label.textContent = (activeComposeType === 'expense' ? 'Чек' : 'Документ') + ' уже прикреплен (нажмите, чтобы заменить)';
  } else {
    btn.classList.remove('attached');
    label.textContent = 'Прикрепить ' + baseLabel + ' (можно несколько)';
  }
}

function filePreviewIcon(file) {
  if (file.type === 'application/pdf') {
    return '<div class="file-preview-pdf"><svg class="icon"><use href="#i-file"/></svg><span>PDF</span></div>';
  }
  return '';
}

function renderFilePreviews() {
  var wrap = document.getElementById('chat-file-previews');
  if (!wrap) return;
  wrap.innerHTML = selectedFiles.map(function (file, idx) {
    var inner;
    if (file.type === 'application/pdf') {
      inner = filePreviewIcon(file);
    } else {
      inner = '<img src="' + URL.createObjectURL(file) + '" alt="">';
    }
    return '<div class="file-preview-item">' + inner +
      '<button type="button" class="file-preview-remove" onclick="removeSelectedFile(' + idx + ')" aria-label="Удалить файл">' +
      '<svg class="icon"><use href="#i-close"/></svg></button></div>';
  }).join('');
}

function removeSelectedFile(idx) {
  selectedFiles.splice(idx, 1);
  updateAttachLabel();
  renderFilePreviews();
  checkChatForm();
}

function handleChatFile(input) {
  var files = input.files ? Array.prototype.slice.call(input.files) : [];
  var accepted = files.filter(function (f) { return ACCEPTED_FILE_TYPES.indexOf(f.type) !== -1; });
  var rejectedCount = files.length - accepted.length;
  selectedFiles = selectedFiles.concat(accepted);
  input.value = '';
  if (rejectedCount > 0) {
    window.alert('Можно загружать только файлы PNG, JPEG, WebP и PDF. ' + rejectedCount + ' файл(а) пропущено.');
  }
  updateAttachLabel();
  renderFilePreviews();
  checkChatForm();
}

function startEditReport(id) {
  var report = findReport(id);
  if (!report) return;
  editingId = id;
  activateComposeTab(report.type);
  document.getElementById('chat-statya').value = report.statya;
  document.getElementById('chat-sum').value = report.sum;
  document.getElementById('chat-date').value = report.dateIso;
  document.getElementById('chat-comment').value = report.comment;
  document.getElementById('chat-file').value = '';
  selectedFiles = [];
  keepExistingAttachment = !!report.attached;
  renderFilePreviews();
  updateAttachLabel();

  document.getElementById('chat-submit').textContent = 'Сохранить изменения';
  document.getElementById('chat-cancel-edit').hidden = false;
  checkChatForm();
  showView('report');
  document.querySelector('.chat-compose').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelEditReport() {
  setComposeType(activeComposeType);
}

function filesToAttachments(files) {
  return files.map(function (file) {
    return {
      type: file.type === 'application/pdf' ? 'pdf' : 'image',
      url: URL.createObjectURL(file),
      name: file.name
    };
  });
}

function submitChatCard() {
  var statyaEl = document.getElementById('chat-statya');
  var sumEl = document.getElementById('chat-sum');
  var dateEl = document.getElementById('chat-date');
  var commentEl = document.getElementById('chat-comment');

  var statya = statyaEl.value;
  var sum = Number(sumEl.value);
  var comment = commentEl.value.trim();
  if (!statya || statya.indexOf('Выберите') === 0 || !sum || !dateEl.value) { return; }

  var editingReport = editingId ? findReport(editingId) : null;
  var hasFile = selectedFiles.length > 0 || keepExistingAttachment;
  if (!hasFile) { return; }
  var dateIso = dateEl.value;

  if (editingReport) {
    editingReport.statya = statya;
    editingReport.sum = sum;
    editingReport.dateIso = dateIso;
    editingReport.comment = comment;
    editingReport.attached = hasFile;
    editingReport.status = 'pending';
    if (selectedFiles.length) { editingReport.files = filesToAttachments(selectedFiles); }
    addBot('pending', activeComposeType === 'expense'
      ? 'Отчет изменен и повторно отправлен на проверку бухгалтеру.'
      : 'Приход изменен и повторно отправлен на проверку бухгалтеру.');
    renderAll();
    setComposeType(activeComposeType);
    return;
  }

  addReport(activeComposeType, statya, sum, dateIso, comment, true, 'pending', filesToAttachments(selectedFiles));
  addBot('pending', activeComposeType === 'expense'
    ? 'Отчет принят и отправлен на проверку бухгалтеру.'
    : 'Приход принят и отправлен на проверку бухгалтеру.');

  renderAll();
  resetComposeFields();
  checkChatForm();
  scrollChatToBottom();
}

/* ---------- Дашборд: статистика ---------- */

function reports() {
  return THREAD.filter(function (e) { return e.kind === 'user'; });
}

function fmtSum(n) { return Math.round(n).toLocaleString('ru-RU'); }

function renderStats() {
  var all = reports();
  var totalSum = 0, pendingSum = 0, pendingCount = 0, approvedSum = 0, approvedCount = 0, rejectedSum = 0, rejectedCount = 0;
  all.forEach(function (r) {
    totalSum += r.sum;
    if (r.status === 'pending') { pendingSum += r.sum; pendingCount++; }
    if (r.status === 'approved') { approvedSum += r.sum; approvedCount++; }
    if (r.status === 'rejected') { rejectedSum += r.sum; rejectedCount++; }
  });
  document.getElementById('stat-total-sum').textContent = fmtSum(totalSum);
  document.getElementById('stat-total-count').textContent = all.length + (all.length === 1 ? ' отчет' : ' отчетов');
  document.getElementById('stat-pending-sum').textContent = fmtSum(pendingSum);
  document.getElementById('stat-pending-count').textContent = pendingCount + ' шт.';
  document.getElementById('stat-approved-sum').textContent = fmtSum(approvedSum);
  document.getElementById('stat-approved-count').textContent = approvedCount + ' шт.';
  document.getElementById('stat-rejected-sum').textContent = fmtSum(rejectedSum);
  document.getElementById('stat-rejected-count').textContent = rejectedCount + ' шт.';
}

function renderProportion() {
  var bar = document.getElementById('proportion-bar');
  var legend = document.getElementById('proportion-legend');
  var countEl = document.getElementById('hero-count');
  var expenseReports = reports().filter(function (r) { return r.type === 'expense' && r.status !== 'rejected'; });

  countEl.textContent = expenseReports.length + (expenseReports.length === 1 ? ' операция' : ' операций');

  if (!expenseReports.length) {
    bar.innerHTML = '';
    legend.innerHTML = '<span class="proportion-empty">Пока нет принятых отчетов по расходам.</span>';
    return;
  }

  var totals = {};
  var order = [];
  expenseReports.forEach(function (r) {
    var group = groupFor(r.statya, r.type);
    var key = group.label;
    if (!totals[key]) { totals[key] = { sum: 0, group: group }; order.push(key); }
    totals[key].sum += r.sum;
  });
  var grand = order.reduce(function (acc, k) { return acc + totals[k].sum; }, 0);
  order.sort(function (a, b) { return totals[b].sum - totals[a].sum; });

  bar.innerHTML = order.map(function (k) {
    var pct = (totals[k].sum / grand) * 100;
    return '<span style="width:' + pct.toFixed(2) + '%;--seg-color:var(' + totals[k].group.color + ')"></span>';
  }).join('');

  legend.innerHTML = order.map(function (k) {
    var pct = Math.round((totals[k].sum / grand) * 100);
    return '<span class="leg-item"><span class="leg-dot" style="--seg-color:var(' + totals[k].group.color + ')"></span>' + escapeHtml(k) + ' · ' + pct + '%</span>';
  }).join('');
}

function renderRecent() {
  var list = document.getElementById('recent-list');
  var all = reports().slice().reverse().slice(0, 6);
  if (!all.length) {
    list.innerHTML = '<div class="recent-empty">Отчетов пока нет — отправьте первый в разделе «Отчетность».</div>';
    return;
  }
  list.innerHTML = all.map(function (r) {
    var group = groupFor(r.statya, r.type);
    var isRejected = r.status === 'rejected';
    var statusHtml = isRejected
      ? '<span class="recent-status-badge recent-status-rejected">Отклонено</span>'
      : (r.status === 'pending' ? 'На проверке' : 'Одобрено');
    var reasonHtml = (isRejected && r.reviewerComment)
      ? '<div class="recent-reject-reason"><span class="review-comment-label">Комментарий от бухгалтера:</span> ' + escapeHtml(r.reviewerComment) + '</div>'
      : '';
    var sign = r.type === 'income' ? '+' : '−';
    return '<div class="recent-row" onclick="openReportModal(\'' + r.id + '\')">' + catIconChip(group) +
      '<div class="recent-info"><div class="recent-title">' + escapeHtml(r.statya) + '</div>' +
      '<div class="recent-meta">' + formatDate(r.dateIso) + ' | ' + statusHtml + '</div>' +
      reasonHtml +
      '</div>' +
      '<div class="recent-amount' + (r.type === 'income' ? ' is-income' : '') + '">' + sign + fmtSum(r.sum) + ' ₽</div></div>';
  }).join('');
}

/* ========================================================================
   Модалка с деталями отчета (кабинет сотрудника) — открывается кликом по
   строке "Последние отчеты" на дашборде.
   ========================================================================== */

function reportDetailBodyHtml(r) {
  var group = groupFor(r.statya, r.type);
  var sign = r.type === 'income' ? '+' : '−';
  var typeLabel = r.type === 'expense' ? 'Отчет по расходу' : 'Приход';
  var filesHtml = (r.files && r.files.length)
    ? '<div class="review-attachments">' + r.files.map(attachmentThumbHtml).join('') + '</div>'
    : '<div class="review-files-empty">Без вложения</div>';
  var statusBadge = r.status === 'rejected'
    ? '<span class="recent-status-badge recent-status-rejected">Отклонено</span>'
    : '<span class="status-pill status-pill-' + r.status + '">' + reportStatusLabel(r.status) + '</span>';
  var reasonHtml = (r.status === 'rejected' && r.reviewerComment)
    ? '<div class="modal-reject-reason"><span class="review-comment-label">Комментарий от бухгалтера:</span> ' + escapeHtml(r.reviewerComment) + '</div>'
    : '';
  var editable = r.status !== 'approved';
  return (
    '<div class="msg-card-head">' + catIconChip(group) + '<div><div class="msg-card-type">' + typeLabel + '</div></div></div>' +
    '<div class="review-title" style="margin-top:8px">' + escapeHtml(r.statya) + '</div>' +
    '<div class="review-meta" style="margin:4px 0 10px">Дата: ' + formatDate(r.dateIso) + '</div>' +
    '<div class="review-sum' + (r.type === 'income' ? ' is-income' : '') + '" style="margin-bottom:10px">' + sign + fmtSum(r.sum) + ' ₽</div>' +
    statusBadge +
    (r.comment ? '<div class="review-comment" style="margin-top:12px"><span class="review-comment-label">Комментарий:</span> ' + escapeHtml(r.comment) + '</div>' : '') +
    reasonHtml +
    filesHtml +
    (editable ? '<button class="btn-primary modal-edit-btn" type="button" onclick="editFromModal(\'' + r.id + '\')">Редактировать и отправить заново</button>' : '')
  );
}

function openReportModal(id) {
  var r = findReport(id);
  if (!r) return;
  document.getElementById('report-modal-body').innerHTML = reportDetailBodyHtml(r);
  document.getElementById('report-modal-overlay').hidden = false;
}

function closeReportModal() {
  document.getElementById('report-modal-overlay').hidden = true;
  document.getElementById('report-modal-body').innerHTML = '';
}

function closeReportModalOverlay(evt) {
  if (evt.target.id === 'report-modal-overlay') closeReportModal();
}

function editFromModal(id) {
  closeReportModal();
  showView('report');
  startEditReport(id);
}

function renderAll() {
  renderThread();
  renderStats();
  renderProportion();
  renderRecent();
}

/* ========================================================================
   Кабинет бухгалтера
   ========================================================================== */

var buhFilter = 'all';
var expandedReviewIds = {}; // id -> true — отчеты в "Все отчеты", развёрнутые кликом для проверки/правки решения

function findAnyReport(id) {
  for (var i = 0; i < ALL_REPORTS.length; i++) {
    if (ALL_REPORTS[i].id === id) return ALL_REPORTS[i];
  }
  return null;
}

function buhPending() {
  return ALL_REPORTS.filter(function (r) { return r.status === 'pending'; });
}

function reportStatusLabel(status) {
  return status === 'pending' ? 'На проверке' : status === 'approved' ? 'Одобрено' : 'Отклонено';
}

function renderBuhStats() {
  var pendingSum = 0, pendingCount = 0, approvedSum = 0, approvedCount = 0, rejectedSum = 0, rejectedCount = 0;
  var employees = {};
  ALL_REPORTS.forEach(function (r) {
    employees[r.employee] = true;
    if (r.status === 'pending') { pendingSum += r.sum; pendingCount++; }
    if (r.status === 'approved') { approvedSum += r.sum; approvedCount++; }
    if (r.status === 'rejected') { rejectedSum += r.sum; rejectedCount++; }
  });
  document.getElementById('buh-stat-pending-sum').textContent = fmtSum(pendingSum);
  document.getElementById('buh-stat-pending-count').textContent = pendingCount + (pendingCount === 1 ? ' отчет' : ' отчетов');
  document.getElementById('buh-stat-approved-sum').textContent = fmtSum(approvedSum);
  document.getElementById('buh-stat-approved-count').textContent = approvedCount + ' шт.';
  document.getElementById('buh-stat-rejected-sum').textContent = fmtSum(rejectedSum);
  document.getElementById('buh-stat-rejected-count').textContent = rejectedCount + ' шт.';
  document.getElementById('buh-stat-employees').textContent = Object.keys(employees).length;
}

function attachmentThumbHtml(file) {
  var safeUrl = escapeHtml(file.url);
  var safeName = escapeHtml(file.name);
  if (file.type === 'pdf') {
    return '<button type="button" class="review-attach-thumb review-attach-thumb-pdf" data-url="' + safeUrl + '" data-kind="pdf" data-name="' + safeName + '" onclick="openLightboxFromEl(this)" title="' + safeName + '">' +
      '<svg class="icon"><use href="#i-file"/></svg><span>PDF</span></button>';
  }
  return '<button type="button" class="review-attach-thumb" data-url="' + safeUrl + '" data-kind="image" data-name="' + safeName + '" onclick="openLightboxFromEl(this)" title="' + safeName + '">' +
    '<img src="' + file.url + '" alt="' + safeName + '"></button>';
}

/* ---------- Просмотр вложения (лайтбокс) ----------
   Открываем файл во встроенном окне поверх страницы вместо перехода в новую
   вкладку: target="_blank" на относительные/blob-ссылки ненадёжен внутри
   встроенной (iframe) версии сайта — там такая навигация блокируется. */
function openLightboxFromEl(el) {
  openLightbox({ url: el.dataset.url, kind: el.dataset.kind, name: el.dataset.name });
}

function openLightbox(file) {
  var body = document.getElementById('lightbox-body');
  if (file.kind === 'pdf') {
    body.innerHTML =
      '<iframe class="lightbox-pdf" src="' + file.url + '" title="' + escapeHtml(file.name) + '"></iframe>' +
      '<a class="text-link lightbox-fallback" href="' + file.url + '" target="_blank" rel="noopener">Открыть в новой вкладке</a>';
  } else {
    body.innerHTML = '<img class="lightbox-img" src="' + file.url + '" alt="' + escapeHtml(file.name) + '">';
  }
  document.getElementById('lightbox-overlay').hidden = false;
}

function closeLightbox() {
  document.getElementById('lightbox-overlay').hidden = true;
  document.getElementById('lightbox-body').innerHTML = '';
}

function closeLightboxOverlay(evt) {
  if (evt.target.id === 'lightbox-overlay') closeLightbox();
}

function reviewCardHtml(r, opts) {
  var group = groupFor(r.statya, r.type);
  var sign = r.type === 'income' ? '+' : '−';
  var typeLabel = r.type === 'expense' ? 'Отчет по расходу' : 'Приход';
  /* В очереди и в "Все отчеты" одна и та же запись может отрисовываться одновременно
     (разные <section>, просто один из них скрыт) — различаем id контекстом (queue/all),
     чтобы не дублировать id в документе. */
  var context = (opts && opts.context) || 'queue';
  var domId = context + '-' + r.id;
  /* В "На проверке" кнопки решения видны всегда; в "Все отчеты" — только после клика
     по карточке (или по ссылке "Редактировать"), чтобы можно было поправить любое,
     уже принятое, решение. */
  var showActions = context === 'queue' ? true : !!expandedReviewIds[r.id];
  var clickToExpand = context === 'all' && !showActions;

  var filesHtml = (r.files && r.files.length)
    ? '<div class="review-attachments">' + r.files.map(attachmentThumbHtml).join('') + '</div>'
    : '<div class="review-files-empty">Без вложения</div>';

  var reviewerCommentHtml = (r.status !== 'pending' && r.reviewerComment)
    ? '<div class="review-comment review-reviewer-comment"><span class="review-comment-label">Комментарий бухгалтера:</span> ' + escapeHtml(r.reviewerComment) + '</div>'
    : '';

  var statusArea;
  if (showActions) {
    statusArea =
      '<div class="review-actions" id="review-actions-' + domId + '">' +
        '<button class="btn-reject" type="button" onclick="startReject(\'' + r.id + '\',\'' + domId + '\')">Отклонить</button>' +
        '<button class="btn-approve" type="button" onclick="accountantApprove(\'' + r.id + '\')">Одобрить</button>' +
      '</div>' +
      (context === 'all' ? '<button class="text-link review-collapse" type="button" onclick="collapseReview(\'' + r.id + '\')">Свернуть</button>' : '');
  } else {
    statusArea =
      '<div class="status-pill status-pill-' + r.status + '">' + reportStatusLabel(r.status) + '</div>' +
      (context === 'all' ? '<button class="text-link review-edit-link" type="button">Редактировать</button>' : '');
  }

  return '<div class="review-card' + (clickToExpand ? ' review-card-clickable' : '') + '" id="review-' + domId + '"' +
      (clickToExpand ? ' onclick="toggleReviewExpand(\'' + r.id + '\', event)"' : '') + '>' +
    '<div class="review-head">' +
      '<div class="review-employee">' + escapeHtml(r.employee) + '</div>' +
      '<div class="review-meta">Дата: ' + formatDate(r.dateIso) + '</div>' +
    '</div>' +
    '<div class="review-body">' +
      '<div class="msg-card-head">' + catIconChip(group, 'sm') +
        '<div><div class="msg-card-type">' + typeLabel + '</div></div></div>' +
      '<div class="review-title">' + escapeHtml(r.statya) + '</div>' +
      '<div class="review-sum' + (r.type === 'income' ? ' is-income' : '') + '">' + sign + fmtSum(r.sum) + ' ₽</div>' +
      (r.comment ? '<div class="review-comment"><span class="review-comment-label">Комментарий:</span> ' + escapeHtml(r.comment) + '</div>' : '') +
      reviewerCommentHtml +
      filesHtml +
    '</div>' +
    statusArea +
  '</div>';
}

/* Клик по свёрнутой карточке в "Все отчеты" разворачивает кнопки решения —
   кроме клика по вложению (там своё действие — открыть лайтбокс). */
function toggleReviewExpand(id, evt) {
  if (evt && evt.target && evt.target.closest && evt.target.closest('.review-attach-thumb')) return;
  if (expandedReviewIds[id]) { delete expandedReviewIds[id]; } else { expandedReviewIds[id] = true; }
  renderBuhAllList();
}

function collapseReview(id) {
  delete expandedReviewIds[id];
  renderBuhAllList();
}

function renderBuhDashboardQueue() {
  var wrap = document.getElementById('buh-dashboard-queue');
  var items = buhPending().slice(0, 5);
  if (!items.length) {
    wrap.innerHTML = '<div class="recent-empty">Нет отчетов, ожидающих проверки.</div>';
    return;
  }
  wrap.innerHTML = items.map(function (r) {
    var group = groupFor(r.statya, r.type);
    return '<div class="recent-row" onclick="showView(\'buh-queue\')">' + catIconChip(group) +
      '<div class="recent-info"><div class="recent-title">' + escapeHtml(r.employee) + ' · ' + escapeHtml(r.statya) + '</div>' +
      '<div class="recent-meta">' + formatDate(r.dateIso) + ' | На проверке</div></div>' +
      '<div class="recent-amount">' + fmtSum(r.sum) + ' ₽</div></div>';
  }).join('');
}

function renderBuhQueue() {
  var wrap = document.getElementById('buh-queue-list');
  var items = buhPending();
  if (!items.length) {
    wrap.innerHTML = '<div class="recent-empty">Все отчеты проверены — очередь пуста.</div>';
    return;
  }
  wrap.innerHTML = items.map(function (r) { return reviewCardHtml(r, { context: 'queue' }); }).join('');
}

function setBuhFilter(filter) {
  buhFilter = filter;
  var order = ['all', 'pending', 'approved', 'rejected'];
  document.querySelectorAll('#view-buh-all .tab').forEach(function (el, idx) {
    el.classList.toggle('active', order[idx] === filter);
  });
  renderBuhAllList();
}

function renderBuhAllList() {
  var wrap = document.getElementById('buh-all-list');
  var items = ALL_REPORTS.slice().sort(function (a, b) { return b.dateIso.localeCompare(a.dateIso); });
  if (buhFilter !== 'all') items = items.filter(function (r) { return r.status === buhFilter; });
  if (!items.length) {
    wrap.innerHTML = '<div class="recent-empty">Отчетов нет.</div>';
    return;
  }
  wrap.innerHTML = items.map(function (r) { return reviewCardHtml(r, { context: 'all' }); }).join('');
}

function renderBuhAll() {
  renderBuhStats();
  renderBuhDashboardQueue();
  renderBuhQueue();
  renderBuhAllList();
}

function applyDecision(id, status, comment) {
  var report = findAnyReport(id);
  if (!report) return;
  var wasAlreadyDecided = report.status !== 'pending';
  report.status = status;
  report.reviewerComment = comment || '';
  delete expandedReviewIds[id]; // после решения сворачиваем карточку обратно к плашке статуса
  if (report.kind === 'user') {
    var text;
    if (wasAlreadyDecided) {
      text = status === 'approved'
        ? (report.type === 'expense' ? 'Решение по отчету изменено: одобрено бухгалтером.' : 'Решение по приходу изменено: одобрено бухгалтером.')
        : (report.type === 'expense' ? 'Решение по отчету изменено: отклонено бухгалтером.' : 'Решение по приходу изменено: отклонено бухгалтером.') + (comment ? ' Комментарий: ' + comment : '');
    } else {
      text = status === 'approved'
        ? (report.type === 'expense' ? 'Отчет согласован бухгалтером.' : 'Приход согласован бухгалтером.')
        : (report.type === 'expense' ? 'Отчет отклонен бухгалтером.' : 'Приход отклонен бухгалтером.') + (comment ? ' Комментарий: ' + comment : '');
    }
    addBot(status, text);
  }
  renderBuhAll();
}

function accountantApprove(id) {
  applyDecision(id, 'approved', '');
}

function startReject(id, domId) {
  var actionsEl = document.getElementById('review-actions-' + domId);
  if (!actionsEl) return;
  var report = findAnyReport(id);
  var prefill = (report && report.status === 'rejected' && report.reviewerComment) ? escapeHtml(report.reviewerComment) : '';
  actionsEl.outerHTML =
    '<div class="reject-form" id="review-actions-' + domId + '">' +
      '<textarea id="reject-comment-' + domId + '" placeholder="Причина отклонения (обязательно)" rows="2">' + prefill + '</textarea>' +
      '<div class="reject-form-actions">' +
        '<button class="text-link" type="button" onclick="cancelReject()">Отмена</button>' +
        '<button class="btn-reject-confirm" type="button" onclick="confirmReject(\'' + id + '\',\'' + domId + '\')">Подтвердить отклонение</button>' +
      '</div>' +
    '</div>';
}

function cancelReject() {
  renderBuhAll();
}

function confirmReject(id, domId) {
  var ta = document.getElementById('reject-comment-' + domId);
  var comment = ta ? ta.value.trim() : '';
  if (!comment) { ta.focus(); return; }
  applyDecision(id, 'rejected', comment);
}

/* ========================================================================
   Кабинет руководителя — управление бухгалтерами
   Только почта и шифр проекта, к которому привязан бухгалтер: пароль
   бухгалтер при необходимости сбрасывает сам, руководителю он не нужен и
   не показывается — ни здесь, ни где-либо ещё в приложении.
   ========================================================================== */

var ACCOUNTANTS = [];
var ACCOUNTANT_SEQ = 1;

function addAccountant(email, projectCode) {
  var acc = { id: 'a' + (ACCOUNTANT_SEQ++), email: email, projectCode: projectCode || '' };
  ACCOUNTANTS.push(acc);
  return acc;
}

function seedAccountants() {
  addAccountant('buh@alpservice-group.ru', '30-155');
  addAccountant('svetlana.buh@alpservice-group.ru', '30-162');
  addAccountant('oleg.buh@alpservice-group.ru', '30-170');
}

function renderRukStats() {
  document.getElementById('ruk-stat-count').textContent = ACCOUNTANTS.length;
  var codes = {};
  ACCOUNTANTS.forEach(function (a) { if (a.projectCode) codes[a.projectCode] = true; });
  document.getElementById('ruk-stat-projects').textContent = Object.keys(codes).length;
}

function renderRukList() {
  var wrap = document.getElementById('ruk-list');
  if (!ACCOUNTANTS.length) {
    wrap.innerHTML = '<div class="recent-empty">Бухгалтеров пока нет — добавьте первого выше.</div>';
    return;
  }
  wrap.innerHTML = ACCOUNTANTS.map(function (a) {
    return '<div class="ruk-row">' +
      '<span class="cat-icon-chip"><svg class="icon"><use href="#i-users"/></svg></span>' +
      '<div class="recent-info">' +
        '<div class="recent-title">' + escapeHtml(a.email) + '</div>' +
        '<div class="recent-meta">Проект: ' + escapeHtml(a.projectCode || '—') + '</div>' +
      '</div>' +
      '<button class="ruk-delete-btn" type="button" onclick="deleteAccountant(\'' + a.id + '\')" aria-label="Удалить бухгалтера">' +
        '<svg class="icon icon-sm"><use href="#i-close"/></svg>' +
      '</button>' +
    '</div>';
  }).join('');
}

function renderRukAll() {
  renderRukStats();
  renderRukList();
}

function checkRukForm() {
  var mail = document.getElementById('ruk-new-mail').value.trim().toLowerCase();
  var code = document.getElementById('ruk-new-code').value.trim();
  var errorEl = document.getElementById('ruk-form-error');
  var validMail = mail.indexOf('@') > 0 && mail.lastIndexOf('.') > mail.indexOf('@');
  var duplicate = mail !== '' && ACCOUNTANTS.some(function (a) { return a.email === mail; });
  errorEl.hidden = !duplicate;
  document.getElementById('ruk-add-btn').disabled = !(validMail && code !== '' && !duplicate);
}

function addAccountantFromForm() {
  var mailEl = document.getElementById('ruk-new-mail');
  var codeEl = document.getElementById('ruk-new-code');
  var mail = mailEl.value.trim().toLowerCase();
  var code = codeEl.value.trim();
  if (!mail || !code) return;
  addAccountant(mail, code);
  mailEl.value = '';
  codeEl.value = '';
  document.getElementById('ruk-form-error').hidden = true;
  document.getElementById('ruk-add-btn').disabled = true;
  renderRukAll();
}

function deleteAccountant(id) {
  ACCOUNTANTS = ACCOUNTANTS.filter(function (a) { return a.id !== id; });
  renderRukAll();
}

/* ---------- Инициализация ---------- */
setComposeType('expense');
seedChatHistory();
seedOtherEmployees();
seedAccountants();
