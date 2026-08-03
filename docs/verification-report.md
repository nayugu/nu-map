# Major verification report

Generated 2026-08-03 by `npm run data:verify`.

> **What this can and cannot tell you.** There is no second authoritative
> source for Northeastern degree requirements — Degree Works and the
> CourseLeaf admin are SSO-gated, Banner exposes no program endpoints, and
> the per-page PDF is the same render as the HTML. These checks confirm we
> parsed the catalog faithfully. They cannot confirm the catalog is right.

**1017 programs** — 871 verified · 138 partial · 8 review · 0 unverified

## Findings by root cause

Grouped by check rather than by program: one parser bug usually wears many
names, and a list of every affected program is not a work order.

### `missing-total-credits` · 267 program(s) · medium

the catalog page states no total credit requirement

- Foundation Year — `majors/2026/admission/foundation_year`
- Animation, Minor — `majors/2026/arts-media-design/animation_minor`
- Architectural and Urban History, Minor — `majors/2026/arts-media-design/architectural_and_urban_history_minor`
- Architectural Design, Minor — `majors/2026/arts-media-design/architectural_design_minor`
- Architectural Science and Systems, Minor — `majors/2026/arts-media-design/architectural_science_and_systems_minor`
- Argumentation and Law, Minor — `majors/2026/arts-media-design/argumentation_and_law_minor`
- Art History and Visual Studies, Minor — `majors/2026/arts-media-design/art_history_and_visual_studies_minor`
- Art, Minor — `majors/2026/arts-media-design/art_minor`
- Cinema Studies, Minor — `majors/2026/arts-media-design/cinema_studies_minor`
- Communication Studies, Minor — `majors/2026/arts-media-design/communication_studies_minor`
- …and 257 more

### `plan-witness-unaccounted` · 113 program(s) · medium

2 of 23 courses in the catalog's four-year plan aren't required by anything here — they may be electives, or a requirement we missed

- Architectural Studies and Design, BS (Boston) — `majors/2026/arts-media-design/architectural_studies_and_design_bs_(boston)`
- Architectural Studies, BS (Boston) — `majors/2026/arts-media-design/architectural_studies_bs_(boston)`
- Architecture and English, BS (Boston) — `majors/2026/arts-media-design/architecture_and_english_bs_(boston)`
- Architecture, BS (Boston) — `majors/2026/arts-media-design/architecture_bs_(boston)`
- Communication Studies and Speech-Language Pathology and Audiology, BS (Boston) — `majors/2026/arts-media-design/communication_studies_and_speech-language_pathology_and_audiology_bs_(boston)`
- Design and Public Health, BS (Boston) — `majors/2026/arts-media-design/design_and_public_health_bs_(boston)`
- Design and Theatre, BS (Boston) — `majors/2026/arts-media-design/design_and_theatre_bs_(boston)`
- Business Administration and Communication Studies, BS (Boston) — `majors/2026/business/business_administration_and_communication_studies_bs_(boston)`
- Business Administration and Communication Studies, BS (Oakland) — `majors/2026/business/business_administration_and_communication_studies_bs_(oakland)`
- Business Administration and Criminal Justice, BS — `majors/2026/business/business_administration_and_criminal_justice_bs`
- …and 103 more

### `no-sample-plan` · 9 program(s) · medium

this program publishes no sample four-year plan, so our strongest check could not run

- Foundation Year — `majors/2026/admission/foundation_year`
- Design, BFA (Boston) — `majors/2026/arts-media-design/design_bfa_(boston)`
- Health Science and Business Administration, BS (Boston) — `majors/2026/health-sciences/health_science_and_business_administration_bs_(boston)`
- Health Science and Sociology, BS (Boston) — `majors/2026/health-sciences/health_science_and_sociology_bs_(boston)`
- Nursing, BSN—Accelerated Program for Second-Degree Students (Boston) — `majors/2026/health-sciences/nursing_bsnaccelerated_program_for_second-degree_students_(boston)`
- Nursing, BSN—Accelerated Program for Second-Degree Students (Charlotte) — `majors/2026/health-sciences/nursing_bsnaccelerated_program_for_second-degree_students_(charlotte)`
- Economics — `majors/2026/social-sciences-humanities/economics`
- Additional Requirements for BA Students — `majors/2026/university-academics/additional_requirements_for_ba_students`
- Writing-Intensive Courses — `majors/2026/university-academics/writing-intensive_courses`

### `total-from-sample-plan` · 3 program(s) · medium

the credit total was taken from the sample four-year plan, not from a stated requirement

- Media and Screen Studies, BA (Boston) — `majors/2026/arts-media-design/media_and_screen_studies_ba_(boston)`
- Creative Collaboration and Multidisciplinary Design, MS (Boston) — `grad-majors/2026/arts-media-design/creative_collaboration_and_multidisciplinary_design_ms_(boston)`
- Interdisciplinary Design and Media, PhD (Boston) — `grad-majors/2026/arts-media-design/interdisciplinary_design_and_media_phd_(boston)`

### `unknown-course` · 1 program(s) · info

3 course(s) this program requires are absent from our course list, so those requirements can never be ticked off in the planner

- Education, MEd (Boston) — `grad-majors/2026/professional-studies/education_med_(boston)`
