/* Shared offline calendar picker for all calendar-date fields. */
const datePickerMonths = new Map();
const datePickerWeekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function datePicker(id, value = '', onInput = '', locale = 'en-US') {
  const displayValue = value ? new Date(value + 'T00:00:00').toLocaleDateString(locale) : '';
  return `<div class="date-picker" id="date-picker-${id}">
    <input type="hidden" id="${id}" value="${esc(value)}"${onInput ? ` oninput="${onInput}"` : ''}>
    <div class="date-picker-control">
      <input id="${id}-display" type="text" value="${esc(displayValue)}" placeholder="${locale === 'en-GB' ? 'dd/mm/yyyy' : 'MM/DD/YYYY'}" data-locale="${esc(locale)}" autocomplete="off" onclick="openDatePicker('${id}')" oninput="updateDatePickerInput('${id}')">
      <button type="button" class="date-picker-trigger" aria-label="Open date picker" title="Open date picker" onclick="openDatePicker('${id}')">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 2v3m10-3v3M4 9h16M5 4h14a1 1 0 0 1 1 1v15H4V5a1 1 0 0 1 1-1Z"/></svg>
      </button>
    </div>
    <div class="date-picker-calendar" id="${id}-calendar" role="dialog" aria-label="Choose a date" hidden></div>
  </div>`;
}

function updateDatePickerInput(id) {
  const field = document.getElementById(id);
  const display = document.getElementById(id + '-display');
  if (!field || !display) return;
  field.value = parseDatePickerInput(display.value, display.dataset.locale) || '';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function parseDatePickerInput(value, locale = 'en-US') {
  const text = value.trim();
  let year, month, day;
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    if (locale === 'en-GB') [, day, month, year] = match;
    else [, month, day, year] = match;
  } else {
    match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return '';
    [, year, month, day] = match;
  }
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return '';
  return toIso(date);
}

function openDatePicker(id) {
  const calendar = document.getElementById(id + '-calendar');
  if (calendar && !calendar.hidden) {
    calendar.hidden = true;
    return;
  }
  document.querySelectorAll('.date-picker-calendar').forEach(item => { item.hidden = true; });
  const field = document.getElementById(id);
  if (!field || !calendar) return;
  const selected = field.value ? new Date(field.value + 'T00:00:00') : new Date();
  datePickerMonths.set(id, { year: selected.getFullYear(), month: selected.getMonth() });
  calendar.hidden = false;
  renderDatePickerCalendar(id);
}

function changeDatePickerMonth(id, offset) {
  const current = datePickerMonths.get(id);
  if (!current) return;
  const date = new Date(current.year, current.month + offset, 1);
  datePickerMonths.set(id, { year: date.getFullYear(), month: date.getMonth() });
  renderDatePickerCalendar(id);
}

function renderDatePickerCalendar(id) {
  const calendar = document.getElementById(id + '-calendar');
  const current = datePickerMonths.get(id);
  if (!calendar || !current) return;
  const field = document.getElementById(id);
  const selected = field.value;
  const todayValue = toIso(new Date());
  const firstDay = new Date(current.year, current.month, 1).getDay();
  const daysInMonth = new Date(current.year, current.month + 1, 0).getDate();
  const cells = [];
  datePickerWeekdays.forEach(day => cells.push(`<span class="date-picker-weekday">${day}</span>`));
  const previousMonth = new Date(current.year, current.month, 0);
  const daysInPreviousMonth = previousMonth.getDate();
  for (let index = 0; index < 42; index++) {
    let date;
    if (index < firstDay) {
      date = new Date(current.year, current.month - 1, daysInPreviousMonth - firstDay + index + 1);
    } else if (index >= firstDay + daysInMonth) {
      date = new Date(current.year, current.month + 1, index - firstDay - daysInMonth + 1);
    } else {
      date = new Date(current.year, current.month, index - firstDay + 1);
    }
    const iso = toIso(date);
    const classes = ['date-picker-day'];
    if (date.getMonth() !== current.month) classes.push('other-month');
    if (iso === selected) classes.push('selected');
    if (iso === todayValue) classes.push('today');
    cells.push(`<button type="button" class="${classes.join(' ')}" aria-pressed="${iso === selected}" onclick="selectDatePickerDate('${id}','${iso}')">${date.getDate()}</button>`);
  }
  const monthLabel = new Date(current.year, current.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  calendar.innerHTML = `<div class="date-picker-header">
      <button type="button" aria-label="Previous month" onclick="changeDatePickerMonth('${id}',-1)">‹</button>
      <strong aria-live="polite">${monthLabel}</strong>
      <button type="button" aria-label="Next month" onclick="changeDatePickerMonth('${id}',1)">›</button>
    </div><div class="date-picker-grid">${cells.join('')}</div>
    <div class="date-picker-actions">
      <button type="button" onclick="clearDatePicker('${id}')">Clear</button>
      <button type="button" onclick="selectDatePickerToday('${id}')">Today</button>
    </div>`;
  positionDatePickerCalendar(id);
}

function positionDatePickerCalendar(id) {
  const picker = document.getElementById('date-picker-' + id);
  const calendar = document.getElementById(id + '-calendar');
  if (!picker || !calendar || calendar.hidden) return;

  const container = picker.closest('.card');
  const containerRect = container
    ? container.getBoundingClientRect()
    : { left: 0, right: document.documentElement.clientWidth };
  const style = container ? getComputedStyle(container) : null;
  const leftEdge = containerRect.left + (style ? parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) : 12);
  const rightEdge = containerRect.right - (style ? parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight) : 12);

  calendar.style.width = '';
  const availableWidth = Math.max(0, rightEdge - leftEdge);
  const width = Math.min(calendar.getBoundingClientRect().width, availableWidth);
  calendar.style.width = `${width}px`;

  const pickerLeft = picker.getBoundingClientRect().left;
  const left = Math.min(Math.max(pickerLeft, leftEdge), rightEdge - width);
  calendar.style.left = `${left - pickerLeft}px`;
}

function clearDatePicker(id) {
  const field = document.getElementById(id);
  const display = document.getElementById(id + '-display');
  if (!field || !display) return;
  field.value = '';
  display.value = '';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  renderDatePickerCalendar(id);
}

function selectDatePickerToday(id) {
  selectDatePickerDate(id, toIso(new Date()));
}

function selectDatePickerDate(id, value) {
  const field = document.getElementById(id);
  const display = document.getElementById(id + '-display');
  const calendar = document.getElementById(id + '-calendar');
  if (!field || !display || !calendar) return;
  field.value = value;
  display.value = new Date(value + 'T00:00:00').toLocaleDateString(display.dataset.locale || 'en-US');
  calendar.hidden = true;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

document.addEventListener('click', event => {
  const insidePicker = event.composedPath().some(node =>
    node.classList && node.classList.contains('date-picker'));
  if (insidePicker) return;
  document.querySelectorAll('.date-picker-calendar').forEach(calendar => { calendar.hidden = true; });
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const openCalendar = document.querySelector('.date-picker-calendar:not([hidden])');
  if (!openCalendar) return;
  openCalendar.hidden = true;
  const id = openCalendar.id.slice(0, -'-calendar'.length);
  const display = document.getElementById(id + '-display');
  if (display) display.focus();
});
