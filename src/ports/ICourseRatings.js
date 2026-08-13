// ═══════════════════════════════════════════════════════════════════
// PORT: ICourseRatings
// First-party workload and difficulty — what students who took a course
// reported about it, and how this app submits one more such report.
//
// ── Why this port is deliberately lopsided ─────────────────────────
// Reads and writes do NOT share a transport, and that asymmetry is the
// feature's main privacy control rather than an implementation detail:
//
//   read   a static aggregate file, recomputed on the data pipeline's
//          schedule and served like every other catalog sidecar. The
//          browser never queries anything per-user, so there is no read
//          path to leak and no read-side auth to get wrong.
//   write  a single fire-and-forget submission, anonymous, unauthenticated.
//
// The schedule is the point. A LIVE aggregate leaks individuals by
// differencing: watch a course go from n=7, mean=3.20 to n=8, mean=3.30
// and the eighth person's exact answer falls out. Recomputing in batches
// collapses the time resolution so there is nothing to difference.
//
// ── What an implementation must never do ───────────────────────────
//   · never send a grade. Grades are a PRIVATE_FIELDS entry and stay on
//     the device; the review UI writes them to local plan state only.
//   · never attach an account, device or session id to a submission.
//     Deduplication uses a per-course token derived from a device-local
//     secret, so rows for one person across different courses cannot be
//     linked back together — by anyone, including whoever holds the
//     database.
//   · never record a wall-clock timestamp. Five ratings submitted in one
//     sitting are correlated by time, and a distinctive combination of
//     courses re-identifies a person even without ids. Term granularity
//     is the resolution; anything finer is a leak.
//   · never expose a figure that publicView() withheld. The disclosure
//     floors live in src/core/courseRatings.js and are not this layer's
//     to reinterpret.
//   · never submit anything unless the user has explicitly consented.
//     Consent is three-state (unasked / off / on) and only "on" permits
//     a send; "unasked" is not a yes.
//
// ── Requirements a SERVER implementation must meet ─────────────────
// These are not covered by anything in src/, because the code that would
// violate them does not exist yet. They are written here so that the
// backend cannot be built without meeting them — each one, if missed,
// silently undoes a guarantee the client works hard to provide.
//
//   1. NO REQUEST LOGGING AGAINST A RATING. The per-course tokens make
//      one person's ratings unlinkable; an access log pairing IP and
//      timestamp with each row re-links them completely and defeats the
//      entire design. Rating writes must be excluded from request logs,
//      and no IP may be stored, hashed or otherwise, alongside a rating.
//
//   2. DISPATCH MUST BE SPREAD OVER TIME. independentSubmissions()
//      splits and shuffles a batch, but thirty requests arriving inside
//      two seconds from one address are trivially regrouped, and a full
//      course history identifies a person better than a name. Sends must
//      be jittered, and a retrospective batch spread over a long window.
//
//   3. AN ENROLMENT FLOOR, NOT ONLY A RESPONSE FLOOR. MIN_N_DISPLAY
//      guards against a small SAMPLE; it does nothing about a small
//      POPULATION. Five responses from a class of six means the raters
//      are nearly everyone, and a classmate can subtract themselves out.
//      Northeastern's own TRACE excludes sections under five students
//      for exactly this reason. Publication must additionally require
//      that the course's typical enrolment is comfortably above the
//      response count — the offering data needed for this is already in
//      offering-summary.json.
//
//   4. PUBLISH THROUGH ratchetPublication(). Recomputing an aggregate
//      and shipping it every cycle leaks an individual by subtraction
//      across two updates; see the note on the ratchet in
//      src/core/courseRatings.js. The published file must carry the
//      HELD figure, not the freshly computed one.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const ICourseRatings = "courseRatings";

/**
 * @typedef {Object} RatingDraft
 * What the review UI collects for one course. Every field except
 * `courseId` is optional — an untouched row must never be submitted,
 * and a row answering one field is a legitimate partial response.
 *
 * @property {string}      courseId    - catalog id, e.g. "CS 3000"
 * @property {string|null} [instructor] - who taught it, when known. Left
 *                                        null when the term had several
 *                                        and the student did not pick;
 *                                        the rating still counts toward
 *                                        the course, just not a professor.
 * @property {number|null} [difficulty] - integer 1–5
 * @property {number|null} [hours]      - integer 0–25 total hours per week,
 *                                        where 25 means "25 or more"
 */

/**
 * @typedef {Object} ICourseRatings
 *
 * Reading — from the published aggregate, already passed through the
 * disclosure floors. Callers render what they are given and never
 * recompute a hidden quantity.
 *
 * @property {(courseId: string) => import('../core/courseRatings.js').PublicView|null}
 *   getCourseRating - Aggregate across every instructor of a course.
 *                     null when the course has no published figure at all.
 *
 * @property {(courseId: string, instructor: string) =>
 *            import('../core/courseRatings.js').PublicView|null}
 *   getInstructorRating - Aggregate for one course-and-instructor pair.
 *                     Usually crosses the disclosure floor much later than
 *                     the course-level figure, and often never — callers
 *                     must treat null as the normal case, not an error.
 *
 * Writing
 *
 * @property {(termCode: string, drafts: RatingDraft[]) => Promise<{ok: boolean}>}
 *   submit - Send one term's reports. Resolves ok:false rather than
 *            throwing: a failed submission must never cost the user the
 *            grades they entered in the same form.
 *
 * @property {(termCode: string) => boolean}
 *   hasReviewed - Whether this device already submitted for this term.
 *            Device-local, so it survives no better than localStorage —
 *            which is the right trade. It exists to stop nagging, not to
 *            enforce one-per-person, and must never be sent to a server.
 *
 * @property {() => import('./IAttributable.js').SourceInfo[]} getSources
 *   External data sources this adapter draws from. See IAttributable.
 */
