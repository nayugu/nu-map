# Major verification report

Generated 2026-09-06 by `npm run data:verify`.

> **What this can and cannot tell you.** There is no second authoritative
> source for Northeastern degree requirements — Degree Works and the
> CourseLeaf admin are SSO-gated, Banner exposes no program endpoints, and
> the per-page PDF is the same render as the HTML. These checks confirm we
> parsed the catalog faithfully. They cannot confirm the catalog is right.

**1722 programs** — 1111 verified · 603 partial · 8 review · 0 unverified

## Findings by root cause

Grouped by check rather than by program: one parser bug usually wears many
names, and a list of every affected program is not a work order.

### `unenumerated-sections` · 648 program(s) · info

4 section(s) state a credit requirement whose courses the catalog does not list, so completion of those cannot be checked automatically

- Architectural Studies and Design, BS (Boston) — `undergraduate/2026/arts-media-design/architectural_studies_and_design_bs_(boston)`
- Architectural Studies, BS (Boston) — `undergraduate/2026/arts-media-design/architectural_studies_bs_(boston)`
- Architecture and English, BS (Boston) — `undergraduate/2026/arts-media-design/architecture_and_english_bs_(boston)`
- Architecture, BS (Boston) — `undergraduate/2026/arts-media-design/architecture_bs_(boston)`
- Art, BA (Boston) — `undergraduate/2026/arts-media-design/art_ba_(boston)`
- Communication Studies and Design, BS (Boston) — `undergraduate/2026/arts-media-design/communication_studies_and_design_bs_(boston)`
- Communication Studies and Sociology, BA (Boston) — `undergraduate/2026/arts-media-design/communication_studies_and_sociology_ba_(boston)`
- Communication Studies and Speech-Language Pathology and Audiology, BS (Boston) — `undergraduate/2026/arts-media-design/communication_studies_and_speech-language_pathology_and_audiology_bs_(boston)`
- Communication Studies and Theatre, BA (Boston) — `undergraduate/2026/arts-media-design/communication_studies_and_theatre_ba_(boston)`
- Communication Studies, BA (Boston) — `undergraduate/2026/arts-media-design/communication_studies_ba_(boston)`
- …and 638 more

### `no-sample-plan` · 472 program(s) · medium

this program publishes no sample four-year plan, so our strongest check could not run

- Foundation Year — `undergraduate/2026/admission/foundation_year`
- Design, BFA (Boston) — `undergraduate/2026/arts-media-design/design_bfa_(boston)`
- International Business, BSIB—Exchange (Boston) — `undergraduate/2026/business/international_business_bsibexchange_(boston)`
- Health Science and Business Administration, BS (Boston) — `undergraduate/2026/health-sciences/health_science_and_business_administration_bs_(boston)`
- Health Science and Sociology, BS (Boston) — `undergraduate/2026/health-sciences/health_science_and_sociology_bs_(boston)`
- Nursing, BSN—Accelerated Program for Second-Degree Students (Boston) — `undergraduate/2026/health-sciences/nursing_bsnaccelerated_program_for_second-degree_students_(boston)`
- Nursing, BSN—Accelerated Program for Second-Degree Students (Charlotte) — `undergraduate/2026/health-sciences/nursing_bsnaccelerated_program_for_second-degree_students_(charlotte)`
- Economics — `undergraduate/2026/social-sciences-humanities/economics`
- Additional Requirements for BA Students — `undergraduate/2026/university-academics/additional_requirements_for_ba_students`
- Writing-Intensive Courses — `undergraduate/2026/university-academics/writing-intensive_courses`
- …and 462 more

### `missing-total-credits` · 471 program(s) · medium

the catalog page states no total credit requirement

- Foundation Year — `undergraduate/2026/admission/foundation_year`
- Animation, Minor — `undergraduate/2026/arts-media-design/animation_minor`
- Architectural and Urban History, Minor — `undergraduate/2026/arts-media-design/architectural_and_urban_history_minor`
- Architectural Design, Minor — `undergraduate/2026/arts-media-design/architectural_design_minor`
- Architectural Science and Systems, Minor — `undergraduate/2026/arts-media-design/architectural_science_and_systems_minor`
- Argumentation and Law, Minor — `undergraduate/2026/arts-media-design/argumentation_and_law_minor`
- Art History and Visual Studies, Minor — `undergraduate/2026/arts-media-design/art_history_and_visual_studies_minor`
- Art, Minor — `undergraduate/2026/arts-media-design/art_minor`
- Cinema Studies, Minor — `undergraduate/2026/arts-media-design/cinema_studies_minor`
- Communication Studies, Minor — `undergraduate/2026/arts-media-design/communication_studies_minor`
- …and 461 more

### `plan-witness-unaccounted` · 114 program(s) · medium

2 of 23 courses in the catalog's four-year plan aren't required by anything here — they may be electives, or a requirement we missed

- Architectural Studies and Design, BS (Boston) — `undergraduate/2026/arts-media-design/architectural_studies_and_design_bs_(boston)`
- Architectural Studies, BS (Boston) — `undergraduate/2026/arts-media-design/architectural_studies_bs_(boston)`
- Architecture and English, BS (Boston) — `undergraduate/2026/arts-media-design/architecture_and_english_bs_(boston)`
- Architecture, BS (Boston) — `undergraduate/2026/arts-media-design/architecture_bs_(boston)`
- Communication Studies and Speech-Language Pathology and Audiology, BS (Boston) — `undergraduate/2026/arts-media-design/communication_studies_and_speech-language_pathology_and_audiology_bs_(boston)`
- Design and Public Health, BS (Boston) — `undergraduate/2026/arts-media-design/design_and_public_health_bs_(boston)`
- Design and Theatre, BS (Boston) — `undergraduate/2026/arts-media-design/design_and_theatre_bs_(boston)`
- Business Administration and Communication Studies, BS (Boston) — `undergraduate/2026/business/business_administration_and_communication_studies_bs_(boston)`
- Business Administration and Communication Studies, BS (Oakland) — `undergraduate/2026/business/business_administration_and_communication_studies_bs_(oakland)`
- Business Administration and Criminal Justice, BS — `undergraduate/2026/business/business_administration_and_criminal_justice_bs`
- …and 104 more

### `total-from-sample-plan` · 2 program(s) · medium

the credit total was taken from the sample four-year plan, not from a stated requirement

- Media and Screen Studies, BA (Boston) — `undergraduate/2026/arts-media-design/media_and_screen_studies_ba_(boston)`
- Creative Collaboration and Multidisciplinary Design, MS (Boston) — `graduate/2026/arts-media-design/creative_collaboration_and_multidisciplinary_design_ms_(boston)`

### `unknown-course` · 1 program(s) · info

3 course(s) this program requires are absent from our course list, so those requirements can never be ticked off in the planner

- Education, MEd (Boston) — `graduate/2026/professional-studies/education_med_(boston)`

### `variable-total-credits` · 1 program(s) · info

the catalog states the total credit requirement varies rather than giving a number

- Biology, PhD—Advanced Entry (Boston) — `graduate/2026/science/biology_phdadvancedentry_(boston)`
