# CLAUDE.md — DJS Admission Health Screening wizard

Reference for working on the Maryland DJS admission screening wizard
inside this `medplum-provider` checkout. Read this before touching a save
handler — it's the invariants and gotchas that aren't obvious from the
code. For what's still open, see `TASKS.md`.

## What this is

Maryland DJS's "Admission Health Screening and Nursing Assessment" paper
form, as a Medplum-backed React wizard. **4 sections**: Patient
Information → Current Health Status → Review of Systems → Diagnosis &
Disposition. Originally 9 sections; Skin/Body Exam, Abuse/Substance/Family
History, and Reproductive Health were cut and are **not coming back** — if
you find code referencing them, it's debris.

## Running it

```bash
npm install
npm run dev          # vite on localhost:3001
npm test             # unit suite (MockClient, no network)
npm run test:live    # live suite (real Medplum server, see below)
```

Reachable at `/admission-screening[/:patientId[/:encounterId]]`, plus an
"Admission Screening" entry in the sidebar Quick Links. Needs a real
Medplum project to sign into — `.env` ships as the stock template with an
empty client ID; point `MEDPLUM_BASE_URL` at your project or a local
server on `:8103`.

`npm run build` runs `tsc && vite build` and type-checks test files too.

### Running the live suite

`AdmissionHealthScreeningWizard.live.test.tsx` talks to a **real** Medplum
server via client-credentials login — no `MockClient`. Requires:

1. A running Medplum stack (e.g. the local Docker full-stack setup).
2. A `ClientApplication` (Project Admin → Clients), with its id/secret as
   `MEDPLUM_LIVE_CLIENT_ID` / `MEDPLUM_LIVE_CLIENT_SECRET`. Optional
   `MEDPLUM_LIVE_BASE_URL` (defaults to `http://localhost:8103/`).

Without those two env vars the whole file skips — `npm test` and a
credential-less `npm run test:live` both stay green. **This is the only
way to catch the bug class below marked "live-only"** — write it a live
test rather than trusting the unit suite for anything MockClient might
fake.

## Architecture

- `src/pages/AdmissionHealthScreeningWizard.tsx` — the wizard. Sections
  1–2 use dedicated `useState`; sections 3–4 use the generic `useFormState`
  container.
- `src/pages/formState.ts` — `FormState` (`chip`/`setChip`, `text`/
  `setText`, `checkedItems`/`checkTextMap`, `rows`/`setRows`) plus
  `parseItems()`, splitting a `"A|B|C::text"` spec into checkboxes where
  `::text` marks one with an inline free-text field. **Never leave a
  trailing `|`** — it parses into a blank, labelless checkbox.
- `src/pages/screeningData.ts` — `loadScreeningResources(medplum,
  patientId)`: the one place that reads a patient's screening resources
  back. Filters out retracted findings and collapses legacy duplicates.
  Both `hydrateScreening.ts` (form read-back) and `DjsPatientSummary.tsx`
  (display) build on this — extend it, don't duplicate its search/filter
  logic elsewhere.
- `src/pages/hydrateScreening.ts` — `hydrateScreeningForm(data, patient)`:
  pure function, live resources → form values, for resuming a
  partially-completed screening. Kept pure and separately unit-tested
  (see "Bug classes" below for why).
- `src/components/DjsPatientSummary.tsx` — read-only screening summary
  shown on the patient page, **alongside** Medplum's own `PatientSummary`
  (additive, not a replacement — the default sections are untouched).
- `src/components/FormControls.tsx` — `Grid` (checkbox list bound to
  FormState), `YesNoChip`/`TrackedChip` (chip toggle + optional reveal).
- `src/theme/tokens.css` — design tokens and every `.djs-*` class. Real
  USWDS default palette, not a reconstruction. Loads **globally** (Vite
  applies plain `.css` app-wide), so its typography/background rule is
  scoped to `.djs-root` rather than `body` — never add a bare element
  selector here.
- `src/theme/mantine-theme.ts` — **unused, intentionally.** No DJS
  component renders Mantine; it's all raw HTML plus `.djs-*` classes.
  Applying `djsTheme` would restyle the rest of the app for nothing.

**The wizard renders inside the AppShell** and draws its own
`GovBanner`/`AppHeader`/sidebar/`AppFooter`, so chrome currently nests
inside Medplum's. Known, accepted — function over appearance. Pulling it
out means restructuring where `App.tsx` declares `<Routes>`, since
`AppShell` wraps all of them.

## The write path

Every resource the wizard writes carries an identifier under
`SCREENING_ID_SYSTEM` (`http://maryland.gov/djs/admission-screening`,
exported from `screeningData.ts`), whose value is **derived** from the
field that produced it — never hand-written per call site, so it can't
drift from the resource it labels. If you add a field, its `code.text`
must be unique across the file; a collision silently overwrites one field
with another.

**Each section's save handler builds a `ScreeningBundle` and commits it
once** via `medplum.executeBatch({ type: 'transaction', ... })` — atomic
on a real server, so a failure part-way leaves the section wholly
unwritten rather than half-persisted. `obs()` and `bundleUpsert()` append
entries to the bundle instead of writing immediately; the section's
`onClick` handler creates the bundle, calls the save functions, then
`commitBundle()`s once. Only the Patient upsert (which must resolve first,
to yield the subject reference) and retraction reads/writes happen outside
the bundle.

**Writes are conditional upserts** (`PUT` with a search URL — same
mechanism `bundleUpsert` uses inside the bundle, or `medplum.upsertResource`
directly for the Patient), never plain `create`. Idempotent and
concurrency-safe.

**`retractStale(resourceType, subject, inScope, liveKeys, param?)`**
withdraws resources the form no longer asserts — unchecking an item must
withdraw its resource, not leave it asserted while the form shows it gone.
Retraction is `status: 'entered-in-error'` for Observation/
MedicationStatement, `verificationStatus: entered-in-error` for
Condition/AllergyIntolerance. **Never hard-delete clinical data.**
Retractions are applied as **direct** `updateResource` calls, deliberately
**outside** the section's bundle — see "Bug classes" for why.

The `inScope` predicate is load-bearing: without it, saving one section
retracts every other section's findings, since none of their keys appear
in this section's live set. It matters within a resource type too —
`chronic::` and `nursing-diagnosis::` are both `Condition`, and the key
prefixes are what keep them apart.

`AllergyIntolerance` searches on `patient`, not `subject` — hence the
`param` argument threaded through `upsertQuery`/`retractStale`.

**`ensurePatientRef()` must be used for the subject**, never `patient`
state read directly inside a save handler — see "Bug classes."

**`runSave(key, message, fn)`** wraps each button with a pending state and
success/error toasts. Never fire a save handler bare from `onClick`.

## Bug classes that have bitten here — don't reintroduce

These are patterns, not one-off fixes — the same shape has recurred
across different fields and sections. If you're touching a save handler,
check against this list.

**Stale closure for the subject reference.** Reading `patient` state right
after `setPatient()` gets the *pre-update* value — `setState` doesn't
update the running closure. Always resolve the subject from the awaited
write (`ensurePatientRef()`), never from state, or a first-time save sends
`subject: undefined` on every resource.

**Field wired in the JSX but missing from the save handler**, or the
mirror — a handler reading a key no input ever sets. Both directions have
happened repeatedly. The verification script below catches "read but never
set" completely; "set but never read" needs a human look, since a field's
only "read" might be its own `value=` in the JSX rather than a save
handler actually persisting it — that class is invisible to the script
entirely, so a field can look wired and still silently drop data. Write a
targeted test for anything you add.

**Async handler fired as a floating promise.** Swallows rejections — a
failed save looks identical to a successful one. Always route through
`runSave`.

**A default that's also a valid answer.** E.g. a 0–10 scale defaulting to
`0` can't be told apart from a real "0" answer. Use `undefined` for "not
answered" and a coded `dataAbsentReason` (or equivalent) on save, never a
value that could mean either thing.

**Trailing `|` in a `Grid` items string** parses into a blank, labelless
checkbox — always double-check hand-edited item strings.

**Live-only bugs: things `MockClient` cannot catch.** Two real
server-rejected writes passed the entire unit suite and only surfaced
against a real server:
- A bare `identifier=<system>|` search (system, empty value) — `MockClient`
  matches it, the live server returns nothing. Never narrow a search with
  an empty-value token; fetch by patient/subject and filter the identifier
  system client-side instead (see `screeningData.ts`, `retractStale`).
- A retracted `AllergyIntolerance`/`Condition` keeping `clinicalStatus` set
  alongside `verificationStatus: entered-in-error` — violates FHIR
  constraints `ait-2`/`con-5`. `clinicalStatus` must be **removed**, not
  just left in place, when retracting those two types.

  General lesson: **`MockClient` does not enforce FHIR invariants or
  transaction atomicity.** It will store a constraint-violating resource
  without complaint, and a bundle with one bad entry partial-commits
  instead of rolling back. The unit suite's `captureWrites` +
  `validateResource` (below) catches the constraint class offline; the
  atomicity property and any raw-search behavior can *only* be proven by
  the live suite. If you're unsure whether a fix actually works, write a
  live test — don't extrapolate from a green unit run.

- Also: a resource **created inside a transaction bundle** is not reliably
  found by a later `searchResources` call within the same `MockClient`
  session/component flow. If a unit test needs to seed "a resource from a
  prior save," seed it with a direct `createResource`, not a bundle — see
  the retraction round-trip test for the pattern.

## Verifying a change

**Field integrity** — every read in a save handler should have a matching
set in the JSX, and vice versa:

```bash
python << 'EOF'
import re
src = open('src/pages/AdmissionHealthScreeningWizard.tsx').read()
set_keys  = set(re.findall(r"form\.setText\('([\w-]+)'", src))
set_keys |= set(re.findall(r"form\.setChip\('([\w-]+)'", src))
set_keys |= set(re.findall(r'track="([\w-]+)"', src))
set_keys |= set(re.findall(r'grid="([\w-]+)"', src))
set_keys |= set(re.findall(r"form\.setRows\('([\w-]+)'", src))
set_keys |= set(re.findall(r"form\.checkedItems\('([\w-]+)'\)", src))
read_keys  = set(re.findall(r"form\.text\('([\w-]+)'\)", src))
read_keys |= set(re.findall(r"form\.chip\('([\w-]+)'\)", src))
read_keys |= set(re.findall(r"form\.checkedItems\('([\w-]+)'\)", src))
read_keys |= set(re.findall(r"form\.checkTextMap\('([\w-]+)'\)", src))
read_keys |= set(re.findall(r"form\.rows\('([\w-]+)'\)", src))
print("read but never set:", sorted(read_keys - set_keys))
print("set but never read:", sorted(set_keys - read_keys))
EOF
```

(Note: `python`, not `python3` — the latter isn't aliased on this Windows
setup.) This is also codified as a real test in
`AdmissionHealthScreeningWizard.fieldIntegrity.test.ts`, with a
`KNOWN_SCRIPT_BLIND_SPOTS` allowlist for grids read via a loop variable
(the regex can't see those). `read but never set` has **no** allowlist —
it's always a bug.

**Identifier collisions** — two fields deriving the same key would
silently overwrite each other:

```bash
grep -oE "code: \{ text: '[^']+'" src/pages/AdmissionHealthScreeningWizard.tsx \
  | sed "s/code: { text: '//;s/'$//" | sort | uniq -d
```

**Constraint validity — the `captureWrites` harness.** `MockClient` does
not validate FHIR constraints on write, so a test that only checks "didn't
throw" misses the whole `ait-1`/`ait-2`/`con-3`/`con-5`/`ele-1` class.
`AdmissionHealthScreeningWizard.test.tsx`'s `captureWrites(medplum)` wraps
every write (including bundle entries) and runs it through
`validateResource` from `@medplum/core`, which reproduces the server's
constraint errors exactly. Any new resource-producing code should be
driven through a test asserting `capture.validationErrors` is empty. When
you add a check like this, **mutation-verify it once** — break the code on
purpose and confirm the test goes red with the real error text — before
trusting it as a guard.

Then: `npm run build` (type-checks tests too), `npm test`, and — for
anything touching the write path — `npm run test:live` if you have a
server available.

## Formatting

**CRLF, not LF** — committed from Windows, `.gitattributes` enforces it.
Convert generated files:

```bash
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.css" -o -name "*.md" -o -name "*.html" \) \
  -not -path "./node_modules/*" \
  -exec sh -c 'sed -i "s/\r$//" "$1" && sed -i "s/$/\r/" "$1"' _ {} \;
```

## `preview.html`

Static, dependency-free mirror of the wizard for a quick visual check with
no build step. **Hand-maintained, not generated** — update it in the same
change if you alter section count or content, or it drifts. Doesn't load
Mantine or `tokens.css`, so it's not a valid test surface for either.

## Sensitive-content note

This form captures abuse history and substance use for a minor population
in state custody. Nothing currently restricts visibility of these fields
beyond default patient-record access — see `TASKS.md` for the AccessPolicy
item. Keep access-control and audit-trail implications in mind in any
change here; the retraction-not-deletion model exists partly to preserve
that trail.
