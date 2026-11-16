const { esc } = require('./input');

const KINDS = new Set(['info','success','warning','error','loading']);
function notice({ kind = 'info', message, title = '', id = '', floating = false, hidden = false }) {
  const state = KINDS.has(kind) ? kind : 'info';
  const icon = { info:'i', success:'✓', warning:'!', error:'!', loading:'…' }[state];
  return `<div class="ui-notice${floating?' ui-view-status':''}" data-ui-state="${state}" role="${state==='error'?'alert':'status'}"${id?` id="${esc(id)}"`:''}${hidden?' hidden':''}><span class="ui-state-icon" aria-hidden="true">${icon}</span><div>${title?`<strong>${esc(title)}</strong>`:''}<p>${esc(message)}</p></div></div>`;
}

function emptyState(message) {
  return `<div class="empty ui-empty" data-ui-state="empty"><span aria-hidden="true">—</span><p>${esc(message)}</p></div>`;
}

function field({ name, label, value = '', type, required = false, maxLength, autocomplete, id, description = '', error = '' }) {
  const fieldId = id || `field-${name}`;
  const described = [description?`${fieldId}-hint`:'',error?`${fieldId}-error`:''].filter(Boolean).join(' ');
  return `<label${id||description||error?` for="${esc(fieldId)}"`:''}>${esc(label)}<input${type?` type="${esc(type)}"`:''} name="${esc(name)}"${id||description||error?` id="${esc(fieldId)}"`:''}${autocomplete?` autocomplete="${esc(autocomplete)}"`:''}${required?' required':''}${maxLength?` maxlength="${Number(maxLength)}"`:''}${value!==undefined&&type!=='password'?` value="${esc(value)}"`:''}${error?' aria-invalid="true"':''}${described?` aria-describedby="${esc(described)}"`:''} />${description?`<small id="${esc(fieldId)}-hint">${esc(description)}</small>`:''}${error?`<small class="ui-field-error" id="${esc(fieldId)}-error">${esc(error)}</small>`:''}</label>`;
}

function button({ label, type = 'button', variant = 'secondary', attributes = {} }) {
  const attrs = Object.entries(attributes).filter(([key])=>/^(?:hidden|disabled|data-[a-z-]+|aria-[a-z-]+)$/.test(key))
    .filter(([,value])=>value!==false).map(([key,value])=>value===true?key:`${key}="${esc(value)}"`).join(' ');
  return `<button type="${type==='submit'?'submit':'button'}" class="${variant==='primary'?'primary-btn':'secondary-btn'}" ${attrs}>${esc(label)}</button>`;
}

const UI_STYLESHEET = `
:root {
  --space-1: .25rem; --space-2: .5rem; --space-3: .75rem; --space-4: 1rem;
  --control-height: 42px; --touch-target: 44px;
  --font-small: .86rem; --focus-ring: #2563eb;
  --status-success: var(--accent-dark); --status-warning: var(--gold); --status-error: var(--red);
  --button-bg: var(--accent); --button-ink: #fff;
}
[data-theme="dark"] { --focus-ring: #8fb2ec; --button-ink: #101613; }
:is(a,button,input,select,textarea,summary,[tabindex]):focus-visible,
.gb-grid-score-cell input:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 2px; }
:is(button,input,select,textarea):disabled { cursor: not-allowed; opacity: .65; }
.primary-btn, .main button[type="submit"], .login button[type="submit"], .page-action {
  background: var(--button-bg); color: var(--button-ink);
}
.main button.secondary-btn, .login button.secondary-btn { background: var(--paper-strong); color: var(--ink); }
.main button.secondary-btn.danger-action { color: var(--status-error); }
[hidden] { display: none !important; }
.ui-notice { display: flex; align-items: flex-start; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--line-strong); border-radius: var(--radius); background: var(--paper-strong); color: var(--ink); overflow-wrap: anywhere; }
.ui-notice p, .ui-empty p { margin: 0; }
.ui-notice ul { margin: var(--space-2) 0 0; padding-left: 1.2rem; }
.ui-notice strong { display: block; }
.ui-notice[data-ui-state="error"], .ui-field-error { color: var(--status-error); }
.ui-notice[data-ui-state="warning"] { color: var(--status-warning); }
.ui-notice[data-ui-state="success"] { color: var(--status-success); }
.ui-state-icon { flex: 0 0 1.2rem; font-weight: 800; text-align: center; }
.form-grid > .ui-notice, .form-grid > [data-request-error], .form-grid > [data-form-status] { grid-column: 1 / -1; }
.ui-empty { display: flex; align-items: center; gap: var(--space-2); }
[aria-invalid="true"] { border-color: var(--status-error); box-shadow: inset 0 0 0 1px var(--status-error); }
button[aria-busy="true"] { opacity: .7; cursor: progress; }
.ui-view-status { position: fixed; right: var(--space-4); top: calc(var(--topbar-height) + var(--mobile-strip-height) + var(--space-2)); z-index: 40; box-shadow: var(--shadow); }
[data-grid-autosave-status] { min-inline-size: 5rem; font-size: var(--font-small); }
[data-grid-autosave-status][data-ui-state="error"] { color: var(--status-error); }
.gb-cell-status { width: .8rem; height: .8rem; display: inline-flex; align-items: center; justify-content: center; font-size: .65rem; line-height: 1; color: var(--paper); }
.gb-grid-score-cell.saving .gb-cell-status { background: var(--status-warning); }
.gb-grid-score-cell.saved .gb-cell-status { background: var(--status-success); }
.gb-grid-score-cell.save-error .gb-cell-status { background: var(--status-error); }
@media (pointer: coarse), (max-width: 600px) {
  :is(button,select,input:not([type="checkbox"]):not([type="hidden"]),.secondary-btn,.page-action,.nav-link,.setup-link,.check-row,.score-switch) { min-height: var(--touch-target); }
  .gb-grid-score-cell, .gb-grid-score-cell input { min-height: var(--touch-target); height: var(--touch-target); }
  .gb-grid-score-cell input { min-width: var(--touch-target); }
  .score-switch { display: inline-flex; align-items: center; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
@media screen and (max-width: 600px) {
  .app, .grade-graph-print-grid { grid-template-columns: minmax(0, 1fr); }
  .table-wrap > table:not(.gb-grid-table) { min-width: 28rem; }
  .report-card-document { min-width: 0; max-width: 100%; overflow-x: auto; }
  .report-card-spread { min-width: 1060px; }
}
`;

module.exports = { notice, emptyState, field, button, UI_STYLESHEET };
