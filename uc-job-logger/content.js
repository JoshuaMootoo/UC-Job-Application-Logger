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
    top:        '0',
    bottom:     '0',
    right:      '0',
    width:      '310px',
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
  const searchBar       = shadow.getElementById('search-bar');
  const searchInput     = shadow.getElementById('search-input');

  // All fetched applications — shared across tab renders without re-fetching.
  let allApps     = [];
  let activeTab   = 'APPLIED';
  let searchQuery = '';

  // ── 3. Collapsed/expanded state ─────────────────────────────────────────
  const stored = await chrome.storage.local.get(['panelCollapsed', 'activeTab']);
  applyCollapsed(!!stored.panelCollapsed);
  if (stored.activeTab) {
    activeTab = stored.activeTab;
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));
    updateTabUI();
  }

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

  // ── 4. Tabs, search & universal button ─────────────────────────────────
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab   = btn.dataset.tab;
      searchQuery = '';
      searchInput.value = '';
      chrome.storage.local.set({ activeTab });
      updateTabUI();
      renderCards();
    });
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.toLowerCase().trim();
    renderCards();
  });

  // Shows the search bar on all tabs; shows the universal button on non-Applied tabs.
  function updateTabUI() {
    searchBar.classList.remove('hidden');
    if (activeTab === 'APPLIED') {
      universalBar.classList.add('hidden');
    } else {
      universalBar.classList.remove('hidden');
      const label = activeTab === 'SUCCESSFUL' ? 'Successful' : 'Unsuccessful';
      universalSetBtn.textContent = `Set as ${label} on this page`;
      universalSetBtn.dataset.tab = activeTab;
    }
  }

  // Sets the radio, marks the matching job's outcome updated, then submits the form.
  universalSetBtn.addEventListener('click', () => {
    const radio = document.getElementById(`clickable-${activeTab}`);
    if (!radio) {
      showToast('Status button not found on this page', true);
      return;
    }
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    radio.dispatchEvent(new Event('click',  { bubbles: true }));

    // Identify the matching app now, while the form fields still have values.
    const tabApps = filterByTab(allApps, activeTab);
    const idx     = findMatchingAppIndex(tabApps);

    setTimeout(() => {
      const submitBtn = document.getElementById('id-submit-button');
      if (!submitBtn) {
        showToast('Submit button not found on this page', true);
        return;
      }
      // Write to the sheet before navigating; the background SW will complete
      // the request even after the page unloads.
      if (idx >= 0 && tabApps[idx].sheetRow) {
        markOutcomeUpdated(tabApps[idx].sheetRow)
          .catch(err => console.error(`Outcome update failed: ${err.message}`));
      }
      submitBtn.click();
    }, 300);
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

  // Filters allApps by the active tab and renders all matching cards.
  // The Applied tab is split into two sections: jobs not yet added to UC,
  // and jobs that have been submitted (column G = TRUE).
  function renderCards() {
    cardsContainer.innerHTML = '';
    const filtered = filterByTab(allApps, activeTab);

    if (activeTab === 'APPLIED') {
      const toAdd = applySearch(filtered.filter(a => a.addedToUC.toUpperCase() !== 'TRUE'));
      const added = applySearch(filtered.filter(a => a.addedToUC.toUpperCase() === 'TRUE'));

      if (!toAdd.length && !added.length) {
        cardsContainer.innerHTML = '<p class="status-msg">No applied applications.</p>';
        return;
      }
      if (toAdd.length) {
        cardsContainer.appendChild(makeSectionHeader('To Add'));
        toAdd.forEach(app => cardsContainer.appendChild(buildFullCard(app)));
      }
      if (added.length) {
        cardsContainer.appendChild(makeSectionHeader('Added to UC Site'));
        added.forEach(app => cardsContainer.appendChild(buildAddedCard(app)));
      }
      return;
    }

    const toUpdate = applySearch(filtered.filter(a => a.outcomeUpdated.toUpperCase() !== 'TRUE'));
    const updated  = applySearch(filtered.filter(a => a.outcomeUpdated.toUpperCase() === 'TRUE'));

    if (!toUpdate.length && !updated.length) {
      const label = activeTab.charAt(0) + activeTab.slice(1).toLowerCase();
      cardsContainer.innerHTML = `<p class="status-msg">No ${label} applications.</p>`;
      return;
    }
    if (toUpdate.length) {
      cardsContainer.appendChild(makeSectionHeader('To Update'));
      const matchIdx = findMatchingAppIndex(toUpdate);
      toUpdate.forEach((app, i) => {
        const card = buildSimpleCard(app);
        if (i === matchIdx) {
          card.classList.add('card-matched');
          setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
        }
        cardsContainer.appendChild(card);
      });
    }
    if (updated.length) {
      cardsContainer.appendChild(makeSectionHeader('Updated on UC Site'));
      updated.forEach(app => cardsContainer.appendChild(buildSimpleCard(app)));
    }
  }

  function applySearch(apps) {
    if (!searchQuery) return apps;
    return apps.filter(app =>
      app.employer.toLowerCase().includes(searchQuery) ||
      app.jobTitle.toLowerCase().includes(searchQuery)
    );
  }

  function makeSectionHeader(text) {
    const el = document.createElement('div');
    el.className = 'section-header';
    el.textContent = text;
    return el;
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

  // Full card for the Applied tab — date, employer, job title, auto-fill.
  function buildFullCard(app) {
    const card = document.createElement('div');
    card.className = 'app-card';

    card.innerHTML = `
      <div class="card-header">
        <span class="card-date">${escHtml(app.date)}</span>
        <span class="card-employer-badge" title="${escAttr(app.employer)}">${escHtml(app.employer)}</span>
      </div>
      <div class="card-job" title="${escAttr(app.jobTitle)}">${escHtml(app.jobTitle)}</div>
      <button class="autofill-btn">Auto-fill form</button>
    `;

    card.querySelector('.autofill-btn').addEventListener('click', () => autoFill(app, 'Applied'));
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
    card.querySelector('.find-btn').addEventListener('click', () => findOnPage(app.jobTitle, app.employer));
    return card;
  }

  // Card for jobs already added to the UC site — lets the user mark the outcome.
  function buildAddedCard(app) {
    const card = document.createElement('div');
    card.className = 'app-card app-card--added';
    card.innerHTML = `
      <div class="simple-employer" title="${escAttr(app.employer)}">${escHtml(app.employer)}</div>
      <div class="simple-jobtitle" title="${escAttr(app.jobTitle)}">${escHtml(app.jobTitle)}</div>
      <div class="added-status-row">
        <button class="added-status-btn added-status-btn--unsuccessful">Unsuccessful</button>
        <button class="added-status-btn added-status-btn--successful">Successful</button>
      </div>
    `;

    card.querySelector('.added-status-btn--unsuccessful').addEventListener('click', () => {
      updateApplicationStatus(app.sheetRow, 'Unsuccessful')
        .then(() => showToast('Marked Unsuccessful'))
        .catch(err => showToast(`Update failed: ${err.message}`, true))
        .finally(() => loadApplications());
    });

    card.querySelector('.added-status-btn--successful').addEventListener('click', () => {
      updateApplicationStatus(app.sheetRow, 'Successful')
        .then(() => showToast('Marked Successful'))
        .catch(err => showToast(`Update failed: ${err.message}`, true))
        .finally(() => loadApplications());
    });

    return card;
  }

  // Finds the matching job listing on the UC page using the "JOB TITLE - COMPANY"
  // heading format, then auto-clicks its Update job link.
  function findOnPage(jobTitle, employer) {
    const norm     = s => s.toLowerCase().trim();
    const title    = norm(jobTitle);
    const company  = norm(employer);
    const combined = `${title} - ${company}`;

    // Score each h3.job-list__item-heading: prefer the combined match, fall back
    // to title-only if no combined match exists.
    const headings = Array.from(document.querySelectorAll('h3.job-list__item-heading'));
    let matched = headings.find(h => norm(h.textContent).includes(combined));
    if (!matched) {
      matched = headings.find(h => norm(h.textContent).includes(title));
    }

    if (!matched) {
      showToast(`"${jobTitle}" not found on this page`, true);
      return;
    }

    const li         = matched.closest('li.job-list__item');
    const updateLink = li?.querySelector('a.job-list__item-link');

    if (updateLink) {
      updateLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
      updateLink.click();
      showToast('Found — opening Update job');
    } else {
      matched.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showToast('Found — no Update job link on this listing', true);
    }
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
    filled += setField(SELECTORS.notes,      cleanUrl(app.jobUrl));
    filled += setStatus(status);

    if (filled === 0) {
      showToast('No fields found — update selectors.js', true);
      return;
    }
    showToast(`Auto-filled ${filled} field${filled !== 1 ? 's' : ''}`);

    // Write the status back to column F and reload the panel once done.
    if (status && app.sheetRow) {
      updateApplicationStatus(app.sheetRow, status)
        .then(() => loadApplications())
        .catch(err => showToast(`Sheet update failed: ${err.message}`, true));
    }

    // Give the page's validation JS a moment to react, then submit the form.
    // Write addedToUC before clicking submit so the message reaches the
    // background SW before the page navigates away.
    setTimeout(() => {
      const submitBtn = document.getElementById('id-submit-button');
      if (!submitBtn) {
        showToast('Submit button not found on this page', true);
        return;
      }
      if (app.sheetRow) {
        markAddedToUC(app.sheetRow)
          .catch(err => console.error(`UC flag failed: ${err.message}`));
      }
      submitBtn.click();
    }, 300);
  }

  // Checks the job-status radio button on the UC page (Applied/Successful/Unsuccessful).
  function setStatus(status) {
    if (!status) return 0;
    const radio = document.getElementById(`clickable-${status.toUpperCase()}`);
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

  // ── 9. URL cleaner ───────────────────────────────────────────────────────
  // Removes all utm_* tracking parameters from a URL before it is pasted
  // into the UC form notes field.
  function cleanUrl(url) {
    try {
      const u = new URL(url);
      [...u.searchParams.keys()]
        .filter(k => k.toLowerCase().startsWith('utm_'))
        .forEach(k => u.searchParams.delete(k));
      // Drop the trailing ? if no params remain
      return u.toString();
    } catch {
      return url; // not a valid URL — return as-is
    }
  }

  // ── 10. HTML-escaping helpers ─────────────────────────────────────────────
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
