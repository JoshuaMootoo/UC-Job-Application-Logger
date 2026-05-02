// ─── Google Sheets API Helper ──────────────────────────────────────────────
// Fetches all data rows from the configured Google Sheet (most-recent-first),
// and provides a function to write a status value back to column F.
// Depends on: SHEET_ID, API_KEY, SHEET_TAB, NUM_ROWS (all from config.js).
//
// Sheet column layout expected:
//   A – Date Applied (DD/MM/YYYY)
//   B – Employer or Agency
//   C – Job Title
//   D – Job URL  (used as the Notes value on the UC form)
//   E – Application Method (display only, not submitted to UC)
//   F – Status   (APPLIED / SUCCESSFUL / UNSUCCESSFUL — written by this extension)

async function fetchRecentApplications() {
  // Fetch all rows from columns A–F (row 1 is the header).
  const range = encodeURIComponent(`${SHEET_TAB}!A:F`);
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}` +
                `?key=${API_KEY}&majorDimension=ROWS`;

  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Sheets API returned ${response.status}: ${body || response.statusText}`);
  }

  const data = await response.json();
  const rows = data.values || [];

  // Attach the 1-based sheet row number before reversing so we know exactly
  // which row to update when writing status back.
  // Row 1 is the header, so data rows begin at sheet row 2.
  const dataRows = rows.slice(1).map((row, i) => ({ row, sheetRow: i + 2 }));

  // Return all rows most-recent-first; tab rendering caps each tab at NUM_ROWS.
  return dataRows.reverse().map(({ row, sheetRow }) => ({
    sheetRow,
    date:     (row[0] || '').trim(),  // A: DD/MM/YYYY
    employer: (row[1] || '').trim(),  // B: Employer or Agency
    jobTitle: (row[2] || '').trim(),  // C: Job Title
    jobUrl:   (row[3] || '').trim(),  // D: Job URL → Notes field
    method:   (row[4] || '').trim(),  // E: Method (display only)
    status:   (row[5] || '').trim(),  // F: Status (written back by extension)
  }));
}

// Writes a status string to column F of the given sheet row.
// Uses chrome.identity.getAuthToken for OAuth so the sheet doesn't need to
// be publicly writable — the user's Google account is used instead.
async function updateApplicationStatus(sheetRow, status) {
  const token = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, t => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(t);
      }
    });
  });

  const range = encodeURIComponent(`${SHEET_TAB}!F${sheetRow}`);
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}` +
                `?valueInputOption=RAW`;

  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ values: [[status]] }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Sheets write failed ${res.status}: ${body || res.statusText}`);
  }
}
