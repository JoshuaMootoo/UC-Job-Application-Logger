// ─── UC Job Logger — Google Apps Script Web App ───────────────────────────
// Paste this entire file into your sheet's Apps Script editor, then deploy
// it as a Web App (Execute as: Me, Who has access: Anyone).
// Copy the generated URL into APPS_SCRIPT_URL in config.js.
//
// This script receives POST requests from the Chrome extension and writes
// a single cell value back to the spreadsheet.

function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents);
    const ss     = SpreadsheetApp.getActiveSpreadsheet();
    const sheet  = ss.getSheetByName(data.sheetTab) || ss.getSheets()[0];
    // Convert column letter to number: A=1, F=6, G=7 …
    const colNum = data.column.toUpperCase().charCodeAt(0) - 64;
    sheet.getRange(data.sheetRow, colNum).setValue(data.value);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
