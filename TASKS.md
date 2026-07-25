# DJS Admission Screening — task plan

Working plan for getting the wizard to a functioning, demonstrable
prototype. Current as of commit `2148f2b`.

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
| — | Unblock `npm install`; pin dependency versions | `4a31626` |
| 12 | Retract single-value fields (vitals, pain, complaint) | `cdfe972` |
| 13 | Save the Epi-Pen fields | `cdfe972` |
| 14 | DJS test coverage (constraint validity, subject, retraction, pain, read-back) | `e2fbf7c`, `cdfe972`, later files |
| 15 | DJS patient summary + shared `screeningData` loader | `ac20232`, `e269d99`, `b7f71f1` |
| 16 | Show DJS summary on the patient page | `f2d54cf` |
| 10 | Form read-back on mount | `9d6d54f`, `de93193` |
| — | Live-server tests: idempotency, constraint acceptance, retraction | `cfe0d4f`, `2148f2b` |

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
- **`npm install` was hard-failing (`4a31626`).**
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

- **Locally, by automated unit test (49 DJS tests, `npm test`):**
  - **Constraint validity** across all four sections, via `validateResource`
    — the `ait-1`/`con-3`/`ele-1` class, mutation-verified.
  - **Idempotent upsert** — saving a section twice updates in place.
  - **Retraction round-trip** — uncheck → `entered-in-error`, not deleted.
  - **Subject integrity** — first-time save references a real patient
    (the task-8 orphan bug).
  - **Pain absent-vs-zero** — reported-but-unscored saves `dataAbsentReason`.
  - **Form read-back** — a seeded patient's screening repopulates the form.
  - **`screeningData` loader** — retraction/duplicate filtering; **DJS patient
    summary** rendering, incl. a retracted finding staying off screen.
  - **Field integrity** and `FormState`/`parseItems` logic.
- **Against a live server, by automated test (`npm run test:live`):** three
  scenarios via a client-credentials login to a local Medplum stack — see
  `AdmissionHealthScreeningWizard.live.test.tsx`. These are the checks
  `MockClient` genuinely cannot make:
  1. **Idempotency** — demographics saved twice → one Patient, one
     Observation with a stable id.
  2. **Constraint acceptance** — an allergy (`ait-1`), a chronic condition
     and nursing diagnosis (`con-3`), and a no-dosage medication (`ele-1`)
     all persist, i.e. the server *accepts* them. `validateResource` only
     proxies this offline.
  3. **Retraction round-trip** — unchecking an allergy marks it
     `entered-in-error` on the server, not deleted.
  - The live project is separate from `npm test` (see `vite.config.ts`) and
    skips cleanly without `MEDPLUM_LIVE_CLIENT_ID`/`SECRET`.
- **Also verified live by hand earlier:** routing, save toasts, pain slider,
  and the original `ait-1` failure that prompted the constraint fixes.
- **Locally, by hand:** `npm install` completes, `npm run build` passes.
- **`react-router` stays at 7.18.1.** The `^8.3.0` bump was tested and
  **reverted** — see the dependency note above.

### Still needs a live server

The live tests above now cover idempotency, constraint acceptance, and the
retraction round-trip — the write-path behaviours that most needed a real
server. Still not exercised against one:

1. **Transaction atomicity** — task 9; only meaningful once bundles are
   implemented, and only verifiable on a real server (MockClient does not
   roll transactions back).
2. **AccessPolicy** — restricting the sensitive sections; not built yet.
3. **Terminology binding / reference existence** — `validateResource`
   covers the structural/FHIRPath constraint class, not these.

Cheap live additions if wanted: read-back and the DJS summary against
real data (both are covered offline against `MockClient` today).

### Full test suite state

Baseline on `react-router` 7.18.1: **9 files / 44 tests failing, the rest
passing.** None of the failures are in DJS code — all 49 DJS unit tests
pass (plus 3 live tests, run separately via `npm run test:live`).

The failures are the parent package's pre-existing Vitest/ESM limitation:
`vi.spyOn()` on a module export (`useNavigate`, `PatientSummary`,
`normalizeErrorString`) raises `Cannot spy on export` / `Cannot redefine
property`, plus a couple of 5s timeouts under load. Not fixable by a
dependency version (confirmed under `vitest` 4.1.9); fixing means
rewriting those tests to `vi.mock()`, which is parent-package work. The
earlier "18 files / 106" figure was the `react-router` 8 regression, now
reverted; the earlier "15 / 76" was measured before this code state.

---

## How the offline constraint check works (the `captureWrites` harness)

`MockClient` does **not** validate on write — it will store an
`ait-1`-violating resource without complaint — but `validateResource` from
`@medplum/core` reproduces the server's constraint checks *exactly* (same
`ait-1` error text). So the `captureWrites` harness in
`AdmissionHealthScreeningWizard.test.tsx` wraps every write, runs
`validateResource`, and collects failures. The constraint test drives all
four sections and asserts zero violations; it was **mutation-verified** —
removing the allergy `clinicalStatus` makes it fail with the real `ait-1`
message, so the guard demonstrably bites. This is the offline proxy; the
live constraint-acceptance test (above) is the real proof that the server
accepts the same resources.

Any new section or resource type should be driven through a test using
`captureWrites` and asserting `capture.validationErrors` is empty.

---

## Open

### 12 — Retract single-value fields — **DONE** (`cdfe972`)

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

### 13 — Save the Epi-Pen fields — **DONE** (`cdfe972`)

Persisted in `saveAllergiesChronic` through `saveObservationSet`, so it
gets upsert and retraction like everything else. A recorded "No" is saved
too, not just "Yes" — absence of an Epi-Pen is itself clinically relevant.
`epipen` was removed from `KNOWN_OPEN_BUGS` in the field-integrity test in
the same change; that test passing is now the proof the field is read.

### 10 — Form read-back on mount — **DONE** (`9d6d54f`, `de93193`)

The form is now resumable. `hydrateScreeningForm(data, patient)` in
`hydrateScreening.ts` is a **pure** reverse of the save handlers (live
resources → form values); the wizard's mount effect loads via
`loadScreeningResources`, hydrates, and applies scalar setters + FormState.

Keeping the mapping pure and unit-tested is the deliberate defense against
the "field wired but never handled" bug class doubling — that class is
**invisible to the field-integrity grep**, which only sees FormState
symmetry, not a resource → field mapping. 8 unit tests + 1 integration test
(mount at the patient route, assert inputs populate). 49 DJS tests total.

Covered: vitals, pain, complaint, allergies+reaction, chronic list,
appearance/ROS checklists, nursing diagnoses, nursing plan, core Patient
demographics. **Deferred to task 17** (lossy or extra): medications,
sign-off, mandated-reporter, hair/eye/race/interpreter/birthplace/
ethnicity/vision-acuity, and `Other::` free text.

Found while mapping — **task 18**: `chronic-providers`, `chronic-pcp`,
`chronic-comments` and `injuries-detail` are captured in the JSX but written
by no save handler (epipen-class data loss). Read-back can't restore what
isn't persisted, so the write must be fixed first.

### 9 — Batch each section's writes into a transaction Bundle — **ATTEMPTED, reverted; do on the backend**

Each handler issues N sequential awaited writes with no transaction, so a
failure mid-save leaves the section half-persisted. The fix is one FHIR
`transaction` Bundle per section.

**This was implemented in full and then reverted.** Why: it can't be
verified against `MockClient`, and it broke a green test that a real
server wouldn't. Probing `MockClient.executeBatch` found:

1. Transaction bundles + conditional PUT **work** for create and
   same-session conditional-match update.
2. But MockClient does **not enforce transaction atomicity** — an
   `ait-1`-violating entry did not roll the bundle back. So task 9's whole
   point (a mid-save failure leaves nothing written) is **unverifiable**
   against the mock.
3. Worse, a resource **created via a bundle** conditional PUT is not
   reliably found by a later `searchResources` in the running component
   flow — `searchResources('AllergyIntolerance', {})` returned 0 in the
   second save though the resource existed. That broke the retraction
   round-trip test, on a MockClient limitation, not a real bug.

The refactor (one `ScreeningBundle` per section's onClick; `obs`/upserts
append entries; `commitBundle` → `executeBatch({type:'transaction'})`;
retractions kept as direct idempotent `updateResource` on prior-save data)
got 5/6 wizard tests green, but the 6th can't pass on the mock and
atomicity can't be shown offline either way. Reverted to the
sequential-upsert version (**49 DJS tests green**).

Kept: the checkpoint-1 harness change (`captureWrites` intercepts
`executeBatch`, `a5ab376`) — harmless with no producer, and needed when
this lands.

**Recommendation: implement on the real backend**, where the transaction
is actually atomic and testable. Low urgency regardless — conditional
upsert already makes a partial save self-heal on the next save, so this is
hardening, not a blocker. This is the one task that genuinely needs the
backend to complete *and* verify.

### 17 — Extend form read-back to the deferred fields

`hydrateScreeningForm` (task 10) covers vitals, pain, complaint, allergies,
chronic, appearance/ROS checklists, nursing diagnoses, nursing plan, and
core demographics. Still not mapped back on resume, because their stored
form is lossy or they're extra fields:

- **Medications** — stored `dosage`+`frequency` merged into one string,
  lossy to split back into the two table columns.
- **Sign-off** — a formatted `valueString` (`Nurse: X; Physician: Y`) plus
  health-alerts in a note; parse them back.
- **Mandated-reporter** checkbox + RN initials.
- **Extra demographics** — hair/eye colour, race, needs-interpreter,
  birthplace, ethnicity chip, the 6-cell vision-acuity grid.
- **`Other::` free text** on checklist items.

Wiring is already in place — the mount effect applies whatever the pure
function returns — so each is a mapping in `hydrateScreeningForm` plus a
unit test.

### 18 — Save `chronic-providers` / `-pcp` / `-comments` and `injuries-detail`

Four text fields captured in the JSX (`value=form.text` / `onChange=
form.setText`) but read by **no save handler**, so the input is silently
discarded — the same epipen-class bug as task 13. Confirmed by grep: each
key appears only at its JSX line. Fix by persisting them via
`saveObservationSet` in the right section handler (chronic-* in
`saveAllergiesChronic`, `injuries-detail` in `saveReviewOfSystems`), then
add the reverse mapping to task 17. The field-integrity test **cannot**
catch this class — a JSX `value=` read counts as a read — so it needs a
targeted check or a manual JSX-vs-handler diff.

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

Wired onto the patient page in task 16 (`f2d54cf`).

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

### 14 — Test coverage for the DJS wizard — **DONE** (`e2fbf7c`, `cdfe972`, later files)

**49 DJS unit tests** plus **3 live tests**, following the parent package's
Vitest pattern. Unit files: `formState.test.ts`,
`AdmissionHealthScreeningWizard.fieldIntegrity.test.ts`,
`AdmissionHealthScreeningWizard.test.tsx` (save-twice, constraint validity,
subject integrity, retraction round-trip, pain absent-vs-zero, read-back),
`screeningData.test.ts`, `hydrateScreening.test.ts`,
`DjsPatientSummary.test.tsx`. Live file:
`AdmissionHealthScreeningWizard.live.test.tsx` (idempotency, constraint
acceptance, retraction — see the Verified section). The `captureWrites`
harness is reusable for future sections.

The only test still owed is the **bundle-rollback** case, which belongs to
task 9 and can't be written until bundles exist (and only verified on a
real server). The original plan and parent-style reference notes follow.

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
