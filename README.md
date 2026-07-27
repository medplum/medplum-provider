# DJS Admission Health Screening — Medplum prototype

Maryland DJS's **Admission Health Screening and Nursing Assessment** paper form,
rebuilt as a React wizard storing real FHIR data through
[Medplum](https://www.medplum.com/), running inside a `medplum-provider`
checkout.

The project has **two purposes**, and the second one shapes how the work is
done:

1. Build a working admission screening wizard.
2. **Evaluate whether Medplum is a viable platform for this agency.**

Because of (2), platform limitations and bugs found along the way are treated as
deliverables, not obstacles — they're documented rather than quietly worked
around. See [Platform findings](#platform-findings) below; that section is
arguably the most valuable output so far.

> **The data here is health information about minors in state custody**,
> including abuse history and substance use. Data loss is a clinical problem,
> not a cosmetic one, and records are withdrawn rather than deleted so the trail
> stays auditable. Nothing currently restricts field-level visibility beyond
> default patient-record access — an AccessPolicy is open work, tracked in
> `TASKS.md`.

---

## Start here

| If you're… | Read |
| --- | --- |
| Making UI or design changes | **[`CONTRIBUTING.md`](CONTRIBUTING.md)** — the ways this app breaks silently, plus the code-review checklist |
| Writing or changing save/read code | **[`CLAUDE.md`](CLAUDE.md)** — invariants, bug classes, platform findings |
| Wondering what's done or planned, and why | **[`TASKS.md`](TASKS.md)** — source of truth, including the reasoning behind decisions |

`CONTRIBUTING.md` is the accessible on-ramp; `CLAUDE.md` is the deeper technical
reference behind it.

---

## Quick start

```bash
npm install
npm run dev          # vite on localhost:3001
npm test             # offline test suite — fast, no setup
npm run build        # tsc + vite build (type-checks tests too)
```

The wizard lives at `/admission-screening[/:patientId[/:encounterId]]`, plus an
"Admission Screening" entry in the sidebar Quick Links. It needs a real Medplum
project to sign into — `.env` ships as the stock template with an empty client
ID, so point `MEDPLUM_BASE_URL` at your project or a local server on `:8103`.

**No credentials? Visit `/demo/admission-screening`** (dev server only —
`npm run dev`, dev-only route, stripped from production builds). Renders the
real wizard against an in-memory `MockClient`, with an unmistakable "DEMO
MODE" banner. Replaces the old hand-maintained `preview.html`, which
drifted out of sync with the real UI and never loaded `tokens.css`.

---

## Current state

**Four sections**, all wired to real FHIR resources — nothing stubbed:

1. **Patient Information** — demographics, identification, mandated-reporter
   attestation
2. **Current Health Status** — vitals, vision, complaint, pain, medications,
   allergies, chronic conditions, appearance/mental status
3. **Review of Systems** — injuries/trauma, oral/dental, infectious history
4. **Diagnosis & Disposition** — nursing diagnoses, nursing plan, sign-off

**Originally nine sections.** Skin/Body Exam, Mental Status & Psychosocial,
Abuse/Substance/Family History, and Reproductive Health were **cut and are not
coming back.** If you find code or docs referencing them, that's debris — say
so. (Allergies, chronic conditions, and appearance were folded into section 2
rather than removed.)

### What works today

- Saving each section, with success/error feedback
- **Resuming a partially-completed screening** — reopening a patient repopulates
  the form from what's stored
- **Idempotent saves** — re-saving updates in place instead of duplicating
- **Withdrawal, not deletion** — unchecking an item marks its record
  `entered-in-error` and keeps the history
- A full "Overview" tab/page on the patient record (`PatientOverviewPage.tsx`)
  covering the same sections Medplum's default `PatientSummary` does, using
  the same underlying resource queries, plus the DJS-specific ones (Pain,
  Sign-off) it doesn't know about — with each concept shown exactly once

### Known rough edges

- The wizard draws its own banner/header/sidebar/footer *inside* the host app's
  chrome. Accepted deliberately — function over appearance for this prototype.
- Most clinical content is still free text rather than coded terminology. Vitals
  and medication dosage are now properly coded; the rest is tracked as tasks
  22–35.
- No field validation (vitals ranges, date sanity) anywhere yet.

---

## How data is stored

Every resource the wizard writes carries an identifier under
`http://maryland.gov/djs/admission-screening`, derived from the field that
produced it. That's what makes re-saving update in place rather than duplicate —
and it's why **some on-screen text is data, not decoration** (see
`CONTRIBUTING.md` §1 before renaming anything).

| Section | FHIR resources |
| --- | --- |
| 1. Patient Information | `Patient` (name, birthDate, gender, language, birthplace/race/ethnicity extensions); `Encounter` (admission date, facility) → `Location`; `Observation` for hair/eye colour and the mandated-reporter attestation |
| 2. Current Health Status | `Observation` vitals — LOINC-coded, `category: vital-signs`, UCUM units, blood pressure as a two-component panel; `Observation` for vision acuity, complaint, pain; `MedicationStatement` per medication with structured `Dosage`; `AllergyIntolerance` per allergy; `Condition` per chronic condition |
| 3. Review of Systems | `Observation` per checked finding, plus dental/vision exam dates and comments |
| 4. Diagnosis & Disposition | `Condition` per nursing diagnosis; `CarePlan` for the nursing plan; `Observation` for sign-off, disposition notes and review date |

Facilities are real `Location` resources keyed on a permanent code, so a
facility's display name can change without stranding prior admissions. The
facility field is a closed dropdown on purpose — see `src/pages/djsFacilities.ts`.

---

## Architecture

```
src/
  pages/
    AdmissionHealthScreeningWizard.tsx  — the wizard; all 4 sections + save handlers
    screeningData.ts    — the one place screening resources are read back;
                          also the shared dose/blood-pressure/vital helpers
    hydrateScreening.ts — pure function: stored resources → form values
    djsFacilities.ts    — canonical DJS facility list (codes are permanent)
    formState.ts        — chip/check/text/table state + the "A|B::text" item parser
    patient/PatientOverviewPage.tsx — the "Overview" tab on the patient page;
                          combines the DJS screening summary with the same
                          sections Medplum's default PatientSummary shows
    AdmissionScreeningDemoPage.tsx — no-credentials demo route (dev-only,
                          see "Quick start" above); replaces the old preview.html
  components/
    SidebarStepper · PatientBand · Card · ChipGroup · CheckGrid
    FormControls · Callout · DynamicTable · MarylandChrome
  theme/
    tokens.css          — design tokens and every .djs-* class (loads globally)
    mantine-theme.ts    — intentionally unused; see below
```

Two things that surprise people:

- **DJS screens don't use Mantine**, even though the surrounding app does.
  They're raw HTML plus `.djs-*` classes. `mantine-theme.ts` exists but is
  deliberately **not applied** — wiring it up would restyle the rest of the
  application for no benefit.
- **`tokens.css` loads globally**, so it must never contain a bare element
  selector (`body`, `input`). Everything is scoped to `.djs-*`.

---

## Testing, and what's actually proven

```bash
npm test             # offline suite (MockClient) — 142 DJS tests
npm run test:live    # against a real Medplum server
```

The split matters. **`MockClient` lies in both directions**: it accepts
constraint-violating resources the real server rejects, and it matches some
searches the real server doesn't. So the offline suite runs writes through
`validateResource` to catch FHIR constraint errors offline, and anything
touching the write path also gets a live test.

`npm run test:live` needs `MEDPLUM_LIVE_CLIENT_ID` / `MEDPLUM_LIVE_CLIENT_SECRET`
against a running Medplum stack. **Without them the suite skips cleanly**, so
it's always safe to run — it just reports zero tests.

Conventions worth keeping:

- A new field gets a test proving it **saves and comes back**, not just that it
  renders.
- Tests are **mutation-verified**: break the code on purpose, confirm the test
  goes red with a real error, restore. An unverified test is a false sense of
  security, and this codebase has been bitten by exactly that.
- Clinical codes are **looked up in the spec and cited**, never recalled. A
  plausible-but-wrong LOINC code is worse than none because it looks
  authoritative.

---

## Platform findings

The evaluation output so far. Details and reproductions in `CLAUDE.md`.

| Finding | Impact |
| --- | --- |
| **`executeBatch` with `type: "transaction"` is not atomic** on Medplum 5.1.27. A bundle with one valid and one invalid entry partially committed, and the call *resolved* rather than rejecting. | There is no way to get atomic multi-resource writes from this server via `executeBatch`. A platform ceiling, not a client bug. Attempted twice and reverted both times; the app relies on idempotent upserts so a partial save self-heals on retry. |
| **A resource created inside a transaction Bundle isn't immediately searchable.** | Silently broke retraction on the real server while every offline test stayed green. |
| **`MockClient` doesn't enforce FHIR invariants.** | Constraint bugs pass offline and only surface against a real server. Mitigated with a `validateResource` harness. |
| **A bare `identifier=<system>\|` search behaves differently** — MockClient matches it, the live server returns nothing. | Would silently show an empty screening even when data exists. Never narrow a search that way. |
| **Conditional PUT on a *populated* custom identifier works correctly** — verified live across both the create and reuse paths. | The positive counterpart to the above, and what the no-duplicate-facilities design rests on. |

A recurring *application* bug class worth naming too: **a field wired into the
JSX but read by no save handler**. It has happened five times, always silently —
the nurse types, clicks save, sees success, and the data is discarded. The
automated field check can't see sections 1–2, which is where the most recent
instance hid.

---

## What's next

`TASKS.md` is authoritative. In short: the data-loss, blood-pressure, vitals,
and patient-overview-page items are done. Open work is mostly coded
terminology (allergy categories, RxNorm, Condition categories), practitioner
attribution on every resource, threading the admission Encounter through the
rest of the resources it should link to, and two larger questions — whether
to adopt `QuestionnaireResponse` as the persistence model, and a checklist
remodel that would change how identifiers are derived.

---

## USWDS theming

Unlike Maryland's MDWDS, the U.S. Web Design System
([designsystem.digital.gov](https://designsystem.digital.gov/)) publishes its
tokens openly, so this is the real default USWDS palette rather than a
reconstruction:

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

Typography is Public Sans (USWDS's default theme typeface), 4px base corner
radius on buttons/inputs/chips, and the focus style is an outline rather than a
box-shadow glow, matching USWDS's actual focus treatment. The `.gov` banner's
lock icon is green because real USWDS reserves green specifically for that icon.

**For pixel-exact parity**, install the real package (`npm i @uswds/uswds`) and
use its SCSS/CSS directly. What's here gives you USWDS's visual language on top
of the wizard's own components; it isn't a swap-in of USWDS's component library.
