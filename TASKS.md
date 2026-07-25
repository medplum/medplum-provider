# DJS Admission Screening — task plan

**Target:** a demo that *really saves* — a real Medplum project, real FHIR
writes, no duplicate-on-resave. Not a clickable mockup; not yet
pilot-ready (no AccessPolicy, no coded terminology, no field validation).

**Standing priority:** function over appearance. UI polish (pulling the
wizard out of the AppShell, its own chrome) is explicitly deprioritised
until the data path is trustworthy.

For architecture, invariants, and bug classes to avoid, see `CLAUDE.md`.
This file is the task list, not a history — resolved work is a one-line
mention, not a narrative.

---

## Current state

The full data path is built and tested: save → no-duplicate (conditional
upsert) → retract-on-uncheck → resume-on-reopen (read-back) → display
(patient-page summary) → atomic-per-section (transaction bundles).

- **50 DJS unit tests** (`npm test`) — MockClient only, no network. Covers
  FHIR constraint validity (mutation-verified against `ait-1`/`con-3`/
  `ele-1`), idempotent upsert, retraction, subject integrity, pain
  absent-vs-zero, form read-back, the `screeningData` loader, and field
  integrity. Stable across repeated runs.
- **Live suite** (`npm run test:live`, needs a real Medplum server + a
  `ClientApplication`'s id/secret — see `CLAUDE.md`) — idempotency,
  constraint acceptance, retraction round-trip, and transaction atomicity.
  The live suite has twice caught real server-only bugs the unit suite
  couldn't (a search form MockClient fakes but the server doesn't honor;
  a retraction that violated `ait-2`/`con-5`) — both fixed. **Confirm this
  suite is green before trusting the bundle refactor (below) is done.**
- Parent-package test suite: 9 pre-existing failing files (a Vitest/ESM
  `vi.spyOn`-on-module-export limitation, unrelated to DJS code) — not
  ours to fix, don't be alarmed if the count doesn't change.

---

## Open

### 1. Confirm task 9 (transaction bundles) against the live server

Each section's save now batches into one FHIR transaction Bundle instead
of N sequential writes, so a mid-save failure should leave the section
wholly unwritten rather than half-persisted. This is implemented and unit
tests pass, but **`MockClient` cannot verify transaction atomicity** (it
partial-commits on a bad entry) — only a live run against a real server
proves it. Run `npm run test:live`; if the atomicity test or any other
live test fails, that's a real finding, not a fluke.

### 2. Task 17 — extend form read-back to the remaining fields

Reopening a patient's screening repopulates most of the form
(`hydrateScreeningForm` in `hydrateScreening.ts`), but a few fields still
come back blank because their stored form is lossy to reverse, or they
were never mapped:

- **Medications** — `dosage`+`frequency` are merged into one string on
  save; splitting them back into the table's two columns is lossy.
- **Sign-off** — a formatted `valueString` (`Nurse: X; Physician: Y`) plus
  health-alerts in a note.
- **Mandated-reporter** checkbox + RN initials.
- **Extra demographics** — hair/eye colour, race, needs-interpreter,
  birthplace, ethnicity chip, the 6-cell vision-acuity grid.
- **`Other::` free text** on checklist items.
- **The four task-18 free-text fields** (chronic providers/PCP/comments,
  injuries detail) — they save correctly now, just aren't read back yet.

The wiring is already in place — the mount effect applies whatever
`hydrateScreeningForm` returns — so each of these is a mapping function
plus a unit test, following the existing pattern in that file.

---

## Backlog — before this could be pilot-ready, not blocking the demo

- **AccessPolicy.** Nothing currently restricts the sensitive sections
  (abuse history, substance use — for a minor population in state
  custody) beyond default patient-record visibility. The retraction model
  keeps an audit trail; access control is separate and unbuilt.
- **Coded terminology.** Most fields save free-text `CodeableConcept.text`
  rather than SNOMED/LOINC/RxNorm codes.
- **Field validation.** No required-field or range checks anywhere (vitals
  ranges, date sanity, etc.).
- **Pull the wizard out of the AppShell.** It currently draws its own
  `GovBanner`/header/sidebar/footer nested inside Medplum's own chrome.
  Deferred by explicit priority call, not forgotten.
- **`react-router` v8.** A `^8.3.0` bump was tried and reverted — it
  regresses 9 parent-package test files (`TaskPanel`, `EncounterModal`,
  `CommunicationTab`, `DocumentsPage`, `EditTab`, `IntakeFormPage`,
  `ResourceCreatePage`, `ResourceEditPage`, `TasksPage`). Stay on `7.18.1`
  unless someone deliberately picks up that migration.

## Environment note

`package-lock.json` is gitignored (inherited from upstream), so
`package.json`'s exact pins (no carets on any `@medplum/*` or
`react-router`) are the *only* version control in this repo — don't
loosen them without re-running the full parent-package suite to check for
regressions, the way the `react-router` v8 attempt was caught.
