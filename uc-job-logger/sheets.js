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
//   E – Status           (Applied / Successful / Unsuccessful — written by extension)
//   F – Added To UC Site (TRUE when the entry has been auto-filled and submitted)
//   G – Outcome Updated  (TRUE when Unsuccessful/Successful has been set on the UC site)

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
    date:           (row[0] || '').trim(),  // A: DD/MM/YYYY
    employer:       (row[1] || '').trim(),  // B: Employer or Agency
    jobTitle:       (row[2] || '').trim(),  // C: Job Title
    jobUrl:         (row[3] || '').trim(),  // D: Job URL → Notes field
    status:         (row[4] || '').trim(),  // E: Status
    addedToUC:      (row[5] || '').trim(),  // F: Added To UC Site
    outcomeUpdated: (row[6] || '').trim(),  // G: Outcome Updated
  })).filter(app => app.employer || app.jobTitle);
}

// ── Generic single-cell writer ───────────────────────────────────────────────
// Delegates to the background service worker, which POSTs to the Apps Script
// web app. Background is used because content scripts cannot make cross-origin
// fetch requests.
function writeCell(sheetRow, column, value) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'writeCell', appsScriptUrl: APPS_SCRIPT_URL, sheetTab: SHEET_TAB, sheetRow, column, value },
      response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve();
        }
      }
    );
  });
}

// Writes the status string (Applied / Successful / Unsuccessful) to column E.
function updateApplicationStatus(sheetRow, status) {
  return writeCell(sheetRow, 'E', status);
}

// Sets column F ("Added To UC Site") to TRUE for the given row.
function markAddedToUC(sheetRow) {
  return writeCell(sheetRow, 'F', true);
}

// Sets column G ("Outcome Updated") to TRUE once Unsuccessful/Successful
// has been submitted on the UC site.
function markOutcomeUpdated(sheetRow) {
  return writeCell(sheetRow, 'G', true);
}
