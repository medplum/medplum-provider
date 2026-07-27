# DJS Admission Screening — design and product decisions

Open questions that need answers from design, product, or clinical stakeholders
before implementation work can start. Each entry names what needs to be decided,
what it blocks, and enough context to have the right conversation.

Resolved decisions that are still load-bearing are documented in `CLAUDE.md`
(why blood pressure is two fields, why the facility list is closed, why records
are retracted rather than deleted, etc.). This file is for what's still open.

---

## Open

### 1. Record locking — when does a screening become read-only?

**The question:** Should a completed or signed-off screening record become
non-editable at some point? If so, what triggers the lock, who can unlock it,
and what does "locked" mean in practice — read-only UI, FHIR write-protection,
or both?

**Why it matters:** The form captures health information about minors in state
custody. There's a real tension between two valid needs:
- **Auditability:** a signed record should reflect what was true at the moment
  of sign-off — reopening and editing it later undermines the trail.
- **Correction:** nurses make mistakes; a record that can never be amended is
  also a problem.

The current model allows unlimited re-editing — any save overwrites the prior
value in place (idempotent upsert). That's correct for an in-progress
screening, but may not be correct after a director or supervisor has signed off.

**Questions to answer before building:**
- What event triggers a lock? Nurse sign-off? Physician co-sign? Director
  review? Submission to a state system?
- Is the lock hard (FHIR resources become immutable) or soft (UI disables
  editing, but a privileged user can reopen)?
- Who can unlock, and what does unlocking require (a reason? a countersignature)?
- Does the lock apply to the whole screening or section by section?
- Should the current sign-off field (`Admission health screening sign-off`
  Observation) be the trigger, or is a separate director-approval step needed?

**What this blocks:** Any implementation of record locking, read-only UI states,
or supervisor approval workflows. Also affects task 29 (practitioner attribution)
and task 32 (sign-off identity) — both become more load-bearing once a record
can be locked.

**Likely tradeoffs:**
- A soft lock (UI only) is simpler but doesn't protect against API writes.
  Appropriate for a prototype; probably not for production.
- A hard lock via AccessPolicy (FHIR server-level) requires a well-designed
  role model first — you can't lock a record to a role that isn't defined.
- Locking per-section is more granular but harder to reason about; locking
  the whole screening on sign-off is simpler to explain to staff.

---

### 2. Sign-off identity — typed names or linked accounts?

**The question:** The current sign-off fields capture nurse and physician names
as free text (`"Nurse: X; Physician: Y"`). Should these be linked to actual
Practitioner accounts in the system, or is typed text acceptable?

**Why it matters:** A free-text name is legally unattributable — it can't be
verified, can't be queried, and can't drive access control or audit. For a
custodial health record, that may or may not be acceptable depending on what
Maryland DJS requires for documentation.

**Questions to answer:**
- Does DJS policy require that a sign-off be traceable to a credentialed
  individual in a system of record?
- Are the nurses and physicians who use this form already Practitioner accounts
  in Medplum (or would they be, in a real deployment)?
- Can a nurse sign off on behalf of a physician, or must each sign themselves?
- Is the current typed-name approach acceptable as a prototype stand-in, or
  does it need to be right before piloting?

**What this blocks:** Task 32. Also closely related to record locking (§1) —
a lock triggered by a sign-off is only meaningful if the sign-off identity is
verified.

---

### 3. Nursing plan structure — free text, activity list, or clinical tasks?

**The question:** The nursing plan is currently saved as a single
`CarePlan.description` string (items joined with `"; "`). FHIR's `CarePlan`
has a structured `activity[]` array. Some plan items may be clinical tasks
(`Task`) or service requests (`ServiceRequest`). What does the clinical workflow
actually require?

**Why it matters:** The merged-string approach has the same fragility as the
comma bug that duplicated findings — any separator that also appears in real
plan text will corrupt the data. More fundamentally: if plan items are things
that get assigned, tracked, and completed, a text blob can't drive any of that.

**Questions to answer:**
- Are nursing plan items things that get assigned to specific staff and tracked
  to completion, or are they documentation of intent (free text is fine)?
- Should plan items link to order sets, protocols, or care templates?
- Is each item a distinct clinical act (ServiceRequest/Task) or a note?

**What this blocks:** Task 31.

---

### 4. Medication drug name lookup — what is the search experience?

**The question:** Drug names are currently entered as free text. RxNorm coding
(task 22) requires a drug-search UI — something the form doesn't have. What
should that experience look like, and what data source backs it?

**Questions to answer:**
- Should the nurse type a name and pick from a list (typeahead against a
  terminology service), or enter a code manually?
- What terminology service is available or preferred? (NLM RxNav API is free
  and public; DoseSpot has its own catalog; others exist.)
- Is full RxNorm coding required before piloting, or is free text acceptable
  for the demo phase?

**What this blocks:** Tasks 22 and 23. Task 23 (DoseSpot prescribing
integration) is also blocked on 22.

---

### 5. Field-level access control — who can see sensitive sections?

**The question:** The form includes fields for abuse history and substance use
for a minor population in state custody. Nothing currently restricts visibility
of these fields beyond default patient-record access. What is the intended
access model?

**Why it matters:** "Default access" likely means anyone with a Medplum login
to this project can read everything. That may not be acceptable for sections
covering abuse history.

**Questions to answer:**
- Which fields or sections should have restricted visibility?
- What roles exist (nurse, physician, director, case manager, auditor) and
  what should each see?
- Is restriction per-field, per-section, or per-resource-type?
- Does DJS have an existing policy document that defines this?

**What this blocks:** The AccessPolicy backlog item. Also affects task 29
(practitioner attribution) — attribution is more meaningful once access control
is defined.

---

### 6. Checklist identifier model — item text as identity vs. coded values

**The question:** Currently, a checked item's on-screen text is its permanent
identity in FHIR (e.g. `"Latex allergy"` becomes the `code.text` the record is
keyed on). This inverts FHIR convention, where a stable code identifies the
finding and display text is a human label that can change. The current approach
means renaming a label is a data migration, not a display change.

This is the largest structural open item and may be substantially resolved by
the QuestionnaireResponse decision (§7).

**Questions to answer:**
- Should checklist findings be identified by a stable code (SNOMED, local
  value set) with a changeable display label, or is the current approach
  acceptable for this agency's needs?
- If stable codes are required: who maintains the value set, and what
  terminology system do they come from?

**What this blocks:** Task 35. Also sequenced before task 20 (comma hazard
audit) — don't fix the comma escaping if the identifier model is about to
change anyway.

---

### 7. Persistence model — hand-rolled FHIR resources vs. QuestionnaireResponse

**The question:** Should the screening wizard migrate to `QuestionnaireResponse`
as its persistence model? The current approach hand-rolls individual FHIR
resources per field, which is where most of the bug backlog comes from
(identifier collisions, comma escaping, retraction scoping, "wired in JSX but
never saved"). `QuestionnaireResponse` round-trips a form losslessly by
construction — the platform handles persistence, the app just reads and writes
the response.

This is a scoped spike (task 34), not a commitment to migrate. The deliverable
is a written recommendation, not code.

**Questions to answer before the spike:**
- Is the individually-queryable-resource model (each finding as its own
  Observation/Condition/etc.) required for downstream use cases — reporting,
  clinical decision support, interoperability?
- Or is the form data primarily used as a unit (display the screening, export
  the screening) rather than as individual queryable findings?

The answer drives the recommendation: if individual resource queryability is
essential, QuestionnaireResponse is a dead end. If the form is primarily used
as a unit, it may be the right model.

**What this blocks:** Task 34, which in turn gates task 35. These two decisions
should be made together.

---

## Resolved (load-bearing — in CLAUDE.md)

These are called out here so they don't get relitigated. Full reasoning is in
`CLAUDE.md`.

| Decision | What was decided |
|---|---|
| Blood pressure as two separate fields | Clinical values must not be merged into a single string — see CONTRIBUTING.md §3 |
| Facility list is a closed dropdown with permanent codes | Free-text escape would allow duplicate Locations and corrupt facility reporting |
| Records are retracted, never deleted | Auditable trail for a custodial health record; `status: entered-in-error`, not hard delete |
| Sections 5–9 cut and not coming back | Skin/Body Exam, Mental Status/Psychosocial, Abuse/Substance/Family History, Reproductive Health were explicitly descoped |
| `effectiveDateTime` preserved on re-save | Reopening a screening the next day must not re-date yesterday's vitals |
| Pain scale defaults to blank, not 0 | 0 is a real clinical answer ("no pain") — a default that doubles as a valid answer is undetectable as unanswered |
| `executeBatch` / transaction bundles not used | Medplum 5.1.27 does not implement atomic transactions — see CLAUDE.md platform findings |
