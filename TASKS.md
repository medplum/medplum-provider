# DJS Admission Screening — task plan

Working plan for getting the wizard to a functioning, demonstrable
prototype. Current as of commit `e2fbf7c`.

**Target defined with the user:** a demo that *really saves* — backed by a
real Medplum project, writing real FHIR, no duplicate-on-resave. Not just
a clickable mockup, and not yet pilot-ready (no tests, validation, or
access policies).

**Standing priority:** function over appearance. UI polish is explicitly
deprioritised until the data path is trustworthy.

---

## Done

| # | Task | Commit |
|---|---|---|
| 1 | Fix `JSX` namespace errors in the 10 DJS files | `33ac636` |
| 2 | Add missing `@medplum/mock` + `@medplum/definitions` devDeps | `33ac636` |
| 3 | Get `npm run build` passing clean | `33ac636` |
| 4 | Route the wizard inside the existing `App.tsx` | `95faefb` |
| 5 | Scope `tokens.css` so it can't restyle the host app | `95faefb` |
| 6 | Read patient/encounter from route params | `95faefb` |
| 7 | Save feedback — pending state + success/error toasts | `95faefb` |
| 8 | Idempotent saves via conditional upsert; fix orphaned `subject` | `0e8f04b` |
| 11 | Retract findings the form no longer asserts | `0e8f04b` |
| — | FHIR constraint fixes: `ait-1`, `con-3`, `ele-1` | `2b3fdba` |
| 14 (part) | `formState`, field-integrity, and save-twice tests | `e2fbf7c` |
| — | Unblock `npm install`; pin dependency versions | uncommitted |

Several of these were bugs found along the way rather than planned work:

- **Orphaned resources (task 8).** `subjectRef` was computed at render
  time, so a first-time save wrote `subject: undefined` on every resource.
  The `/admission-screening` route hit this every time.
- **Missing devDeps (task 2).** Pre-existing; `npm run build` failed on a
  fresh clone for anyone, unrelated to the wizard.
- **FHIR constraint violations (`2b3fdba`).** Saving an allergy failed with
  `ait-1` — `AllergyIntolerance` was written with no `clinicalStatus`.
  Pre-existing; it only became *visible* once task 7 added error toasts,
  so allergies had most likely never saved successfully. Auditing for the
  same class found three more: nursing-diagnosis `Condition` had the
  identical `con-3` bug latent (would have failed on section 4), chronic
  conditions used a text-only `clinicalStatus` that doesn't satisfy R4's
  required binding, and a `MedicationStatement` with no dosage or
  frequency emitted `dosage: [{}]`, violating `ele-1`.
- **`npm install` was hard-failing (uncommitted).**
  `@medplum/eslint-config` was set to `^2.0.26`, resolving to 2.2.10 — a
  different major line that peer-requires `eslint@^8`, while every sibling
  `@medplum/*` is pinned at 5.1.27 and `eslint` resolves to 9.x. `ERESOLVE`
  aborted the whole install, so nobody could set the project up from
  scratch. Restored to `5.1.27`.
- **`react-router` reverted from `^8.3.0` to `7.18.1`.** The major bump
  looked clean on every obvious check — it installed, `npm run build`
  passed, all 28 DJS tests passed, and the app rendered and routed
  correctly. It is still **not safe**: it regresses **9 parent-package test
  files** and roughly doubles failures within the affected set (44 → 107).
  Regressed only under 8.x: `TaskPanel`, `EncounterModal`,
  `CommunicationTab`, `DocumentsPage`, `EditTab`, `IntakeFormPage`,
  `ResourceCreatePage`, `ResourceEditPage`, `TasksPage`.

  Measured by installing each version and diffing the failing-file lists,
  which is the only reliable way to see it — build and DJS tests pass under
  both. If a v8 migration is wanted later, those 9 files are the work item.
  Note `@medplum/react@5.1.27` declares no `react-router` dependency or
  peer at all, so npm warns about nothing either way.

  Pinned exactly rather than with a caret: `package-lock.json` is
  gitignored, so ranges are the *only* version control in this repo and
  drift silently on every install.

**A recurring pattern worth noting:** three separate pre-existing defects
(orphaned `subject`, the discarded Epi-Pen answer, and `ait-1`) surfaced
only after error visibility improved or a check was written. Expect more
in sections that haven't been exercised with realistic data yet.

### Verified

- **Against a live server:** routing, save toasts, pain slider, and the
  `ait-1` allergy failure (which is what prompted the constraint fixes).
- **Locally, by automated test (32 DJS tests):**
  - **Constraint validity** across all four sections, via `validateResource`
    — the `ait-1`/`con-3`/`ele-1` class, mutation-verified.
  - **Idempotent upsert** — saving a section twice updates in place.
  - **Retraction round-trip** — uncheck → `entered-in-error`, not deleted.
  - **Subject integrity** — first-time save references a real patient
    (the task-8 orphan bug).
  - **Pain absent-vs-zero** — reported-but-unscored saves `dataAbsentReason`.
  - **Field integrity** and `FormState`/`parseItems` logic.
- **Locally, by hand:** `npm install` completes, `npm run build` passes.
- **`react-router` stays at 7.18.1.** The `^8.3.0` bump was tested and
  **reverted** — see the dependency note below.

### Still needs a live server

The offline tests above cover the write path's *logic*. A real server is
still owed for, as a one-time smoke check:

1. **Auth + real persistence** — genuine login and round-trip.
2. **Validation beyond structural/FHIRPath** — AccessPolicy, terminology
   binding to a real ValueSet, reference existence. `validateResource`
   covers the constraint class that has actually bitten here, not these.

### Full test suite state

Baseline on `react-router` 7.18.1: **9 files / 44 tests failing, the rest
passing.** None of the failures are in DJS code — all 32 DJS tests pass.

The failures are the parent package's pre-existing Vitest/ESM limitation:
`vi.spyOn()` on a module export (`useNavigate`, `PatientSummary`,
`normalizeErrorString`) raises `Cannot spy on export` / `Cannot redefine
property`, plus a couple of 5s timeouts under load. Not fixable by a
dependency version (confirmed under `vitest` 4.1.9); fixing means
rewriting those tests to `vi.mock()`, which is parent-package work. The
earlier "18 files / 106" figure was the `react-router` 8 regression, now
reverted; the earlier "15 / 76" was measured before this code state.

---

## What the offline tests now cover, and what still needs a server

**Task 14 is done (32 DJS tests).** The manual "save each section and see
what FHIR rejects" pass is now automated. Key finding from probing
`MockClient`: it does **not** validate on write — it will store an
`ait-1`-violating resource without complaint — but `validateResource` from
`@medplum/core` reproduces the server's constraint checks *exactly* (same
`ait-1` error text). So the `captureWrites` harness in
`AdmissionHealthScreeningWizard.test.tsx` wraps every write, runs
`validateResource`, and collects failures. The constraint test drives all
four sections and asserts zero violations; it was mutation-verified —
removing the allergy `clinicalStatus` makes it fail with the real `ait-1`
message, so the guard demonstrably bites. Retraction round-trip and
first-save subject integrity are covered the same way, plus the pain
absent-vs-zero case. `MockClient`'s conditional-upsert and `identifier`
token-search semantics were confirmed to match the server.

**What still needs a live server** (one smoke check, not per-change):

- **Auth and real persistence** — a genuine login and round-trip.
- **Beyond structural/FHIRPath constraints** — `validateResource` covers
  the class that has actually bitten here (`ait-1`/`con-3`/`ele-1`), but
  not AccessPolicy rejections, terminology binding to a real ValueSet, or
  reference-existence checks. Faithful for this prototype's known failure
  modes; not a full server.

### Tests still owed — but they belong to tasks 9 and 10, not 14

- **Task 10 (read-back): no coverage, and the field-integrity grep can't
  help.** That check greps `form.setText`/`form.text` symmetry in source;
  read-back adds a resource → FormState mapping the regex can't see, so a
  field that reads into the wrong key passes clean. Needs new tests that
  *seed* `MockClient`, mount at `/admission-screening/:patientId`, and
  assert inputs come back populated. `renderWizard` will need to take a
  patient id (today it hard-codes the patient-less route).
- **Task 9 (bundles): the save-twice test will need editing, and the
  rollback property is untested.** Save-twice asserts on mechanism
  (`createSpy` call count); moving writes into an `executeBatch` Bundle
  hides them from that spy, though its `searchResources` assertions
  survive. Nothing yet asserts a mid-save failure leaves *nothing*
  written — task 9's whole point — so it could ship broken green. Add a
  test that forces one write to reject and asserts rollback.

---

## Open

### 12 — Retract single-value fields — **DONE** (uncommitted)

All 20 are now reconciled: the 14 single-value Observations plus the 6
vision-acuity fields. Done via a new `saveObservationSet(subject, fields)`
helper — each section declares its fields as a list of
`{ code, value }`, writes the ones with a value, and derives the
retraction scope from *that same list*. `value: undefined` means cleared:
declared, not written, retracted if a previous save recorded it.

Declaring the fields as data rather than a run of `if (x) await obs(...)`
statements is the point. An enumerated scope constant maintained alongside
the writes would drift, and that drift would be *invisible* — a field
missing from the scope simply never gets retracted, leaving a stale
clinical value asserted with nothing to flag it.

Correctly excluded: the sign-off Observation is written unconditionally,
so it can never be stale. Checklist-driven and ROS fields keep their
existing task-11 scopes.

### 13 — Save the Epi-Pen fields — **DONE** (uncommitted)

Persisted in `saveAllergiesChronic` through `saveObservationSet`, so it
gets upsert and retraction like everything else. A recorded "No" is saved
too, not just "Yes" — absence of an Epi-Pen is itself clinically relevant.
`epipen` was removed from `KNOWN_OPEN_BUGS` in the field-integrity test in
the same change; that test passing is now the proof the field is read.

### 10 — Populate form fields from existing resources on mount

Duplicates are prevented, but the form isn't **resumable**: opening a
partially-completed screening shows blank fields. A nurse interrupted
mid-screening can't pick up where they left off, which a real admission
workflow needs.

Use `loadScreeningResources` from `screeningData.ts` (built for task 15) to
fetch and filter the resources, then map them back into `FormState` keys by
their screening identifier. The load/filter/dedupe half is done; what's left
is the resource → FormState mapping. Note this **doubles the surface for the
"field wired in the JSX but missing from the handler" bug class** — run the
field-integrity script in `CLAUDE.md` before and after, or better, turn it
into a real test first.

### 9 — Batch each section's writes into a transaction Bundle

Each handler issues N sequential awaited writes with no transaction, so a
failure mid-save leaves the section half-persisted. Replace with one FHIR
transaction Bundle per section.

Partly a refactor of whatever tasks 10 and 12 land on, so it's cheaper
after them than before.

### 15 — DJS patient summary component — **DONE** (`ac20232`, `e269d99`, `b7f71f1`)

Two pieces plus a unification:

- **`src/pages/screeningData.ts`** — `loadScreeningResources(medplum,
  patientId)`, the shared reader. Searches the five screening resource
  types, drops retracted resources, drops non-screening resources (the
  fallback search has no identifier filter), and collapses legacy
  duplicates to the most recent per key. This is also the primitive task
  10 (read-back) should build on. 5 tests.
- **`src/components/DjsPatientSummary.tsx`** — compact read-only summary
  (vitals, pain, allergies, chronic, medications, nursing diagnoses,
  sign-off), each section shown only if present, with empty/loading/error
  states, styled in `.djs-*` inside `.djs-root`. 3 tests, including that a
  retracted finding stays off screen.
- **Unification** — the wizard's `SCREENING_ID_SYSTEM` and `isRetracted`
  now come from `screeningData.ts`, so writer and reader share one
  definition of "retracted". Divergence there would be a silent bug.

Not yet wired into any route — that's task 16. 40 DJS tests pass.

Original brief, for reference:

Build a DJS-styled patient summary that surfaces what the wizard saves —
vitals (temp, pulse, resp, BP, weight, height, BMI), allergies, chronic
conditions, current medications, pain score, screening sign-off — showing
each section only if data exists, with a clear empty state when a patient
has no screening on file.

Read by searching the `SCREENING_ID_SYSTEM` identifier for the patient,
the same key scheme the wizard writes (see the write path in `CLAUDE.md`).

**Two things it must handle that the wizard's own path doesn't yet:**

1. **Skip retracted resources.** Observation/MedicationStatement with
   `status: 'entered-in-error'`, and Condition/AllergyIntolerance with
   `verificationStatus` entered-in-error, are findings the nurse withdrew.
   Displaying them would defeat the point of task 11.
2. **Tolerate legacy bad data.** Existing test data contains duplicates
   and subject-less resources from the pre-`0e8f04b` bugs.

Style with the existing `.djs-*` classes and keep it inside a `.djs-root`
subtree so the scoped rule applies.

**Overlaps task 10.** The read logic is largely the same as form
read-back — extract a shared "load screening resources for patient"
helper so the two can't diverge.

### 16 — Show the DJS component on the patient page — **DONE** (`f2d54cf`)

Resolved the replace-vs-supplement decision as **supplement**:
`DjsPatientSummary` renders above Medplum's `PatientSummary` in the sidebar,
so the default sections (vitals, meds, allergies, problems, pharmacies,
Order Labs trigger) all stay — additive, no regression. `PatientPage.test.tsx`
still fails only on the pre-existing `vi.spyOn`-on-`PatientSummary` ESM
limitation; its 9 passing cases render the full page including the new
component's `loadScreeningResources` call without crashing.

If a *full* replacement is ever wanted, the original brief below has the
list of default sections that would be lost.

Original brief, for reference:

Replace the patient component currently in the UI. It's Medplum's
`PatientSummary` from `@medplum/react`, in `PatientPage`'s left sidebar at
`src/pages/patient/PatientPage.tsx:78`, taking `patient`,
`onClickResource`, and a `sections` prop built at line 48 from
`getDefaultSections()` with a pharmacies section swapped in.

**Decide explicitly whether this replaces or supplements it.** Full
replacement drops the default sections — vitals, medications, allergies,
problems, pharmacies, and the Order Labs modal trigger wired through
`setIsLabsModalOpen`. Confirm which are still wanted before deleting them,
or this is a feature regression rather than a swap.

Note `PatientPage.test.tsx` is one of the ~15 pre-existing failing files
(the `vi.spyOn` ESM limitation, on `PatientSummary` among others), so
check whether the swap makes it pass, still fails for that same
pre-existing reason, or fails for a new one.

### 14 — Test coverage for the DJS wizard — **DONE** (uncommitted)

32 DJS tests, following the parent package's Vitest pattern:
`formState.test.ts` (24), `AdmissionHealthScreeningWizard.fieldIntegrity.test.ts`
(3), and `AdmissionHealthScreeningWizard.test.tsx` (5: save-twice,
constraint validity, subject integrity, retraction round-trip, pain
absent-vs-zero). The `captureWrites` harness — validate every write via
`validateResource`, collect failures — is reusable for future sections.
The remaining owed tests (read-back, bundle rollback) belong to tasks 10
and 9 and are described under "What the offline tests now cover" above.

The original plan and parent-style reference notes follow, kept for
whoever writes the task-9/10 cases.

---

There is currently no coverage for any DJS code, despite an established
Vitest pattern throughout the rest of `medplum-provider` (colocated
`*.test.ts(x)` files, `describe`/`test` from `vitest`). This task ports
that pattern onto the wizard rather than inventing a new one.

**Reference files already in the repo that define "the parent style":**
- `src/pages/meds/OrderMedicationPage.test.tsx` — component/page pattern:
  render with `MantineProvider` → `MedplumProvider medplum={new MockClient()}`
  → `MemoryRouter`/`Routes`, drive it with `@testing-library/user-event`,
  assert on `vi.spyOn(medplum, 'createResource' | 'updateResource')` calls.
- `src/components/meds/quantity-qualifiers.test.ts` — pure-logic pattern
  for a sibling file with no React/Medplum involved: plain `describe`/`test`
  over exported functions, one `describe` block per function, regression
  cases documented inline with a comment explaining the bug they lock in.
- `src/test.setup.ts` — already wired via `vitest.config` (`setupFiles`),
  indexes FHIR StructureDefinitions/SearchParameters so `MockClient`
  resources validate. Nothing to add here.

**Steps, roughly in order:**

1. **DONE — `src/pages/formState.test.ts`.** Pure-logic tests for
   `FormState` (`chip`/`setChip`, `text`/`setText`,
   `checkedItems`/`checkTextMap`, `rows`/`setRows`) and `parseItems()`,
   using `renderHook`/`act` from `@testing-library/react` per the repo's
   own `useSchedulingStartsAt.test.tsx` pattern. Covers the trailing-`|`
   bug (and the same failure at a leading `|`) plus `::text` free-text
   marker parsing. 24/24 passing.

   Running the full suite (`npm test`) surfaced 15 pre-existing failing
   files / 76 failing tests, all unrelated to this file — every one is
   `TypeError: Cannot spy on export "X". Module namespace is not
   configurable in ESM.` from `vi.spyOn()` on a module export (e.g.
   `useNavigate`, `PatientSummary`) in files like `TaskPanel.test.tsx`,
   `PatientPage.test.tsx`, `TasksPage.test.tsx`. Pre-existing Vitest/ESM
   limitation in the parent package, not introduced by DJS work — left
   alone by design; out of scope here.

   **Baseline discrepancy — RESOLVED.** A later run measured 18 files /
   ~106 tests failing against the 15 / 76 above. The cause was the
   `react-router` `^8.3.0` bump, not noise: diffing failing-file lists
   between 8.3.0 and 7.18.1 showed 9 files that fail only under 8.x.
   `react-router` has been reverted to `7.18.1`, which restores this
   baseline. See the dependency note in the Done section.

   The remaining failures really are pre-existing and unrelated to DJS
   code. If this figure moves again, diff the failing-file lists rather
   than assuming — the totals alone hid a 9-file regression.

2. **DONE — `src/pages/AdmissionHealthScreeningWizard.fieldIntegrity.test.ts`.**
   Ports the field-integrity script and the `code.text` collision grep
   from `CLAUDE.md` verbatim (same regexes) into three Vitest tests:
   read-but-never-set is asserted empty with no allowlist; set-but-never-
   read is asserted to *exactly* match a documented list split into
   `KNOWN_SCRIPT_BLIND_SPOTS` (permanent — `injuries`/`firearm-safety`/
   `infectious`, read only through a loop variable) and `KNOWN_OPEN_BUGS`
   (currently just `epipen`, tied to task 13 — the list is meant to
   shrink, and the test comment says so explicitly); collision check on
   `code: { text: '...' }` duplicates. All three pass against the current
   source. Whoever closes task 13 should delete `epipen` from
   `KNOWN_OPEN_BUGS` in the same change — the test will fail with
   "expected list not to contain 'epipen'" as a reminder if they forget.

3. **`src/pages/AdmissionHealthScreeningWizard.test.tsx`** — component
   tests following `OrderMedicationPage.test.tsx`'s render setup. Priority
   order for what to cover:
   - **DONE — Save-twice idempotency**
     (`src/pages/AdmissionHealthScreeningWizard.test.tsx`). Fills Last
     name + Color of hair on the demographics section, saves twice with
     no edits in between. Asserts `createResource` fires exactly once
     (Patient created only on save #1, updated via `updateResource` on
     save #2 — the orphaned-subject/duplicate-patient regression from
     task 8), and that `medplum.searchResources` for the Hair color
     Observation returns exactly one resource, same `id`, after both
     saves — proving the conditional upsert lands as an update rather
     than a second resource. Not executed against a live server (no
     network in the environment that wrote it) — please confirm with
     `npx vitest run src/pages/AdmissionHealthScreeningWizard.test.tsx`.
   - Orphaned-subject regression: first-time save on a fresh
     `/admission-screening` route (no existing Patient) — assert every
     written resource's `subject`/`patient` reference is defined, never
     `undefined`. This is the exact bug `ensurePatientRef()` exists to
     prevent.
   - Retraction round-trip: check an item, save, uncheck it, save again —
     assert the resource comes back `status: 'entered-in-error'` (or
     `verificationStatus` for Condition/AllergyIntolerance), not deleted
     and not still active.
   - `painScale` absent-vs-zero: an untouched pain slider must save a
     `dataAbsentReason`, not a coded `0`.
   - Once tasks 12/13 land: single-value retraction (a cleared vital
     doesn't leave its old value asserted) and Epi-Pen fields actually
     appearing in the save call.

4. **Sequencing note:** steps 1 and 2 are pure-logic/static, safe to write
   immediately, and give the most protection per hour. Step 3's
   retraction and Epi-Pen cases are cheapest to write *after* tasks 12 and
   13 land — otherwise the test either asserts today's buggy behavior or
   has to be written red and left failing on purpose. If 12/13 are still
   open when this is picked up, write those two cases last, or as
   deliberately-failing (`test.fails`) placeholders that document the gap.

5. **Housekeeping:** convert new test files to CRLF before considering
   the task done (see Formatting section below — the repo-wide sed
   command covers `.ts`/`.tsx`), and confirm `npm run build` still passes
   (it type-checks test files too, so a type error in a new test breaks
   the build same as app code).

---

## Backlog — not scoped, needed before real use

- **Coded terminology.** Most fields save free-text
  `CodeableConcept.text` rather than SNOMED/LOINC/RxNorm. Consistent but
  not standards-compliant, and it's why identifiers are derived from
  `code.text` instead of a code. The retraction statuses and
  `dataAbsentReason` do use real code systems.
- **Field validation.** None anywhere — no required fields, no vitals
  ranges, no date sanity.
- **AccessPolicy.** Nothing restricts the sensitive sections beyond
  default patient-record access, for a minor population in state custody.
- **Tests.** See task 14.
- **Pull the wizard out of the AppShell.** Deliberately deferred. It draws
  its own gov banner/header/sidebar/footer at `100vh`, so chrome nests
  inside Medplum's. Needs `App.tsx` restructured, since `AppShell` wraps
  all routes. Cosmetic for now; `minHeight: 100vh` → `100%` is the cheap
  partial fix.
- **Clean up test data.** Earlier test passes created duplicate
  Observations, and the orphaned-subject bug produced subject-less
  resources. Neither is cleaned up by any of the above.

---

## Environment note

"Really saves" needs a Medplum project to save into. `.env` is still the
stock template with an empty client ID — either a hosted project at
app.medplum.com or a local server on `:8103`.

`package-lock.json` is gitignored (inherited from upstream), so dependency
versions aren't locked in the repo. All `@medplum/*` deps are pinned
exactly in `package.json`, which limits the blast radius.
