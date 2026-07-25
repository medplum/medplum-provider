---
name: exec-plan
description: Create a phased execution plan from an Approved design document, following the konko-ai development lifecycle — use when asked to plan implementation ("let's write an exec plan for <design doc>"). Not for resuming implementation of an existing plan — that's /implement-phase. Works in any konko-ai repo.
---
<!-- vendored from engineering@4e72116 — edit the source, not this copy -->

# /exec-plan — create an execution plan

State-machine position: after design-doc approval, before implementation. The rules live in the repo's `docs/guidelines/development-lifecycle.md` — this skill executes them.

## Preconditions — validate before writing

1. Locate the design doc (named in the request, or the obvious recent Draft/Approved in `docs/design-docs/`).
2. **Verify `**Status:** Approved`.** If it is Draft, stop and report — an exec plan from an unapproved design is a lifecycle violation. (Exception: a deliberate skip-design decision, recorded either by the triage ready-to-plan path — the inbox item's `status: planning` — or, for direct requests, by a `Design: deliberately skipped — <reason>` line in the plan header.)
3. Check `docs/exec-plans/active/` for an existing plan covering the same design — extend it rather than duplicating.

## Steps

1. Read the design doc fully, plus the topic docs and code the phases will touch.
2. Derive the phases: each one a **self-contained, independently mergeable change** (a PR, not a commit) that leaves the system working when merged alone. Order them so earlier phases never depend on later ones.
3. Write `docs/exec-plans/active/YYYY-MM-DD-<slug>.md`: one `##` section per phase with `**Status:** Not Started` and a detailed description (intent, files to modify, considerations, how to verify).
4. Cross-link: reference the design doc from the plan; add the plan to the design doc; if an inbox item exists, set `status: planning`, link it, and record it as a `Source:` line in the plan header so later sessions can find it for the closing bookkeeping.

## Postconditions

- The plan sits in `active/` with all phases `Not Started`.
- Next verb, typically one fresh session per phase: `/implement-phase <plan> <n>`.
