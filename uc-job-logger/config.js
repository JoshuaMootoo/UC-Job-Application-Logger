// ─── Extension Configuration ───────────────────────────────────────────────
// Replace the placeholder values below before loading the extension.

// The long ID string found in your Google Sheet URL:
// https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
const SHEET_ID = 'YOUR_SHEET_ID_HERE';

// A Google Cloud API key with the Sheets API v4 enabled (used for reads).
const API_KEY = 'YOUR_API_KEY_HERE';

// The name of the tab (bottom of the spreadsheet) that holds your applications.
const SHEET_TAB = 'Sheet1';

// ─── Apps Script Web App URL (required for writing back to the sheet) ────────
// This lets the extension update columns F and G without complex OAuth setup.
//
// One-time setup (takes about 2 minutes):
// 1. Open your Google Sheet → Extensions → Apps Script
// 2. Delete any existing code and paste in the contents of apps-script.js
//    (found in this repo alongside this file)
// 3. Click Deploy → New deployment
//    - Type: Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 4. Click Deploy, approve the permissions, then copy the Web app URL below.
const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';
