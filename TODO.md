# Nu-Map TODO

## Requirement Display & Allocation (Current Sprint - Completed ✅)

| Done | Task | Notes |
|------|------|-------|
| [x] | Fix pooled requirements display (297 majors) | XOM structure for credit pools; Khoury electives: "8 SH / 8 SH from pool" |
| [x] | Fix pool display logic | "Choose 1 of 11" shows as "1/1" (requirement met); subtitle: "Requires 1 of 11" |
| [x] | Flatten OR/AND in mixed pool sections | Supporting Courses: COURSE + OR mix; via `normalizePooledSection()` |
| [x] | Show partial requirement satisfaction | AND: "All of (2/3)" when 2 complete; OR: "One of (1/8)" with tracking |
| [x] | Auto-generate General Electives | Tracks unallocated courses; only in major (no minor duplication); updates dynamically |
| [x] | Remove placeholder from UI | Filtered in allocation functions; replaced with auto-generated across all majors |
| [x] | All fixes code-based (no JSON hardcoding) | Works across all 1,471 majors; scales to future variations |

---

## Requirement Display & Allocation (Pending)

| Done | Task | Notes |
|------|------|-------|
| [ ] | Add `creditHoursRequired` to 386 General Electives | Upstream data issue (parser missing field); can't show "28 SH / 28 SH" until populated |
| [ ] | Test all pool structures across majors | Verify Supporting Courses, Technical Electives render; check edge cases |
| [ ] | Test minor allocation with General Electives | Ensure no duplication; verify concentrations work properly |

---

## UI & UX (Backlog)

| Done | Task | Notes |
|------|------|-------|
| [x] | Make other credits less prominent | Styling improvements completed |
| [x] | Add beta sign | Visual indicator added |
| [x] | Collapse other credits toggle works | Expands/collapses all sections properly |
| [x] | Drag from course categories in grad panel | Drag & drop from requirement lists enabled |
| [x] | Fix "any from" requirements list | Display logic corrected |
| [x] | Fix prerequisite error display | Shows partial satisfaction correctly |
| [x] | Plans include major | Major selection persisted in plans |
| [x] | Major choice saved on reload | State persistence working |
| [ ] | Create automatic semester update system | Should use launch check/fix system; log to changelog |
| [ ] | Dim other error lines when clicking course | Even when error lines setting is on |
| [ ] | Enable Claude integration | Allow Claude to access site abilities, modify plan, propose changes |
| [ ] | Add sticky setting to phone | Enable as default |
| [ ] | Have placed courses show in course bank with tag | Distinguish placed vs available courses visually |
| [ ] | WHY courses don't show in course bank across plans | Debug course bank display issue |

---

## Course & Placement Logic (Backlog)

| Done | Task | Notes |
|------|------|-------|
| [x] | Make coops "sticky" with cohort | Coops move with cohort assignments |
| [ ] | Add place-out toggle | For courses taken but not credited (test-based placement) |
| [ ] | Enable mobile drag & drop into sections | Improve mobile course placement UX |
| [ ] | Fix credit double-counting logic | Credits should not count towards multiple requirement categories; CAN double-count BETWEEN majors/minors |
| [ ] | Enable spring entry | Support spring semester start |

---

## Import/Export & Data (Backlog)

| Done | Task | Notes |
|------|------|-------|
| [x] | Add import function | Support plan/course data import |
| [ ] | Rename exported PDFs/JSONs | Use format: `planName_numap_date` |
| [ ] | Add plain text copy option | Allow users to copy plan as plain text |
| [ ] | Export PDF for current plan | Should not bleed between plans |

---

## Error Handling & Validation (Backlog)

| Done | Task | Notes |
|------|------|-------|
| [ ] | Fix prerequisite error logic | Don't show red if prerequisite already fulfilled (e.g., PHYS 1161 needs calc; don't error if Calc 1 done) |
| [ ] | Disable error lines in incoming credit section | Prerequisite mapping shouldn't apply to transferred credits |

---

## Data Scraping (Backlog)

| Done | Task | Notes |
|------|------|-------|
| [ ] | Scrape NU Path | From https://tableau.northeastern.edu/t/Registrar/views/NUpathAttributes/ |

---

## Implementation Details

**Latest Commit (9d03518ae):**
- Systematic pool normalization via `normalizePooledSection()`
- Auto-generated General Electives (no placeholder duplication)
- Works across all 1,471 majors without JSON changes

**Pool Pattern:**
- Trigger: `minRequired < total` with OR/AND nodes
- Action: flatten nested choices
- Result: peer-level options for selection

**Display Rules:**
- Pools: `placed/minRequired` (e.g., "1/1", "3/4")
- Regular sections: `placed/total` (e.g., "2/3")
- Pools include context: "Requires X of Y" subtitle

**Key Files:**
- `src/core/gradRequirements.js` - allocation & pool normalization
- `src/ui/GradPanel.jsx` - display & filtering
