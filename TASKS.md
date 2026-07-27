# DJS Admission Screening — task plan

**Target:** a demo that *really saves* — a real Medplum project, real FHIR
writes, no duplicate-on-resave — and along the way, a real answer to
whether Medplum is a viable platform for this agency. Not a clickable
mockup; not yet pilot-ready (no AccessPolicy, no coded terminology, no
field validation).

**Standing priority:** function over appearance. UI polish (pulling the
wizard out of the AppShell, its own chrome) is explicitly deprioritised
until the data path is trustworthy.

For architecture, invariants, and bug classes to avoid, see `CLAUDE.md`.
This file is the task list, not a history — resolved work is a one-line
mention, not a narrative.

---

## Current state

The full data path is built and tested: save → no-duplicate (conditional
upsert, self-healing on retry) → retract-on-uncheck → resume-on-reopen
(read-back) → display (patient-page summary).

- **50 DJS unit tests** (`npm test`) — MockClient only, no network. Covers
  FHIR constraint validity (mutation-verified against `ait-1`/`con-3`/
  `ele-1`), idempotent upsert, retraction, subject integrity, pain
  absent-vs-zero, form read-back, the `screeningData` loader, and field
  integrity. Stable across repeated runs.
- **Live suite** (`npm run test:live`, needs a real Medplum server + a
  `ClientApplication`'s id/secret — see `CLAUDE.md`, and `RUNNING-LIVE-
  TESTS.md` for the full setup/troubleshooting walkthrough) — idempotency,
  constraint acceptance, and retraction round-trip, all green against a
  real server. This suite has repeatedly caught real server-only bugs the
  unit suite couldn't (a search form `MockClient` fakes but the server
  doesn't honor; a retraction that violated `ait-2`/`con-5`; the
  transaction-atomicity finding below) — treat it as the actual proof of
  anything touching the write path.
- Parent-package test suite: 9 pre-existing failing files (a Vitest/ESM
  `vi.spyOn`-on-module-export limitation, unrelated to DJS code) — not
  ours to fix, don't be alarmed if the count doesn't change.

## Platform finding: transaction Bundles aren't atomic here

**Closed, not pursued further — this is a Medplum platform ceiling, not an
open task.** Batching each section's writes into one FHIR `transaction`
Bundle (so a mid-save failure leaves nothing persisted) was implemented
and reverted after live testing showed this Medplum server (5.1.27) does
not roll a transaction Bundle back when one entry fails — it partial-
commits and `executeBatch` resolves rather than rejecting. Full detail and
the reasoning in `CLAUDE.md` → "Platform findings". Current mitigation:
every write is an idempotent conditional upsert, so a partial save
self-heals on the next save — good enough for this prototype's purposes,
but worth knowing if real cross-resource atomicity is ever a hard
requirement on Medplum.

---

## Open

### Task 19 — save `disposition-notes` / `signoff-datetime` / `review-date` — **DONE** (`782004e`)

Same silent-data-loss class as task 18: rendered in the JSX, read by no
save handler. Fixed via `saveObservationSet` with stable codes
(`'Disposition: additional notes'`, `'Admission screening sign-off
date/time'`, `'Admission screening review date'` — note these are
**not** the on-screen labels verbatim, see below). `review-date` uses
`valueDateTime`, not `valueDate` — `Observation.value[x]` has no
`valueDate` variant, and FHIR's `dateTime` type accepts a date-only
string. Guarded by a persistence test following task 18's pattern;
date/datetime-local inputs are set via `fireEvent.change`, not
`userEvent.type`, which is unreliable for those input types in jsdom.

**A real bug found while writing that test, not caused by it — fixed in the
same commit:** the disposition-notes label contains commas, and every
identifier here is derived from `code.text`. FHIR search treats an
unescaped comma inside a token value as an OR-separator, so a
comma-containing identifier value silently matches nothing. That's not
just a lookup problem — `upsertQuery` uses the same derived value as its
**conditional-PUT match criteria**, so any checklist item whose real-world
name contains a comma (`"Insect allergy (bee, wasp, ant)"`, `"Measles,
mumps, or rubella"`, `"Viral hepatitis A, B, or C"` — several are on the
actual form) **silently duplicated on every resave instead of updating in
place**, defeating task 8's whole guarantee. Confirmed live against
`MockClient.upsertResource` before fixing, mutation-verified after.

Fix: `escapeSearchToken()` backslash-escapes `,|$\` in the search token
only — stored `identifier.value` stays exact. The task-19 field itself was
also renamed to a comma-free code, matching the convention already used
elsewhere, rather than relying on escaping when a clean name was available.

**Follow-up logged as task 20**: audit whether any other code path builds
a search query from one of these item names without going through
`escapeSearchToken`, and consider promoting it to a shared export in
`screeningData.ts` (alongside `SCREENING_ID_SYSTEM`) so future write paths
can't forget it.

### Task 17 — extend form read-back to the remaining fields — **DONE**, all 8 steps

Reopening a patient's screening repopulates most of the form
(`hydrateScreeningForm` in `hydrateScreening.ts`), via the `HydratedScalars`
interface + `VITAL_CODE_TO_FIELD`/`CHECKLIST_CODE_TO_GRID` lookup tables
already there. A few fields still come back blank — either because they're
lossy to reverse, weren't mapped yet, or (task 19) aren't saved yet.
Suggested order, easiest/highest-value first:

1. **The four task-18 free-text fields** — **DONE** (`56e08ce`). Mapped via
   a new `TEXT_CODE_TO_FIELD` lookup table + `textOrDateTime()` helper in
   `hydrateScreening.ts`. 7 unit tests + 1 integration test.

2. **The three task-19 fields** — **DONE** (`56e08ce`), same commit/mapping
   table as step 1 (`textOrDateTime` reads whichever of `valueString`/
   `valueDateTime` the field used, so one generic branch covers all seven).

3. **`Other::` free text on checklist items** — **DONE** (`bbd0015`). New
   `HydratedForm.checkTexts` bucket, applied via `form.setCheckText` in the
   mount effect. Covers all six Other::text grids that carry it through a
   resource (appearance + 3 ROS grids via one shared branch; allergy and
   chronic-list via their own `code.text`). `race`'s Other::text stays out
   of scope — it's a Patient extension, not an Observation, and race itself
   isn't mapped yet (step 4 below).

   **Found and fixed in the same commit, not caused by it:** `saveMentalStatus`
   was writing `valueString: item` instead of `checkTextMap('appearance')[item]
   || item` — the *save* side for appearance's Other:: text was silently
   discarding it (epipen/task-18/19 class), the only one of the seven
   Other::text grids with this bug. Mutation-verified fix, tracked as the
   now-closed task 21.

4. **Extra demographics from `Patient.extension`** — **DONE** (`7cf6ae2`).
   birthplace, ethnicity/hispanic, needs-interpreter, race, plus hair/eye
   colour (plain Observations, turned out to be unmapped too — folded in
   here). `findExtension()` helper added. Race is the interesting case: any
   comma-split token not matching the grid's own 5 labels is treated as the
   "Other" free text; a token containing an internal comma in the original
   free text will split and get rejoined — documented limitation, same
   comma hazard as task 20.

5. **Vision-acuity grid (6 fields) + glasses history** — **DONE** (`d6f6e84`).
   Vision acuity was trivial, per the original plan. Glasses history folded
   in too (found unmapped, same area): its save side already conflates
   "no detail typed" with a literal "Yes" value, so read-back mirrors that
   same imprecision rather than pretending to resolve it.

6. **Medications** — **DONE**, Option A (structured `Dosage`, no RxNorm yet).
   Resolved the product question by anchoring in the FHIR `Dosage` datatype
   instead of working around the merge: dose now saves as
   `doseAndRate[0].doseQuantity` (with a UCUM `system`/`code` for recognized
   units — mg/g/kg/mcg/ml/l — else just `Quantity.unit` as display text) and
   frequency as `timing.code.text`, via `buildDosage()`/`dosageToFields()` in
   `screeningData.ts`. A dose that isn't a bare `<number> <unit>` (e.g.
   "1-2 tablets") falls back to `Dosage.text`, but *only* the dose — frequency
   still lives in its own `timing` field, so nothing is lossy across the two
   columns anymore, unlike the old merged-string approach. The drug name
   itself (`medicationCodeableConcept.text`) is still uncoded free text;
   mapping it to RxNorm needs a drug-search/terminology source this form
   doesn't have, so it's tracked separately as task 22, not folded in here.
   Read-back added a `rows` bucket to `HydratedForm` (medications is a table,
   not scalar fields). Unit tests in `screeningData.test.ts` (dose
   parsing/building/round-trip) and `hydrateScreening.test.ts` (table
   read-back), plus integration + persistence tests in
   `AdmissionHealthScreeningWizard.test.tsx`; mutation-verified against the
   old merged-string behavior.

7. **Sign-off** — **DONE** (`7d8e81b`). Same parse-the-formatted-string
   approach as `VISION_EXAM_CODE`; the `—` placeholder for an unfilled
   signature is recognized and skipped, not treated as a real name.

8. **Mandated-reporter** — **DONE** (`7d8e81b`), same commit. Presence of
   the Observation means the checkbox was checked (no separate "checked but
   empty" state to handle, unlike glasses-history); RN initials parsed from
   the note.

### Task 20 — audit other search paths for the comma hazard (still open)

Logged above when task 19 fixed the disposition-notes comma-duplication
bug. Not yet done: sweep the rest of `AdmissionHealthScreeningWizard.tsx`
for any other identifier/search-token construction that bypasses
`escapeSearchToken`, and consider promoting that helper into
`screeningData.ts` as a shared export so future write paths can't forget
it (it currently lives local to the wizard file).

### Task 22 — map medication drug names to RxNorm (open, follow-on from task 17 step 6)

Task 17 step 6 anchored *dose/frequency* in FHIR's `Dosage` datatype
(structured `doseAndRate`/`timing`, UCUM units where recognized — see
below) but deliberately left the *drug name itself* as free text
(`medicationCodeableConcept.text`, no `coding`). Coding it against RxNorm
(the US clinical-drug terminology SureScripts/DoseSpot use) needs a
drug-search/lookup UI this form doesn't have — a real feature, not a
read-back-sized change. Do this before task 23.

### Task 23 — integrate prescribing/orders: MedicationRequest + DoseSpot (open, blocked on task 22)

The wizard's medication section is medication *reconciliation/history* —
correctly modeled as `MedicationStatement`. Actual *prescribing* is a
different FHIR resource, `MedicationRequest` (with `dosageInstruction`),
which is what Medplum's DoseSpot e-prescribing integration produces
(embedded iframe, RxNorm-coded drugs, transmitted via SureScripts — see
https://www.medplum.com/docs/integration/dosespot, though that page
documents the iframe/feature surface, not the FHIR resource shapes).
When DJS needs to actually write orders, build a `MedicationRequest`-based
flow and evaluate DoseSpot as the e-prescribing path.

**Task 17 is now fully complete — all 8 steps done.** Step 6 (medications)
was the one paused pending a product decision; resolved by anchoring in
FHIR's `Dosage` datatype (Option A — see step 6 above) rather than
guessing at a workaround. `HydratedForm` grew a `rows` bucket to carry it,
since medications is a table, not scalar fields — the mount effect in
`AdmissionHealthScreeningWizard.tsx` applies it via `form.setRows()`.

For the fields that were still scalar/checklist mappings: the wiring is
already in place (the mount effect applies whatever `hydrateScreeningForm`
returns), so each step was purely: add a mapping in `hydrateScreening.ts`,
add a unit test in `hydrateScreening.test.ts` following the existing test
patterns (see e.g. the "Last vision exam" parse test already there), then
run `npx vitest run src/pages/hydrateScreening.test.ts` and the
field-integrity test to confirm nothing regressed.

**Do NOT re-derive the exact `code.text` strings by memory** — grep each
one out of `AdmissionHealthScreeningWizard.tsx` before writing the mapping,
since a typo'd code string will silently match nothing rather than error.

---

## FHIR-modeling audit (tasks 24–35)

A full pass over every save handler, prompted by task 17 step 6: where else
is DJS data modeled as free text or a merged string when FHIR has a
standard model for it? Findings below, grouped by class and ordered by
priority. **One is active data loss (task 24); the rest are correctness or
interoperability.**

Two cross-cutting facts established by the audit, worth knowing before
picking any of these up:

- **There is no clinical terminology anywhere in the wizard.** The only
  coded systems in the file are the four status bindings FHIR constraints
  *forced* us to add, plus `data-absent-reason`. No LOINC, no SNOMED, no
  RxNorm.
- **`Observation.category` is never set on any resource**, and there is no
  `performer`/`recorder`/`asserter` on anything — verified by grep, not
  assumed.

### Tier 1 — data loss and clear correctness bugs

**Task 24 — create the Encounter; persist admission date + facility.
DATA LOSS. — DONE** (see also task 36 for the remaining linkage work).

`admissionDate` and `facilityName` were captured in the JSX, shown in
`PatientBand`, and read by **no save handler** — same class as
epipen/task-18/19, and **invisible to the field-integrity script** because
they're `useState`, not FormState keys. Worth remembering: the script's
"set but never read" side doesn't cover section-1/2 scalar state at all,
so that whole surface needs a human read.

They had nowhere to go because the wizard never created an `Encounter`,
though an admission screening *is* one. Now: `saveAdmissionEncounter()`
upserts an Encounter keyed `admission-encounter` with
`period.start` = admission date and `location[0].location` → a real
`Location`.

**Facility identity hangs on a code, never a name** (`djsFacilities.ts`).
The 13 canonical facilities from the paper form each have a permanent
slug code plus a display name that is explicitly *safe to change* — staff
see the short paper-form names today, and a production version may swap in
official long-form names without moving any stored data. Consequences
worth preserving if this is ever touched:

- The dropdown is a **closed set with no free-text escape**. Standing up a
  DJS facility takes real organizational investment, so the list changes
  rarely and adding to it is cheap — whereas a typed fallback would
  reintroduce exactly the duplicate-Location problem the code list
  prevents. A facility not on the list is a data-entry error or a real
  organizational change; both route to editing the list.
- The `Location` is upserted **conditionally on the facility code**, so a
  rename is a plain update, re-saving is idempotent, and two intakes
  racing on a facility's first use converge on one resource.
- Codes are lowercase/hyphen slugs, which also keeps them clear of the
  FHIR search metacharacters behind the task-19 duplication bug — a reason
  to key on codes, not a happy accident.
- The Encounter stores **only the reference**, with no `Reference.display`.
  FHIR permits that cached label and expects it to go stale, but since
  renames are anticipated here and every reader resolves the Location
  anyway, a copy would only let old Encounters render a name their
  facility record contradicts. Built by hand rather than via
  `createReference`, which populates `display` by default — a test caught
  this.
- Read-back recovers the facility from the Location's **identifier**, not
  its name, and there's a regression test asserting a renamed facility
  still resolves.

`Encounter.class` uses v3 ActCode `IMP`: a custodial admission is a
residential stay rather than an ambulatory visit, and ActCode has no
juvenile-detention code. **A deliberate approximation, not a confident
mapping** — revisit if DJS adopts a more specific value set.

**Task 36 — thread the Encounter reference through every resource type.**
Split out of task 24 on purpose. `obs()` still sets `Observation.encounter`
from the **route param only**, so Observations saved on a normal run aren't
linked to the Encounter the wizard now creates; Condition,
AllergyIntolerance, MedicationStatement (`.context`) and CarePlan support
the link and use it nowhere. **The hazard that earned this its own task:**
the reference must be threaded explicitly like `subject`, never read from
React state inside a handler — doing that reproduces the stale-closure bug
that once sent `subject: undefined` on every resource in a first-time save
(see CLAUDE.md). An `ensureEncounterRef()` mirroring `ensurePatientRef()`
is the right shape; it changes `obs()`'s signature and every call site.

**Task 37 — model the Youth Centers grouping via `Location.partOf`.**
Purely additive, needs no facility code to change. Structural rather than
a guessed `Location.type` code, since no canonical type for a juvenile
facility class is known.

**Task 25 — blood pressure as components, not a string. — DONE.** Was
`valueString: "120/80"`; now FHIR's standard two-component panel, with
LOINC 8480-6 / 8462-4 and UCUM `mm[Hg]` — all three verified against
hl7.org/fhir/R4/bp.html rather than recalled.

**The UI changed too, and that's the more important half.** Systolic and
diastolic are now **two numeric inputs** rather than one `120/80` box. That
wasn't cosmetic: capturing two facts in one text field and parsing them
apart is the exact anti-pattern just fixed for medication dosage and
sign-off, and fixing it only at the storage layer would have left the
parse — and its lossy fallback — sitting at the input layer. With split
inputs the save path has **nothing to parse and no fallback to degrade
into**. A half-filled reading records the half that exists; FHIR permits a
single-component panel.

The string parser survives in exactly one role: **reading legacy data**.
Every BP saved before this change is a `valueString`, and those must keep
loading rather than coming back blank. Nothing writes that form anymore.

`code.text` stays `'Blood pressure'` — identifiers derive from it, so
changing it would orphan every previously saved reading.
`DjsPatientSummary` needed updating too: a component-only panel has no
top-level `value[x]`, so it would otherwise have rendered `—`.

**Verified live 2026-07-26** — all 9 live tests pass, run twice, so both
the create and re-save paths are covered on a real server.

Mutation-verified twice, including a **transposed-LOINC** mutation
(systolic code on the diastolic component) — a silent clinical error a
round-trip test can't catch, since both sides would use the same constant.
Five tests fail on it, because the read-back fixtures hardcode the codes
instead of importing them. Worth preserving that property.

### Tier 2 — standards work, each contained

- **Task 26 — LOINC + `category: vital-signs` + UCUM on vitals. — DONE.**
  All seven vitals now carry a LOINC code, the vital-signs category, and a
  UCUM-coded unit. Codes and permitted units verified against
  hl7.org/fhir/R4/observation-vitalsigns.html, not recalled; the imperial
  units this form collects are all in the profile's allowed sets
  (`[degF]`, `[lb_av]`, `[in_i]`).

  **Adding the category surfaced a conformance obligation worth
  remembering: tagging an Observation `vital-signs` claims the profile, and
  the profile mandates a time of measurement.** Our vitals set no
  `effective[x]` at all, so shipping the category alone would have asserted
  conformance we didn't meet — the same class of error as the US Core race
  extension in task 33. Fixed in the same change.

  `effectiveDateTime` is **preserved across re-saves, not restamped**. This
  wizard exists to resume a partially-completed screening, so a nurse
  reopening it the next day to fix a typo must not silently re-date
  yesterday's vitals to today — that's a clinically misleading record, not
  just untidy. Only a first write stamps the clock; `saveObservationSet`
  looks up prior times once, and only when the set actually contains a
  vital. Mutation-verified (always-restamp fails the test).

  There is **no separate "time vitals taken" input**, so this is the
  recording time standing in for the measurement time — fine for a
  screening done in one sitting, but a real measurement-time field may be
  wanted if that assumption ever stops holding.

  Two structural choices to preserve: the enrichment happens in `obs()`,
  the single chokepoint every Observation passes through, so no vital can
  be missed and non-vitals are provably unaffected (there's a test for the
  leak). And `VITAL_SIGN_DEFS` is the **only** home for a vital's unit —
  call sites pass just the number, because two places naming the same unit
  is how they drift. `code.text` keys are unchanged, since identifiers
  derive from them.
- **Task 27 — assert "No known allergies" instead of discarding it.**
  Currently `continue`d, so "no allergies" is indistinguishable from
  "never asked" — meaningful in a screening.
- **Task 28 — allergy `category`/`criticality`/`type`; per-allergy
  reaction.** The grid items *are* FHIR's category value set. Separately,
  the one shared reaction textarea is copied onto **every** checked
  allergy, so three allergies each claim the same reaction — wrong data,
  not just imprecise.
- **Task 29 — practitioner attribution on every resource.** Nothing
  records *who* asserted a finding, though Medplum knows the logged-in
  user. For minors in state custody this is arguably peer to the
  AccessPolicy backlog item: retraction-not-deletion preserves a trail,
  but the trail can't say who.
- **Task 30 — coded `Condition.category`** (`problem-list-item` /
  `encounter-diagnosis`) instead of `{ text: 'Nursing diagnosis' }`.
- **Task 31 — `CarePlan.activity[]` instead of `join('; ')`.** Third
  instance of the merged-string pattern, with the same separator
  fragility as the comma bug. Some plan items are arguably
  `ServiceRequest`/`Task`, not plan text.
- **Task 32 — sign-off as `performer` references.** Fourth merged-string
  instance (`"Nurse: X; Physician: Y"`, regex-parsed back). The nurse and
  physician are typed *strings* with no link to real Practitioner
  accounts, so a legally meaningful sign-off is unattributable.

### Tier 3 — larger, or blocked on a decision

**Task 33 — US Core demographics conformance.** A real conformance bug,
not a preference: `us-core-race` and `us-core-ethnicity` are **complex
extensions** (`ombCategory` + `text` sub-extensions), and we write a flat
`valueCodeableConcept` under those official URLs — claiming US Core while
failing it. Fixing race also removes the documented comma-join
reconstruction ambiguity. Folds in BCP-47 language coding.

**Task 34 — SPIKE: QuestionnaireResponse as the persistence model.**
Timeboxed evaluation, deliverable is a written recommendation, not code.
Relevant to the Medplum evaluation specifically: most of this project's
bug backlog — identifier collisions, comma escaping, retraction scoping,
read-back mapping, "wired in JSX but never saved" — is *inherent to
hand-rolling form persistence*, and `QuestionnaireResponse` round-trips
losslessly by construction. The question worth answering is whether the
current architecture is fighting the platform, and what a migration costs.

**Task 35 — checklist code/value inversion + past history as Condition.**
Largest item; **needs a design decision before it's decomposed.** Across
appearance/ROS/dental/infectious the *value* carries the finding and the
*code* is a bucket, inverting FHIR's convention — so findings are
unqueryable by code ("find patients with a head injury" is unanswerable).
Past history items are arguably the wrong *resource* too (Condition, not
Observation-with-value).

**Sequencing note — read before picking up task 20.** Task 35 changes how
identifiers are derived from item names, which is the same surface task 20
(comma escaping) addresses; doing task 20 first risks redoing it, or
fixing something that no longer exists. And task 35 may be substantially
subsumed by the task 34 spike. Order: 34 → 35 → 20. Both dependencies are
recorded in the task tracker.

---

## Backlog — before this could be pilot-ready, not blocking the demo

- **AccessPolicy.** Nothing currently restricts the sensitive sections
  (abuse history, substance use — for a minor population in state
  custody) beyond default patient-record visibility. The retraction model
  keeps an audit trail; access control is separate and unbuilt.
- **Coded terminology.** Most fields save free-text `CodeableConcept.text`
  rather than SNOMED/LOINC/RxNorm codes. Now itemized by the FHIR-modeling
  audit above rather than left as one vague backlog line — see tasks 26
  (vitals/LOINC), 28 (allergy category), 30 (Condition.category), 33
  (US Core demographics) and 22 (RxNorm). Medication dose/frequency were
  pulled out of this bucket by task 17 step 6 (now structured `Dosage`
  fields, UCUM-coded where recognized); the medication *name* itself is
  still free text — see task 22.
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

### Task 38 — replace `preview.html` with a MockClient-backed demo route

`preview.html` is a hand-maintained static mirror of the wizard, and it
drifts by construction. Verified 2026-07-26: it has the right 4 sections
(last updated `226ffbb`, 2026-07-24) but **missed the last two UI
changes** — BP is still one `120/80` box (task 25 split it in two) and
facility is still free text (task 24 made it a closed `<select>`). It also
never loads `tokens.css`, so it isn't a valid styling reference either.
Once design/product contributors arrive, a wrong preview is worse than
none: they'd design against fields that no longer exist.

**Don't just delete it — it serves a real need:** viewing the UI *without
Medplum credentials*. The wizard requires sign-in and incoming design folks
won't have a server.

Approach (agreed with the user): a demo route rendering the wizard inside a
`MedplumProvider` backed by `MockClient`. Real components, real
`tokens.css`, no credentials, and in sync by construction because it **is**
the app. Already proven — `AdmissionHealthScreeningWizard.test.tsx` does
exactly this via `renderWizard(new MockClient())`.

Two things to get right: make it unmistakably a demo (a visible banner, not
just a URL) so nobody thinks they're seeing live patient data; and decide
whether it ships in the production build — lean dev-only. Writes land in
the in-memory client so nothing reaches a real server, but that should be
stated, not incidental.

Also remove the `preview.html` references in `README.md`, `CLAUDE.md` and
`CONTRIBUTING.md`, pointing them at the demo route instead.

---

## UI issues found by manual testing (tasks 39–44)

Source: `observed_UI_issues.md`, from a hands-on pass through the running
app on 2026-07-26. Folded in here by priority; the source file stays as
the raw record.

Three of the seven were already known or already answered:

- *"Is an encounter being created for the intake?"* — **yes**, since task
  24 (`58e846b`). That it wasn't discoverable from the UI is the real
  finding → **task 40**.
- *"CarePlan's encounter field is empty"* — exactly **task 36**, now
  confirmed from real use rather than inferred. Priority raised.
- *"Patient display shows both DJS and regular data"* — this **reverses
  task 16's deliberate decision** to keep the DJS summary additive. Both
  positions are defensible; → **task 42**, to be decided explicitly.

### Priority

**High — a broken core workflow**

- **Task 39** — patient edit fails: the server has no
  `us-core-patient` StructureDefinition. Likely a Medplum project/config
  gap rather than DJS code; establish that first. **Also a platform
  finding:** it is direct evidence the server has no US Core profiles
  loaded, corroborating the CLAUDE.md note that live-test *acceptance is
  not profile validation* — the server cannot validate against profiles it
  does not have. Reinforces tasks 26 and 33.

**Medium — workflow gaps that make the app awkward to actually use.**
Tasks 40, 41 and 42 all touch the patient page and are probably one
coherent piece of work; task 36 belongs with them.

- **Task 40** — surface the admission Encounter somewhere visible. Check
  first whether `EncounterChartPage` already exists and simply isn't
  linked, which would make this navigation rather than new UI.
- **Task 41** — "Start admission screening" / "New encounter" buttons on
  the patient page. Settle whether a standalone "new encounter" is a
  distinct clinical act before building both paths.
- **Task 42** — consolidate the patient display. Decide what
  "consolidated" means before editing, and check what Medplum's default
  sections surface that we don't.

**Low — polish**

- **Task 43** — "Save and next" — **DONE.** Sections 1–3 advance on save;
  section 4 keeps a plain "Save diagnosis & disposition" since there is no
  next step. The advance happens **inside `runSave`'s `try`, after the save
  resolves** — never in `catch` or `finally`. Mutation-verified by moving
  it to `finally`, which fails exactly the one test that guards it.

  Two things worth knowing if you touch this again. The test helper
  `saveSection` used to wait for the clicked button to re-enable; that
  breaks now, because a successful save can remove that button from the
  page entirely. It waits on the "Saving…" state clearing instead, which
  holds whether or not the section advances. And several existing tests
  save, then keep working in the same section — those now need an explicit
  `goToStep` back, which is a fair reflection of what a nurse would
  actually do.
- **Task 44** — export date inputs. Establish whether the page is ours or
  stock `medplum-provider` before patching a vendored file.

---

## Plan: tasks 39–42 (the patient-page cluster)

**Headline: this is not one complicated task. It's one independent fix,
plus one coherent piece of patient-page work — and a good deal of it may
be *wiring things that already exist* rather than building.**

### Split task 39 out — it isn't a UI task

Patient edit is broken because the server has no `us-core-patient`
StructureDefinition. That's Medplum's own page and a server/config
problem; it shares nothing with 40–42 but the word "patient". Bundling it
would let a config investigation block UI work, or vice versa.

**Root cause confirmed 2026-07-26 — it's (1), a Project seed gap, not a
Medplum defect and not our page.** Verified against Medplum's own docs
(fhir-datastore/profiles), not guessed: a fresh Project ships base FHIR
only; US Core StructureDefinitions must be uploaded to the Project before
anything can reference them. Every environment built via
`RUNNING-LIVE-TESTS.md` §1 (self-register → brand-new Project) hits this
the first time `Patient/:id/edit` is opened, because nothing in that flow
loads US Core.

**Fix delivered:** `scripts/load-us-core-profiles.{sh,ps1,cmd}` — three
equivalent scripts (Git Bash / native PowerShell / cmd wrapper around the
PowerShell one, since cmd has no reliable JSON/HTTPS handling of its own).
Idempotent, uses the same `MEDPLUM_LIVE_CLIENT_ID`/`SECRET` convention as
`test:live`, downloads the official HL7 US Core package from the FHIR
package registry (not a hand-copied JSON blob) and loads only the three
StructureDefinitions this codebase actually references for Patient
(`us-core-patient`, `us-core-race`, `us-core-ethnicity`). Documented as a
required one-time step in `RUNNING-LIVE-TESTS.md` §7.

**Confirmed no editing of the vendored page was needed** —
`EditTab.tsx`/`ResourceFormWithRequiredProfile.tsx` already do the right
thing (request the profile, show a clear error if missing); the Project
just needed the profile loaded once.

**Deliberately scoped to Patient, not the whole package.** The codebase
references several other US Core profiles too (AllergyIntolerance,
CareTeam, Coverage, Immunization, MedicationRequest, Device, Condition,
ObservationSexualOrientation, ObservationSmokingStatus). Each will hit this
exact same "not found" error the first time that resource type's edit page
is actually used — noted in the script headers and in
`RUNNING-LIVE-TESTS.md` so it's recognized as the same root cause rather
than re-diagnosed.

**Recorded as a platform finding in `CLAUDE.md`:** a Project with zero US
Core StructureDefinitions loaded cannot possibly be validating writes
against US Core profiles — direct confirmation, from the other direction,
of the "acceptance is not validation" note already there. Profile
conformance (tasks 26, 33) stays entirely our responsibility.

**Run 2026-07-28 against the Docker-hosted server — failed, descoped by
user call.** The script downloaded and extracted the US Core package
without error, got an access token fine, then failed creating the first
StructureDefinition: the server rejected it with `"Incorrect resource
type: expected StructureDefinition, but found "` (blank). Whatever the
extracted file actually contained, it wasn't a usable FHIR resource — and
neither script said why, which is itself a gap, fixed below.

**Decision: park this rather than keep debugging blind.** Diagnosing the
actual file content needs eyes on the user's filesystem, which isn't
available this session, and would mean several more round-trips for what
is (see below) a one-time setup annoyance, not something blocking other
work. **Patient edit stays broken** until this is picked back up — noted
so it isn't mistaken for fixed.

**What was still worth doing immediately, regardless of the descope:**
both scripts now check `resourceType` explicitly (not just presence of a
`url` field) and, on failure, print what they actually found plus the
first 300 chars of the file — so the *next* attempt gets a real signal
instead of another blank error. Also suppressed PowerShell's
`Invoke-WebRequest` progress bar (`$ProgressPreference =
'SilentlyContinue'`), which was very likely corrupting the captured log —
`error.txt`'s first line showed "Downloading ... Extracting ..." mashed
onto one line with a large gap, the classic symptom of progress-bar output
bleeding into a redirected file.

**Task 39 is deprioritized, not abandoned.** If/when it's worth another
attempt: re-run one of the scripts, and this time the failure output
itself should say what's actually in the mismatched file rather than
requiring another guess.

### Before touching 40–42: a short discovery spike

Four questions, all cheap to answer, and the answers change whether these
are hour-tasks or day-tasks. **Answer them before estimating or coding.**

1. **`EncounterChartPage` and `EncounterModal` already exist** and are
   routed (`App.tsx` ~209–210: `Encounter/new`, `Encounter/:encounterId`).
   So is task 40 just *"nothing links to them"*? If so it's navigation,
   not new UI. Likewise task 41's "new encounter" button may be a link to
   the existing `Encounter/new` modal.
2. **Is there already an Encounters tab?** `getPatientPageTabs` in
   `PatientPage.utils` drives `LinkTabs`. If an encounters tab exists and
   is merely hidden or unrouted, 40 collapses further.
3. **What does Medplum's `PatientSummary` surface that `DjsPatientSummary`
   doesn't?** This is the load-bearing question for 42 — see below.
4. **Does the wizard prepopulate correctly when launched with a
   `patientId`?** Task 41 assumes yes. It should, via the mount-time
   read-back, but verify rather than assume.

### Then: 36 → 42 → 40 → 41

The order matters, and it isn't the numeric one.

- **36 first (encounter linkage).** Surfacing an encounter that no
  Condition, AllergyIntolerance, MedicationStatement or CarePlan points at
  shows an empty shell — the very complaint that started this. 40's value
  depends on 36 being done. Carries the stale-closure hazard: thread the
  reference explicitly like `subject`, never read it from state.
- **42 next (consolidate the display).** It decides the *container*. Doing
  40 first would add encounter content to a panel 42 then restructures —
  rework for no reason.
- **40 and 41 last**, adding content and actions into a settled structure.
  They're small once 42 has landed, and may be mostly links.

### The decision 42 needs first

Task 42 **reverses task 16's deliberate choice** to keep `DjsPatientSummary`
additive alongside Medplum's `PatientSummary`. That was chosen so we
weren't hiding data the platform surfaces. The user has now used it and
wants them merged; both positions are reasonable, so decide explicitly and
write down why.

- **(a) One merged panel** — most work, best result.
- **(b) DJS replaces the default** — cheapest, and **the risky one**: the
  original reason for additive was not knowing what we'd be hiding.
  Question 3 above must be answered before this is on the table.
- **(c) Keep both, deduplicate the overlap** — smallest change that
  addresses the actual complaint (seeing the same thing twice).

Recommendation: answer question 3, then choose between (a) and (c). Treat
(b) as available only if the audit shows the default panel adds nothing.

### One cross-cutting risk

`PatientPage.tsx` is **stock `medplum-provider` that we've already
modified** (task 16). Every further edit widens the diff against upstream
and the merge burden that comes with it. Prefer changes that live in our
own components and touch the vendored page as little as possible — and if
a change does have to go there, note it, so the divergence is deliberate
and known rather than discovered later.
