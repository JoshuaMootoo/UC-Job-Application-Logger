// ─── Background Service Worker ──────────────────────────────────────────────
// Receives writeCell messages from the content script and POSTs them to the
// Google Apps Script web app, which updates the sheet. The background worker
// is used because content scripts cannot make cross-origin fetch requests.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'writeCell') {
    postToAppsScript(message)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // keeps the channel open for the async response
  }
});

async function postToAppsScript({ appsScriptUrl, sheetTab, sheetRow, column, value }) {
  if (!appsScriptUrl || appsScriptUrl === 'YOUR_APPS_SCRIPT_URL_HERE') {
    throw new Error('APPS_SCRIPT_URL not configured in config.js');
  }

  const res = await fetch(appsScriptUrl, {
    method:   'POST',
    redirect: 'follow', // Apps Script web apps redirect to script.googleusercontent.com
    headers:  { 'Content-Type': 'application/json' },
    body:     JSON.stringify({ sheetTab, sheetRow, column, value }),
  });

  if (!res.ok) {
    throw new Error(`Apps Script responded ${res.status}`);
  }

  const json = await res.json().catch(() => ({}));
  if (json.error) throw new Error(json.error);
}
