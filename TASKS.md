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
- **Locally:** `npm install` now completes, `npm run build` passes, and the
  28 DJS tests pass (`formState` 24, field-integrity 3, save-twice 1).
- **`react-router` stays at 7.18.1.** The `^8.3.0` bump was tested and
  **reverted** — see the dependency note below.

### Not yet verified against a live server

Most of `0e8f04b` and all of `2b3fdba` — idempotent upserts, retraction,
the orphaned-subject fix, and the four constraint fixes. This is a
substantial rewrite of the write path.

Worth checking specifically:

1. Save the same section twice → second save updates, doesn't duplicate.
   (Covered by a unit test against `MockClient`, not a real server.)
2. Check an allergy, save, uncheck it, save → `AllergyIntolerance` comes
   back `entered-in-error`; it should neither vanish nor stay active.
   `clinicalStatus` staying `active` alongside it is correct per `ait-1`.
3. Use `/admission-screening` with no patient → resources have a real
   `subject`.
4. Save each section once with realistic data, to flush out any remaining
   constraint violations of the `ait-1`/`con-3`/`ele-1` kind. Sections not
   yet exercised are where these hide.
5. If saves start erroring, suspect the `identifier=system|` search in
   `retractStale` — there's a client-side fallback, but that's the first
   place to look.

### Full test suite state

`npx vitest run` → **18 files / 106 tests failing, 98 files / 1152 tests
passing.** None of the failures are in DJS code.

The failures are the parent package's pre-existing Vitest/ESM limitation:
`vi.spyOn()` on a module export (`useNavigate`, `PatientSummary`) raises
`Cannot spy on export` / `Cannot redefine property`, plus some 5s timeouts
under load. Out of scope here, but note the count is **higher than the
15 files / 76 tests recorded when the tests were written** — see the
verification note under task 14 before assuming the delta is benign.

---

## Open

### 12 — Retract single-value fields *(recommended next; safety)*

Task 11 covered checklists, medications, nursing diagnoses, and Review of
Systems' three text fields. **Still uncovered: 14 single-value
Observations plus the 6 vision-acuity fields** — temperature, heart rate,
respiratory rate, blood pressure, weight, height, BMI, chief complaint,
pain severity, hair/eye colour, mandated-reporter, glasses history,
visual acuity ×6, and the sign-off.

Clearing any of these leaves the previous value asserted in the chart. **A
stale temperature of 101°F is the dangerous case** — same bug class as
task 11, but on the most clinically visible fields.

Do it carefully: hand-listing ~20 keys in a scope constant would drift
from the writes, which is the exact failure mode this file keeps hitting.
Restructure `saveVitals`/`saveDemographics` so each field is declared once
as a `(code, value)` pair, then derive both the writes and the
reconciliation scope from that single declaration.

### 13 — Save the Epi-Pen fields *(small, live data loss)*

The Allergies card renders a `track="epipen"` yes/no plus an
`epipen-detail` text input, but **no save handler reads either one**. The
nurse's answer to "Ever used / prescribed an Epi-Pen?" is silently
discarded.

Found by running the field-integrity script in `CLAUDE.md` while writing
these docs — a live instance of the bug class that script exists to catch.
Clinically relevant: Epi-Pen history matters for anaphylaxis response.

Fix in `saveAllergiesChronic`, routed through `obs()` so it participates
in upsert and retraction like everything else.

### 10 — Populate form fields from existing resources on mount

Duplicates are prevented, but the form isn't **resumable**: opening a
partially-completed screening shows blank fields. A nurse interrupted
mid-screening can't pick up where they left off, which a real admission
workflow needs.

Search by `SCREENING_ID_SYSTEM` identifier for the patient/encounter and
map results back into `FormState` keys. Note this **doubles the surface
for the "field wired in the JSX but missing from the handler" bug class** —
run the field-integrity script in `CLAUDE.md` before and after, or better,
turn it into a real test first.

### 9 — Batch each section's writes into a transaction Bundle

Each handler issues N sequential awaited writes with no transaction, so a
failure mid-save leaves the section half-persisted. Replace with one FHIR
transaction Bundle per section.

Partly a refactor of whatever tasks 10 and 12 land on, so it's cheaper
after them than before.

### 15 — DJS patient summary component showing saved screening data

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

### 16 — Swap `PatientSummary` for the DJS component

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

### 14 — Test coverage for the DJS wizard, matching the parent package's style

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
