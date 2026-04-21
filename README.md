# UC Job Application Logger

A Chrome extension that reads your job applications from a Google Sheet and
injects a floating panel into Universal Credit journal pages so you can
copy field values or auto-fill the journal entry form with one click.

---

## File structure

```
uc-job-logger/
├── manifest.json    Chrome extension manifest (MV3)
├── config.js        Your Sheet ID and API key
├── selectors.js     UC form field IDs (update if the form changes)
├── content.js       Injected into UC pages — panel logic and auto-fill
├── panel.html       Floating panel markup (loaded into a shadow DOM)
├── panel.css        Panel styles (scoped inside the shadow DOM)
├── sheets.js        Google Sheets API v4 helper
└── icons/           Extension icons at 16 / 48 / 128 px
```

---

## Setup

### 1. Get a Google Sheets API key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or select an existing one).
3. In the left sidebar, go to **APIs & Services → Library**.
4. Search for **Google Sheets API** and click **Enable**.
5. Go to **APIs & Services → Credentials** and click **Create Credentials → API key**.
6. Copy the generated key.
7. *(Optional but recommended)* Click the key, then under **API restrictions**
   restrict it to **Google Sheets API** only, and under **Application restrictions**
   add your Chrome extension ID once you know it.

### 2. Make your Google Sheet publicly readable

1. Open your Google Sheet.
2. Click **Share** (top-right).
3. Under **General access**, change **Restricted** to **Anyone with the link**.
4. Set the role to **Viewer**.
5. Click **Done**.

No OAuth flow is required — the API key plus the public sheet is enough.

### 3. Configure the extension

Open `uc-job-logger/config.js` and replace the two placeholder values:

```js
const SHEET_ID = 'YOUR_SHEET_ID_HERE';  // ← the long ID in your sheet URL
const API_KEY  = 'YOUR_API_KEY_HERE';   // ← the key from step 1
```

Your Sheet ID is the string between `/d/` and `/edit` in the sheet URL:

```
https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit
                                        ↑ this part is the Sheet ID ↑
```

If your data is on a tab other than the default **Sheet1**, also update:

```js
const SHEET_TAB = 'Sheet1';  // ← change to your actual tab name
```

### 4. Google Sheet column layout

The extension expects columns in this exact order:

| Column | Content | Example |
|--------|---------|---------|
| A | Date Applied | `21/04/2026` |
| B | Employer or Agency | `Acme Ltd` |
| C | Job Title | `Software Engineer` |
| D | Job URL | `https://example.com/job/123` |
| E | Application Method | `LinkedIn` |

Row 1 should be a header row — it is skipped automatically.

### 5. Load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `uc-job-logger/` folder (the one that contains `manifest.json`).
5. The extension will appear in your extensions list. Pin it to the toolbar
   if you like (click the puzzle-piece icon → pin UC Job Logger).

---

## Using the extension

1. Navigate to any page on `*.universal-credit.service.gov.uk`.
2. A **Job Logger** panel appears in the bottom-right corner.
3. The panel fetches your last 10 applications from Google Sheets.
4. For each application you can:
   - Click **Copy** next to any field to copy just that value to your clipboard.
   - Click **Auto-fill form** to populate all UC journal fields at once.
5. Click the **−** button to collapse the panel; it remembers the state.
6. Click **↻** to re-fetch the sheet (useful after you add a new row).

---

## Updating selectors if the UC form changes

The UC journal form field IDs are stored in `selectors.js`. If auto-fill
stops working after a GOV.UK update, follow these steps:

1. Open the UC journal entry page in Chrome.
2. Press **F12** to open DevTools.
3. Click the **inspector cursor** (top-left of DevTools, or `Ctrl+Shift+C`).
4. Click on the field that is no longer being filled.
5. In the **Elements** panel, find the `id="..."` attribute on the highlighted
   `<input>` or `<textarea>`. For example: `id="id-jobTitle"`.
6. Open `selectors.js` and update the corresponding property value
   (no leading `#`):

```js
const SELECTORS = {
  jobTitle:   'id-jobTitle',         // ← update this if it changes
  employer:   'id-employer',
  dayInput:   'id-applicationDate.day',
  monthInput: 'id-applicationDate.month',
  yearInput:  'id-applicationDate.year',
  notes:      'id-notes',
};
```

7. Go back to `chrome://extensions` and click the **reload** icon (↻) on the
   extension card, then refresh the UC page.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Panel does not appear | Extension not loaded, or wrong URL pattern | Check `chrome://extensions` → ensure enabled; confirm you are on `*.universal-credit.service.gov.uk` |
| "Sheets API returned 403" | API key wrong or sheet not public | Re-check steps 1–3 above |
| "Sheets API returned 404" | Wrong `SHEET_ID` or `SHEET_TAB` | Double-check `config.js` values |
| Auto-fill fills 0 fields | Form field IDs have changed | Follow "Updating selectors" above |
| Copied value is empty | Data missing in that sheet cell | Check the sheet row |

---

## Permissions used

| Permission | Why |
|------------|-----|
| `storage` | Remembers whether the panel is collapsed |
| Host permission: `*.universal-credit.service.gov.uk` | Allows the content script to run and lets the panel read the UC page DOM for auto-fill |
| Host permission: `sheets.googleapis.com` | Allows `fetch()` calls to the Sheets API v4 |
