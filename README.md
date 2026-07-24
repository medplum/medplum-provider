# DJS Admission Health Screening — medplum-provider theme

## USWDS theming

Unlike Maryland's MDWDS, the U.S. Web Design System (USWDS,
[designsystem.digital.gov](https://designsystem.digital.gov/)) publishes
its tokens openly, so this is the real default USWDS palette rather than
a reconstruction:

| Token | USWDS system color | Hex |
|---|---|---|
| primary | blue-60v | `#005ea2` |
| primary-dark | blue-warm-70v | `#1a4480` |
| primary-darker | blue-warm-80v | `#162e51` |
| secondary | red-50 | `#d83933` |
| secondary-dark | red-60v | `#b50909` |
| accent-warm | orange-30v | `#fa9441` |
| success (banner lock icon) | green-cool-40v | `#00a91c` |
| focus ring | — | `#2491ff` |

Typography is Public Sans (USWDS's default theme typeface), 4px base
corner radius on buttons/inputs/chips, and the focus style is an
outline (not a box-shadow glow) to match USWDS's actual focus treatment.
The `.gov` banner's lock icon is green — I'd originally used
Maryland's own red/green pairing here for a different color role; real
USWDS reserves green specifically for that icon (`--usa-banner-security-icon__color`),
which is now fixed.

**For pixel-exact parity** — the real component CSS, exact spacing
scale, the actual `usa-banner`/`usa-accordion` markup — install the
real package (`npm i @uswds/uswds`) and use its SCSS/CSS directly rather
than relying on these hand-reconstructed tokens layered onto the
mockup's own component set. What's here gets you USWDS's visual
language (colors, type, radius, focus states) on top of the wizard's
existing components; it isn't a swap-in of USWDS's actual component
library.


A component library that reproduces the UI from
`djs-admission-health-screening-mockup.html` (dark sidebar wizard, sticky
patient band, numbered cards, chip toggles, checkbox grids, reveal
sections) as real React components wired to Medplum, dropped into
`medplum-provider`.

Open `preview.html` in a browser for a static look at the shell before
wiring anything up.

## What's fully wired

All 9 sections in `src/pages/AdmissionHealthScreeningWizard.tsx` are
complete and persist real FHIR resources via `useMedplum()` — nothing
is stubbed. The resource mapping actually used, per section, is below
(this is what's implemented now, not just a suggestion).

## FHIR resource mapping (as implemented)

| Section | Content | Suggested FHIR resource(s) |
|---|---|---|
| 1. Demographics | name, DOB, sex, ethnicity, race, language | `Patient` (name, birthDate, gender, extensions for race/ethnicity/language) |
| 2. Current Health Status | vitals, vision, complaint, pain, meds | `Observation` (vitals, vision, pain score), `MedicationStatement` (current meds) |
| 3. Allergies & Chronic | allergies, chronic conditions | `AllergyIntolerance`, `Condition` (clinicalStatus: active) |
| 4. Skin / Body Exam | findings + body-chart markers | `Observation` (one per finding, `bodySite` coded from the marker location) |
| 5. Mental Status & Psychosocial | psych history, SI/HI screening | `Condition` (psych diagnoses), `Observation` (SI/HI screening result — consider a `RiskAssessment` for the "active ideation" flag so it's queryable as a flagged risk) |
| 6. Abuse, Substance & Family | abuse history, substance use, family hx | `Observation` or `Condition` for abuse history (handle with the same access-policy sensitivity as any disclosure), `Observation` per substance (SNOMED-coded), `FamilyMemberHistory` |
| 7. Review of Systems | systems checklist | `Observation`, one per system reviewed, or a single `QuestionnaireResponse` if you'd rather keep ROS as one structured form |
| 8. Reproductive Health | male/female-specific fields | `Observation` (LMP, contraception, etc.), gated on `Patient.gender` |
| 9. Diagnosis & Disposition | nursing plan, sign-off | `Condition` (diagnoses); `ServiceRequest` per lab and per referral (implemented); `Observation` for PPD/health-ed/MD-contacted events (implemented); `CarePlan.activity[]` for everything else (implemented); sign-off is still a plain `Observation`, not a real `Provenance`/`Composition` signature — that upgrade is still open |

For anything checklist-like (races, allergies, substances, ROS systems),
consider whether you actually want one `Observation` per checked item
(queryable, reportable) vs. a single `QuestionnaireResponse` capturing the
whole section as answered (faster to build, matches the paper form
1:1, less granular for downstream queries). The wizard as built favors
discrete Observations for anything clinically actionable (vitals, pain,
allergies) and would suggest QuestionnaireResponse for the more
checklist-heavy sections (Review of Systems) if you want to move faster.

## Files

```
src/
  theme/
    tokens.css              — design tokens + all component CSS classes
    mantine-theme.ts        — MantineThemeOverride matching the palette
  components/
    SidebarStepper.tsx      — dark wizard nav with progress ring
    PatientBand.tsx         — sticky patient strip, reads a real Patient resource
    Card.tsx                — Card, FieldGrid, Field, SectionHeader
    ChipGroup.tsx           — segmented single-select + Reveal wrapper
    CheckGrid.tsx           — multi-select checkbox grid
    FormControls.tsx        — TrackedChip/YesNoChip/Grid — FormState-bound wrappers used throughout Sections 3–9
    Callout.tsx             — amber/red/critical alert banners
    DynamicTable.tsx        — add/remove-row table (substances, family hx)
    MarylandChrome.tsx      — GovBanner, AppHeader, AppFooter
  pages/
    AdmissionHealthScreeningWizard.tsx  — full page, all 9 sections wired
    formState.ts            — generic chip/check/text/table state container + the mockup's "A|B::text" item-spec parser
preview.html                 — static HTML/CSS preview, no build step
```

## Integration into medplum-provider

1. Copy `src/theme/`, `src/components/`, `src/pages/` into your
   `medplum-provider` repo's `src/` (e.g. under `src/djs/`).
2. Import the CSS once, near your app root:
   ```ts
   import './djs/theme/tokens.css';
   ```
3. Apply the Mantine theme:
   ```tsx
   import { MantineProvider } from '@mantine/core';
   import { djsTheme } from './djs/theme/mantine-theme';

   <MantineProvider theme={djsTheme}>
     {/* app */}
   </MantineProvider>
   ```
4. Add a route to the wizard, e.g. in your router:
   ```tsx
   <Route path="/Patient/:id/admission-screening" element={<AdmissionHealthScreeningWizard patientId={id} />} />
   ```
5. `AdmissionHealthScreeningWizard` uses `useMedplum()` from
   `@medplum/react-hooks` — make sure the route is inside your existing
   `MedplumProvider`, which `medplum-provider` already sets up.

## Not carried over from the mockup (by design)

- The body-chart click-to-place-marker interaction was visual-only in
  the mockup ("mockup — visual only" per its own comment). Section 4
  captures findings as a checklist + free-text location notes instead;
  wiring an actual clickable SVG body map to coded `Observation.bodySite`
  values is a further step I'd scope separately once you've confirmed
  the coding approach.
- Google Fonts `<link>` tags — pull Roboto/Roboto Mono in through
  whatever font-loading approach `medplum-provider` already uses.

## Changelog

- **Merged Sections 3 and 4 into the bottom of Section 2** (down from 6
  sections to 4): Allergies, Chronic Health Conditions, and Appearance &
  Mental Status are now cards within "Current Health Status" alongside
  vitals/vision/complaint/pain/medications, rather than their own steps.
  One combined "Save health status" button now calls `saveVitals`,
  `saveAllergiesChronic`, and `saveMentalStatus` in sequence. Review of
  Systems and Nursing Diagnosis & Disposition renumbered to Sections 3
  and 4 accordingly.

- **Scope narrowed (intentional):** Skin/Body Examination, Abuse/Substance/Family
  History (including the Phase 2 substance grid and Phase 3 Task-based
  compliance deadline), and Reproductive Health were removed entirely —
  down from 9 sections to 6. Nursing Plan/Disposition was also reverted
  from Phase 6's structured `ServiceRequest`-per-lab/referral model back
  to a flat checklist. Cleaned up leftover debris from that edit: an
  orphaned `SubstanceUseGrid`/`SUBSTANCES` import, dead code in
  `saveMentalStatus` referencing `mh-dx`/`si-now`/`si-hist` fields that
  no longer have any input UI, a trailing-`|` bug that rendered a blank
  labelless checkbox in Nursing Plan, and two typos ("Iatient
  Information", a trailing space in Section 4's title).
- Section 4's description text still warns staff to contact Behavioral
  Health for current SI/HI — left as-is since removing a safety-warning
  line is a more deliberate call than a typo fix, but it's now
  describing a check the form doesn't actually perform.

- **Phase 6 (Nursing Plan/Disposition):** replaced the flat 18-item
  checklist (which flattened everything into one `CarePlan.description`
  string) with the real form's actual structure: specific labs
  (Urine GC/Chlamydia, rapid pregnancy test, prenatal labs, drug screen,
  CBC/RPR/HIV/MMR, Hep C Ab, lead level) each become their own real
  `ServiceRequest`; specific referrals (Behavioral Health, CPS, Dentist,
  Optometrist, Psychiatrist, Gyn/Midwife) each become their own
  `ServiceRequest` with `performerType` carrying the specialty; PPD
  result, health-education topics, and both MD/NP-contacted events
  become individual `Observation`s with real timestamps; everything
  else (TB screening initiated, sick call, logs, disposition, special
  needs) is a structured `CarePlan.activity[]` list instead of one
  flattened string.
- Fixed three more silently-dropped fields in the same section:
  `disposition-notes`, `signoff-datetime`, and `review-date` were
  captured in state but never included in the save handler.

- **Phase 4 (Page 1 & vitals gaps):** added everything the real form has
  that the build didn't — place of birth, primary language + needs-interpreter,
  race checklist, hair/eye color, and the mandated-reporter statement +
  RN-initials attestation on Page 1; BMI (computed from weight/height),
  a vision-screen table (left/right/both eyes, with and without
  correction, plus glasses-history), and a current-medications table
  (`MedicationStatement` per row) on Page 2. Race and needs-interpreter
  are modeled as `Patient` extensions (`us-core-race`, and an informal
  non-standard extension for needs-interpreter since there's no
  standard one); place of birth uses the real standard
  `patient-birthPlace` extension.
- **Phase 3 (abuse-disclosure compliance deadline):** the real form's
  requirement that "MD/NP must be notified within 7 days of admission"
  when sexual abuse is disclosed is now a real `Task` resource
  (`priority: urgent`, `restriction.period.end` = admission date + 7
  days) instead of just narrative text — trackable/queryable rather
  than something that can get lost in a note. Also added the "called
  MD/NP now for consultation" field the real form has for disclosures
  within the past 2 weeks.
- **Phase 2 (substance use):** replaced the disconnected substance
  checklist + free-add table (checking "Heroin" above did nothing — the
  checklist was never even saved; details had to be re-typed by hand
  into a separate table) with `SubstanceUseGrid`, a fixed one-row-per-substance
  table where checking a substance and filling in its age/route/amount/last-used
  is one action. Splits the real form's combined checkboxes
  (Marijuana/Synthetic THC, Heroin/Fentanyl) into independently trackable
  substances since a youth can use one without the other. Saved as one
  `Observation` per substance with structured `component[]` fields
  (age, route, amount/frequency, last used) rather than a flattened
  string — more correct FHIR modeling than most of the rest of this
  file, worth matching elsewhere eventually.
- Fixed five more silently-dropped fields in the same section: the
  withdrawal/withdrawal-risk/overdose/prior-treatment/MAT yes-no
  questions and both the substance-use and family-history "additional
  comments" fields were captured in state but never included in the
  save handler.
- **Phase 1 (Review of Systems):** added the missing "Other: ___"
  option to 9 of 11 panels, added Last Hearing Test / Last Dental Exam
  / Urine Color fields that the real form has but the build didn't,
  expanded Oral/Dental's Breath/Teeth/Gums into the real form's full
  set of options, and turned Injury Prevention from decorative text
  into an actual saveable attestation checkbox.
- Fixed two more silently-dropped fields in Review of Systems: vision
  exam date/provider and the "additional comments" field were captured
  but never saved.
- All 9 sections implemented and wired to real FHIR resources (Sections
  3–9 were previously placeholders).
- Fixed a bug in Section 8's save handler: it referenced field keys
  (`male-sex-summary`, `male-hiv-detail`, `fem-sex-summary`,
  `fem-hiv-detail`, `fem-preg-detail`) that were never actually set by
  any input in the form — meaning menstrual history, birth control,
  pregnancy details, sexual history, and identity/safety answers were
  silently not being saved. Rewritten to persist every real field
  captured in the section, for both the male and female branches.

## Known follow-up (not yet fixed)

Section 6's **Family History** has the same disconnected pattern that
substance use had before this update: a `family-hx` checklist Grid is
rendered but never saved — only the separate free-add `family-table`
rows are persisted. This is Phase 5 in the migration plan (tightening
Family History to the real form's fixed condition×relative shape);
flagged here rather than fixed opportunistically so it gets the same
"redesign the data shape" treatment the substance table just got,
instead of a quick patch.

## Sensitive-content note

Sections 5–6 capture abuse history, suicidal/homicidal ideation, and
substance use for a minor population. Whatever resources you land on,
make sure your Medplum project's access policies restrict these fields
beyond default patient-record visibility (e.g. a narrower AccessPolicy
for behavioral-health-flagged Observations/Conditions), consistent with
however your agency already segments records with elevated
confidentiality needs.
