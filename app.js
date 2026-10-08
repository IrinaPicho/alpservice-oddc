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

/* ---------- Связь с сервером ---------- */

function api(path, opts) {
  opts = opts || {};
  opts.credentials = 'include';
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    opts.body = JSON.stringify(opts.body);
  }
  return fetch(path, opts).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) {
        var err = new Error((data && data.error) || 'Ошибка запроса');
        err.data = data;
        throw err;
      }
      return data;
    });
  });
}

var CURRENT_USER = null; // {id,email,role,fullName,projectCode,projectCustomer,advanceAmount}

function attemptLogin() {
  var mail = document.getElementById('mail').value.trim().toLowerCase();
  var pass = document.getElementById('pass').value;
  var errorEl = document.getElementById('login-error');
  var btn = document.querySelector('#screen-login .btn-primary');

  btn.disabled = true;
  api('/api/auth/login', { method: 'POST', body: { email: mail, password: pass, role: activeLoginRole } })
    .then(function (data) {
      errorEl.hidden = true;
      CURRENT_USER = data.user;
      var name = data.user.fullName || mail;
      if (activeLoginRole === 'sotr') return enterWorkspace(name);
      if (activeLoginRole === 'buh') return enterBuhWorkspace(name);
      return enterRukWorkspace(name);
    })
    .catch(function () { errorEl.hidden = false; })
    .then(function () { btn.disabled = false; });
}

function completeRegistration() {
  var fio = document.getElementById('r-fio').value.trim();
  var phone = document.getElementById('r-phone').value.trim();
  var position = document.getElementById('r-role').value.trim();
  var projectCode = document.getElementById('r-proj-code').value.trim();
  var projectCustomer = document.getElementById('r-proj-customer').value.trim();
  var legalEntity = document.getElementById('r-legal-entity').value.trim();
  var tabelNumber = document.getElementById('r-tabel-number').value.trim();
  var mail = document.getElementById('r-mail').value.trim().toLowerCase();
  var pass = document.getElementById('r-pass').value;
  if (!fio || !mail || !pass) { window.alert('Заполните ФИО, почту и пароль.'); return; }

  api('/api/auth/register', {
    method: 'POST',
    body: { email: mail, password: pass, fullName: fio, phone: phone, position: position, projectCode: projectCode, projectCustomer: projectCustomer, legalEntity: legalEntity, tabelNumber: tabelNumber },
  })
    .then(function (data) {
      CURRENT_USER = data.user;
      return enterWorkspace(data.user.full_name || fio);
    })
    .catch(function (e) { window.alert(e.message || 'Не удалось зарегистрироваться'); });
}

function enterWorkspace(name) {
  document.getElementById('dash-employee-name').textContent = name;
  document.getElementById('dash-employee-name-side').textContent = name;
  document.getElementById('auth-wrap').hidden = true;
  document.getElementById('workspace').hidden = false;
  showView('dashboard');
  return loadEmployeeData();
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
  initExportDates();
  loadBuhExportEmployees();
  return loadBuhData();
}

function enterRukWorkspace(name) {
  document.getElementById('ruk-name').textContent = name;
  document.getElementById('ruk-name-side').textContent = name;
  document.getElementById('auth-wrap').hidden = true;
  document.getElementById('workspace-ruk').hidden = false;
  showView('ruk-buh');
  return loadRukData();
}

function doLogout() {
  api('/api/auth/logout', { method: 'POST' }).catch(function () {});
  CURRENT_USER = null;
  document.getElementById('workspace').hidden = true;
  document.getElementById('workspace-buh').hidden = true;
  document.getElementById('workspace-ruk').hidden = true;
  document.getElementById('auth-wrap').hidden = false;
  showScreen('login');
}

/* Восстановление сессии при обновлении страницы (куки уже есть — просто спросим,
   кто вошёл, и откроем нужный кабинет без повторного ввода пароля). */
function tryRestoreSession() {
  return api('/api/auth/me').then(function (data) {
    var u = data.user;
    CURRENT_USER = {
      id: u.id, email: u.email, role: u.role, fullName: u.full_name,
      projectCode: u.project_code, projectCustomer: u.project_customer, advanceAmount: u.advance_amount,
    };
    var name = u.full_name || u.email;
    if (u.role === 'sotr') return enterWorkspace(name);
    if (u.role === 'buh') return enterBuhWorkspace(name);
    return enterRukWorkspace(name);
  }).catch(function () { /* не вошли — остаёмся на экране входа */ });
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

  /* Enter в полях входа/регистрации/отправки отчета — как нажатие на основную
     кнопку, без необходимости кликать по ней мышкой. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var el = e.target;
    if (!el || el.tagName !== 'INPUT') return;
    if (['checkbox', 'radio', 'file', 'date'].indexOf(el.type) !== -1) return;

    if (el.closest('#screen-login')) {
      e.preventDefault();
      attemptLogin();
      return;
    }
    if (el.closest('#screen-register')) {
      e.preventDefault();
      completeRegistration();
      return;
    }
    if (el.closest('.chat-compose')) {
      e.preventDefault();
      var submitBtn = document.getElementById('chat-submit');
      if (submitBtn && !submitBtn.disabled) submitChatCard();
      return;
    }
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

/* Полный список статей — прислан клиентом (файл "Статьи с разделами.xlsx"),
   сгруппирован по разделам ровно так, как в его файле. Раздел определяет и
   подпись в выпадающем списке, и цвет/иконку в карточках отчета. */
var CATEGORY_GROUPS = {
  vozvrat_pokupatelu: { label: 'Возврат покупателю',                color: '--g-other',          soft: '--g-other-soft',          icon: 'i-other' },
  dds:                { label: 'ДДС',                                color: '--g-comms',          soft: '--g-comms-soft',          icon: 'i-other' },
  invest:             { label: 'Инвестиционные расходы',             color: '--g-rent',            soft: '--g-rent-soft',           icon: 'i-building' },
  commercial:         { label: 'Коммерческие расходы',                color: '--g-representation', soft: '--g-representation-soft', icon: 'i-gift' },
  taxes:              { label: 'Налоги',                             color: '--g-staff',           soft: '--g-staff-soft',          icon: 'i-receipt' },
  indirect:           { label: 'Постоянные косвенные расходы',        color: '--g-living',          soft: '--g-living-soft',         icon: 'i-users' },
  direct:             { label: 'Прямые переменные расходы',           color: '--g-transport',       soft: '--g-transport-soft',      icon: 'i-truck' },
  financial:          { label: 'Финансовые расходы',                  color: '--g-supply',          soft: '--g-supply-soft',         icon: 'i-archive' },
  return_dds:         { label: 'Возврат (ДДС)',                       color: '--g-logistics',       soft: '--g-logistics-soft',      icon: 'i-other' },
  invest_income:      { label: 'Доход от инвестиционной деятельности',color: '--g-rent',            soft: '--g-rent-soft',           icon: 'i-building' },
  main_income:        { label: 'Доход от основной деятельности',      color: '--g-income',          soft: '--g-income-soft',         icon: 'i-income' },
  other_income:       { label: 'Прочие доходы',                       color: '--g-other',           soft: '--g-other-soft',          icon: 'i-other' },
  other:              { label: 'Прочее',                              color: '--g-other',           soft: '--g-other-soft',          icon: 'i-other' }
};

var STATYA_SECTIONS = {
  expense: [
    { key: 'vozvrat_pokupatelu', label: 'Возврат покупателю', items: ['Возврат покупателю'] },
    { key: 'dds', label: 'ДДС', items: ['дивиденды', 'кредит, займ', 'обеспечение на ЭТП (ДДС)'] },
    { key: 'invest', label: 'Инвестиционные расходы', items: [
      '% по лизингу', 'лизинг', 'НМА (расходы на нематериальные активы)', 'обучение', 'покупка мебели',
      'покупка недвижимости', 'покупка оборудования (на склад)', 'покупка оргтехники', 'покупка ПО', 'покупка транспора'
    ] },
    { key: 'commercial', label: 'Коммерческие расходы', items: [
      'PR (КР)', 'аренда автотранспорта (КР)', 'БГ вознагрождение', 'выставка (КР)', 'ГСМ (КР)',
      'доставка сотрудников (КР)', 'маркетинг (реклама) (КР)', 'питание сотрудников (КР)',
      'представительские расходы (КР)', 'проживание сотрудника (КР)', 'тендерные расходы (КР)'
    ] },
    { key: 'taxes', label: 'Налоги', items: [
      'АУСН', 'Налог на дивиденды', 'Налог на имущество', 'Налог на прибыль (доход)',
      'НДС (Налог на добавленную стоимость)', 'НДФЛ (Налог на фонд оплаты труда)', 'Соцналоги', 'УСН',
      'Штрафы, пени, неустойки по налогам'
    ] },
    { key: 'indirect', label: 'Постоянные косвенные расходы (общехозяйственные, операционные, административные)', items: [
      'аренда офиса', 'аренда склада', 'аренда спецтехники', 'аренда транспорта', 'ГСМ для нужд офиса',
      'доставка документов', 'канцтовары, типография (косв)', 'консалтинг', 'консультация', 'Подбор персонала',
      'премия АУП', 'Программное обеспечение', 'Расходы на офис', 'ремонт оборудования', 'ремонт транспорта',
      'связь, интернет', 'ФОТ АУП', 'ФОТ исполнителя (подрядчика)'
    ] },
    { key: 'direct', label: 'Прямые переменные расходы (общепроизводственные)', items: [
      'аренда автотранспорта (прямые)', 'аренда оборудования (прямые)', 'аренда помещения (прямые)',
      'аренда спецтехники (прямые)', 'вывоз и утилизация мусора', 'ГСМ (прямые)', 'доставка документов (прямые)',
      'доставка материалов (тмц)', 'доставка оборудования (мтр)', 'доставка сотрудников (прямые)', 'инструменты',
      'канцтовары, типография (прямые)', 'комиссия за переводы (прямые)', 'конвертация (прямые)', 'материалы',
      'налоги подрядчика', 'непредвиденные расходы', 'обучение (ОТ и тд и тп)', 'питание исполнителя',
      'питание итр', 'покупка оборудования', 'представительские расходы', 'премия подрядчика',
      'проживание исполнителя', 'проживание ИТР', 'ремонт автотранспорта', 'ремонт оборудования (прямые)',
      'связь, интернет (прямые)', 'снаряжение', 'спецодежда', 'ФОТ исполнитель (подрядчик)(прямые)',
      'ФОТ ИТР (подрядчик)', 'ФОТ ПТО (подрядчик)', 'ФОТ РП (подрядчик)', 'штрафы (прямые)'
    ] },
    { key: 'financial', label: 'Финансовые расходы', items: [
      '% кредиты, займы', '% по факторингу', 'БГ на обеспечение аванса', 'БГ на обеспечение гарантийных обязательств',
      'БГ на обеспечение исполнение договора', 'БГ на обеспечение тендера', 'взносы', 'комиссия за переводы',
      'конвертация', 'перечисление депозита', 'перечисление под отчет', 'получение БГ', 'пошлины',
      'расходы на оптимизацию (УУ)', 'РКО', 'страхование'
    ] }
  ],
  income: [
    { key: 'return_dds', label: 'Возврат (ДДС)', items: [
      'возврат депозита', 'возврат обеспечения с ЭТП', 'возврат подотчетных средств (ДДС)', 'займ от собственика', 'кредит, займ'
    ] },
    { key: 'invest_income', label: 'Доход от инвестиционной деятельности', items: ['доход от НМА', 'продажа активов'] },
    { key: 'main_income', label: 'Доход от основной деятельности компании', items: ['аванс', 'Возврат от поставщика', 'оплата'] },
    { key: 'other_income', label: 'Прочие доходы', items: ['% от депозита'] }
  ]
};

var STATYA_GROUP = {};
Object.keys(STATYA_SECTIONS).forEach(function (type) {
  STATYA_SECTIONS[type].forEach(function (section) {
    section.items.forEach(function (statya) { STATYA_GROUP[statya] = section.key; });
  });
});

function groupFor(statya, type) {
  var key = STATYA_GROUP[statya];
  if (!key) key = type === 'income' ? 'other_income' : 'other';
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
var ALL_REPORTS = []; // список отчетов (своих — у сотрудника, всех по проекту — у бухгалтера/руководителя)
var activeComposeType = 'expense';
var editingId = null;

var MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
function dateDividerLabel(iso) {
  var parts = iso.split('-');
  return Number(parts[2]) + ' ' + MONTHS_RU[Number(parts[1]) - 1];
}

function addDivider(label) { THREAD.push({ kind: 'divider', label: label }); }
function addBot(status, text) { THREAD.push({ kind: 'bot', status: status, text: text }); }

function findReport(id) {
  for (var i = 0; i < THREAD.length; i++) {
    if (THREAD[i].kind === 'user' && THREAD[i].id === id) return THREAD[i];
  }
  return null;
}

function botTextFor(report) {
  var isExpense = report.type === 'expense';
  if (report.status === 'approved') {
    return isExpense ? 'Отчет согласован бухгалтером.' : 'Приход согласован бухгалтером.';
  }
  if (report.status === 'rejected') {
    return (isExpense ? 'Отчет отклонен бухгалтером.' : 'Приход отклонен бухгалтером.') +
      (report.reviewerComment ? ' Комментарий: ' + report.reviewerComment : '');
  }
  return isExpense ? 'Отчет принят и отправлен на проверку бухгалтеру.' : 'Приход принят и отправлен на проверку бухгалтеру.';
}

/* ---------- Загрузка данных кабинета сотрудника с сервера ---------- */

function buildThreadFromReports(list) {
  THREAD = [];
  var sorted = list.slice().sort(function (a, b) {
    return a.dateIso === b.dateIso ? a.reportNo - b.reportNo : a.dateIso.localeCompare(b.dateIso);
  });
  var lastDate = null;
  sorted.forEach(function (r) {
    if (r.dateIso !== lastDate) { addDivider(dateDividerLabel(r.dateIso)); lastDate = r.dateIso; }
    THREAD.push(Object.assign({ kind: 'user' }, r));
    addBot(r.status, botTextFor(r));
  });
}

function loadEmployeeData() {
  return api('/api/reports/mine').then(function (data) {
    ALL_REPORTS = data.reports;
    buildThreadFromReports(data.reports);
    renderAll();
    renderBalance();
  });
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
      '<div><div class="msg-card-type">' + (report.type === 'expense' ? 'Отчет по расходу' : 'Приход') + ' №' + report.reportNo + '</div></div>' +
    '</div>' +
    '<div class="msg-card-title">' + escapeHtml(report.statya) + '</div>' +
    '<div class="msg-card-sum">' + report.sum.toLocaleString('ru-RU') + ' ₽</div>' +
    (report.contractor ? '<div class="msg-card-comment">Контрагент: ' + escapeHtml(report.contractor) + '</div>' : '') +
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
  var sections = STATYA_SECTIONS[type] || [];
  var sel = document.getElementById('chat-statya');
  sel.innerHTML = '<option>Выберите статью</option>' + sections.map(function (section) {
    return '<optgroup label="' + escapeHtml(section.label) + '">' +
      section.items.map(function (s) { return '<option>' + escapeHtml(s) + '</option>'; }).join('') +
      '</optgroup>';
  }).join('');
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
  document.getElementById('chat-contractor').value = '';
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
  var contractor = document.getElementById('chat-contractor').value.trim();
  var hasFile = selectedFiles.length > 0 || keepExistingAttachment;
  var valid = statya && statya.indexOf('Выберите') !== 0 && sum !== '' && Number(sum) > 0 && date !== '' && contractor !== '' && hasFile;
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
  document.getElementById('chat-contractor').value = report.contractor || '';
  document.getElementById('chat-comment').value = report.comment;
  document.getElementById('chat-file').value = '';
  selectedFiles = [];
  keepExistingAttachment = !!(report.files && report.files.length);
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

function uploadSelectedFiles() {
  if (!selectedFiles.length) return Promise.resolve([]);
  var form = new FormData();
  selectedFiles.forEach(function (f) { form.append('files', f); });
  return api('/api/uploads', { method: 'POST', body: form }).then(function (data) {
    return data.files.map(function (f) { return f.id; });
  });
}

function submitChatCard() {
  var statyaEl = document.getElementById('chat-statya');
  var sumEl = document.getElementById('chat-sum');
  var dateEl = document.getElementById('chat-date');
  var contractorEl = document.getElementById('chat-contractor');
  var commentEl = document.getElementById('chat-comment');
  var submitBtn = document.getElementById('chat-submit');

  var statya = statyaEl.value;
  var sum = Number(sumEl.value);
  var contractor = contractorEl.value.trim();
  var comment = commentEl.value.trim();
  if (!statya || statya.indexOf('Выберите') === 0 || !sum || !dateEl.value || !contractor) { return; }

  var editingReport = editingId ? findReport(editingId) : null;
  var hasFile = selectedFiles.length > 0 || keepExistingAttachment;
  if (!hasFile) { return; }
  var dateIso = dateEl.value;

  submitBtn.disabled = true;

  if (editingReport) {
    api('/api/reports/' + editingReport.id, {
      method: 'PATCH',
      body: { statya: statya, sum: sum, dateIso: dateIso, contractor: contractor, comment: comment },
    })
      .then(function () { return loadEmployeeData(); })
      .then(function () { setComposeType(activeComposeType); })
      .catch(function (e) { window.alert(e.message || 'Не удалось сохранить изменения'); })
      .then(function () { submitBtn.disabled = false; });
    return;
  }

  uploadSelectedFiles()
    .then(function (fileIds) {
      return api('/api/reports', {
        method: 'POST',
        body: { type: activeComposeType, statya: statya, sum: sum, dateIso: dateIso, contractor: contractor, comment: comment, fileIds: fileIds },
      });
    })
    .then(function () { return loadEmployeeData(); })
    .then(function () {
      resetComposeFields();
      checkChatForm();
      scrollChatToBottom();
    })
    .catch(function (e) { window.alert(e.message || 'Не удалось отправить отчет'); })
    .then(function () { submitBtn.disabled = false; });
}

/* ---------- Дашборд: статистика ---------- */

function reports() {
  return THREAD.filter(function (e) { return e.kind === 'user'; });
}

function fmtSum(n) { return Math.round(n).toLocaleString('ru-RU'); }

/* ---------- Остаток (сальдо) на главной странице сотрудника ----------
   Сотрудник сам один раз указывает, сколько ему выдали на руки. Дальше система
   сама вычитает все его расходы (по всем отчетам, независимо от статуса проверки —
   деньги уже потрачены по факту) и показывает остаток. */
function renderBalance() {
  var card = document.getElementById('balance-card');
  if (!card) return;
  var advance = Number((CURRENT_USER && CURRENT_USER.advanceAmount) || 0);
  var spent = reports().filter(function (r) { return r.type === 'expense'; })
    .reduce(function (acc, r) { return acc + r.sum; }, 0);
  var remain = advance - spent;
  document.getElementById('balance-advance').textContent = fmtSum(advance) + ' ₽';
  document.getElementById('balance-spent').textContent = fmtSum(spent) + ' ₽';
  var remainEl = document.getElementById('balance-remain');
  remainEl.textContent = fmtSum(remain) + ' ₽';
  remainEl.classList.toggle('balance-negative', remain < 0);
  var input = document.getElementById('balance-input');
  if (document.activeElement !== input) { input.value = advance || ''; }
}

function updateAdvance() {
  var input = document.getElementById('balance-input');
  var amount = Number(input.value);
  if (!input.value || isNaN(amount) || amount < 0) { window.alert('Укажите сумму — сколько выдали на руки.'); return; }
  api('/api/auth/advance', { method: 'PATCH', body: { amount: amount } })
    .then(function (data) {
      CURRENT_USER.advanceAmount = data.advanceAmount;
      renderBalance();
    })
    .catch(function (e) { window.alert(e.message || 'Не удалось сохранить сумму'); });
}

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
      '<div class="recent-meta">Отчет №' + r.reportNo + '</div>' +
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
  var typeLabel = (r.type === 'expense' ? 'Отчет по расходу' : 'Приход') + ' №' + r.reportNo;
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
    (r.contractor ? '<div class="review-comment" style="margin-top:12px"><span class="review-comment-label">Контрагент:</span> ' + escapeHtml(r.contractor) + '</div>' : '') +
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
var BUH_EMPLOYEES = []; // список сотрудников проекта — для страницы "Выгрузка отчетов"

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
        '<div><div class="msg-card-type">' + typeLabel + ' №' + r.reportNo + '</div></div></div>' +
      '<div class="review-title">' + escapeHtml(r.statya) + '</div>' +
      '<div class="review-sum' + (r.type === 'income' ? ' is-income' : '') + '">' + sign + fmtSum(r.sum) + ' ₽</div>' +
      (r.contractor ? '<div class="review-comment"><span class="review-comment-label">Контрагент:</span> ' + escapeHtml(r.contractor) + '</div>' : '') +
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
      '<div class="recent-meta">' + formatDate(r.dateIso) + ' | На проверке</div>' +
      '<div class="recent-meta">Отчет по расходу №' + r.reportNo + '</div></div>' +
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

function loadBuhData() {
  return api('/api/reports').then(function (data) {
    ALL_REPORTS = data.reports.map(function (r) {
      return Object.assign({}, r, { employee: r.employee ? r.employee.fullName : '—' });
    });
    renderBuhAll();
  });
}

/* ---------- Выгрузка в Excel для управленческого учета (кабинет бухгалтера) ---------- */

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function isoDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

/* По умолчанию — текущий месяц, чтобы не заставлять каждый раз выбирать период заново. */
function initExportDates() {
  var fromEl = document.getElementById('export-from');
  var toEl = document.getElementById('export-to');
  if (!fromEl || fromEl.value) return;
  var now = new Date();
  fromEl.value = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  toEl.value = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

/* Список сотрудников для страницы "Выгрузка отчетов" — один раз при входе
   в кабинет бухгалтера (список почти не меняется, перезагружать не нужно). */
function loadBuhExportEmployees() {
  return api('/api/reports/employees').then(function (data) {
    BUH_EMPLOYEES = data.employees || [];
    renderBuhExportList();
  }).catch(function () { /* страница просто останется пустой, не критично */ });
}

function renderBuhExportList() {
  var wrap = document.getElementById('buh-export-list');
  if (!wrap) return;
  if (!BUH_EMPLOYEES.length) {
    wrap.innerHTML = '<div class="recent-empty">В проекте пока нет ни одного сотрудника.</div>';
    return;
  }
  wrap.innerHTML = BUH_EMPLOYEES.map(function (emp) {
    return '<div class="export-emp-row">' +
      '<span class="export-emp-icon"><svg class="icon"><use href="#i-users"/></svg></span>' +
      '<div class="export-emp-info"><div class="export-emp-name">' + escapeHtml(emp.fullName || '—') + '</div></div>' +
      '<div class="export-emp-actions">' +
        '<button class="btn-uo" type="button" onclick="downloadExport(\'' + emp.id + '\')">УО</button>' +
        '<button class="btn-ao1" type="button" onclick="downloadAo1(\'' + emp.id + '\')">АО-1</button>' +
      '</div></div>';
  }).join('');
}

/* Выгрузка Excel (управленческий учет) по одному сотруднику — общей выгрузки
   по всем сотрудникам сразу нет (решили не делать, это усложнение). */
function downloadExport(employeeId) {
  if (!employeeId) return;
  var from = document.getElementById('export-from').value;
  var to = document.getElementById('export-to').value;
  var params = ['employeeId=' + encodeURIComponent(employeeId)];
  if (from) params.push('from=' + encodeURIComponent(from));
  if (to) params.push('to=' + encodeURIComponent(to));
  window.location.href = '/api/reports/export?' + params.join('&');
}

/* Официальный бланк АО-1 по одному сотруднику за выбранный период —
   тот же общий период сверху страницы, что и для "УО". */
function downloadAo1(employeeId) {
  if (!employeeId) return;
  var from = document.getElementById('export-from').value;
  var to = document.getElementById('export-to').value;
  var params = ['employeeId=' + encodeURIComponent(employeeId)];
  if (from) params.push('from=' + encodeURIComponent(from));
  if (to) params.push('to=' + encodeURIComponent(to));
  window.location.href = '/api/reports/ao1?' + params.join('&');
}

function renderBuhAll() {
  renderBuhStats();
  renderBuhDashboardQueue();
  renderBuhQueue();
  renderBuhAllList();
}

function applyDecision(id, status, comment) {
  delete expandedReviewIds[id]; // после решения сворачиваем карточку обратно к плашке статуса
  return api('/api/reports/' + id + '/decision', { method: 'PATCH', body: { status: status, reviewerComment: comment || '' } })
    .then(function () { return loadBuhData(); })
    .catch(function (e) { window.alert(e.message || 'Не удалось сохранить решение'); });
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

function loadRukData() {
  return api('/api/accountants').then(function (data) {
    ACCOUNTANTS = data.accountants;
    renderRukAll();
  });
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
  var btn = document.getElementById('ruk-add-btn');
  btn.disabled = true;
  api('/api/accountants', { method: 'POST', body: { email: mail, projectCode: code } })
    .then(function (data) {
      mailEl.value = '';
      codeEl.value = '';
      document.getElementById('ruk-form-error').hidden = true;
      window.alert(
        'Бухгалтер добавлен.\n\nВременный пароль: ' + data.tempPassword +
        '\n\nСообщите его бухгалтеру лично (телефон, мессенджер) — после первого входа он должен сменить пароль сам. Этот пароль больше нигде не показывается, сохраните его сейчас, если нужно.'
      );
      return loadRukData();
    })
    .catch(function (e) { window.alert(e.message || 'Не удалось добавить бухгалтера'); })
    .then(function () { btn.disabled = false; });
}

function deleteAccountant(id) {
  api('/api/accountants/' + id, { method: 'DELETE' })
    .then(function () { return loadRukData(); })
    .catch(function (e) { window.alert(e.message || 'Не удалось удалить бухгалтера'); });
}

/* ---------- Инициализация ---------- */
setComposeType('expense');
tryRestoreSession();
