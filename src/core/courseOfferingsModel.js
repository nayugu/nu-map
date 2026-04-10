// ═══════════════════════════════════════════════════════════════════
// COURSE OFFERINGS MODEL  (extends courseModel.js)
// Domain logic for working with current semester offerings
// ═══════════════════════════════════════════════════════════════════

// courseOfferingsModel: domain helpers for current semester offerings.

/**
 * Check if a course has current offering data.
 */
export function hasCurrentOfferings(course) {
  return !!(course.currentOfferings && typeof course.currentOfferings === 'object');
}

/**
 * Check if a course is currently offered in any semester.
 */
export function isCurrentlyOffered(course) {
  if (!hasCurrentOfferings(course)) return false;
  return Object.keys(course.currentOfferings).length > 0;
}

/**
 * Get list of semester types when a course is currently offered.
 * Returns array of semester type strings: ['fall', 'spring', 'sumA', 'sumB']
 */
export function getCurrentOfferings(course) {
  if (!hasCurrentOfferings(course)) return [];
  return Object.keys(course.currentOfferings);
}

/**
 * Check if a course is offered in a specific semester type.
 */
export function isOfferedInSemester(course, semesterType) {
  if (!hasCurrentOfferings(course)) return false;
  return !!(course.currentOfferings[semesterType]);
}

// Convenience functions for specific semesters
export const isOfferedInFall = (course) => isOfferedInSemester(course, 'fall');
export const isOfferedInSpring = (course) => isOfferedInSemester(course, 'spring');
export const isOfferedInSummerA = (course) => isOfferedInSemester(course, 'sumA');
export const isOfferedInSummerB = (course) => isOfferedInSemester(course, 'sumB');

/**
 * Get the semester types when a course is typically offered (from historical terms)
 * vs when it's currently offered (from currentOfferings).
 * Returns: { historical: string[], current: string[] }
 */
export function compareHistoricalVsCurrent(course) {
  const historical = course.terms ? 
    [...new Set(course.terms.map(t => {
      const code = typeof t === 'string' ? t : (t?.code ?? "");
      const ss = code.slice(-2);
      if (ss === "10") return "fall";
      if (ss === "30") return "spring"; 
      if (ss === "40") return "sumA";
      if (ss === "60") return "sumB";
      return null;
    }).filter(Boolean))] : [];
  
  const current = getCurrentOfferings(course);
  
  return { historical, current };
}

/**
 * Check if a course's current offerings match its historical pattern.
 * Returns: { matches: boolean, missing: string[], extra: string[] }
 */
export function checkOfferingConsistency(course) {
  const { historical, current } = compareHistoricalVsCurrent(course);
  
  const historicalSet = new Set(historical);
  const currentSet = new Set(current);
  
  const missing = historical.filter(sem => !currentSet.has(sem));
  const extra = current.filter(sem => !historicalSet.has(sem));
  
  return {
    matches: missing.length === 0 && extra.length === 0,
    missing,
    extra
  };
}

/**
 * Generate a human-readable description of when a course is offered.
 * Examples: "Fall and Spring", "Fall only", "Summer A and B", "Not currently offered"
 */
export function getOfferingDescription(course, options = {}) {
  const { includeCurrent = true, includeHistorical = false } = options;
  
  const parts = [];
  
  if (includeCurrent) {
    const current = getCurrentOfferings(course);
    if (current.length > 0) {
      const readable = current.map(sem => {
        switch(sem) {
          case 'fall': return 'Fall';
          case 'spring': return 'Spring';
          case 'sumA': return 'Summer A';
          case 'sumB': return 'Summer B';
          default: return sem;
        }
      });
      parts.push(`Currently: ${formatList(readable)}`);
    } else {
      parts.push("Not currently offered");
    }
  }
  
  if (includeHistorical) {
    const { historical } = compareHistoricalVsCurrent(course);
    if (historical.length > 0) {
      const readable = historical.map(sem => {
        switch(sem) {
          case 'fall': return 'Fall';
          case 'spring': return 'Spring';
          case 'sumA': return 'Summer A';
          case 'sumB': return 'Summer B';
          default: return sem;
        }
      });
      parts.push(`Typically: ${formatList(readable)}`);
    }
  }
  
  return parts.join(' • ');
}

/**
 * Check if a course can be taken in a specific semester.
 *
 * @param {object} course
 * @param {string} semTypeId - The semester type ID (e.g. "fall", "spring", "sumA") from sem.semTypeId.
 */
export function canTakeInSemester(course, semTypeId) {
  if (!semTypeId) return false;

  // Check current offerings first (most accurate)
  if (hasCurrentOfferings(course)) {
    return isOfferedInSemester(course, semTypeId);
  }

  // Fall back to historical terms if no current data
  const { historical } = compareHistoricalVsCurrent(course);
  return historical.includes(semTypeId);
}

/**
 * Filter courses by offering availability.
 */
export function filterCoursesByOfferings(courses, filters = {}) {
  const {
    onlyCurrentlyOffered = false,
    semesterType = null, // 'fall', 'spring', 'sumA', 'sumB'
    includeHistorical = true
  } = filters;
  
  return courses.filter(course => {
    // Filter by currently offered
    if (onlyCurrentlyOffered && !isCurrentlyOffered(course)) {
      return false;
    }
    
    // Filter by specific semester
    if (semesterType) {
      if (hasCurrentOfferings(course)) {
        return isOfferedInSemester(course, semesterType);
      } else if (includeHistorical) {
        const { historical } = compareHistoricalVsCurrent(course);
        return historical.includes(semesterType);
      } else {
        return false;
      }
    }
    
    return true;
  });
}

/**
 * Sort courses by offering recency/availability.
 * Prioritizes currently offered courses, then historically offered.
 */
export function sortCoursesByOfferings(courses, preferredSemester = null) {
  return [...courses].sort((a, b) => {
    const aCurrently = isCurrentlyOffered(a);
    const bCurrently = isCurrentlyOffered(b);
    
    // Currently offered courses come first
    if (aCurrently && !bCurrently) return -1;
    if (!aCurrently && bCurrently) return 1;
    
    // If both currently offered, prefer courses in preferred semester
    if (preferredSemester && aCurrently && bCurrently) {
      const aInPreferred = isOfferedInSemester(a, preferredSemester);
      const bInPreferred = isOfferedInSemester(b, preferredSemester);
      
      if (aInPreferred && !bInPreferred) return -1;
      if (!aInPreferred && bInPreferred) return 1;
    }
    
    // Fall back to alphabetical by course code
    const aCode = `${a.subject || ''}${a.number || ''}`;
    const bCode = `${b.subject || ''}${b.number || ''}`;
    return aCode.localeCompare(bCode);
  });
}

/**
 * Get offering statistics for a list of courses.
 */
export function getOfferingsStatistics(courses) {
  const stats = {
    total: courses.length,
    withCurrentData: 0,
    currentlyOffered: 0,
    bySemester: {
      fall: 0,
      spring: 0,
      sumA: 0,
      sumB: 0
    },
    consistencyStats: {
      consistent: 0,
      hasGaps: 0,
      hasExtras: 0,
      noHistorical: 0
    }
  };
  
  courses.forEach(course => {
    if (hasCurrentOfferings(course)) {
      stats.withCurrentData++;
      
      if (isCurrentlyOffered(course)) {
        stats.currentlyOffered++;
        
        // Count by semester
        getCurrentOfferings(course).forEach(sem => {
          if (stats.bySemester.hasOwnProperty(sem)) {
            stats.bySemester[sem]++;
          }
        });
      }
      
      // Consistency analysis
      const consistency = checkOfferingConsistency(course);
      if (consistency.matches) {
        stats.consistencyStats.consistent++;
      } else {
        if (consistency.missing.length > 0) stats.consistencyStats.hasGaps++;
        if (consistency.extra.length > 0) stats.consistencyStats.hasExtras++;
      }
    } else {
      const { historical } = compareHistoricalVsCurrent(course);
      if (historical.length === 0) {
        stats.consistencyStats.noHistorical++;
      }
    }
  });
  
  return stats;
}

/**
 * Utility function to format list of items with proper conjunction.
 */
function formatList(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Create offering badge/indicator data for UI components.
 */
export function getOfferingBadges(course) {
  const badges = [];
  
  if (!hasCurrentOfferings(course)) {
    // No current data available
    const { historical } = compareHistoricalVsCurrent(course);
    if (historical.length > 0) {
      badges.push({
        type: 'historical',
        text: 'Usually ' + formatList(historical.map(s => s.charAt(0).toUpperCase() + s.slice(1))),
        color: 'neutral'
      });
    }
    return badges;
  }
  
  const current = getCurrentOfferings(course);
  
  if (current.length === 0) {
    badges.push({
      type: 'not-offered',
      text: 'Not offered',
      color: 'warning'
    });
    return badges;
  }
  
  // Current offerings badges
  current.forEach(sem => {
    const semName = sem === 'sumA' ? 'Summer A' : 
                   sem === 'sumB' ? 'Summer B' :
                   sem.charAt(0).toUpperCase() + sem.slice(1);
    
    badges.push({
      type: 'current',
      semester: sem,
      text: semName,
      color: 'success'
    });
  });
  
  return badges;
}