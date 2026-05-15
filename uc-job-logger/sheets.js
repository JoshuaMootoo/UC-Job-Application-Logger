// ─── Google Sheets API Helper ──────────────────────────────────────────────
// Fetches all data rows from the configured Google Sheet (most-recent-first),
// and provides functions to write values back to individual cells.
// Depends on: SHEET_ID, API_KEY, SHEET_TAB, NUM_ROWS (all from config.js).
//
// Sheet column layout expected:
//   A – Date Applied (DD/MM/YYYY)
//   B – Employer or Agency
//   C – Job Title
//   D – Job URL  (used as the Notes value on the UC form)
//   E – Application Method (display only, not submitted to UC)
//   F – Status          (APPLIED / SUCCESSFUL / UNSUCCESSFUL — written by extension)
//   G – Added To UC Site  (TRUE when the entry has been auto-filled and submitted)

async function fetchRecentApplications() {
  // Fetch all rows from columns A–G (row 1 is the header).
  const range = encodeURIComponent(`${SHEET_TAB}!A:G`);
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
  // which row to update when writing back.
  // Row 1 is the header, so data rows begin at sheet row 2.
  const dataRows = rows.slice(1).map((row, i) => ({ row, sheetRow: i + 2 }));

  // Return all rows most-recent-first; skip rows with no employer and no job
  // title (blank sheet rows that would otherwise render as empty cards).
  return dataRows.reverse().map(({ row, sheetRow }) => ({
    sheetRow,
    date:      (row[0] || '').trim(),  // A: DD/MM/YYYY
    employer:  (row[1] || '').trim(),  // B: Employer or Agency
    jobTitle:  (row[2] || '').trim(),  // C: Job Title
    jobUrl:    (row[3] || '').trim(),  // D: Job URL → Notes field
    method:    (row[4] || '').trim(),  // E: Method (display only)
    status:    (row[5] || '').trim(),  // F: Status
    addedToUC: (row[6] || '').trim(),  // G: Added To UC Site
  })).filter(app => app.employer || app.jobTitle);
}

// ── Shared OAuth token helper ────────────────────────────────────────────────
function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, t => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(t);
    });
  });
}

// ── Generic single-cell writer ───────────────────────────────────────────────
async function writeCell(sheetRow, column, value) {
  const token = await getAuthToken();
  const range = encodeURIComponent(`${SHEET_TAB}!${column}${sheetRow}`);
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}` +
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

// Writes the status string (APPLIED / SUCCESSFUL / UNSUCCESSFUL) to column F.
function updateApplicationStatus(sheetRow, status) {
  return writeCell(sheetRow, 'F', status);
}

// Sets column G ("Added To UC Site") to TRUE for the given row.
function markAddedToUC(sheetRow) {
  return writeCell(sheetRow, 'G', true);
}
