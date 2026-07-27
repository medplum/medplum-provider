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

Open design and product decisions that block or shape tasks are tracked in
`DECISIONS.md`. Tasks that say "needs a design decision" or "blocked on X"
reference a numbered section there.

---

## Current state

The full data path is built and tested: save → no-duplicate (conditional
upsert, self-healing on retry) → retract-on-uncheck → resume-on-reopen
(read-back) → display (`PatientOverviewPage`).

- **142 DJS unit tests** (`npm test`) — `MockClient` only, no network.
  Previously flaky under full-suite CPU contention (a handful would report
  `Test timed out in 5000ms` under load, not because anything was actually
  broken); `testTimeout: 20_000` on the `unit` project fixed this —
  confirmed clean (0 timeouts) on a subsequent full run. Stable across
  repeated runs now.
- **Live suite** (`npm run test:live`) — needs a real Medplum server + a
  `ClientApplication`'s id/secret; see `CLAUDE.md` and
  `RUNNING-LIVE-TESTS.md` for setup/troubleshooting. Treat it as the actual
  proof of anything touching the write path — it has repeatedly caught
  real server-only bugs the unit suite couldn't. All green as of task 43's
  fallout being fixed (see below).
- **Parent-package test suite: ~7 failing files, none of them ours.** Two
  distinct things, not one vague bucket:
  - A pre-existing Vitest/ESM `vi.spyOn`-on-module-export limitation
    (`ExportTab.test.tsx`, `notifications.test.ts`) — confirmed present
    since the start of this project's DJS work, unrelated to anything
    here.
  - A newer, distinct regression: `RegisterPage.test.tsx`,
    `SignInPage.test.tsx`, and `ResourcePage.test.tsx` now fail with
    `Cannot read properties of undefined (reading 'MEDPLUM_LOGO_URL')`
    inside `@medplum/react`'s own `Logo.tsx`. Not present earlier in this
    project's history; best working guess is a transitive `@medplum/*`
    version shift from a clean `node_modules` reinstall, not yet
    confirmed or fixed. Don't assume it's the same class as the ESM-spy
    issue above — it isn't, and it's newer.
  Don't be alarmed if the exact file/test count drifts slightly run to
  run — `TaskStatusPanel.test.tsx` in particular has changed *which*
  assertion it fails on between runs (a Vitest-level timeout on one run,
  a testing-library `waitFor` failure on another), which points at
  flakiness rather than a single fixed cause.

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
  matters). Broke three pre-existing live tests that assumed a section
  stays active after saving (a field lookup, a checkbox lookup, and —
  worse — a re-save that silently saved the wrong section instead of
  failing loudly); all three fixed with an explicit `goToStep()` back to
  the section, the same pattern already used elsewhere. See the new bug
  class in `CLAUDE.md`.
- **36** — every resource type (not just Observation) now links to the
  admission Encounter, or to an explicit `:encounterId` route param when
  embedded (see `CLAUDE.md`).
- **38** — `preview.html` deleted; replaced by `/demo/admission-screening`
  (dev-only, real wizard against `MockClient`, verified stripped from the
  production bundle — see `CLAUDE.md`).

---

## Open

**Task 20 — audit other search paths for the comma hazard.** `escapeSearchToken`
(local to the wizard file) fixed disposition-notes; sweep the rest of
`AdmissionHealthScreeningWizard.tsx` for identifier/search-token
construction that bypasses it, and consider promoting it to a shared
`screeningData.ts` export. **Blocked behind task 35, which is blocked
behind DECISIONS.md §6 and §7** — if checklist identifiers stop deriving
from item names, the hazard may disappear rather than need escaping; don't
fix this twice.

**Task 22 — map medication drug names to RxNorm.** Dose/frequency are
already structured (`Dosage`); the drug name itself
(`medicationCodeableConcept.text`) is still free text. Needs a
drug-search/lookup UI this form doesn't have. Do before task 23.
**Blocked on DECISIONS.md §4** — the search UX and terminology source
need to be decided before implementation.

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
items are arguably `ServiceRequest`/`Task`, not plan text. **Blocked on
DECISIONS.md §3** — whether plan items are tracked clinical tasks or
documentation of intent changes the right data model entirely.

**Task 32 — sign-off as `performer` references**, not
`"Nurse: X; Physician: Y"` regex-parsed back. Nurse/physician are typed
strings with no link to real Practitioner accounts — a legally meaningful
sign-off is currently unattributable. **Blocked on DECISIONS.md §2** —
whether typed names are acceptable or linked accounts are required is a
policy question, not a technical one. Also closely coupled to DECISIONS.md
§1 (record locking): a sign-off is only meaningful as a lock trigger if the
signer's identity is verified.

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
platform, and what would migrating cost? **Needs the stakeholder question
in DECISIONS.md §7 answered first** — whether individual-resource
queryability is required determines whether QR is even viable.

**Task 35 — checklist code/value inversion + past history as Condition.**
Largest open item; needs a design decision before decomposing. Across
appearance/ROS/dental/infectious the *value* carries the finding and the
*code* is a bucket, inverting FHIR convention — findings are unqueryable
by code. May be substantially subsumed by task 34. **Blocked on
DECISIONS.md §6 and §7. Sequencing: 34 → 35 → 20** — don't fix task 20
before this settles, or the fix may be redone or become moot.

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

**Task 40 — "New encounter" button on the Overview page. — DONE.** A
`New encounter` button in `PatientOverviewPage` navigates to
`/Patient/:patientId/Encounter/new`, which opens the existing
`EncounterModal` already routed there — it pre-populates the patient field
from the route param and navigates to the new encounter's chart page on
creation. A standalone new encounter is a distinct clinical act from the
admission screening wizard (which creates its own `Encounter` automatically
when the first section saves). Tested in `PatientOverviewPage.test.tsx`.

**Task 41 — "Start admission screening" button on the patient page.** The
screening button just needs to link to `/admission-screening/:patientId`
from the Overview page. The `New encounter` button (task 40) covers the
standalone encounter case — this task is now only about the screening shortcut.
Prepopulate-from-`patientId` is already proven by existing tests.

**Task 44 — export tab: accept date-only input, default end date to now.**
Establish whether the page is ours or stock `medplum-provider` before
patching a vendored file.

**Task 45 — record locking: make a completed screening read-only.**
Once a screening is signed off (or a supervisor approves it), the record
should become non-editable. **Blocked on DECISIONS.md §1** — the trigger,
lock granularity, and who-can-unlock questions must be answered before any
implementation. Also blocked on §2 (sign-off identity) — locking on a
sign-off that can't be attributed to a real account is of limited value.

---

## Backlog — before this could be pilot-ready, not blocking the demo

- **AccessPolicy.** Nothing restricts the sensitive sections beyond default
  patient-record visibility. Retraction preserves an audit trail; access
  control is separate and unbuilt. **Blocked on DECISIONS.md §5** — the
  role model and which sections are sensitive must be defined before
  policies can be written.
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
