// ─── Extension Configuration ───────────────────────────────────────────────
// Replace SHEET_ID and API_KEY with your real values before loading the
// extension. See README.md → "Setup" for step-by-step instructions.

// The long ID string found in your Google Sheet URL:
// https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
const SHEET_ID = 'YOUR_SHEET_ID_HERE';

// A Google Cloud API key with the Sheets API v4 enabled.
// The key only needs read access; no OAuth is required if the sheet is public.
const API_KEY = 'YOUR_API_KEY_HERE';

// The name of the tab (bottom of the spreadsheet) that holds your applications.
const SHEET_TAB = 'Sheet1';

// How many of the most-recent rows to display in the panel.
const NUM_ROWS = 10;
