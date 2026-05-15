// ─── Background Service Worker ──────────────────────────────────────────────
// Content scripts cannot use chrome.identity, so all OAuth token fetching and
// Google Sheets write requests are handled here instead.
//
// Listens for { action: 'writeCell', sheetId, sheetTab, sheetRow, column, value }
// messages from the content script and writes the value to the specified cell.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'writeCell') {
    writeCell(message)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // keeps the message channel open for the async response
  }
});

async function writeCell({ sheetId, sheetTab, sheetRow, column, value }) {
  const token = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, t => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(t);
    });
  });

  const range = encodeURIComponent(`${sheetTab}!${column}${sheetRow}`);
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}` +
                `?valueInputOption=RAW`;

  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ values: [[value]] }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Sheets write failed ${res.status}: ${body || res.statusText}`);
  }
}
