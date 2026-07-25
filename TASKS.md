# DJS Admission Screening — task plan

Working plan for getting the wizard to a functioning, demonstrable
prototype. Current as of commit `0e8f04b`.

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

Two of these were bugs found along the way rather than planned work:

- **Orphaned resources (task 8).** `subjectRef` was computed at render
  time, so a first-time save wrote `subject: undefined` on every resource.
  The `/admission-screening` route hit this every time.
- **Missing devDeps (task 2).** Pre-existing; `npm run build` failed on a
  fresh clone for anyone, unrelated to the wizard.

### Verified by a real test pass

Build/compile, routing, save toasts, pain slider.

### Not yet verified against a live server

Everything in `0e8f04b` — idempotent upserts, retraction, the
orphaned-subject fix. This is a substantial rewrite of the write path that
has never run against a real Medplum server.

Worth checking specifically:

1. Save the same section twice → second save updates, doesn't duplicate.
2. Check an allergy, save, uncheck it, save → `AllergyIntolerance` comes
   back `entered-in-error`; it should neither vanish nor stay active.
3. Use `/admission-screening` with no patient → resources have a real
   `subject`.
4. If saves start erroring, suspect the `identifier=system|` search in
   `retractStale` — there's a client-side fallback, but that's the first
   place to look.

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
- **Tests.** No coverage for any DJS code, despite an established Vitest
  pattern throughout the rest of the repo. The field-integrity check is
  the highest-value first test.
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
