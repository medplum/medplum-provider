# DJS Admission Screening — task plan

**Target:** a demo that *really saves* — a real Medplum project, real FHIR
writes, no duplicate-on-resave — and along the way, a real answer to
whether Medplum is a viable platform for this agency. Not a clickable
mockup; not yet pilot-ready (no AccessPolicy, no coded terminology, no
field validation).

**Standing priority:** function over appearance. UI polish (pulling the
wizard out of the AppShell, its own chrome) is explicitly deprioritised
until the data path is trustworthy.

For architecture, invariants, bug classes, and platform findings, see
`CLAUDE.md` — this file is the task list, not a history. Resolved work
gets a one-line mention with a commit hash; the reasoning behind it lives
in git history and, where it's still relevant going forward, in `CLAUDE.md`.

---

## Current state

The full data path is built and tested: save → no-duplicate (conditional
upsert, self-healing on retry) → retract-on-uncheck → resume-on-reopen
(read-back) → display (`PatientOverviewPage`).

- **113 DJS unit tests** (`npm test`) — `MockClient` only, no network.
  Stable across repeated runs.
- **Live suite** (`npm run test:live`) — needs a real Medplum server + a
  `ClientApplication`'s id/secret; see `CLAUDE.md` and
  `RUNNING-LIVE-TESTS.md` for setup/troubleshooting. Treat it as the actual
  proof of anything touching the write path — it has repeatedly caught
  real server-only bugs the unit suite couldn't.
- Parent-package test suite: ~9 pre-existing failing files (a Vitest/ESM
  `vi.spyOn`-on-module-export limitation, plus some flaky timeouts under
  full-suite load) — not ours to fix, don't be alarmed if the count doesn't
  match exactly run to run.

## Resolved (one-liners; see `CLAUDE.md` for anything still load-bearing)

- **17** — form read-back extended to every deferred field, all 8 steps.
- **18/19** — chronic-providers/pcp/comments/injuries-detail and
  disposition-notes/signoff-datetime/review-date data loss fixed.
  Discovered the comma-in-identifier duplication bug along the way → 20.
- **21** — appearance grid's discarded `Other::` free text fixed.
- **24** — admission `Encounter` created; admission date + facility persist
  (`Location`, keyed on a permanent code — see `CLAUDE.md`).
- **25** — blood pressure modeled as FHIR's two-component panel, not a
  string; input split into two numeric fields.
- **26** — LOINC + `category: vital-signs` + UCUM units on all vitals;
  `effectiveDateTime` preserved across re-saves (see `CLAUDE.md` bug classes).
- **42** — `PatientOverviewPage.tsx` replaces the old sidebar-embedded
  `DjsPatientSummary` + Medplum `PatientSummary` pair (see `CLAUDE.md`).
- **43** — section Save buttons advance to the next step on a successful
  save only (never on failure — see `CLAUDE.md` bug classes for why that
  matters).
- **36** — every resource type (not just Observation) now links to the
  admission Encounter, or to an explicit `:encounterId` route param when
  embedded (see `CLAUDE.md`).

---

## Open

**Task 20 — audit other search paths for the comma hazard.** `escapeSearchToken`
(local to the wizard file) fixed disposition-notes; sweep the rest of
`AdmissionHealthScreeningWizard.tsx` for identifier/search-token
construction that bypasses it, and consider promoting it to a shared
`screeningData.ts` export. **Blocked behind task 35** — if checklist
identifiers stop deriving from item names, the hazard may disappear rather
than need escaping; don't fix this twice.

**Task 22 — map medication drug names to RxNorm.** Dose/frequency are
already structured (`Dosage`); the drug name itself
(`medicationCodeableConcept.text`) is still free text. Needs a
drug-search/lookup UI this form doesn't have. Do before task 23.

**Task 23 — integrate prescribing/orders: `MedicationRequest` + DoseSpot.**
Blocked on task 22. The wizard's medication section is reconciliation/history
(`MedicationStatement`, correct); actual prescribing is `MedicationRequest`,
which is what Medplum's DoseSpot integration produces.

**Task 27 — assert "No known allergies" instead of discarding it.**
Currently `continue`d on save, so "no allergies" is indistinguishable from
"never asked."

**Task 28 — allergy `category`/`criticality`/`type`; per-allergy reaction.**
The grid items are FHIR's category value set. Separately, one shared
reaction textarea is copied onto every checked allergy — wrong data, not
just imprecise.

**Task 29 — practitioner attribution on every written resource.** Nothing
records *who* asserted a finding, though Medplum knows the logged-in user.
Peer to the AccessPolicy backlog item for a minor-in-custody population.

**Task 30 — coded `Condition.category`** (`problem-list-item` /
`encounter-diagnosis`) instead of `{ text: 'Nursing diagnosis' }`.

**Task 31 — `CarePlan.activity[]` instead of `join('; ')`.** Same
merged-string/separator-fragility pattern as the comma bug. Some plan
items are arguably `ServiceRequest`/`Task`, not plan text.

**Task 32 — sign-off as `performer` references**, not
`"Nurse: X; Physician: Y"` regex-parsed back. Nurse/physician are typed
strings with no link to real Practitioner accounts — a legally meaningful
sign-off is currently unattributable.

**Task 33 — US Core demographics conformance.** `us-core-race`/
`us-core-ethnicity` are complex extensions (`ombCategory` + `text`
sub-extensions); we write a flat `valueCodeableConcept` under those
official URLs — claiming US Core while failing it. Folds in BCP-47
language coding.

**Task 34 — SPIKE: `QuestionnaireResponse` as the persistence model.**
Timeboxed evaluation, deliverable is a written recommendation, not code.
Most of this project's bug backlog (identifier collisions, comma escaping,
retraction scoping, "wired in JSX but never saved") is inherent to
hand-rolling form persistence; `QuestionnaireResponse` round-trips
losslessly by construction. Is the current architecture fighting the
platform, and what would migrating cost?

**Task 35 — checklist code/value inversion + past history as Condition.**
Largest open item; needs a design decision before decomposing. Across
appearance/ROS/dental/infectious the *value* carries the finding and the
*code* is a bucket, inverting FHIR convention — findings are unqueryable
by code. May be substantially subsumed by task 34. **Sequencing: 34 → 35 →
20** — don't fix task 20 before this settles, or the fix may be redone or
become moot.

**Task 36 — thread the admission Encounter reference through every
resource type. — DONE.** `ensureEncounterRef()` (mirrors `ensurePatientRef()`)
resolves either the route-param `encounterId` (embedded case, unchanged) or
the wizard's own admission Encounter, and every save handler now threads it
explicitly through `obs()`/`saveObservationSet()` and into every
Observation/Condition/AllergyIntolerance/CarePlan (`encounter`) and
MedicationStatement (`context` — different field name, verified against
`@medplum/fhirtypes` rather than assumed). See `CLAUDE.md` for the
mutation-tested finding on what actually prevents duplicate Encounters
(the conditional upsert, not the state cache).

**Task 37 — model the Allegany County Youth Centers grouping via
`Location.partOf`.** Purely additive. The last four facilities in
`djsFacilities.ts` are a distinct class (Youth Centers) with no known
canonical type code — model the grouping structurally rather than guess a
`Location.type`.

**Task 38 — replace `preview.html` with a `MockClient`-backed demo route.**
`preview.html` is a hand-maintained static mirror that drifts by
construction (already missed two UI changes) and never loads `tokens.css`.
Don't just delete it — it serves a real need (viewing the UI without
Medplum credentials, which incoming design/product folks need). Approach:
a demo route rendering the real wizard inside `MedplumProvider` +
`MockClient` — already proven, since the test suite does exactly this via
`renderWizard(new MockClient())`. Get two things right: make it
unmistakably a demo (a visible banner, not just a URL), and decide whether
it ships in the production build (lean dev-only). Then remove the
`preview.html` references in `README.md`/`CLAUDE.md`/`CONTRIBUTING.md`.

**Task 39 — patient edit fails: server has no `us-core-patient`
StructureDefinition. Deprioritized, not abandoned.** Root cause confirmed:
a fresh Medplum Project ships base FHIR only, and nothing in this
project's setup flow loads US Core — not a bug in `EditTab.tsx`/
`ResourceFormWithRequiredProfile.tsx` (both already do the right thing).
Fix scripts exist (`scripts/load-us-core-profiles.{sh,ps1,cmd}`,
documented in `RUNNING-LIVE-TESTS.md` §7) but **failed against the
Docker-hosted server** — downloaded/extracted fine, then the server
rejected the first StructureDefinition create as not actually being one.
Both scripts now print what they found on failure instead of a blank
error, so a retry should be self-diagnosing. Patient edit stays broken
until this is picked back up.

**Task 40 — surface the admission Encounter in the UI.** Smaller than it
looks: a "Visits" tab already exists (`PatientPageTabs`), unfiltered, and
verified to actually match our admission Encounter (`Encounter.subject`).
Real work is narrower — decide whether "Visits" needs a hint pointing at
it, since it's not an obvious place to look for "the admission screening's
encounter" among ~12 tabs. Do after task 36 (an Encounter nothing points
to is an empty shell).

**Task 41 — "Start admission screening" / "New encounter" buttons on the
patient page.** The prepopulate-from-`patientId` path is already proven
(existing tests), so the screening button just needs to link to
`/admission-screening/:patientId`. Settle whether a standalone "new
encounter" is a distinct clinical act, or duplicates what saving the
screening's first section already does, before building both paths.

**Task 44 — export tab: accept date-only input, default end date to now.**
Establish whether the page is ours or stock `medplum-provider` before
patching a vendored file.

---

## Backlog — before this could be pilot-ready, not blocking the demo

- **AccessPolicy.** Nothing restricts the sensitive sections beyond default
  patient-record visibility. Retraction preserves an audit trail; access
  control is separate and unbuilt.
- **Coded terminology.** Itemized above rather than one vague line — see
  tasks 26 (done), 28, 30, 33, 22.
- **Field validation.** No required-field or range checks anywhere.
- **Pull the wizard out of the AppShell.** Deferred by explicit priority
  call, not forgotten.
- **`react-router` v8.** A bump was tried and reverted — regresses 9
  parent-package test files. Stay on `7.18.1` unless someone deliberately
  picks up that migration.

## Environment note

`package-lock.json` is gitignored (inherited from upstream), so
`package.json`'s exact pins (no carets on any `@medplum/*` or
`react-router`) are the *only* version control here — don't loosen them
without re-running the full parent-package suite, the way the
`react-router` v8 attempt was caught.
