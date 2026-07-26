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
  `ClientApplication`'s id/secret — see `CLAUDE.md`) — idempotency,
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

### Task 17 — extend form read-back to the remaining fields

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

3. **`Other::` free text on checklist items.** Currently `hydrateScreeningForm`
   restores the checkbox toggle (`checks[grid]`) from the identifier suffix,
   but not the typed-in text next to "Other" — that lives only in the
   Observation's `code.text`/`valueString` (see `saveReviewOfSystems` /
   `saveAllergiesChronic`: `checkTextMap(grid)[item] || item` is what gets
   written, keyed by the *original* item name via the identifier suffix, not
   the typed text). To restore it: for a checklist item whose stored value
   differs from its own key name, that stored value **is** the free text —
   write it into `checkTextMap`/`form.setCheckText(grid, item, text)`
   alongside toggling the checkbox. Needs a test seeding an "Other: <text>"
   Observation and asserting both the checkbox and the text field come back.

4. **Extra demographics from `Patient.extension`** — race
   (`us-core-race`), ethnicity/hispanic (`us-core-ethnicity`),
   needs-interpreter (informal `needs-interpreter` extension), birthplace
   (`patient-birthPlace`). All read off `patient.extension` in
   `savePatientRecord` (~line 375–392) with known URLs — grep those URLs to
   confirm before mapping. Hair/eye colour are **not** extensions, they're
   plain Observations (`'Hair color'`/`'Eye color'` codes) — check whether
   those two are already mapped in `hydrateScreeningForm` before
   re-adding them (they may already be covered as generic Observations;
   confirm with the field list at the top of `hydrateScreening.ts` first).

5. **Vision-acuity grid (6 fields)** — `vision-nocorr-left/right/both`,
   `vision-corr-left/right/both`. Already saved as 6 separate Observations
   in `saveVitals`'s `visionFields` loop with fixed labels ("Visual acuity,
   left eye, without correction", etc. — see that array in the source for
   the exact 6 strings). Straightforward `valueString` → `texts[key]`
   mapping, one entry per field, no parsing needed.

6. **Medications** (lossiest — do last). `dosage`+`frequency` are merged
   into one string on save (`[dosage, frequency].filter(Boolean).join(', ')`
   in `saveVitals`). Reconstructing the medications table means either (a)
   accepting the lossy merge and putting the whole string in one column,
   leaving the other blank, or (b) leaving medications un-resumable and
   documenting that explicitly. Needs a product call, not just code — flag
   this one for a decision rather than guessing an approach.

7. **Sign-off** — `valueString: "Nurse: X; Physician: Y"` plus
   `health-alerts` in a `note`. Same parse-the-formatted-string approach
   already used for `'Last vision exam'` in `hydrateScreeningForm` (see the
   `Date: ..., provider: ...` regex there) — write a similar regex for
   `Nurse: (.*); Physician: (.*)`, then note → `health-alerts`.

8. **Mandated-reporter** checkbox + RN initials. Saved as one Observation
   (`'Mandated reporter statement read to youth'`) with the initials in a
   `note` (`RN initials: ${initials}`) — presence of the Observation means
   the checkbox was checked; parse the note for the initials.

For every step: the wiring is already in place (the mount effect in
`AdmissionHealthScreeningWizard.tsx` applies whatever `hydrateScreeningForm`
returns — no changes needed there), so each step is purely: add a mapping
in `hydrateScreening.ts`, add a unit test in `hydrateScreening.test.ts`
following the existing test patterns (see e.g. the "Last vision exam"
parse test already there), then run `npx vitest run
src/pages/hydrateScreening.test.ts` and the field-integrity test to confirm
nothing regressed.

**Do NOT re-derive the exact `code.text` strings by memory** — grep each
one out of `AdmissionHealthScreeningWizard.tsx` before writing the mapping,
since a typo'd code string will silently match nothing rather than error.

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
