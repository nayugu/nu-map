// ═══════════════════════════════════════════════════════════════════
// SMART BANNER OFFERINGS SYSTEM
// Modular term classifier + intelligent data-rich term detection.
//
// Term code anatomy (Northeastern Banner):
//   YYYY  SS
//   2025  10  → Fall 2024 Semester        (academic year starts in fall)
//   2025  30  → Spring 2025 Semester
//   2025  40  → Summer 1 2025 Semester
//   2025  50  → Summer Full 2025 Semester (or generic "Summer" when no 1/2 split)
//   2025  60  → Summer 2 2025 Semester
//
// Excluded by default: CPS Quarter/Semester, Law Semester, Winter CPS
// ═══════════════════════════════════════════════════════════════════

import { SEMESTER_TYPES } from "../core/constants.js";

const BANNER_BASE = "https://nubanner.neu.edu/StudentRegistrationSsb/ssb";
const DELAY_MS = 200;
const MIN_COURSES_THRESHOLD = 50;

// ── Term Classification Rules ────────────────────────────────────────────
// Each rule is checked in order. First matching rule wins.
// `exclude: true` means the term is skipped entirely.
// `type` maps to a SEMESTER_TYPES key.
//
// To add new term types in the future, just add a rule here.
// ─────────────────────────────────────────────────────────────────────────

const TERM_CLASSIFICATION_RULES = [
  // ── Exclusions (checked first by description pattern) ──────────────
  { descPattern: /CPS/i,  exclude: true, reason: "CPS term" },
  { descPattern: /Law/i,  exclude: true, reason: "Law term" },

  // ── Suffix-based classification ────────────────────────────────────
  // These match the last 2 digits of the term code.
  // Description patterns are optional secondary checks for safety.
  { suffix: "10", type: "fall",    descPattern: /Fall/i },
  { suffix: "30", type: "spring",  descPattern: /Spring/i },
  { suffix: "40", type: "sumA",    descPattern: /Summer\s*1/i },
  { suffix: "60", type: "sumB",    descPattern: /Summer\s*2/i },
  // Suffix 50 covers both "Summer Full" and generic "Summer" (no 1/2 split)
  { suffix: "50", type: "sumFull", descPattern: /Summer/i },
];

// Display-friendly labels for each semester type
const SEMESTER_LABELS = {
  fall:    "Fall",
  spring:  "Spring",
  sumA:    "Summer 1",
  sumFull: "Summer Full",
  sumB:    "Summer 2",
};

// Preferred order for display and iteration
const SEMESTER_ORDER = ["fall", "spring", "sumA", "sumFull", "sumB"];

// ── Classifier ───────────────────────────────────────────────────────────

/**
 * Classify a single Banner term into a semester type.
 * @param {string} code  - e.g. "202540"
 * @param {string} desc  - e.g. "Summer 1 2025 Semester (View Only)"
 * @returns {{ type: string, excluded: boolean, reason?: string } | null}
 */
function classifyTerm(code, desc) {
  const suffix = code.slice(-2);

  for (const rule of TERM_CLASSIFICATION_RULES) {
    // Check description-based exclusions first
    if (rule.exclude && rule.descPattern && rule.descPattern.test(desc)) {
      return { type: null, excluded: true, reason: rule.reason };
    }

    // Check suffix match
    if (rule.suffix && rule.suffix === suffix) {
      // Optional description safety check — if provided and doesn't match, skip
      // (handles hypothetical future suffix reuse)
      if (rule.descPattern && !rule.descPattern.test(desc)) continue;
      return { type: rule.type, excluded: false };
    }
  }

  // Unknown term — don't crash, just skip
  return { type: null, excluded: true, reason: `unknown suffix ${suffix}` };
}

/**
 * Classify all terms and group by semester type, newest first.
 * @param {Array<{code: string, description: string}>} allTerms
 * @returns {Record<string, Array<{code: string, description: string, year: number}>>}
 */
function classifyAndGroupTerms(allTerms) {
  const groups = {};
  for (const st of SEMESTER_ORDER) groups[st] = [];

  for (const term of allTerms) {
    const result = classifyTerm(term.code, term.description);
    if (!result || result.excluded || !result.type) continue;

    // Extract academic year from the first 4 digits
    const year = parseInt(term.code.slice(0, 4), 10);

    groups[result.type].push({
      code: term.code,
      description: term.description,
      year,
    });
  }

  // Sort each group newest-first (higher code = more recent)
  for (const st of SEMESTER_ORDER) {
    groups[st].sort((a, b) => parseInt(b.code) - parseInt(a.code));
  }

  return groups;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN CLASS
// ═══════════════════════════════════════════════════════════════════

export class SmartBannerOfferingsSystem {
  constructor() {
    this.sessionCookies = null;
  }

  // ── Expose the classifier utilities for the server to use ──────
  static classifyTerm = classifyTerm;
  static classifyAndGroupTerms = classifyAndGroupTerms;
  static SEMESTER_ORDER = SEMESTER_ORDER;
  static SEMESTER_LABELS = SEMESTER_LABELS;

  /**
   * Get all available terms, classify them, and select the most recent
   * data-rich term for each semester type.
   *
   * @returns {Record<string, {termCode, termName, termDescription, totalCourses, totalSubjects}>}
   */
  async getSmartTermSelection() {
    const allTerms = await this.getAllTerms();
    const grouped = classifyAndGroupTerms(allTerms);
    const smartTerms = {};

    for (const semType of SEMESTER_ORDER) {
      const candidates = grouped[semType];
      if (!candidates.length) {
        console.warn(`❌ No ${SEMESTER_LABELS[semType] || semType} terms found in Banner`);
        continue;
      }

      // Try each candidate (newest first) until we find one with enough data
      for (const candidate of candidates) {
        const probe = await this.testTermDataRichness(candidate.code);

        if (probe.totalCourses >= MIN_COURSES_THRESHOLD) {
          smartTerms[semType] = {
            termCode: candidate.code,
            termName: this.formatTermName(candidate.description),
            termDescription: candidate.description,
            totalCourses: probe.totalCourses,
            totalSubjects: probe.totalSubjects,
          };
          console.log(`✅ ${SEMESTER_LABELS[semType]}: ${candidate.code} (~${probe.totalCourses} courses)`);
          break;
        } else {
          console.log(`⚠️  ${SEMESTER_LABELS[semType]} ${candidate.code}: only ${probe.totalCourses} courses (skipping)`);
        }
      }

      if (!smartTerms[semType]) {
        console.warn(`❌ No data-rich ${SEMESTER_LABELS[semType]} term found`);
      }
    }

    return smartTerms;
  }

  /**
   * Test if a term has substantial course data by sampling subjects.
   */
  async testTermDataRichness(termCode) {
    try {
      await this.declareTermInterest(termCode);
      const subjects = await this.getSubjectsForTerm(termCode);

      const sampleSize = Math.min(5, subjects.length);
      if (sampleSize === 0) return { totalCourses: 0, totalSubjects: 0 };

      const sampleSubjects = subjects.slice(0, sampleSize);
      let totalSampleCourses = 0;

      for (const subject of sampleSubjects) {
        const courses = await this.searchCourses(termCode, subject.code, "", 500);
        totalSampleCourses += courses.length;
        await this.delay();
      }

      const estimatedTotal = Math.round((totalSampleCourses / sampleSize) * subjects.length);

      return {
        totalCourses: estimatedTotal,
        totalSubjects: subjects.length,
        actualSampleSize: sampleSize,
        sampleCourses: totalSampleCourses,
      };
    } catch (error) {
      console.warn(`Error testing term ${termCode}:`, error.message);
      return { totalCourses: 0, totalSubjects: 0 };
    }
  }

  /**
   * Get comprehensive course offerings organized by semester.
   * (Used by the CLI script; the server endpoint drives its own loop for SSE streaming.)
   */
  async getComprehensiveOfferings() {
    console.log("🔍 Finding data-rich terms...");
    const smartTerms = await this.getSmartTermSelection();

    if (Object.keys(smartTerms).length === 0) {
      throw new Error("No data-rich terms found for any semester type");
    }

    console.log(`📅 Processing ${Object.keys(smartTerms).length} data-rich semesters...`);

    const offeringsBySemester = {};

    for (const [semType, termInfo] of Object.entries(smartTerms)) {
      console.log(`\n🔄 Processing ${SEMESTER_LABELS[semType] || semType}: ${termInfo.termName} (${termInfo.termCode})`);

      try {
        await this.declareTermInterest(termInfo.termCode);
        const subjects = await this.getSubjectsForTerm(termInfo.termCode);

        console.log(`  Found ${subjects.length} subjects to process...`);

        const semesterData = {
          termCode: termInfo.termCode,
          termName: termInfo.termName,
          termDescription: termInfo.termDescription,
          totalSubjects: subjects.length,
          courses: {},
          stats: { totalCourses: 0, subjectsCompleted: 0, errors: 0 },
        };

        for (let i = 0; i < subjects.length; i++) {
          const subject = subjects[i];
          try {
            console.log(`  [${i + 1}/${subjects.length}] Fetching ${subject.code}...`);
            const courses = await this.searchCourses(termInfo.termCode, subject.code, "", 500);

            if (courses.length > 0) {
              semesterData.courses[subject.code] = courses.map(c => this.normalizeCourse(c));
              semesterData.stats.totalCourses += courses.length;
            }

            semesterData.stats.subjectsCompleted++;
            await this.delay();
          } catch (error) {
            console.warn(`    ❌ Error fetching ${subject.code}: ${error.message}`);
            semesterData.stats.errors++;
          }
        }

        offeringsBySemester[semType] = semesterData;
        console.log(`  ✅ ${SEMESTER_LABELS[semType]} complete: ${semesterData.stats.totalCourses} courses`);
      } catch (error) {
        console.error(`❌ Failed to process ${SEMESTER_LABELS[semType]}:`, error.message);
      }
    }

    return offeringsBySemester;
  }

  /**
   * Normalize a raw Banner course object into our standard shape.
   */
  normalizeCourse(c) {
    return {
      subject:       c.subject,
      number:        c.courseNumber,
      title:         c.courseTitle,
      crn:           c.courseReferenceNumber,
      credits:       c.creditHourLow || c.creditHours || 4,
      sections:      1,
      instructor:    c.faculty?.[0]?.displayName || "TBA",
      enrollment:    c.enrollment || 0,
      maxEnrollment: c.maximumEnrollment || 0,
      scheduleType:  c.scheduleTypeDescription || "Lecture",
    };
  }

  /**
   * Compare current vs previous offerings and organize by semester.
   */
  compareOfferingsBySemester(previousBySemester, currentBySemester) {
    const changes = { totalChanges: 0, bySemester: {} };

    for (const [semType, currentSem] of Object.entries(currentBySemester)) {
      const previousSem = previousBySemester?.[semType];

      if (!previousSem) {
        changes.bySemester[semType] = {
          termName: currentSem.termName,
          termCode: currentSem.termCode,
          type: "baseline",
          totalCourses: currentSem.stats.totalCourses,
          changes: { newly: 0, stopped: 0, modified: 0 },
          details: [],
        };
        continue;
      }

      const semesterChanges = this.compareSemesterCourses(
        previousSem.courses, currentSem.courses, semType
      );

      changes.bySemester[semType] = {
        termName: currentSem.termName,
        termCode: currentSem.termCode,
        type: "comparison",
        totalCourses: currentSem.stats.totalCourses,
        changes: semesterChanges.summary,
        details: semesterChanges.details,
        bySubject: semesterChanges.bySubject,
      };

      changes.totalChanges += semesterChanges.summary.newly
                            + semesterChanges.summary.stopped
                            + semesterChanges.summary.modified;
    }

    return changes;
  }

  /**
   * Compare courses within a specific semester.
   */
  compareSemesterCourses(previousCourses, currentCourses, semesterType) {
    const changes = {
      summary: { newly: 0, stopped: 0, modified: 0 },
      details: [],
      bySubject: {},
    };

    const flatten = (courses) => {
      const flat = new Map();
      for (const [subject, courseList] of Object.entries(courses || {})) {
        for (const course of courseList) {
          flat.set(`${course.subject} ${course.number}`, { ...course, subject });
        }
      }
      return flat;
    };

    const prevFlat = flatten(previousCourses);
    const currFlat = flatten(currentCourses);

    const ensureSubject = (subj) => {
      if (!changes.bySubject[subj]) changes.bySubject[subj] = { newly: 0, stopped: 0, modified: 0 };
    };

    // Newly offered
    for (const [key, course] of currFlat) {
      if (!prevFlat.has(key)) {
        changes.summary.newly++;
        ensureSubject(course.subject);
        changes.bySubject[course.subject].newly++;
        changes.details.push({ type: "newly", semester: semesterType, course: key, subject: course.subject, data: course });
      }
    }

    // Stopped
    for (const [key, course] of prevFlat) {
      if (!currFlat.has(key)) {
        changes.summary.stopped++;
        ensureSubject(course.subject);
        changes.bySubject[course.subject].stopped++;
        changes.details.push({ type: "stopped", semester: semesterType, course: key, subject: course.subject, data: course });
      }
    }

    // Modified
    for (const [key, curr] of currFlat) {
      const prev = prevFlat.get(key);
      if (!prev) continue;

      const mods = [];
      if (prev.title !== curr.title)             mods.push({ field: "title", from: prev.title, to: curr.title });
      if (prev.credits !== curr.credits)         mods.push({ field: "credits", from: prev.credits, to: curr.credits });
      if (prev.scheduleType !== curr.scheduleType) mods.push({ field: "scheduleType", from: prev.scheduleType, to: curr.scheduleType });

      if (mods.length) {
        changes.summary.modified++;
        ensureSubject(curr.subject);
        changes.bySubject[curr.subject].modified++;
        changes.details.push({ type: "modified", semester: semesterType, course: key, subject: curr.subject, modifications: mods, data: curr });
      }
    }

    return changes;
  }

  // ═══════════════════════════════════════════════════════════════
  // Banner API helpers
  // ═══════════════════════════════════════════════════════════════

  async getAllTerms() {
    const res = await fetch(`${BANNER_BASE}/classSearch/getTerms?offset=1&max=100&searchTerm=`);
    if (!res.ok) throw new Error(`Failed to fetch terms: ${res.status}`);
    const cookies = res.headers.get("set-cookie");
    if (cookies) this.sessionCookies = cookies.split(";")[0];
    return await res.json();
  }

  async declareTermInterest(termCode) {
    const res = await fetch(`${BANNER_BASE}/term/search`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: this.sessionCookies || "" },
      body: `term=${termCode}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
    });
    if (!res.ok) throw new Error(`Failed to declare term interest: ${res.status}`);
    const cookies = res.headers.get("set-cookie");
    if (cookies) this.sessionCookies = cookies.split(";")[0];
    return await res.json();
  }

  async getSubjectsForTerm(termCode) {
    const res = await fetch(`${BANNER_BASE}/classSearch/get_subject?searchTerm=&term=${termCode}&offset=1&max=500`, {
      headers: { Cookie: this.sessionCookies || "" },
    });
    if (!res.ok) throw new Error(`Failed to fetch subjects for term ${termCode}: ${res.status}`);
    return await res.json();
  }

  async searchCourses(termCode, subjectCode, courseNumber = "", maxResults = 500) {
    const params = new URLSearchParams({
      txt_subject: subjectCode, txt_courseNumber: courseNumber, txt_term: termCode,
      startDatepicker: "", endDatepicker: "", pageOffset: "0",
      pageMaxSize: maxResults.toString(), sortColumn: "subjectDescription", sortDirection: "asc",
    });
    const res = await fetch(`${BANNER_BASE}/searchResults/searchResults?${params}`, {
      headers: { Cookie: this.sessionCookies || "" },
    });
    if (!res.ok) throw new Error(`Failed to search courses: ${res.status}`);
    const result = await res.json();
    if (!result.success) throw new Error(`Banner search failed for ${subjectCode} in term ${termCode}`);
    return result.data || [];
  }

  formatTermName(description) {
    return description.replace(/\s+(Semester|Quarter)(\s+\(View Only\))?$/i, "").trim();
  }

  async delay() {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}