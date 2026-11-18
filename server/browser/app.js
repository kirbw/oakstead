function generateReportCardPdf(btn) {
  var orig = btn.textContent;
  btn.textContent = 'Preparing…';
  btn.disabled = true;
  function restore() {
    btn.textContent = orig; btn.disabled = false;
    document.body.classList.remove('report-card-printing');
  }
  document.body.classList.add('report-card-printing');
  setTimeout(function() {
    window.print();
    setTimeout(restore, 700);
  }, 50);
}
(function(){
  const root = document.documentElement;
  const feedback = createUiFeedback(document);
  const saved = localStorage.getItem('oakstead-theme');
  const appRequest = createBrowserRequest({ fetch: window.fetch.bind(window), onAuthLoss: function(error) { showRequestNotice(error); } });
  const scoreQueue = createScoreSaveQueue({ send: sendGridScore, onChange: renderGridSave });
  const submittingForms = new WeakSet();
  const resumedForms = new WeakSet();
  let activeScoreInput = null;
  let navAbort = null;
  let navigating = false;
  let displayedUrl = window.location.href;
  if (saved === 'dark') root.setAttribute('data-theme', 'dark');

  function mainEl() {
    return document.querySelector('[data-app-main]') || document.querySelector('.main');
  }

  function setMobileNav(open) {
    const navToggle = document.getElementById('navToggle');
    document.body.classList.toggle('nav-open', open);
    if (navToggle) navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function canUseAppNav(url) {
    return url.origin === window.location.origin
      && !url.pathname.startsWith('/assets/')
      && url.pathname !== '/backup/download'
      && url.pathname !== '/system-update/status';
  }

  function isSamePageHash(url) {
    return url.hash && url.pathname === window.location.pathname && url.search === window.location.search;
  }

  function updateShellFrom(doc) {
    const currentNav = document.querySelector('.nav-links');
    const nextNav = doc.querySelector('.nav-links');
    if (currentNav && nextNav) currentNav.innerHTML = nextNav.innerHTML;
    const currentMobileLabel = document.querySelector('#navToggle .nav-toggle-main span');
    const nextMobileLabel = doc.querySelector('#navToggle .nav-toggle-main span');
    if (currentMobileLabel && nextMobileLabel) currentMobileLabel.textContent = nextMobileLabel.textContent;
  }

  async function navigateApp(to, options) {
    if (navigating) return false;
    navigating = true;
    const inputs = Array.from(document.querySelectorAll('[data-grid-score-input]:not(:disabled)'));
    inputs.forEach(function(input) { input.disabled = true; });
    try {
      if (!(await scoreQueue.flush())) return false;
      scoreQueue.forgetClean();
      return await performNavigation(to, options);
    } finally {
      inputs.forEach(function(input) { input.disabled = false; });
      navigating = false;
    }
  }

  function performNavigation(to, options) {
    options = options || {};
    const nextUrl = new URL(to, window.location.href);
    if (!canUseAppNav(nextUrl)) {
      window.location.href = nextUrl.toString();
      return Promise.resolve(false);
    }
    const currentMain = mainEl();
    if (!currentMain) {
      window.location.href = nextUrl.toString();
      return Promise.resolve(false);
    }
    if (navAbort) navAbort.abort();
    navAbort = new AbortController();
    setViewBusy(currentMain, true);
    return appRequest(nextUrl.toString(), {
      responseType: 'text',
      signal: navAbort.signal,
      headers: { Accept: 'text/html', 'X-Requested-With': 'Oakstead-App-Shell' }
    }).then(function(response) {
      if (!response.ok) throw new Error('Navigation failed');
      return response.text().then(function(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const nextMain = doc.querySelector('[data-app-main]') || doc.querySelector('.main');
        if (!nextMain) {
          window.location.href = response.url || nextUrl.toString();
          return false;
        }
        document.title = doc.title || document.title;
        updateShellFrom(doc);
        const liveMain = mainEl();
        liveMain.replaceWith(document.importNode(nextMain, true));
        if (options.push !== false) history.pushState({ oaksteadApp: true }, '', nextUrl.toString());
        displayedUrl = window.location.href;
        if (options.scroll !== false) window.scrollTo(0, 0);
        setMobileNav(false);
        initDynamicContent(mainEl());
        return true;
      });
    }).catch(function(error) {
      if (error.name === 'AbortError') return false;
      showRequestNotice(error, undefined, function() { void navigateApp(nextUrl, options); });
      return false;
    }).finally(function() {
      const liveMain = mainEl();
      if (liveMain) setViewBusy(liveMain, false);
    });
  }

  function formToUrl(form) {
    const url = new URL(form.getAttribute('action') || window.location.href, window.location.href);
    url.search = '';
    new FormData(form).forEach(function(value, key) {
      if (key) url.searchParams.append(key, value);
    });
    return url;
  }

  function submitFormSmoothly(form, options) {
    if (!form) return;
    const method = (form.getAttribute('method') || 'get').toLowerCase();
    if (method !== 'get' || form.classList.contains('year-form') || form.dataset.noAppNav !== undefined) {
      if (awaitGridForm(form)) form.requestSubmit();
      return;
    }
    navigateApp(formToUrl(form), options);
  }

  function goToUrl(url, options) {
    const nextUrl = new URL(url, window.location.href);
    navigateApp(nextUrl, options);
  }

  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function(){
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next === 'dark' ? 'dark' : '');
      localStorage.setItem('oakstead-theme', next);
    });
  }

  const navToggle = document.getElementById('navToggle');
  const primaryNav = document.getElementById('primaryNav');
  if (navToggle && primaryNav) {
    navToggle.addEventListener('click', function(event) {
      event.stopPropagation();
      setMobileNav(!document.body.classList.contains('nav-open'));
    });
    primaryNav.addEventListener('click', function(event) {
      if (event.target.closest('a')) setMobileNav(false);
    });
    document.addEventListener('click', function(event) {
      if (!document.body.classList.contains('nav-open')) return;
      if (primaryNav.contains(event.target) || navToggle.contains(event.target)) return;
      setMobileNav(false);
    });
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') setMobileNav(false);
    });
  }

  document.querySelectorAll('.year-form select').forEach(function(select) {
    select.addEventListener('change', function() {
      submitFormSmoothly(select.form);
    });
  });

  document.addEventListener('click', function(event) {
    if (event.target.closest('[data-grid-retry]')) { void scoreQueue.retry(); return; }
    if (event.target.closest('[data-grid-discard]')) {
      if (window.confirm('Discard unsaved grade edits? Completed saves will remain.')) void scoreQueue.discard();
      return;
    }
    const printButton = event.target.closest('[data-print-page]');
    if (printButton) {
      window.print();
      return;
    }
    const pdfButton = event.target.closest('[data-generate-pdf]');
    if (pdfButton) {
      generateReportCardPdf(pdfButton);
      return;
    }
    const closeButton = event.target.closest('[data-dialog-close]');
    if (closeButton) {
      closeButton.closest('dialog')?.close();
      return;
    }
    const dialogButton = event.target.closest('[data-dialog-target]');
    if (dialogButton) {
      const dialog = document.getElementById(dialogButton.dataset.dialogTarget);
      if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
      return;
    }
    if (event.target.matches('.assignment-dialog')) {
      event.target.close();
      return;
    }
    const scoreChip = event.target.closest('[data-score-chip]');
    if (scoreChip) {
      const target = activeScoreInput || document.querySelector('[data-score-input]');
      if (!target) return;
      target.value = scoreChip.dataset.scoreChip;
      updateScorePreview(target);
      if (target.matches('[data-grid-score-input]')) autosaveGridInput(target);
      const next = target.closest('.score-row')?.nextElementSibling?.querySelector('[data-score-input]');
      if (next) {
        next.focus();
        next.select();
      }
      return;
    }
    const anchor = event.target.closest('a[href]');
    if (!anchor || event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (anchor.target || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin === window.location.origin && anchor.dataset.noAppNav !== undefined && scoreQueue.isDirty()) {
      event.preventDefault();
      scoreQueue.flush().then(function(saved) { if (saved) window.location.href = url.toString(); });
      return;
    }
    if (anchor.dataset.noAppNav !== undefined) return;
    if (!canUseAppNav(url) || isSamePageHash(url)) return;
    event.preventDefault();
    navigateApp(url);
  });

  function showRequestNotice(error, form, retry) {
    feedback.show(form || mainEl() || document.body, error, form, retry);
  }

  function setViewBusy(element, busy) {
    element.classList.toggle('app-loading', busy);
    element.setAttribute('aria-busy', String(busy));
    const status = document.getElementById('view-loading-status');
    if (status) status.hidden = !busy;
  }

  async function submitPostForm(form, submitter) {
    if (submittingForms.has(form)) return;
    submittingForms.add(form);
    const body = new FormData(form);
    if (submitter?.name) body.append(submitter.name, submitter.value);
    if (submitter) { submitter.disabled = true; submitter.setAttribute('aria-busy', 'true'); }
    form.setAttribute('aria-busy', 'true');
    feedback.clear(form);
    let status = form.querySelector('[data-form-status]');
    if (!status && !form.classList.contains('year-form')) {
      status = document.createElement('p'); status.dataset.formStatus = ''; status.dataset.uiState = 'loading';
      status.className = 'ui-notice'; status.setAttribute('role', 'status'); status.textContent = 'Saving changes…'; form.prepend(status);
    }
    if (status) status.hidden = false;
    try {
      const response = await appRequest(form.action || window.location.href, { method: 'POST', body: body,
        responseType: 'text', allowLoginRedirect: new URL(form.action, window.location.href).pathname === '/logout', headers: { Accept: 'application/json' } });
      if (response.redirected && new URL(response.url).pathname === '/login') window.location.href = response.url;
      else await navigateApp(response.url || window.location.href);
    } catch (error) { showRequestNotice(error, form); }
    finally {
      submittingForms.delete(form);
      form.removeAttribute('aria-busy');
      if (status) status.hidden = true;
      if (submitter) { submitter.disabled = false; submitter.removeAttribute('aria-busy'); }
    }
  }

  function awaitGridForm(form) {
    if (!scoreQueue.isDirty()) return true;
    scoreQueue.flush().then(function(saved) { if (saved) form.requestSubmit(); });
    return false;
  }

  document.addEventListener('submit', function(event) {
    if (!scoreQueue.isDirty() || resumedForms.has(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const form = event.target;
    const submitter = event.submitter;
    scoreQueue.flush().then(function(saved) {
      if (!saved || !form.isConnected) return;
      resumedForms.add(form);
      try { form.requestSubmit(submitter || undefined); }
      finally { resumedForms.delete(form); }
    });
  }, true);

  window.addEventListener('beforeunload', function(event) {
    if (!scoreQueue.isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('submit', function(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || event.defaultPrevented) return;
    const method = (form.getAttribute('method') || 'get').toLowerCase();
    if (method === 'post' && form.dataset.noAppNav === undefined) {
      event.preventDefault();
      void submitPostForm(form, event.submitter);
      return;
    }
    if (method !== 'get' || form.classList.contains('year-form') || form.dataset.noAppNav !== undefined) return;
    event.preventDefault();
    navigateApp(formToUrl(form));
  });

  document.addEventListener('change', function(event) {
    const assignmentSelect = event.target.closest('[data-assignment-select]');
    if (assignmentSelect) {
      if (assignmentSelect.dataset.baseUrl) {
        const nextUrl = new URL(assignmentSelect.dataset.baseUrl, window.location.origin);
        if (assignmentSelect.value === '__new__') {
          nextUrl.searchParams.delete('assignmentId');
          nextUrl.searchParams.set('action', 'add');
        } else if (assignmentSelect.value) {
          nextUrl.searchParams.delete('action');
          nextUrl.searchParams.set('assignmentId', assignmentSelect.value);
        }
        goToUrl(nextUrl);
        return;
      }
      if (assignmentSelect.value) {
        submitFormSmoothly(assignmentSelect.form);
      } else {
        const url = new URL(window.location.href);
        url.searchParams.delete('assignmentId');
        goToUrl(url);
      }
      return;
    }
    const scoreModeToggle = event.target.closest('[data-score-mode-toggle]');
    if (scoreModeToggle) {
      goToUrl(scoreModeToggle.checked ? scoreModeToggle.dataset.wrongUrl : scoreModeToggle.dataset.percentUrl);
      return;
    }
    const gridToggle = event.target.closest('[data-grid-toggle]');
    if (gridToggle) {
      goToUrl(gridToggle.checked ? gridToggle.dataset.onUrl : gridToggle.dataset.offUrl);
      return;
    }
    const lettersToggle = event.target.closest('[data-grid-letters-toggle]');
    if (lettersToggle) {
      syncGridLettersToggle(lettersToggle, true);
      return;
    }
    if (event.target.matches('select[name="groupId"]')) {
      syncRoleOptions(event.target.closest('form'));
      return;
    }
    const gridInput = event.target.closest('[data-grid-score-input]');
    if (gridInput) {
      autosaveGridInput(gridInput);
      return;
    }
    const auto = event.target.closest('[data-auto-submit]');
    if (auto && auto.form) submitFormSmoothly(auto.form, { scroll: false });
  });

  document.addEventListener('focusin', function(event) {
    if (event.target.matches('[data-score-input]')) {
      activeScoreInput = event.target;
      window.setTimeout(function() { event.target.select?.(); }, 0);
    }
  });

  document.addEventListener('input', function(event) {
    if (event.target.matches('[data-score-input]')) {
      updateScorePreview(event.target);
      if (!event.target.matches('[data-grid-score-input]')) return;
    }
    if (event.target.matches('[data-grid-score-input]')) {
      const input = event.target;
      autosaveGridInput(input);
      return;
    }
    if (event.target.matches('input[name="maxScore"]')) {
      event.target.form?.querySelectorAll('[data-score-input]').forEach(updateScorePreview);
    }
  });

  document.addEventListener('keydown', function(event) {
    const input = event.target.closest('[data-grid-score-input]');
    if (!input || event.key !== 'Tab') return;
    const inputs = Array.from(document.querySelectorAll('[data-grid-score-input][data-assignment-id="' + input.dataset.assignmentId + '"]'));
    const index = inputs.indexOf(input);
    const next = inputs[index + (event.shiftKey ? -1 : 1)];
    if (!next) return;
    event.preventDefault();
    autosaveGridInput(input);
    next.focus();
    next.select?.();
  });

  window.addEventListener('popstate', function() {
    navigateApp(window.location.href, { push: false, scroll: false }).then(function(moved) {
      if (!moved) history.pushState({ oaksteadApp: true }, '', displayedUrl);
    });
  });

  history.replaceState({ oaksteadApp: true }, '', window.location.href);

  function formatScorePreviewNumber(value) {
    if (!Number.isFinite(value)) return '';
    return value.toFixed(1).replace(/\.0$/, '');
  }

  function updateScorePreview(input) {
    const preview = input.closest('.score-entry-cell')?.querySelector('[data-score-preview]');
    if (!preview) return;
    const formPoints = Number(input.form?.querySelector('input[name="maxScore"]')?.value);
    const points = Number.isFinite(formPoints) && formPoints > 0 ? formPoints : Number(input.dataset.scorePoints || 100);
    const raw = Number(input.value);
    const mode = input.dataset.scoreMode || input.form?.querySelector('input[name="scoreMode"]')?.value || 'wrong';
    input.max = mode === 'percent' ? '100' : String(points);
    if (!Number.isFinite(raw)) {
      preview.textContent = mode === 'percent' ? formatScorePreviewNumber(points) + ' pts possible' : 'out of ' + formatScorePreviewNumber(points);
      return;
    }
    if (mode === 'percent') {
      const earned = Math.max(0, Math.min(points, (Math.max(0, Math.min(100, raw)) / 100) * points));
      preview.textContent = formatScorePreviewNumber(earned) + ' / ' + formatScorePreviewNumber(points) + ' pts';
      return;
    }
    const wrong = Math.max(0, Math.min(points, raw));
    const percent = points > 0 ? ((points - wrong) / points) * 100 : 0;
    preview.textContent = formatScorePreviewNumber(percent) + '%';
  }

  function syncGridLettersToggle(toggle, save) {
    const shell = toggle.closest('.gb-grid-shell');
    if (!save && localStorage.getItem('oakstead-gradebook-letters') === 'off') toggle.checked = false;
    shell?.classList.toggle('letters-hidden', !toggle.checked);
    if (save) localStorage.setItem('oakstead-gradebook-letters', toggle.checked ? 'on' : 'off');
  }

  function markGridCell(input, state, failure) {
    const cell = input.closest('.gb-grid-score-cell');
    if (!cell) return;
    cell.classList.remove('saving', 'saved', 'save-error');
    if (state) cell.classList.add(state);
    const badge = cell.querySelector('[data-grid-save-status]');
    if (badge) { badge.textContent = state === 'save-error' ? '!' : state === 'saving' ? '…' : state === 'saved' ? '✓' : ''; badge.setAttribute('aria-hidden', 'true'); }
    if (state === 'save-error' && failure?.status === 400) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function gridHidden(container, name) {
    return container.querySelector('input[name="' + name + '"]')?.value || '';
  }

  function updateGridAverages(result, container) {
    if (!result || !result.display) return;
    const root = container || document;
    const assignmentId = String(result.assignmentId || '');
    const studentId = String(result.studentId || '');
    const assignmentAverage = assignmentId ? root.querySelector('[data-grid-assignment-average="' + assignmentId + '"]') : null;
    const studentAverage = studentId ? root.querySelector('[data-grid-student-average="' + studentId + '"]') : null;
    const classAverage = root.querySelector('[data-grid-class-average]');
    if (assignmentAverage && result.display.assignmentAverage !== undefined) assignmentAverage.innerHTML = result.display.assignmentAverage;
    if (studentAverage && result.display.studentAverage !== undefined) studentAverage.innerHTML = result.display.studentAverage;
    if (classAverage && result.display.classAverage !== undefined) classAverage.innerHTML = result.display.classAverage;
  }

  function autosaveGridInput(input) {
    const container = input.closest('[data-grid-autosave]');
    if (!container) return;
    const context = { actionUrl: container.dataset.action || '/gradebook' };
    ['csrfToken', 'schoolYearId', 'markingPeriodId', 'gradeLevel', 'subjectId', 'scoreMode'].forEach(function(name) {
      context[name] = gridHidden(container, name);
    });
    context.assignmentId = input.dataset.assignmentId;
    context.studentId = input.dataset.studentId;
    const key = [context.schoolYearId, context.assignmentId, context.studentId].join(':');
    scoreQueue.edit(key, input.value, context, input.dataset.originalValue);
  }

  async function sendGridScore(context, value, signal) {
    const formData = new FormData();
    Object.keys(context).forEach(function(name) { if (name !== 'actionUrl') formData.set(name, context[name]); });
    formData.set('action', 'grid-score');
    formData.set('scoreValue', value);
    const response = await appRequest(context.actionUrl, { method: 'POST', body: formData, signal: signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Save failed');
    const result = await response.json();
    if (!result || result.ok !== true) throw new Error('Save failed');
    return result;
  }

  function renderGridSave(entry, result, state) {
    const container = document.querySelector('[data-grid-autosave]');
    if (!container) return;
    const context = entry.context;
    const input = container.querySelector('[data-grid-score-input][data-assignment-id="' + context.assignmentId + '"][data-student-id="' + context.studentId + '"]');
    if (input) {
      input.dataset.originalValue = entry.saved;
      if (!entry.sending && !entry.error && entry.value === entry.saved) input.value = entry.value;
      markGridCell(input, entry.error ? 'save-error' : entry.sending || entry.value !== entry.saved ? 'saving' : 'saved', entry.failure);
      if (result && entry.value === entry.saved) {
        const letter = input.closest('.gb-grid-score-cell')?.querySelector('.gb-cell-letter');
        if (letter && result.letter !== undefined) letter.textContent = result.letter || '';
      }
    }
    if (result) updateGridAverages(result, container);
    const status = container.querySelector('[data-grid-autosave-status]');
    if (status) status.dataset.uiState = state.halted ? 'error' : state.dirty ? 'loading' : 'success';
    if (status) status.textContent = state.halted ? 'Could not save. Retry or discard unsaved edits before leaving.' + (entry.failure?.requestId ? ' Request ID: ' + entry.failure.requestId : '') : state.dirty ? 'Saving...' : 'Saved';
    container.querySelectorAll('[data-grid-retry], [data-grid-discard]').forEach(function(button) { button.hidden = !state.halted; });
  }

  function syncRoleOptions(form) {
    if (!form) return;
    const groupSelect = form.querySelector('select[name="groupId"]');
    const roleSelect = form.querySelector('select[name="roleTypeId"]');
    if (!groupSelect || !roleSelect) return;
    const groupId = groupSelect.value;
    Array.from(roleSelect.options).forEach(function(option) {
      if (!option.value) return;
      const matches = !groupId || option.dataset.roleGroup === groupId;
      option.disabled = !matches;
      option.hidden = !matches;
    });
    if (roleSelect.selectedOptions[0] && roleSelect.selectedOptions[0].disabled) roleSelect.value = '';
  }

  function initUpdateTools(scope) {
    const panel = scope.querySelector('[data-update-status]');
    if (!panel) return;
    const updateForm = scope.querySelector('[data-update-form]');
    const updateCheckForm = scope.querySelector('[data-update-check-form]');
    const updateDownloadRow = scope.querySelector('[data-update-download-row]');
    const updateDownloadLink = scope.querySelector('[data-update-download]');
    const updateReleaseLink = scope.querySelector('[data-update-release]');
    function renderUpdateStatus(status) {
      if (!panel.isConnected || !status) return;
      const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
      const message = panel.querySelector('[data-update-message]');
      const percentLabel = panel.querySelector('[data-update-percent]');
      const progress = panel.querySelector('[data-update-progress]');
      const phase = panel.querySelector('[data-update-phase]');
      const log = panel.querySelector('[data-update-log]');
      if (message) message.textContent = status.message || '';
      if (percentLabel) percentLabel.textContent = percent + '%';
      if (progress) progress.style.setProperty('--progress-value', percent + '%');
      if (phase) phase.textContent = (status.phase || 'idle') + (status.targetVersion ? ' / target v' + status.targetVersion : '');
      if (log) log.textContent = status.log && status.log.length ? status.log.join('\n') : 'No update activity yet.';
      if (updateDownloadRow && updateDownloadLink) {
        const downloadUrl = status.downloadUrl || status.installerDownloadUrl || '';
        updateDownloadRow.style.display = downloadUrl || status.releaseUrl ? 'flex' : 'none';
        updateDownloadLink.style.display = downloadUrl ? 'inline-flex' : 'none';
        if (downloadUrl) updateDownloadLink.href = downloadUrl;
        if (status.installerAssetName) updateDownloadLink.textContent = 'Download ' + status.installerAssetName;
      }
      if (updateReleaseLink) {
        updateReleaseLink.style.display = status.releaseUrl ? 'inline-flex' : 'none';
        if (status.releaseUrl) updateReleaseLink.href = status.releaseUrl;
      }
      [updateForm, updateCheckForm].forEach(function(form) {
        const button = form?.querySelector('button[type="submit"]');
        if (button) button.disabled = Boolean(status.running);
      });
      const channelInput = updateForm?.querySelector('input[name="channel"]');
      if (channelInput && status.channel) channelInput.value = status.channel;
    }
    function pollUpdateStatus() {
      if (!panel.isConnected) return;
      appRequest('/system-update/status', { headers: { Accept: 'application/json' } })
        .then(function(response) { return response.ok ? response.json() : null; })
        .then(function(status) {
          renderUpdateStatus(status);
          if (status && status.running) setTimeout(pollUpdateStatus, 1400);
        })
        .catch(function(error) { showRequestNotice(error, updateCheckForm || updateForm); });
    }
    if (updateForm && !updateForm.dataset.bound) {
      updateForm.dataset.bound = '1';
      updateForm.addEventListener('submit', function(event) {
        event.preventDefault();
        const button = updateForm.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        appRequest('/system-update', { method: 'POST', body: new FormData(updateForm), headers: { Accept: 'application/json' } })
          .then(function(response) { return response.json(); })
          .then(function(status) {
            renderUpdateStatus(status);
            if (status && (status.downloadUrl || status.installerDownloadUrl)) {
              window.location.href = status.downloadUrl || status.installerDownloadUrl;
            }
            setTimeout(pollUpdateStatus, 800);
          })
          .catch(function(error) { showRequestNotice(error, updateForm); if (button) button.disabled = false; });
      });
      pollUpdateStatus();
    }
    if (updateCheckForm && !updateCheckForm.dataset.bound) {
      updateCheckForm.dataset.bound = '1';
      updateCheckForm.addEventListener('submit', function(event) {
        event.preventDefault();
        const button = updateCheckForm.querySelector('button[type="submit"]');
        if (button) button.disabled = true;
        appRequest('/system-update/check', { method: 'POST', body: new FormData(updateCheckForm), headers: { Accept: 'application/json' } })
          .then(function(response) { return response.json(); })
          .then(function(status) { renderUpdateStatus(status); })
          .catch(function() {})
          .finally(function() { if (button) button.disabled = false; });
      });
    }
  }

  function initDynamicContent(scope) {
    scope = scope || document;
    scope.querySelectorAll('[data-score-input]').forEach(updateScorePreview);
    scope.querySelectorAll('[data-grid-letters-toggle]').forEach(function(toggle) {
      syncGridLettersToggle(toggle, false);
    });
    scope.querySelectorAll('form[action="/person-roles"]').forEach(syncRoleOptions);
    initUpdateTools(scope);
  }

  initDynamicContent(document);
})();
