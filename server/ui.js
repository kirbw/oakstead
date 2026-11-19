const { esc } = require('./input');

const KINDS = new Set(['info','success','warning','error','loading']);
function notice({ kind = 'info', message, title = '' }) {
  const state = KINDS.has(kind) ? kind : 'info';
  const icon = { info:'i', success:'✓', warning:'!', error:'!', loading:'…' }[state];
  return `<div class="ui-notice" data-ui-state="${state}" role="${state==='error'?'alert':'status'}"><span class="ui-state-icon" aria-hidden="true">${icon}</span><div>${title?`<strong>${esc(title)}</strong>`:''}<p>${esc(message)}</p></div></div>`;
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

module.exports = { notice, emptyState, field, button };
