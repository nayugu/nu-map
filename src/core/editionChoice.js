// ═══════════════════════════════════════════════════════════════════
// EDITION CHOICE — what the per-program catalog-year control should show.
//
// Every DECISION the year selector makes lives here, and the component that
// draws it makes none. That split is not tidiness, it is what makes the rules
// checkable: `GradPanel.jsx` cannot be imported under Node (it is JSX, and the
// loaders beneath it use `import.meta.glob`, a Vite transform), so a rule kept
// inside the component can only be tested by building the whole app and driving
// a browser — 20 seconds per assertion instead of a fraction of a millisecond.
//
// The repo has been here before, and the lesson is not merely about speed:
// `bankRank.js` was extracted out of `BankPanel.jsx` because a mutant SURVIVED
// the entire browser suite while the comparator was inline — the natural
// browser test for it could not observe an ordering at all. Extraction made it
// both cheaper AND more sensitive. The same applies to every rule below: "the
// row is absent when one edition is held" is a claim about a boolean, and
// asking a rendered page about it is the least direct way to find out.
//
// What legitimately still needs a browser is left in a browser: that the app
// mounts at all, that the program box is not blank, and that choosing another
// edition actually re-audits the degree and reaches the saved plan. Those are
// integration facts, not decisions.
// ═══════════════════════════════════════════════════════════════════

/**
 * The model for one program's catalog-year control, or `null` when no control
 * should be drawn at all.
 *
 * @param {object} args
 * @param {{year:number,label:string,path:string}[]} args.editions
 *        Every edition HELD for this program, oldest first. Built from the
 *        registry, so each entry is a path that certainly loads — the property
 *        that stops the control offering a selection which would empty the
 *        program box.
 * @param {string|null} args.cohortPath  the edition this cohort follows, or
 *        null when the program is already on it.
 * @param {string} args.cohortLabel      that edition's name, e.g. "2025-2026".
 * @param {number|null} args.currentYear the edition in use.
 *
 * @returns {{options: {year:number,label:string,path:string}[],
 *            currentYear: number|null,
 *            hint: string|null,
 *            resetTo: string|null} | null}
 */
export function editionChoice({ editions, cohortPath, cohortLabel, currentYear } = {}) {
  const options = Array.isArray(editions) ? editions : [];

  // ── One edition is not a choice ──────────────────────────────────
  // A dropdown with a single option tells a student they may pick something
  // when they may not. Measured on the live tree: 180 of 689 undergraduate
  // programs and ALL 524 graduate programs are in this state, so this branch is
  // the common one, not an edge case. It also means the control appears for no
  // graduate plan today and for every one of them at once when the 2027
  // graduate edition lands.
  if (options.length < 2) return null;

  // ── The hint is shown only when it says something ────────────────
  // `cohortPath` is null when the program is already on its cohort's edition,
  // which is the overwhelmingly common case and must be silent. The predecessor
  // of this control fired for 338 of 498 undergraduate majors — every student
  // the app had — telling each of them to leave the edition they actually owe.
  // Deriving the hint from `cohortPath` rather than from a year comparison is
  // deliberate: one source decides both the message and the reset target, so
  // they cannot disagree about which edition is being recommended.
  const off = Boolean(cohortPath);

  return {
    options,
    currentYear: currentYear ?? null,
    hint:    off ? (cohortLabel || null) : null,
    // The reset is the repair path for a plan sitting on an edition it did not
    // choose — including every plan the old newer-only banner pushed forward.
    // It is a PATH, never a year: the caller assigns it straight to the saved
    // program field, and a year would have to be turned back into a path by
    // someone, which is where the two could drift.
    resetTo: off ? cohortPath : null,
  };
}
