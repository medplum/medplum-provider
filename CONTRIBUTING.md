# Working on the DJS Admission Screening wizard

**Read this before changing anything in the wizard — especially if you're
changing the UI.**

This is written for design and product folks joining the project, and for the
AI assistants helping them. It assumes no FHIR knowledge and no familiarity
with the codebase. It is not a style guide; it's a list of the ways this
particular app breaks *silently*, and how to avoid them.

`CLAUDE.md` is the deep technical reference. This document is the on-ramp. If
the two ever disagree, `CLAUDE.md` is right — tell someone about the drift.

---

## What this project is

A Maryland DJS "Admission Health Screening and Nursing Assessment" — a paper
form rebuilt as a web app storing real clinical data in FHIR (a health-records
standard) via a platform called Medplum.

It has two purposes, and the second one changes how you should behave:

1. Build a working screening wizard.
2. **Evaluate whether Medplum is a viable platform for this agency.**

Because of (2), **finding a problem is a deliverable, not a delay.** If
something feels wrong, awkward, or impossible, say so loudly and write it
down — that's the output we want, not a workaround you quietly invented. Do
not paper over a limitation to keep moving.

### Who this data is about

This form records health information about **minors in state custody**,
including abuse history and substance use. Two consequences:

- Data loss here isn't cosmetic. A nurse's entry vanishing means a real
  clinical fact about a child in custody is missing from their record.
- Records are **never deleted**, only marked withdrawn, so the history stays
  auditable. Never "clean up" data by deleting it.

---

## The 60-second version

If you read nothing else:

| Do | Don't |
| --- | --- |
| Rename a **field label** freely | Rename a **checkbox / checklist item** — that text is stored data |
| Add fields in pairs: input **and** the code that saves it | Add an input and assume it saves itself — it won't, and nothing will warn you |
| Keep two facts in two inputs | Merge two facts into one box ("120/80", "5mg twice daily") |
| Leave dropdowns as closed lists | Add an "Other — type your own" escape to a dropdown |
| Run `npm test` before saying you're done | Assume a green screen means it saved |
| Say "I found a platform limitation" | Invent a workaround and stay quiet about it |

**Stop and ask a developer** before: renaming any checkbox, removing a field,
deleting anything, changing how something is stored, or if a test fails and
you don't understand why.

Changes are reviewed before they land — **§9 is the exact checklist that gets
applied.** Worth skimming before you start, not just before you submit.

---

## 1. Some text on screen is data, not decoration

This is the single biggest trap, and it's invisible.

When a nurse ticks **"Latex allergy"**, the app saves a record whose permanent
identity is built from that exact text. Change the label to
`"Allergy: latex"` and the app will no longer recognize any previously saved
record — every patient who had that allergy recorded now appears not to. The
old records aren't deleted; they're **orphaned**, which is worse, because
nothing looks broken.

### The rule

| Kind of text | Safe to change? | Why |
| --- | --- | --- |
| Section headings, hints, help text, button text | ✅ Yes | Pure display |
| **Field labels** — the `label="..."` on a text box | ✅ Yes | Stored separately from the label. *Tests find inputs by label text, so a rename will break tests — that's expected; the fix is updating the test.* |
| **Checkbox / checklist item text** | ❌ **No — ask first** | Stored verbatim as the record's identity |
| **Facility names** in the dropdown | ✅ Yes | Deliberately designed so names can change — see below |
| Dropdown **codes** (`cheltenham`, `hickey`) | ❌ **Never** | Permanent identity |

Concretely: in a line like

```
items="No known allergies|Latex allergy|Food allergy|Other::text"
```

each of those phrases is stored data. `::text` marks the one checkbox that also
gets a free-text box next to it. **Never leave a trailing `|`** — it creates an
invisible, unlabelled checkbox.

Adding a *new* checkbox is fine. Renaming or removing an existing one needs a
developer, because old records have to be migrated.

### Commas are a real hazard

Avoid commas in new checklist items. Commas have a special meaning in the way
these records are looked up, and an unescaped one used to cause records to
**silently duplicate on every save**. That's fixed, but the safest new item
text has no commas in it. Existing ones like `"Insect allergy (bee, wasp, ant)"`
are handled — don't add more without flagging it.

---

## 2. A field on screen does not save itself

This is the bug this codebase has had **five separate times**: Epi-Pen details,
chronic-condition providers, disposition notes, the appearance "Other" box, and
admission date + facility. In every case a nurse could type into a box, click
Save, see a success message — and the data was silently discarded.

**Adding an input to the page is roughly half the work.** Something also has to
read that input and store it. If you (or your AI assistant) add a field, you
must confirm the save side exists.

There is an automated check, but **it does not cover everything** — it can't see
fields in the first two sections (Demographics, Current Health Status), which is
exactly where the admission-date bug hid. Never treat a passing test suite as
proof that a new field saves.

**How to actually verify a new field saves:** add a test that types into it,
saves, and asserts the value came back. If you're working with an AI assistant,
ask for that test explicitly — and ask it to prove the test works by
temporarily breaking the save and showing the test go red. A test that passes
whether or not the code works is worse than no test.

---

## 3. Patterns already fixed — please don't undo them

These look like reasonable UI simplifications. They are not. Each one was a
real bug that took real work to fix.

### Don't merge two facts into one input

A single "120/80" blood-pressure box looks tidier than two. It isn't:
- Software can't compare, chart, or alarm on the text `"120/80"`.
- A blood-pressure check appropriate to a child's age is **impossible** against
  a text string.
- Anything that pulls the two numbers apart later has to guess, and guesses fail
  on real-world input.

Same for medication dose + frequency, and for the nurse/physician signature
pair. **Two facts, two inputs.** If a design calls for merging them, raise it.

### Don't add an "Other" escape to a closed dropdown

The Facility dropdown is a fixed list on purpose. A free-text fallback would
let two spellings of the same facility become two different facilities in the
database, which quietly corrupts any reporting built on it. If a facility is
missing, the fix is **adding it to the list**, not letting people type one.

### Don't use a default that's also a real answer

The pain slider starts blank, not at 0, because on a 0–10 scale **0 means "no
pain" — a genuine clinical finding**. If the default were 0, "not asked" and
"asked, answered zero" would be indistinguishable forever. Any new rating,
score, or scale needs the same care: there must be a way to tell "unanswered"
from a real answer that happens to look like the default.

### Don't add a delete button

Withdrawing a finding marks it as retracted and keeps the history. That's a
deliberate design for an auditable custodial health record. If a design calls
for "remove", it means *withdraw*, and a developer should wire it.

---

## 4. Testing expectations

```bash
npm test
```

Runs the offline test suite (100+ tests for this wizard). **Run it before you
consider a change finished.** It's fast and needs nothing set up.

```bash
npm run build
```

Catches type errors, including in tests. Also run this.

```bash
npm run dev
```

Runs the app locally. Needs a Medplum server to sign into — ask a developer to
get you set up the first time.

```bash
npm run test:live
```

Runs tests against a real Medplum server. Needs credentials; **skips harmlessly
without them**, so it's safe to run. Some bugs only appear here — the offline
tests use a simulator that accepts invalid data the real server rejects. If
you're changing how anything is *stored*, a developer should run these.

### What "done" means

- `npm test` passes
- `npm run build` passes
- Any new field has a test proving it saves **and** comes back when you reopen
  the screening
- You've said out loud what you *didn't* verify

That last one matters. "Tests pass, but I haven't seen it in a browser" is a
useful, honest statement. "It works" when you haven't checked is not.

---

## 5. FHIR — the minimum you need

FHIR is the health-data standard everything is stored in. You don't need to
learn it, but three things will save you grief.

**Every screening answer becomes a medical record, not a form field.** A ticked
checkbox becomes a clinical finding with its own identity, status and history.
That's why the text matters (§1) and why nothing is deleted (§3).

**Prefer the standard shape over a convenient one.** FHIR usually has a proper
place for a thing. Blood pressure has an official two-part structure; medication
dose has official fields for amount and frequency. Using them is why the data
can be shared with other systems later. When there's a choice between "a text
box that holds anything" and "the structured field the standard defines", we
take the structured one — and if that requires a UI change, the UI changes.

**Don't claim a standard you don't meet.** Some markers in the code declare "this
record follows profile X", which obliges it to satisfy that profile's rules.
Adding the marker without the rules produces data that *looks* conformant and
isn't — we've hit this twice. Not something you'll do directly, but if an AI
assistant offers to "make this US Core compliant", make sure it read the
profile's requirements rather than just adding a label.

---

## 6. Styling

- The wizard uses plain HTML with `djs-*` CSS classes, and its design tokens
  live in `src/theme/tokens.css`. That's the place for colour, spacing and type
  changes.
- **It does not use Mantine**, the component library the surrounding app uses.
  Don't introduce Mantine components into DJS screens — there's a deliberately
  unused theme file explaining why.
- In `tokens.css`, **never add a bare element selector** (`body`, `input`, `h1`
  on its own). That file loads globally and would restyle the rest of the
  application. Always scope to a `.djs-*` class.
- Function over appearance is the standing priority for this prototype. Known
  cosmetic issue: the wizard draws its own header/sidebar/footer nested inside
  the host app's. That's accepted, not overlooked — don't spend effort on it
  without asking.

---

## 7. Housekeeping

- **Line endings are handled for you.** `.gitattributes` normalizes them, so
  don't convert files by hand or let an AI assistant do it "to be safe". If a
  file you barely touched shows as entirely changed, stop and ask — that's a
  real signal, not something to paper over.
- **Commit source changes only** — no build output, no `node_modules`.
- `TASKS.md` is the source of truth for what's done and what's planned,
  including *why* decisions were made. If you make a decision that a future
  reader would find surprising, write it there.

---

## 8. If you're an AI assistant reading this

- **Don't rename checkbox or checklist item text** to improve wording without
  flagging it as a data-migration question first. It looks cosmetic; it isn't.
- **When you add an input, add the save path and a test in the same change.**
  Then verify the test by breaking the code on purpose and confirming it fails.
  Report that you did this.
- **Don't infer FHIR codes, LOINC codes, or terminology from memory.** Look them
  up in the spec. A plausible-but-wrong medical code is worse than none, because
  it looks authoritative. This project's convention is to cite the source in a
  comment.
- **Don't invent facility names, clinical codes, or reference data.** If you
  need a value you don't have, ask.
- **Report honestly.** If tests fail, say so with the output. If you skipped
  verification, say which. Never describe work as verified when it isn't.
- **Surface platform limitations rather than working around them.** That's the
  point of the project — see the top of this document.

---

## 9. Code review — what will actually be checked

Changes get reviewed before they land. This is the checklist that gets applied,
published here so there are no surprises: **run through it yourself first and
most review comments disappear.**

Items are ordered by how much damage they do. The top group is the reason this
review exists at all — every one of them has happened in this codebase, and
none of them announce themselves.

### Silent data loss — the blocking group

1. **Was any checkbox / checklist item text renamed or removed?** Orphans every
   prior record of it. Needs a migration plan, not just a rename.
2. **Does every new input have code that saves it?** Traced by hand, not assumed
   from a green test run.
3. **Does every new input reload when the screening is reopened?** Saving and
   reading back are separate code — one without the other means a nurse's work
   vanishes when they resume.
4. **Was an input removed while its save code stayed** (or the reverse)?
5. **Were two facts merged into one input?** (see §3)
6. **Was a free-text escape added to a closed dropdown?** (see §3)
7. **Does any new default double as a real answer?** (see §3)
8. **Does anything delete rather than withdraw?** (see §3)

### Data that looks fine and isn't

9. **Commas or a trailing `|` in new checklist item text.**
10. **Two fields sharing a stored code** — they'd silently overwrite each other.
11. **Medical codes taken from memory rather than looked up**, or without a
    source cited. A plausible-but-wrong clinical code is worse than none.
12. **A standards marker added without meeting that standard's requirements**
    (see §5).

### Testing

13. **Does each new field have a test proving it saves *and* comes back?**
14. **Was that test shown to fail when the code is broken?** An unverified test
    is a false sense of security; this is asked about specifically.
15. **`npm test` and `npm run build` both pass.**
16. **Does anything touching storage need a live-server run?** If yes, it gets
    flagged for one.

### Styling and housekeeping

17. Bare element selector added to `tokens.css` (would restyle the host app).
18. Mantine components introduced into DJS screens.
19. No build output or `node_modules` committed. No whole-file line-ending
    churn burying the real change.
20. Decisions a future reader would find surprising written down in `TASKS.md`.

### How to make review fast

- **Keep changes small and one-topic.** A restyle mixed with a new field is
  much harder to review than either alone.
- **Say what you verified and what you didn't.** "Tests pass, haven't run it in
  a browser" is genuinely useful and costs you nothing. Claiming more than you
  checked is the only thing that erodes trust here.
- **Flag your own uncertainty inline.** "I renamed this checkbox — is that
  safe?" gets a fast answer. The same rename discovered during review costs
  everyone more.
- **Don't tidy unrelated code in the same change.** It buries the thing that
  needs attention.

Review findings come back grouped by severity, each with the concrete scenario
that breaks — not just "this is wrong". If a finding seems wrong to you, push
back; sometimes the reviewer is missing context, and that's worth catching too.

---

## 10. When you're not sure

Ask. Genuinely — the failure mode here is silent, plausible-looking data loss,
and the cost of a question is far lower than the cost of a nurse's entry
vanishing from a child's medical record without anyone noticing for months.

Good questions to raise without hesitation:

- "Is this checkbox text safe to reword?"
- "Does this new field actually save anywhere?"
- "This design merges two values into one box — is that a problem?"
- "The tests pass but I haven't seen it run. Who can check?"
- "This seems like something the platform should do and doesn't."
