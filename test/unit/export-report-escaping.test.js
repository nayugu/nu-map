// UNIT · the printed report is HTML built by concatenation, and several of the
// strings it interpolates arrive from a SHARE LINK.
//
// `exportReport` opens its document as a `blob:` URL, and a blob document
// inherits the origin of the page that created it — so script inside it is
// same-origin with the app and can read every plan slot in localStorage,
// grades included. React escapes these strings everywhere else in the app;
// this one surface builds its own markup, which is why it is the one that has
// to be tested rather than trusted.
//
// The fields a sender controls (planSchema.js):
//   specialTermPl[*].company / .subline / .duration   SHARE_INNER_KEYS.specialTerm
//   reservations[*].label → card.code                 share key `rv`
//   reservations[*].requirement.title → card.title    share key `rv`
//
// These tests are deliberately hostile: they assert the payload is neutralised
// AND that the text still survives, because an escaper that drops content
// passes a "no payload" check while quietly losing the student's data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { exportReport, _escapeHtml as esc } from "../../src/core/planModel.js";

// ── Browser stubs ─────────────────────────────────────────────────────
// The minimum exportReport touches. `window.open` returning null makes it
// alert and return — AFTER the Blob is constructed, so the document is
// captured without needing print()/onafterprint or a dangling timer.
// AWAITED inside the try: exportReport is async and builds the Blob after
// several awaits, so restoring the globals synchronously would hand it the
// real Blob and capture nothing.
async function captureReport(run) {
  let html = null;
  const saved = {
    Blob: globalThis.Blob, URL: globalThis.URL,
    window: globalThis.window, alert: globalThis.alert,
  };
  globalThis.Blob = class { constructor(parts) { html = parts.join(""); } };
  globalThis.URL  = { createObjectURL: () => "blob:test", revokeObjectURL() {} };
  globalThis.window = { open: () => null };
  globalThis.alert = () => {};
  try {
    await run();
  } finally {
    globalThis.Blob = saved.Blob;
    globalThis.URL = saved.URL;
    globalThis.window = saved.window;
    globalThis.alert = saved.alert;
  }
  assert.ok(typeof html === "string" && html.length > 0,
    "the harness captured no document — the stub did not catch the Blob");
  return html;
}

const SEMS = [
  { id: "incoming", label: "Incoming Credit", weight: 1 },
  { id: "fall2026", label: "Fall 2026", weight: 1 },
  { id: "spr2027",  label: "Spring 2027", weight: 1 },
];
const SEM_IDX = { incoming: 0, fall2026: 1, spr2027: 2 };

const ADAPTER = {
  specialTerms: { getTypes: () => [
    { id: "coop", label: "CO-OP", durations: [{ duration: 4, weight: 1 }] },
  ] },
  attributeSystem: {
    getGridCodes: () => ["EX"], getSystemName: () => "NUPath",
    getCoverage: () => new Set(), getLabel: (k) => k,
  },
  creditSystem: { getUnitName: () => "SH" },
  institution: { appName: "NU Map" },
  majorRequirements: {},
};

const COURSES = {
  CS2500: { id: "CS2500", code: "CS 2500", title: "Fundamentals of Computer Science 1",
            subject: "CS", number: "2500", sh: 4, color: "#111", desc: "A real course.",
            attributes: [] },
};

/** Every shape that gets out of a different context. */
const PAYLOADS = {
  element:   `<img src=x onerror=alert(document.domain)>`,
  attrBreak: `" onerror="alert(document.domain)`,
  attrBreakSingle: `' onerror='alert(1)`,
  closeTag:  `</span><script>alert(1)</script>`,
  styleOut:  `</style><script>alert(1)</script>`,
  amp:       `Tom & Jerry <b>Ltd</b>`,
};

/**
 * Markup that must never appear live in the document.
 *
 * Deliberately NOT a search for the word "onerror": escaping `" onerror="` to
 * `&quot; onerror=&quot;` leaves the literal text ` onerror=` in the document,
 * where it is inert — it is the QUOTES that would have ended the attribute, and
 * they are gone. A test that flagged that would be failing correct output, so
 * these check for structure that only unescaped input can produce.
 */
function assertNoLiveMarkup(html, label) {
  assert.ok(!/<img\s+src=x/i.test(html), `${label}: raw <img> survived`);
  assert.ok(!/<script/i.test(html), `${label}: raw <script> survived`);
  assert.ok(!/<b>Ltd<\/b>/i.test(html), `${label}: raw inline markup survived`);
  assert.ok(!/<\/style>/i.test(html.slice(html.indexOf("</style>") + 8)),
    `${label}: a second </style> — the payload closed the stylesheet`);
}

test("escape › neutralises every metacharacter, and loses nothing", () => {
  assert.equal(esc(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  // & first, or the entities we emit get re-escaped into nonsense.
  assert.equal(esc("&lt;"), "&amp;lt;", "a literal &lt; must display as &lt;, not as <");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
  assert.equal(esc(0), "0", "a real 0 must not vanish");
  assert.equal(esc(false), "false");
  // Plain text is untouched — escaping must be invisible to ordinary content.
  assert.equal(esc("Khoury Approved Elective"), "Khoury Approved Elective");
  // Non-Latin content survives intact (8 locales ship here).
  assert.equal(esc("安全必修课程"), "安全必修课程");
});

test("escape › co-op employer fields from a share link cannot inject", async () => {
  for (const [name, payload] of Object.entries(PAYLOADS)) {
    const html = await captureReport(() => exportReport(
      { CS2500: "fall2026" }, COURSES, "fall2026", SEMS, SEM_IDX, {},
      { t1: { typeId: "coop", semId: "spr2027", duration: payload,
              company: payload, subline: payload, companyDomain: null } },
      ADAPTER,
    ));
    assertNoLiveMarkup(html, `company/${name}`);
    assert.ok(!html.includes(payload), `company/${name}: payload survived verbatim`);
    // …and the text is still THERE, escaped — a report that silently drops the
    // employer is a different bug wearing this one's clothes.
    assert.ok(html.includes(esc(payload)), `company/${name}: content was dropped`);
  }
});

test("escape › reservation label and requirement title cannot inject", async () => {
  for (const [name, payload] of Object.entries(PAYLOADS)) {
    const resId = "~res:x";
    const view = {
      occupants: { CS2500: "fall2026", [resId]: "spr2027" },
      cards: {
        ...COURSES,
        [resId]: { id: resId, isReservation: true, code: payload, title: payload,
                   subject: payload, sh: 4, color: payload, attributes: [payload] },
      },
    };
    const html = await captureReport(() => exportReport(
      { CS2500: "fall2026" }, COURSES, "fall2026", SEMS, SEM_IDX, {}, {}, ADAPTER, view,
    ));
    assertNoLiveMarkup(html, `reservation/${name}`);
    assert.ok(!html.includes(payload), `reservation/${name}: payload survived verbatim`);
  }
});

test("escape › a payload in `color` cannot break out of the style attribute", async () => {
  // `color` is interpolated INSIDE style="…", where angle brackets alone are
  // not the escape hatch — the quote is.
  const resId = "~res:c";
  const view = {
    occupants: { [resId]: "fall2026" },
    cards: { [resId]: { id: resId, isReservation: true, code: "Elective", title: "",
                        subject: "", sh: 4, color: `#fff" onmouseover="alert(1)`,
                        attributes: [] } },
  };
  const html = await captureReport(() => exportReport(
    {}, {}, "fall2026", SEMS, SEM_IDX, {}, {}, ADAPTER, view,
  ));
  // The quote is the escape hatch, so that is what to look for — the words
  // survive as inert text and are not evidence of anything.
  assert.ok(!html.includes(`#fff" onmouseover=`), "broke out of the style attribute");
  assert.ok(html.includes("#fff&quot; onmouseover="), "the colour text should still print");
});

test("escape › the report still renders ordinary content correctly", async () => {
  // The guard against over-escaping: a clean plan must be unchanged, and the
  // deliberate markup the report builds must still be markup.
  const html = await captureReport(() => exportReport(
    { CS2500: "fall2026" }, COURSES, "fall2026", SEMS, SEM_IDX, {}, {}, ADAPTER,
  ));
  assert.ok(html.includes("CS 2500"), "the course code should print");
  assert.ok(html.includes("Fundamentals of Computer Science 1"), "the title should print");
  assert.ok(html.includes("Fall 2026"), "the semester label should print");
  assert.ok(html.includes('<div class="course-row">'), "the report's own markup is intact");
  assert.ok(!html.includes("&amp;lt;"), "nothing was double-escaped");
});

test("escape › a description's newlines are still <br>, and its markup is not", async () => {
  // Order matters: escape THEN insert <br>. Reversed, the <br> is escaped and
  // the appendix prints literal tags.
  const courses = {
    CS2500: { ...COURSES.CS2500, desc: "Line one\nLine <b>two</b>" },
  };
  const html = await captureReport(() => exportReport(
    { CS2500: "fall2026" }, courses, "fall2026", SEMS, SEM_IDX, {}, {}, ADAPTER,
  ));
  assert.ok(html.includes("Line one<br>Line"), "the intentional <br> must survive");
  assert.ok(!html.includes("<b>two</b>"), "description markup must not");
  assert.ok(html.includes("&lt;b&gt;two&lt;/b&gt;"), "it should be visible as text");
});
