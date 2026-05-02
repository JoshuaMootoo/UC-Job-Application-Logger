// ─── Extension Configuration ───────────────────────────────────────────────
// Replace the placeholder values below before loading the extension.
// See README.md → "Setup" for step-by-step instructions.

// The long ID string found in your Google Sheet URL:
// https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
const SHEET_ID = 'YOUR_SHEET_ID_HERE';

// A Google Cloud API key with the Sheets API v4 enabled (used for reads).
const API_KEY = 'YOUR_API_KEY_HERE';

// The name of the tab (bottom of the spreadsheet) that holds your applications.
const SHEET_TAB = 'Sheet1';

// Maximum number of applications to show per tab (Applied / Successful / Unsuccessful).
const NUM_ROWS = 10;

// ─── OAuth Setup (required for writing status back to the sheet) ────────────
// 1. Go to console.cloud.google.com → APIs & Services → Credentials
// 2. Create an OAuth 2.0 Client ID → Application type: Chrome Extension
// 3. Enter your extension's ID (found at chrome://extensions after loading it)
// 4. Copy the generated client_id into manifest.json → "oauth2" → "client_id"
// No changes needed in this file for OAuth — it's configured in manifest.json.
