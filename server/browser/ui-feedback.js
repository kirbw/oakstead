// Shared browser notices use text nodes so server messages never become markup.
function createUiFeedback(document) {
  let sequence = 0;
  function clear(form) {
    form.querySelector('[data-request-error]')?.remove();
    form.querySelectorAll('[aria-invalid="true"]').forEach(input => {
      input.removeAttribute('aria-invalid');
      const ids = (input.getAttribute('aria-describedby') || '').split(' ').filter(id=>id && !id.startsWith('request-error-'));
      if (ids.length) input.setAttribute('aria-describedby',ids.join(' '));
      else input.removeAttribute('aria-describedby');
    });
  }
  function show(host, error, form, retry) {
    if (error.status===401) document.querySelectorAll('[data-auth-error]').forEach(panel=>panel.remove());
    host.querySelector('[data-request-error]')?.remove();
    const panel = document.createElement('div');
    panel.dataset.requestError = '';
    panel.dataset.uiState = 'error';
    if (error.status===401) panel.dataset.authError = '';
    panel.className = 'ui-notice';
    panel.setAttribute('role','alert');panel.tabIndex=-1;panel.id='request-error-'+(++sequence);
    const icon=document.createElement('span');icon.className='ui-state-icon';icon.setAttribute('aria-hidden','true');icon.textContent='!';panel.appendChild(icon);
    const content=document.createElement('div');
    const message=document.createElement('p');message.textContent=(error.message||'The request failed. Please try again.')+(error.requestId?' Request ID: '+error.requestId:'');content.appendChild(message);
    const errors=document.createElement('ul');
    Object.entries(error.fields||{}).forEach(([name,text])=>{
      const input=form?.elements?.namedItem(name);
      if (!input?.setAttribute) return;
      input.setAttribute('aria-invalid','true');
      input.setAttribute('aria-describedby',[(input.getAttribute('aria-describedby')||''),panel.id].filter(Boolean).join(' '));
      const item=document.createElement('li');item.textContent=(input.labels?.[0]?.textContent.trim()||name)+': '+text;errors.appendChild(item);
    });
    if (errors.childNodes.length) content.appendChild(errors);
    if (error.status===401) {
      const link=document.createElement('a');link.href='/login';link.target='_blank';link.rel='noopener';link.textContent='Sign in in a new tab, then retry here.';content.appendChild(link);
    } else if (retry) {
      const button=document.createElement('button');button.type='button';button.className='secondary-btn';button.textContent='Try again';button.addEventListener('click',retry);content.appendChild(button);
    }
    panel.appendChild(content);host.prepend(panel);panel.focus();
  }
  return { clear, show };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { createUiFeedback };
