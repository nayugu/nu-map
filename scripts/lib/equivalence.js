/**
 * equivalence.js — deciding which courses are interchangeable, and how sure we are.
 *
 * ## What this is for
 *
 * Students ask "what can I take instead of PHYS 1151?" and the honest answer
 * has three very different flavours that must never be blended into one:
 *
 *   1. "Your program already accepts either"    — a fact we hold and don't show.
 *   2. "That's the same course under two codes" — a fact about the catalog.
 *   3. "Those are usually interchangeable"      — an inference, needing approval.
 *
 * A single blended confidence score cannot express that, so this module emits
 * a **tier** plus the evidence that produced it. The UI's wording, and whether
 * a pair may be offered as a requirement substitution at all, follow from the
 * tier — not from the numeric score, which only orders results within a tier.
 *
 * ## Zero dependencies, on purpose
 *
 * `.github/workflows/test.yml` runs the invariant job with **no `npm install`**,
 * so anything `test/invariant/` imports may use only `src/` + Node builtins.
 * Same constraint as `major-verify.js`: all HTML/JSON reading happens in the
 * caller (`build-equivalences.js`); everything here is a pure function over
 * plain objects.
 *
 * ## The signals, and what each is actually worth
 *
 * Measured against the committed corpus on 2026-08-03. Precision figures come
 * from hand-checking against pairs whose answer is known.
 *
 * | # | Signal                                    | Yield        | Verdict |
 * |---|-------------------------------------------|--------------|---------|
 * | 6 | `OR`/`XOM` node in a program requirement  | 3,524 pairs  | the rule itself |
 * | 1 | explicit statement in a description       | 7 pairs      | gold; carries scope |
 * | 3 | cross-listing (identical description)     | 154 same-subj| good if cluster ≤ 3 |
 * | 5 | numbering convention (…01 / …09)          | 4 clean      | weak prior only |
 * | 4 | prereq `OR` co-occurrence                 | 1,926 pairs  | suggestive |
 * | 2 | mutual exclusion ("not open to…")         | 1 pair       | absent at NEU |
 *
 * ### Rejected signal: "they satisfy the same prerequisites"
 *
 * The intuitive test — A and B unlock the same downstream courses — was
 * measured and **does not discriminate**:
 *
 *     gate-set Jaccard, true equivalents:  mean 0.85
 *     gate-set Jaccard, NOT equivalent:    mean 0.82
 *
 * The ranges overlap almost entirely, and the worst false positive scores a
 * perfect 1.00: `LS 6101` / `LS 6102` are Intro to Legal Studies **1** and
 * **2** — a sequence. Meanwhile `PHYS 1151` / `PHYS 1161`, genuinely
 * interchangeable, scores only 0.67.
 *
 * The reason is structural, so no amount of threshold tuning fixes it: gate-set
 * identity measures "these two are always listed together", which is equally
 * true of a fixed choice pool (`ANTH 1101 or SOCL 1101` = "any social
 * science"), of a course sequence, and of real alternatives. Two courses always
 * offered as a pair have identical gate sets *by construction*. It survives
 * here only as a weak positive term, never as a decider.
 *
 * ### Why the vetoes carry the inference tier
 *
 * Tier C is the only tier built on inference, and it is usable only because
 * four cheap negative signals remove the failure classes the positive signals
 * cannot distinguish. Applying them moved every known-bad pair out of the top
 * 150 while keeping every known-good pair inside the top 40.
 */
import { TIERS, tierRank } from "../../src/core/equivalenceTiers.js";
export { TIERS } from "../../src/core/equivalenceTiers.js";

/** Minimum distinct downstream courses asserting a prereq-OR for tier C. */
export const TIER_C_MIN_EVIDENCE = 5;

/**
 * Minimum title-stem overlap for tier C — the fix for choice pools.
 *
 * Prereq-`OR` evidence cannot by itself tell an equivalence from a *menu*. NEU
 * gates many courses on "any one social science", which the parser sees as
 * `ANTH 1101 Or SOCL 1101 Or POLS 1160 Or WMNS 1103 Or CRIM 1100 Or HUSV 1101`
 * — eight subjects, 20–32 downstream courses each, easily clearing the
 * evidence threshold. Same for "any intro statistics"
 * (`MGSC 2301 / PSYC 2320 / ENVR 2500 / MATH 3081`).
 *
 * Group *size* is the wrong discriminator: it rejects the ENGW first-year
 * writing family, six genuine alternatives attested by 224 courses. The right
 * one is semantic — **a pool is a menu of different things, an equivalence is
 * the same thing packaged differently**, and that difference is legible in the
 * title. "Peoples and Cultures" vs "Introduction to Sociology" share nothing;
 * "Physics for Engineering 1" vs "Physics 1" share their whole stem.
 *
 * Measured at 0.6: keeps every PHYS/CHEM/ENGW/SCHM pair, drops the entire
 * social-science and statistics pools, and also drops `FINA 3301` /
 * `FINA 3303` (Corporate Finance vs Investments) and `SPNS 2102` /
 * `SPNS 3102` — a sequence whose matching "2" suffixes defeat `seqNum`.
 */
export const TIER_C_MIN_STEM = 0.6;

/**
 * Identical-description clusters above this size are administrative
 * boilerplate, not cross-listings. Measured: the largest clusters are
 * "Project" (30 courses), "Research" (29), "Junior/Senior Honors Project 2"
 * (20) and "Co-op Work Experience - Half-Time" (19) — every subject gets a
 * shell course with the same text. Genuine cross-listings come in twos and
 * threes (`INTL 5100` / `PPUA 5100`, `ALY 5000` / `ALY 6000`).
 */
export const MAX_CROSSLIST_CLUSTER = 3;

// ═══════════════════════════════════════════════════════════════════
// TEXT HELPERS — pure, dependency-free, unit-testable
// ═══════════════════════════════════════════════════════════════════

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4 };

/** Words that carry no distinguishing meaning in a course title. */
const STOP = new Set([
  "for", "of", "and", "the", "in", "to", "a", "an", "with", "on",
  "introduction", "intro",
]);

/**
 * The sequence position a title advertises, or null.
 *
 * Must match mid-title, not just at the end: "Introduction to Legal Studies 1:
 * Law and Legal Reasoning" carries its `1` before a colon, and an end-anchored
 * match returns null there — which is exactly how `LS 6101 ⇄ LS 6102` reached
 * rank 11 with a perfect title score before this was fixed.
 */
export function seqNum(title) {
  const t = String(title || "").toLowerCase().trim();
  const d = t.match(/(?:^|[\s:—–-])(\d)(?=$|[\s:—–-])/);
  if (d) return +d[1];
  const r = t.match(/(?:^|\s)(i{1,3}|iv)(?=$|[\s:—–-])/);
  return r ? ROMAN[r[1]] : null;
}

/**
 * Distinguishing words in a title.
 *
 * Sequence numerals are dropped from the *stem* so that "Physics 1" and
 * "Physics for Engineering 1" share it — but they are compared separately via
 * `seqNum`, because stripping them without comparing them is what makes
 * "Legal Studies 1" and "Legal Studies 2" look identical.
 */
export function titleStem(title) {
  return new Set(
    String(title || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter(w => w && !STOP.has(w) && !/^\d$/.test(w) && !(w in ROMAN))
  );
}

/** Overlap of the smaller stem into the larger — asymmetric on purpose, so
 *  "Organic Chemistry 2" ⊂ "Organic Chemistry 2 for Chemistry Majors" scores 1. */
export function stemContainment(titleA, titleB) {
  const A = titleStem(titleA), B = titleStem(titleB);
  if (!A.size || !B.size) return 0;
  let hits = 0;
  for (const w of A) if (B.has(w)) hits++;
  return hits / Math.min(A.size, B.size);
}

export function jaccard(a, b) {
  if (!a?.size || !b?.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}



/**
 * What part a course plays in its bundle.
 *
 * NEU splits a science course into separately-registered components and encodes
 * the part in the **units digit**, with the tens digit selecting the variant:
 *
 *     PHYS 115x — "for Engineering"      PHYS 116x — standard
 *       1151 lecture   1152 lab            1161 lecture   1162 lab
 *       1153 seminar                       1163 recitation
 *
 * So role is what makes a pair comparable at all: `1162 ⇄ 1152` is lab-for-lab
 * and valid, while `1152 ⇄ 1161` is lab-against-lecture and never valid. An
 * earlier version vetoed *any* pair touching a companion, which correctly killed
 * `PSYC 2315 ⇄ PSYC 2320` but also made the lab and recitation rows of a
 * sequence substitution impossible to express.
 */
export function courseRole(title) {
  const t = String(title || "").trim();
  if (/^(?:lab|laboratory)\b/i.test(t)) return "lab";
  if (/^recitation\b/i.test(t)) return "recitation";
  if (/^(?:interactive learning )?seminar\b/i.test(t)) return "seminar";
  if (/^studio\b/i.test(t)) return "studio";
  if (/\bsupplement\b/i.test(t)) return "supplement";
  return "lecture";
}

/**
 * The slot a role occupies in a bundle.
 *
 * Variants of the same course label their third component differently —
 * `PHYS 1163` is "Recitation for PHYS 1161" while its engineering counterpart
 * `PHYS 1153` is "Interactive Learning Seminar for PHYS 1151". They are the
 * same slot and must line up, so matching happens on the slot rather than the
 * word; requiring exact roles silently dropped two rows of the physics
 * substitution table.
 */
export function roleSlot(role) {
  return role === "recitation" || role === "seminar" || role === "studio"
    ? "discussion"
    : role;
}

/**
 * The parent course a companion is attached to, read off its own title.
 *
 * Companion titles are formulaic — "Lab for PHYS 1151", "Recitation for
 * CHEM 1161", "Interactive Learning Seminar for PHYS 1155" — which lets a
 * proven lecture-level equivalence propagate down the bundle without needing
 * separate evidence for each part. Labs almost never appear in prereq `OR`
 * groups, so inference alone would never reach them.
 */
export function companionParent(title) {
  const m = /^(?:lab|laboratory|recitation|studio|interactive learning seminar)\s+for\s+([A-Z]{2,5}\s?\d{4})/i
    .exec(String(title || "").trim());
  if (!m) return null;
  const code = m[1].toUpperCase().replace(/([A-Z]+)\s?(\d+)/, "$1 $2");
  return code;
}

/**
 * How structurally aligned two course numbers are within one subject.
 *
 * Returns 0–1. The units digit agreeing means the two occupy the same slot in
 * their respective bundles (both lectures, or both labs); the hundreds agreeing
 * means they belong to the same family. This is what makes `1161 → 1151` rank
 * above `1161 → 1141` even when both co-occur: the numbering itself asserts a
 * component-by-component correspondence.
 */
export function numericAffinity(a, b) {
  const [sa, na] = String(a).split(" ");
  const [sb, nb] = String(b).split(" ");
  if (sa !== sb) return 0;
  const x = parseInt(na, 10), y = parseInt(nb, 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  let score = 0;
  if (x % 10 === y % 10) score += 0.5;                              // same slot
  if (Math.floor(x / 100) === Math.floor(y / 100)) score += 0.3;    // same family
  const tens = Math.abs(Math.floor((x % 100) / 10) - Math.floor((y % 100) / 10));
  if (tens > 0 && tens <= 2) score += 0.2 / tens;                   // adjacent variant
  return Math.min(1, score);
}

/**
 * An administrative container rather than a course with content.
 *
 * Every subject gets its own copy of these, all sharing one boilerplate
 * description, which makes them look like cross-listings of each other: the
 * identical-description pass produced `ALY 2983 ⇄ ALY 3983 ⇄ ALY 4983`
 * ("Topics"), `BIOL 8984 ⇄ BIOL 9984` ("Research") and
 * `CS 4970 ⇄ CY 4970 ⇄ DS 4970` ("Junior/Senior Honors Project 1"). None of
 * those is a substitution — you take the shell belonging to your own subject
 * and level, and the registrar treats them as distinct.
 *
 * Cluster size alone does not catch these, because the same-subject variants
 * come in twos and threes, well under `MAX_CROSSLIST_CLUSTER`.
 */
export function isGenericShell(title) {
  const t = String(title || "").trim();
  return /^(?:special\s+)?topics\b/i.test(t) ||
         /^(?:research|project|elective|thesis|dissertation|practicum|capstone)\b/i.test(t) ||
         /^(?:directed|independent)\s+study\b/i.test(t) ||
         /^(?:co-?op|internship)\s+(?:work\s+)?experience\b/i.test(t) ||
         /\b(?:continuation|honors project)\b/i.test(t) ||
         /^transfer credit\b/i.test(t);
}

/**
 * Does this pair straddle the undergraduate / graduate boundary?
 *
 * NEU numbers graduate work at 5000 and above. An identical description across
 * that line is a dual-level listing with different expectations, not an
 * interchangeable pair — `COP 3945` / `COP 6945` ("Co-op Work Experience") and
 * `COMM 4605` / `COMM 6605` are the same text at two degree levels.
 */
export function crossesGradBoundary(a, b) {
  const na = parseInt(String(a).split(" ")[1], 10);
  const nb = parseInt(String(b).split(" ")[1], 10);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return (na < 5000) !== (nb < 5000);
}

// ═══════════════════════════════════════════════════════════════════
// SIGNAL 1 — explicit equivalence stated in a course description
// ═══════════════════════════════════════════════════════════════════

/**
 * Statement forms, and the direction each implies.
 *
 * `counts as` is directional and usually scoped: five business courses share
 * one formula — "Does not count as credit for business majors. Counts as
 * ACCT 1201 for business minors only." The scope clause is the point. Note
 * `INTB 1209` states `INTB 1203`, not `INTB 1201`, so the "…09 minus 8"
 * numbering convention would confidently produce the wrong target: the
 * statement is authoritative and the convention is only a prior.
 */
const STATEMENT_FORMS = [
  { kind: "counts-as",   re: /counts?\s+(?:as|for|toward)\s+(?:credit\s+)?(?:as\s+)?([A-Z]{2,5}\s?\d{4})/g, directed: true },
  { kind: "cross-list",  re: /cross-?listed\s+(?:with|as)\s+([A-Z]{2,5}\s?\d{4})/g,                          directed: false },
  { kind: "equivalent",  re: /equivalent\s+(?:to|of)\s+([A-Z]{2,5}\s?\d{4})/g,                                directed: false },
  { kind: "same-as",     re: /\bsame\s+as\s+([A-Z]{2,5}\s?\d{4})/g,                                          directed: false },
  { kind: "identical",   re: /identical\s+(?:to|with)\s+([A-Z]{2,5}\s?\d{4})/g,                              directed: false },
  { kind: "replaces",    re: /\breplaces?\s+([A-Z]{2,5}\s?\d{4})/g,                                          directed: true },
];

/** Trailing scope clause, e.g. "for business minors only". */
const SCOPE_RE = /\bfor\s+([a-z][a-z\s]{2,40}?)\s+(?:only|students)\b/i;

/**
 * Parse equivalence statements out of one course's description.
 *
 * Returns `[{ target, kind, directed, scope, excludes, text }]`.
 *
 * The regexes are case-insensitive on the *phrase* but the course code must be
 * uppercase in the source, so prose like "counts as chemistry 1211" is not
 * mistaken for a code. (An earlier version applied no `/i` flag at all and
 * matched **zero** statements, because every real one begins a sentence —
 * "Counts as ACCT 1201".)
 */
export function parseStatedEquivalences(courseId, description) {
  const text = String(description || "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  // "Does not count as credit for business majors" — a negative scope that
  // rides alongside the positive statement and must be carried with it.
  const excludes = /does not count as credit for ([a-z][a-z\s]{2,40}?)(?:\.|,|;|$)/i.exec(text)?.[1]?.trim() ?? null;

  const out = [];
  for (const { kind, re, directed } of STATEMENT_FORMS) {
    const rx = new RegExp(re.source, "gi");
    let m;
    while ((m = rx.exec(text))) {
      const raw = m[1];
      if (raw !== raw.toUpperCase()) continue;                 // must be a real code
      const target = raw.replace(/([A-Z]+)\s?(\d+)/, "$1 $2");
      if (target === courseId) continue;
      const tail = text.slice(m.index, m.index + 120);
      out.push({
        target,
        kind,
        directed,
        scope: SCOPE_RE.exec(tail)?.[1]?.trim() ?? null,
        excludes,
        text: text.slice(Math.max(0, m.index - 70), m.index + 90).trim(),
      });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// VETOES — the negative signals that make tier C usable
// ═══════════════════════════════════════════════════════════════════

/**
 * Reasons a pair cannot be an equivalence, checked in order of confidence.
 * Each returns a reason string or null. A vetoed pair is never tier C; it can
 * still surface in search as tier D, because "related course" is a useful
 * answer even when "interchangeable" is the wrong one.
 */
export function findVetoes(pair, ctx) {
  const { a, b } = pair;
  const { titleOf = {}, creditsOf = {}, prereqEdges = new Set() } = ctx;
  const out = [];

  // 1. One is a prerequisite of the other → a sequence, not a choice.
  if (prereqEdges.has(`${a}→${b}`) || prereqEdges.has(`${b}→${a}`)) out.push("sequence-prereq");

  // 2. Titles advertise different sequence positions ("…1" vs "…2").
  const sa = seqNum(titleOf[a]), sb = seqNum(titleOf[b]);
  if (sa != null && sb != null && sa !== sb) out.push("sequence-number");

  // 3. Different roles in the bundle — a lab cannot stand in for a lecture.
  //    Same role is fine and necessary: "Lab for PHYS 1151" ⇄ "Lab for
  //    PHYS 1161" is exactly the lab row of a sequence substitution.
  const ra = courseRole(titleOf[a]), rb = courseRole(titleOf[b]);
  if (roleSlot(ra) !== roleSlot(rb)) out.push("role-mismatch");
  else if (ra === "supplement") out.push("supplement-pair");

  // 4. Credit ratio ≤ ½ — a 1 SH supplement does not replace a 4 SH course.
  //    Compared over the whole **bundle** where the caller supplies it: PHYS
  //    1151 is 3 SH beside PHYS 1161's 4 SH, which looks like a mismatch until
  //    the lab is counted (3+1+1 = 5 against 4+1+0 = 5). Comparing the bare
  //    lecture credits docked a genuine pair for a packaging artefact.
  const ca = ctx.bundleCreditsOf?.[a] ?? creditsOf[a];
  const cb = ctx.bundleCreditsOf?.[b] ?? creditsOf[b];
  if (Number.isFinite(ca) && Number.isFinite(cb) && ca > 0 && cb > 0) {
    const hi = Math.max(ca, cb), lo = Math.min(ca, cb);
    if (lo / hi <= 0.5) out.push("credit-mismatch");
  }

  // 5. Administrative shells share boilerplate across every subject and level.
  if (isGenericShell(titleOf[a]) || isGenericShell(titleOf[b])) out.push("generic-shell");

  // 6. Undergraduate ↔ graduate is a different degree level, never a swap.
  if (crossesGradBoundary(a, b)) out.push("grad-boundary");

  return out;
}

// ═══════════════════════════════════════════════════════════════════
// SCORING + TIERING
// ═══════════════════════════════════════════════════════════════════

/** Weights for the ordering score. Tiering is decided separately, by evidence
 *  kind — this only ranks results *within* a tier. */
const WEIGHTS = {
  programs:    34,   // signal 6, log-saturating
  prereqOr:    26,   // signal 4, log-saturating
  stem:        18,   // title overlap
  numeric:     14,   // structural alignment of the course numbers
  gateOverlap: 10,   // the rejected signal, demoted to a weak term
  creditsEq:    6,
  sameSubject:  5,
  levelEq:      3,
  nuPath:       5,
  seqAgree:     7,
};

const sat = (n, ceil) => (n > 0 ? Math.min(1, Math.log10(1 + n) / Math.log10(1 + ceil)) : 0);

/** Sum of all weights — the score is normalised against this so it reads 0–100. */
const WEIGHT_TOTAL = Object.values(WEIGHTS).reduce((s, w) => s + w, 0);

/**
 * Which vetoes invalidate which tier.
 *
 * Tiers A and B differ in kind from C: A is a choice the catalog publishes and
 * B is a statement about the catalog, so an *inference* veto has no standing
 * against them — if a program lists `OR(COOP 3945, COOP 3948)`, that is a real
 * choice regardless of the pair looking like a shell to us.
 *
 * The two structural vetoes are different. Tier B is itself inferred, from
 * identical description text, and both `generic-shell` and `grad-boundary`
 * describe exactly the way that inference goes wrong — boilerplate shared
 * across subjects and levels. So they demote B as well as C. Neither touches a
 * pair backed by an explicit statement or a published program choice.
 */
const STRUCTURAL_VETOES = new Set(["generic-shell", "grad-boundary"]);

/**
 * Score and tier one candidate pair.
 *
 * @param pair    { a, b } course ids, `a` < `b` lexically
 * @param ev      evidence: { programs, prereqOr, stated, crossListCluster, numbering, gateOverlap, nuPathOverlap }
 * @param ctx     { titleOf, creditsOf, prereqEdges }
 * @returns       { tier, score, vetoes, offer, approval, reasons }
 */
export function classifyPair(pair, ev = {}, ctx = {}) {
  const { a, b } = pair;
  const { titleOf = {}, creditsOf = {} } = ctx;
  const vetoes = findVetoes(pair, ctx);

  const stem = stemContainment(titleOf[a], titleOf[b]);
  const sameSubject = a.split(" ")[0] === b.split(" ")[0];
  const levelEq = Math.floor(parseInt(a.split(" ")[1], 10) / 1000) ===
                  Math.floor(parseInt(b.split(" ")[1], 10) / 1000);
  const creditsEq = Number.isFinite(creditsOf[a]) && Number.isFinite(creditsOf[b]) &&
                    creditsOf[a] === creditsOf[b];
  const sa = seqNum(titleOf[a]), sb = seqNum(titleOf[b]);

  let score = 0;
  score += sat(ev.programs ?? 0, 60) * WEIGHTS.programs;
  score += sat(ev.prereqOr ?? 0, 25) * WEIGHTS.prereqOr;
  score += stem * WEIGHTS.stem;
  score += numericAffinity(a, b) * WEIGHTS.numeric;
  score += (ev.gateOverlap ?? 0) * WEIGHTS.gateOverlap;
  score += (ev.nuPathOverlap ?? 0) * WEIGHTS.nuPath;
  if (creditsEq) score += WEIGHTS.creditsEq;
  if (sameSubject) score += WEIGHTS.sameSubject;
  if (levelEq) score += WEIGHTS.levelEq;
  if (sa != null && sb != null && sa === sb) score += WEIGHTS.seqAgree;

  // ── tier by evidence KIND, not by score ─────────────────────────
  //
  // The tier returned here is deliberately **program-agnostic**: it answers
  // "what can we say to a student whose program does not publish this choice?"
  // Program membership is a runtime *upgrade* to tier A, applied by the caller
  // against the active program — see `resolveTier`.
  //
  // Tiering on `ev.programs` directly was the first design and it was wrong.
  // Measured: 2,536 of 3,525 program-backed pairs are published by exactly ONE
  // program, so a global tier A would tell a chemical engineering student "your
  // program accepts either" for `PHYS 1155 ⇄ PHYS 1165` on the authority of the
  // science writing minor. The pair is still worth showing that student — 17
  // courses accept either as a prerequisite — but as tier C, with the approval
  // flag, not as a published entitlement.
  const reasons = [];
  let tier = "D";

  if (ev.footnote) {
    // A program footnote is the department stating the rule in its own words —
    // the same standing as any other catalog statement, and not inference.
    tier = "A";
    reasons.push("stated in a program footnote");
  } else if (ev.stated) {
    tier = ev.stated.kind === "cross-list" ? "B" : "A";
    reasons.push(`catalog states: ${ev.stated.kind}`);
  } else if (ev.crossListCluster && ev.crossListCluster <= MAX_CROSSLIST_CLUSTER) {
    tier = "B";
    reasons.push("identical description and title");
  } else if ((ev.prereqOr ?? 0) >= TIER_C_MIN_EVIDENCE && vetoes.length === 0 &&
             stem >= TIER_C_MIN_STEM) {
    tier = "C";
    reasons.push(`${ev.prereqOr} courses accept either as a prerequisite`);
  } else if ((ev.prereqOr ?? 0) >= TIER_C_MIN_EVIDENCE && vetoes.length === 0) {
    reasons.push(`${ev.prereqOr} courses accept either, but the titles are unrelated ` +
                 `(stem ${stem.toFixed(2)} < ${TIER_C_MIN_STEM}) — likely a choice pool`);
  } else if ((ev.prereqOr ?? 0) > 0) {
    reasons.push(`${ev.prereqOr} course${ev.prereqOr === 1 ? "" : "s"} accept either`);
  }

  // Apply the vetoes according to what each tier's claim rests on.
  const structural = vetoes.filter(v => STRUCTURAL_VETOES.has(v));
  const stated = Boolean(ev.stated) || (ev.programs ?? 0) > 0;
  if (tier === "C" && vetoes.length) tier = "D";
  if (tier === "B" && structural.length && !stated) tier = "D";
  if (vetoes.length) reasons.push(`vetoed: ${vetoes.join(", ")}`);
  if (ev.numbering && tier !== "D") reasons.push("parallel course numbering");
  if ((ev.programs ?? 0) > 0) {
    reasons.push(`${ev.programs} program${ev.programs === 1 ? "" : "s"} publish this choice`);
  }

  return {
    tier,
    score: Math.round((score / WEIGHT_TOTAL) * 1000) / 10,   // 0–100
    vetoes,
    offer: TIERS[tier].offer,
    approval: TIERS[tier].approval,
    reasons,
    /** True when at least one program publishes the choice — the upgrade key. */
    programBacked: (ev.programs ?? 0) > 0,
  };
}



/** Sort comparator: strongest tier first, then score, then id for stability. */
export function comparePairs(x, y) {
  const t = tierRank(x.tier) - tierRank(y.tier);
  if (t !== 0) return t;
  if (y.score !== x.score) return y.score - x.score;
  return `${x.a} ${x.b}`.localeCompare(`${y.a} ${y.b}`);
}

/** Canonical, order-independent key for a pair. */
export function pairKey(a, b) {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}
