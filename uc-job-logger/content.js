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
  const panel           = shadow.getElementById('uc-logger-panel');
  const panelBody       = shadow.getElementById('panel-body');
  const toggleBtn       = shadow.getElementById('panel-toggle');
  const refreshBtn      = shadow.getElementById('refresh-btn');
  const cardsContainer  = shadow.getElementById('cards-container');
  const tabBtns         = shadow.querySelectorAll('.tab-btn');
  const universalBar    = shadow.getElementById('universal-bar');
  const universalSetBtn = shadow.getElementById('universal-set-btn');

  // All fetched applications — shared across tab renders without re-fetching.
  let allApps   = [];
  let activeTab = 'APPLIED';

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

  // ── 4. Tabs & universal button ──────────────────────────────────────────
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      updateUniversalBar();
      renderCards();
    });
  });

  function updateUniversalBar() {
    if (activeTab === 'APPLIED') {
      universalBar.classList.add('hidden');
      return;
    }
    universalBar.classList.remove('hidden');
    const label = activeTab === 'SUCCESSFUL' ? 'Successful' : 'Unsuccessful';
    universalSetBtn.textContent  = `Set as ${label} on this page`;
    universalSetBtn.dataset.tab  = activeTab;
  }

  // Clicks the matching radio on the UC page for the current tab's status.
  universalSetBtn.addEventListener('click', () => {
    const radio = document.getElementById(`clickable-${activeTab}`);
    if (!radio) {
      showToast('Status button not found on this page', true);
      return;
    }
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    radio.dispatchEvent(new Event('click',  { bubbles: true }));
    showToast(`Set as ${activeTab.charAt(0) + activeTab.slice(1).toLowerCase()}`);
  });

  // ── 5. Refresh ──────────────────────────────────────────────────────────
  refreshBtn.addEventListener('click', loadApplications);

  // ── 6. Fetch & render ───────────────────────────────────────────────────
  async function loadApplications() {
    cardsContainer.innerHTML = '<p class="status-msg">Loading…</p>';
    try {
      allApps = await fetchRecentApplications();
      renderCards();
    } catch (err) {
      cardsContainer.innerHTML =
        `<p class="status-msg error">${escHtml(err.message)}</p>`;
    }
  }

  // Filters allApps by the active tab and renders up to NUM_ROWS cards.
  function renderCards() {
    cardsContainer.innerHTML = '';
    const filtered = filterByTab(allApps, activeTab).slice(0, NUM_ROWS);
    if (!filtered.length) {
      const label = activeTab.charAt(0) + activeTab.slice(1).toLowerCase();
      cardsContainer.innerHTML = `<p class="status-msg">No ${label} applications.</p>`;
      return;
    }
    const matchIdx = findMatchingAppIndex(filtered);
    filtered.forEach((app, i) => {
      const card = buildCard(app);
      if (i === matchIdx) {
        card.classList.add('card-matched');
        setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
      }
      cardsContainer.appendChild(card);
    });
  }

  // Applied tab shows jobs with status APPLIED or no status set yet.
  function filterByTab(apps, tab) {
    return apps.filter(app => {
      const s = app.status.toUpperCase();
      if (tab === 'APPLIED') return s === 'APPLIED' || s === '';
      return s === tab;
    });
  }

  // Checks whether any UC form field already contains a value that matches an
  // application in the filtered list. Returns the index in apps[], or -1.
  function findMatchingAppIndex(apps) {
    const pageEmployer = (document.getElementById(SELECTORS.employer)?.value || '').trim().toLowerCase();
    const pageJobTitle = (document.getElementById(SELECTORS.jobTitle)?.value || '').trim().toLowerCase();
    if (!pageEmployer && !pageJobTitle) return -1;
    return apps.findIndex(app =>
      (pageEmployer && app.employer.toLowerCase() === pageEmployer) ||
      (pageJobTitle && app.jobTitle.toLowerCase()  === pageJobTitle)
    );
  }

  // Dispatches to the correct card builder based on the active tab.
  function buildCard(app) {
    return activeTab === 'APPLIED' ? buildFullCard(app) : buildSimpleCard(app);
  }

  // Full card for the Applied tab — date, employer, job, URL, status picker, auto-fill.
  function buildFullCard(app) {
    const card = document.createElement('div');
    card.className = 'app-card';

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

  // Simple card for Successful / Unsuccessful tabs — employer, job title, find button only.
  function buildSimpleCard(app) {
    const card = document.createElement('div');
    card.className = 'app-card app-card--simple';
    card.innerHTML = `
      <div class="simple-employer" title="${escAttr(app.employer)}">${escHtml(app.employer)}</div>
      <div class="simple-jobtitle" title="${escAttr(app.jobTitle)}">${escHtml(app.jobTitle)}</div>
      <button class="find-btn">Find on page</button>
    `;
    card.querySelector('.find-btn').addEventListener('click', () => findOnPage(app.jobTitle));
    return card;
  }

  // Searches the UC page text for the job title and scrolls to the first match.
  // Excludes script/style nodes. Shadow DOM content is not traversed.
  function findOnPage(jobTitle) {
    const search = jobTitle.toLowerCase().trim();
    if (!search) return;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const tag = node.parentElement?.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.toLowerCase().includes(search)) {
        node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showToast('Found — scrolled to it');
        return;
      }
    }
    showToast(`"${jobTitle}" not found on this page`, true);
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
