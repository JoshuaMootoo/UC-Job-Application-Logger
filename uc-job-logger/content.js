// ─── UC Job Logger — Content Script ───────────────────────────────────────
// Injected into every Universal Credit journal page at document_idle.
// Other scripts loaded before this one (all share the same content-script
// global scope): config.js → selectors.js → sheets.js → content.js
//
// Responsibilities:
//   • Build a shadow-DOM-isolated floating panel in the bottom-right corner
//   • Fetch job applications from Google Sheets via sheets.js
//   • Render an application card for each row with per-field copy buttons
//   • Auto-fill the UC journal form fields when the user clicks "Auto-fill"
//   • Persist the panel's collapsed/expanded state in chrome.storage.local
//   • Show a brief toast notification for copy and auto-fill actions

(async () => {
  // Prevent re-injection on soft navigations (e.g. single-page transitions)
  if (document.getElementById('uc-job-logger-host')) return;

  // ── 1. Shadow DOM host ──────────────────────────────────────────────────
  // A fixed-position host element anchors the panel to the bottom-right
  // corner. Attaching a shadow root prevents the panel's styles from
  // interfering with the UC page and vice-versa.
  const host = document.createElement('div');
  host.id = 'uc-job-logger-host';
  Object.assign(host.style, {
    position:   'fixed',
    bottom:     '20px',
    right:      '20px',
    zIndex:     '2147483647',
    lineHeight: 'initial',
    fontFamily: 'initial',
  });
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // Load panel.css into the shadow root so styles are scoped to the panel
  const styleLink = document.createElement('link');
  styleLink.rel  = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('panel.css');
  shadow.appendChild(styleLink);

  // Fetch the panel.html template and inject its root element into the shadow
  const panelHtml = await fetch(chrome.runtime.getURL('panel.html')).then(r => r.text());
  const tpl = document.createElement('div');
  tpl.innerHTML = panelHtml.trim();
  shadow.appendChild(tpl.firstElementChild);

  // ── 2. Cache frequently-used element references ─────────────────────────
  const panel          = shadow.getElementById('uc-logger-panel');
  const panelBody      = shadow.getElementById('panel-body');
  const toggleBtn      = shadow.getElementById('panel-toggle');
  const refreshBtn     = shadow.getElementById('refresh-btn');
  const cardsContainer = shadow.getElementById('cards-container');

  // ── 3. Collapsed/expanded state ─────────────────────────────────────────
  const stored = await chrome.storage.local.get('panelCollapsed');
  applyCollapsed(!!stored.panelCollapsed);

  function applyCollapsed(shouldCollapse) {
    panelBody.classList.toggle('hidden', shouldCollapse);
    // − (U+2212) when open, + when closed
    toggleBtn.textContent = shouldCollapse ? '+' : '−';
  }

  toggleBtn.addEventListener('click', () => {
    const nowCollapsed = !panelBody.classList.contains('hidden');
    applyCollapsed(nowCollapsed);
    chrome.storage.local.set({ panelCollapsed: nowCollapsed });
  });

  // ── 4. Refresh ──────────────────────────────────────────────────────────
  refreshBtn.addEventListener('click', loadApplications);

  // ── 5. Fetch & render ───────────────────────────────────────────────────
  async function loadApplications() {
    cardsContainer.innerHTML = '<p class="status-msg">Loading…</p>';
    try {
      const apps = await fetchRecentApplications();
      renderCards(apps);
    } catch (err) {
      cardsContainer.innerHTML =
        `<p class="status-msg error">${escHtml(err.message)}</p>`;
    }
  }

  function renderCards(apps) {
    cardsContainer.innerHTML = '';
    if (!apps.length) {
      cardsContainer.innerHTML = '<p class="status-msg">No applications found.</p>';
      return;
    }
    const matchIdx = findMatchingAppIndex(apps);
    apps.forEach((app, i) => {
      const card = buildCard(app);
      if (i === matchIdx) {
        card.classList.add('card-matched');
        setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
      }
      cardsContainer.appendChild(card);
    });
  }

  // Checks whether any UC form field already contains a value that matches an
  // application in the sheet. Returns the index in apps[], or -1 if no match.
  function findMatchingAppIndex(apps) {
    const pageEmployer = (document.getElementById(SELECTORS.employer)?.value || '').trim().toLowerCase();
    const pageJobTitle = (document.getElementById(SELECTORS.jobTitle)?.value || '').trim().toLowerCase();
    if (!pageEmployer && !pageJobTitle) return -1;
    return apps.findIndex(app =>
      (pageEmployer && app.employer.toLowerCase() === pageEmployer) ||
      (pageJobTitle && app.jobTitle.toLowerCase()  === pageJobTitle)
    );
  }

  // Builds one application card DOM element.
  function buildCard(app) {
    const card = document.createElement('div');
    card.className = 'app-card';

    // Using innerHTML for the static structure; event listeners are attached
    // via addEventListener below to avoid any XSS risk from sheet data.
    card.innerHTML = `
      <div class="card-header">
        <span class="card-date">${escHtml(app.date)}</span>
        <span class="card-method">${escHtml(app.method)}</span>
      </div>
      <div class="card-row">
        <span class="card-label">Employer</span>
        <span class="card-value" title="${escAttr(app.employer)}">${escHtml(app.employer)}</span>
        <button class="copy-btn" data-copy="${escAttr(app.employer)}"
                title="Copy employer name">Copy</button>
      </div>
      <div class="card-row">
        <span class="card-label">Job</span>
        <span class="card-value" title="${escAttr(app.jobTitle)}">${escHtml(app.jobTitle)}</span>
        <button class="copy-btn" data-copy="${escAttr(app.jobTitle)}"
                title="Copy job title">Copy</button>
      </div>
      <div class="card-row">
        <span class="card-label">URL</span>
        <span class="card-value" title="${escAttr(app.jobUrl)}">${escHtml(app.jobUrl)}</span>
        <button class="copy-btn" data-copy="${escAttr(app.jobUrl)}"
                title="Copy job URL (for the Notes field)">Copy</button>
      </div>
      <div class="status-row">
        <button class="status-btn" data-status="APPLIED">Applied</button>
        <button class="status-btn" data-status="SUCCESSFUL">Successful</button>
        <button class="status-btn" data-status="UNSUCCESSFUL">Unsuccessful</button>
      </div>
      <button class="autofill-btn">Auto-fill form</button>
    `;

    card.querySelectorAll('.copy-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        copyText(btn.dataset.copy);
        showToast('Copied to clipboard');
      })
    );

    // Pre-select whatever status is already stored in the sheet for this row.
    let selectedStatus = app.status ? app.status.toUpperCase() : null;
    card.querySelectorAll('.status-btn').forEach(btn => {
      if (btn.dataset.status === selectedStatus) btn.classList.add('active');
      btn.addEventListener('click', () => {
        card.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedStatus = btn.dataset.status;
      });
    });

    card.querySelector('.autofill-btn').addEventListener('click', () => autoFill(app, selectedStatus));

    return card;
  }

  // ── 6. Auto-fill ────────────────────────────────────────────────────────
  function autoFill(app, status) {
    // The sheet stores the date as DD/MM/YYYY; split it for the three UC inputs
    const [day, month, year] = app.date.split('/');

    let filled = 0;
    filled += setField(SELECTORS.jobTitle,   app.jobTitle);
    filled += setField(SELECTORS.employer,   app.employer);
    filled += setField(SELECTORS.dayInput,   day   || '');
    filled += setField(SELECTORS.monthInput, month || '');
    filled += setField(SELECTORS.yearInput,  year  || '');
    filled += setField(SELECTORS.notes,      app.jobUrl);
    filled += setStatus(status);

    if (filled === 0) {
      showToast('No fields found — update selectors.js', true);
      return;
    }
    showToast(`Auto-filled ${filled} field${filled !== 1 ? 's' : ''}`);

    // Write the status back to column F of the sheet row asynchronously.
    if (status && app.sheetRow) {
      updateApplicationStatus(app.sheetRow, status)
        .then(() => showToast('Status saved to sheet'))
        .catch(err => showToast(`Sheet update failed: ${err.message}`, true));
    }
  }

  // Checks the job-status radio button on the UC page (Applied/Successful/Unsuccessful).
  function setStatus(status) {
    if (!status) return 0;
    const radio = document.getElementById(`clickable-${status}`);
    if (!radio) return 0;
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    radio.dispatchEvent(new Event('click',  { bubbles: true }));
    return 1;
  }

  // Writes a value to a form field identified by its element ID.
  // Fires both 'input' and 'change' events so that any JavaScript on the
  // page that watches those events (validation, character counters, etc.)
  // reacts correctly.
  function setField(elementId, value) {
    const el = document.getElementById(elementId);
    if (!el) return 0;
    el.value = value;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;
  }

  // ── 7. Toast ────────────────────────────────────────────────────────────
  // Appended inside #uc-logger-panel (which has position: relative), so the
  // absolute positioning in panel.css places it just above the panel.
  function showToast(message, isError = false) {
    const old = panel.querySelector('.toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.className = isError ? 'toast toast-error' : 'toast';
    toast.textContent = message;
    panel.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  // ── 8. Clipboard ────────────────────────────────────────────────────────
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    } else {
      legacyCopy(text);
    }
  }

  // Fallback for environments where the Clipboard API is unavailable
  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    Object.assign(ta.style, {
      position: 'fixed', opacity: '0', top: '0', left: '0', pointerEvents: 'none',
    });
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  // ── 9. HTML-escaping helpers ─────────────────────────────────────────────
  // Used when building card innerHTML so sheet data cannot inject markup.
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
  }

  // ── Initial load ─────────────────────────────────────────────────────────
  loadApplications();

})();
