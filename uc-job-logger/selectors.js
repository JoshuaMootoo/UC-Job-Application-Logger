// ─── UC Journal Form Field IDs ─────────────────────────────────────────────
// These are the HTML element IDs for each input on the UC journal entry form.
//
// How to verify or update a selector after the form changes:
//   1. Open the UC journal entry page in Chrome.
//   2. Press F12 to open DevTools.
//   3. Click the inspector cursor (top-left of DevTools) then click the field
//      you want to target on the page.
//   4. In the Elements panel, look for the `id="..."` attribute on the
//      highlighted <input> or <textarea>.
//   5. Copy that ID string (without the leading #) and paste it below.
//
// Values here are plain element IDs — no leading '#'.
// They are passed directly to document.getElementById().

const SELECTORS = {
  // Single-line text input: job title
  jobTitle:   'id-jobTitle',

  // Single-line text input: employer or agency name
  employer:   'id-employer',

  // The application date is split across three separate number inputs.
  // content.js splits the DD/MM/YYYY string from the sheet and fills each one.
  dayInput:   'id-applicationDate.day',
  monthInput: 'id-applicationDate.month',
  yearInput:  'id-applicationDate.year',

  // Textarea: notes — the job URL from column D is placed here
  notes:      'id-notes',
};
