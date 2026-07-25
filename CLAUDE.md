# CLAUDE.md — DJS Admission Health Screening wizard

Context for working on the Maryland DJS admission screening wizard inside
this `medplum-provider` checkout. Read this before changing the wizard —
it captures decisions, invariants, and bug classes that aren't obvious
from the code.

Accurate as of commit `0e8f04b`.

## What this is

Maryland DJS's "Admission Health Screening and Nursing Assessment" paper
form, implemented as a Medplum-backed React wizard. Built from a visual
mockup, validated field-by-field against the scanned PDF, then
deliberately narrowed from 9 sections to **4**: Patient Information →
Current Health Status → Review of Systems → Diagnosis & Disposition.

Skin/Body Exam, Abuse/Substance/Family History, and Reproductive Health
were **cut entirely and are not coming back**. Allergies and
Appearance/Mental Status were merged into Current Health Status as extra
cards. If you find code referencing the removed sections, it's debris —
delete it.

The wizard originally lived in a separate `djs-medplum-theme` repo. That
repo is gone; its `theme/`, `components/`, and `pages/` were merged into
this checkout's `src/`. There is no second repo to sync with.

## Running it

```bash
npm install
npm run dev          # vite on localhost:3001
```

Reachable at `/admission-screening` (also `/:patientId` and
`/:patientId/:encounterId`), plus an "Admission Screening" entry in the
sidebar Quick Links. **Requires a Medplum project to sign into** — `.env`
ships as the stock template with an empty client ID, so point
`MEDPLUM_BASE_URL` at your own project or a local server on `:8103`.

`npm run build` runs `tsc && vite build` and type-checks tests too, so
test-only type errors break the build.

## Architecture

- `src/pages/AdmissionHealthScreeningWizard.tsx` — the whole wizard.
  Sections 1–2 use dedicated typed state; sections 3–4 use the generic
  `useFormState` container.
- `src/pages/formState.ts` — `FormState` container (`chip`/`setChip`,
  `text`/`setText`, `checkedItems`/`checkTextMap`, `rows`/`setRows`) plus
  `parseItems()`, which splits a `"A|B|C::text"` spec into checkboxes
  where `::text` marks one with an inline free-text field. **Never leave a
  trailing `|`** — it parses into a real, blank, labelless checkbox.
- `src/components/FormControls.tsx` — `Grid` (checkbox list bound to
  FormState), `YesNoChip`/`TrackedChip` (chip toggle + optional reveal).
- `src/theme/tokens.css` — design tokens and every `.djs-*` component
  class. USWDS's real default palette (primary `#005ea2`, secondary
  `#d83933`, Public Sans, 4px radius), verified against
  designsystem.digital.gov rather than guessed.
- `src/theme/mantine-theme.ts` — **unused, and intentionally so.** No DJS
  component renders a single Mantine component; it's all raw HTML plus
  `.djs-*` classes. Applying `djsTheme` would restyle the rest of the app
  for zero benefit. Leave it alone or delete it.

### Two integration constraints

**`tokens.css` is global.** Vite applies plain `.css` app-wide regardless
of which module imports it. Its typography/background rule is therefore
scoped to `.djs-root` (the wizard's outermost div) rather than `body` — a
bare `body` rule restyles every existing medplum-provider page. Keep new
rules scoped; don't add bare element selectors.

**The wizard renders inside the AppShell.** It draws its own `GovBanner`,
`AppHeader`, sidebar, and `AppFooter` at `minHeight: 100vh`, so the chrome
currently nests inside Medplum's. This is a known, accepted trade-off —
function was prioritised over appearance. Pulling it out of the AppShell
means restructuring where `App.tsx` declares `<Routes>`, since `AppShell`
wraps all of them.

## The write path — read this before touching a save handler

Every resource the wizard writes carries an identifier under
`SCREENING_ID_SYSTEM` (`http://maryland.gov/djs/admission-screening`)
whose value is derived from the field that produced it. That makes each
resource deterministically addressable, which is what the whole save
design rests on.

**`obs(subject, partial, itemKey?)`** derives the identifier from
`partial.code.text`, plus `::itemKey` for checklist rows where one code
covers many items. The key is *derived*, not hand-written per call site,
specifically so it cannot drift from the resource it labels. Keep it that
way. If you add a field, its `code.text` must be unique across the file —
a collision silently overwrites one field with another.

**Writes go through `upsertResource`, never `createResource`.** That's a
FHIR conditional update matched server-side, so saves are idempotent and
stay correct under concurrent edits. Only the `Patient` itself uses
create/update directly.

**`retractStale(resourceType, subject, inScope, liveKeys, param?)`**
withdraws resources the form no longer asserts. Upsert only ever adds or
updates, so without this, unchecking an item leaves its resource live in
the chart while the form shows it gone — the record keeps asserting a
finding the nurse withdrew, which is worse than a duplicate. Retraction
is `status: 'entered-in-error'` for Observation/MedicationStatement and
`verificationStatus: entered-in-error` for Condition/AllergyIntolerance,
which express it differently. **Never hard-delete clinical data.**

The `inScope` predicate is load-bearing: without it, saving one section
would retract every other section's findings, since none of their keys
appear in that section's live set. It matters within a resource type too
— `chronic::` and `nursing-diagnosis::` are both `Condition`, and the
prefixes are the only thing keeping them apart.

`AllergyIntolerance` searches on `patient`, not `subject` — hence the
`param` argument on `upsertQuery`/`retractStale`.

**`ensurePatientRef()` must be used for the subject.** See the bug class
below; do not read `patient` state inside a save handler.

**`runSave(key, message, fn)`** wraps each button with a pending state and
success/error notifications, using the repo's existing
`showSuccessNotification`/`showErrorNotification` helpers. Don't fire a
save handler directly from `onClick` — see below.

## Bug classes that have actually happened here — don't reintroduce

**Stale closure for the subject reference.** `subjectRef` used to be
computed at render time. `saveDemographics` created the Patient, called
`setPatient()`, then kept writing with the stale closure value — sending
`subject: undefined` on every resource in a first-time save and orphaning
them from any patient. `setState` does not update the running closure.
Always thread values out of the awaited write, via `ensurePatientRef()`.

**Field wired in the JSX but missing from the save handler.** A field has
an input bound to `form.setText`/`setChip`, but the `save*()` function
never reads it back, so data silently vanishes. This has happened
**repeatedly** across nearly every section (vision exam date/provider, ROS
comments, five withdrawal yes/no fields, disposition notes, signoff
datetime, review date). The mirror image also happened: a handler
referencing field keys no input ever set. **Any time you touch a save
handler, cross-check every `form.text()`/`chip()`/`checkedItems()` call
inside it against the JSX, both directions.** The script below does it.

**Async handler fired as a floating promise.** `onClick={saveFoo}` on an
async function swallows rejections — a failed save looks identical to a
successful one. Everything goes through `runSave` now; keep it that way.

**A default that's also a valid value.** `painScale` defaulted to `0`, but
on a 0–10 scale `0` means "no pain" — a real clinical finding. An
untouched slider was silently recording one. It now starts `undefined`
and saves a coded `dataAbsentReason` when no score was captured. Watch for
this pattern anywhere a "not answered" state shares a value with a real
answer.

**Trailing `|` in a `Grid` items string** parses into a blank, labelless
checkbox.

## Verifying changes

Field integrity — every read in a save handler should have a matching set
in the JSX, and vice versa. This has caught real bugs every single time
it's been run:

Note `python`, not `python3` — the `python3` alias is not present on this
Windows setup, and the previous version of this file documented a command
that simply failed.

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

`read but never set` is always a bug. `set but never read` needs
eyeballing — the regex only matches literal keys, so grids read through a
loop variable show up falsely. **Known false positives:** `injuries`,
`firearm-safety`, `infectious` (all read via `form.checkedItems(grid)` in
`saveReviewOfSystems`). Anything else in that list is worth chasing: it's
how the `epipen` field was found to be captured but never saved.

The script also can't tell a read in the JSX from a read in a save
handler, so a field whose only read is its own input `value=` will look
clean while never being persisted. That's how `epipen-detail` hid.

Identifier collisions — two fields deriving the same key would silently
overwrite each other:

```bash
grep -oE "code: \{ text: '[^']+'" src/pages/AdmissionHealthScreeningWizard.tsx \
  | sed "s/code: { text: '//;s/'$//" | sort | uniq -d
```

Then `npm run build` (type-checks tests too) and `npx vitest run`.

## Formatting

**CRLF line endings, not LF** — this is committed from Windows.
`.gitattributes` has `* text=auto eol=crlf`; keep it. Convert generated
files before considering a task done:

```bash
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.css" -o -name "*.md" -o -name "*.html" \) \
  -not -path "./node_modules/*" \
  -exec sh -c 'sed -i "s/\r$//" "$1" && sed -i "s/$/\r/" "$1"' _ {} \;
```

## `preview.html`

A static, dependency-free mirror of the wizard for visual checks without
a build step. **Hand-maintained, not generated** — if you change the
section count or content, update it in the same change or it drifts. It
is currently in sync at 4 sections.

Note it does not load Mantine or `tokens.css`, so it is not a valid test
surface for anything involving those.

## What's NOT done

See `TASKS.md` for the current plan and priorities. In short: single-value
fields aren't retracted yet (a cleared vital sign still asserts its old
value), the form isn't resumable (no read-back into fields), writes aren't
batched into transaction bundles, and there is no coded terminology, no
validation, no AccessPolicy, and no tests for any DJS code.

## Sensitive-content note

This form captures abuse history and substance use for a minor population
in state custody. Nothing currently restricts visibility of these fields
beyond default patient-record access. Keep access-control and audit-trail
implications in mind even in prototype code — and note that the retraction
model above exists partly to preserve that audit trail.
