// ─── Google Sheets API Helper ──────────────────────────────────────────────
// Fetches the last NUM_ROWS data rows from the configured Google Sheet.
// Depends on: SHEET_ID, API_KEY, SHEET_TAB, NUM_ROWS (all from config.js).
//
// Sheet column layout expected:
//   A – Date Applied (DD/MM/YYYY)
//   B – Employer or Agency
//   C – Job Title
//   D – Job URL  (used as the Notes value on the UC form)
//   E – Application Method (display only, not submitted to UC)

async function fetchRecentApplications() {
  // Fetch all rows from columns A–E (row 1 is the header).
  const range = encodeURIComponent(`${SHEET_TAB}!A:E`);
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}` +
                `?key=${API_KEY}&majorDimension=ROWS`;

  const response = await fetch(url);

  if (!response.ok) {
    // Surface a readable error that includes any message from the API.
    const body = await response.text().catch(() => '');
    throw new Error(`Sheets API returned ${response.status}: ${body || response.statusText}`);
  }

  const data = await response.json();
  const rows = data.values || [];

  // Skip the header row (index 0), grab the last NUM_ROWS data rows,
  // then reverse so the most-recent application appears at the top.
  const dataRows = rows.slice(1);
  const recent   = dataRows.slice(-NUM_ROWS).reverse();

  return recent.map(row => ({
    date:     (row[0] || '').trim(),  // A: DD/MM/YYYY
    employer: (row[1] || '').trim(),  // B: Employer or Agency
    jobTitle: (row[2] || '').trim(),  // C: Job Title
    jobUrl:   (row[3] || '').trim(),  // D: Job URL → Notes field
    method:   (row[4] || '').trim(),  // E: Method (display only)
  }));
}
