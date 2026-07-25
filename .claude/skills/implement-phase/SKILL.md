---
name: implement-phase
description: Implement one phase of an active execution plan, or resume work on one, following the konko-ai development lifecycle — use when asked to implement a phase ("implement phase 3 of <plan>") or to continue ("continue the plan", "pick up where we left off"). Works in any konko-ai repo.
---
<!-- vendored from engineering@4e72116 — edit the source, not this copy -->

# /implement-phase — implement one phase of an exec plan

State-machine position: the implementation step, one phase per session/PR. All state lives in the plan file — read it cold; never assume conversation memory from earlier phases. The rules live in the repo's `docs/guidelines/development-lifecycle.md` — this skill executes them.

## Preconditions — read the state cold

1. Locate the plan in `docs/exec-plans/active/` and the phase (numbered in the request, or the first non-Done phase).
2. Verify every earlier phase is `Done`. If not, stop — phases run in order. Offer to finish the earlier phase first; proceeding out of order requires the human's explicit go.
3. Verify the target phase is `Not Started` or `In Progress`. Read the linked design doc for intent where the phase description is thin.

## Steps

1. Set the phase `**Status:** In Progress` (commit-worthy state: the plan is the coordination surface for whoever looks next). If this is the plan's first phase and the plan header names a source inbox item, set that item's `status: doing`.
2. Implement exactly this phase's scope, following the repo's conventions (its `CLAUDE.md` index and topic docs). Scope creep goes to the plan as a note or a new phase — not into this diff.
3. Run the repo's verification — `make verify` where it exists, otherwise the verification targets advertised in the repo's `CLAUDE.md` (lint + the relevant test targets) — plus the deeper suite if the phase description names one. Fix until green.
4. **Docs consistency check.** With the diff in hand, ask what it made stale or left undocumented: the package/repo `CLAUDE.md` index lines, the `docs/` topic files for touched components, runbooks or references the change invalidates. Ship the updates in this same diff. Most phases affect no docs — a fine outcome, but state it explicitly (one line in the PR description); the check always runs and is never silently skipped.
5. **Review-fix loop (mandatory, two rounds max).** Run `/code-review` on the working diff, and **persist its findings immediately** to an untracked working file next to the plan (`<plan>.phase-<N>-review.md`) as a checklist — the file is the loop's durable state; it survives context compaction and session breaks, the conversation does not. Work the checklist: fix each finding, or mark an explicit disposition (why it's skipped or not a real issue). After fixes, re-run verification, then run `/code-review` once more to confirm the fixes and catch anything new; update the checklist. **Exit condition: every finding in the file is marked fixed or dispositioned — "review ran" is never the exit.** Do not grind past the second round — findings still open then go to the human reviewer, who is the right judge of anything that survived two rounds. Copy the final finding → outcome table into the PR description; delete the working file before merge.
6. Set the phase `**Status:** Done`.

For unattended runs, the launcher arms the loop (e.g., a `/goal` condition or a workflow stop rule) using exactly the review-loop exit condition plus verification green — never "review ran".

## Postconditions

- One phase = one PR; don't roll multiple phases into one branch unless explicitly asked.
- If this was the **last** phase: the closing bookkeeping ships **inside this final PR** — move the plan to `docs/exec-plans/completed/`, delete the source inbox item (find it via the plan header's `Source:` line or `links:`; `done` is not a resting state), and add the design doc + plan to the touched component's topic-file "Related design docs and exec plans" section (provenance both ways).
- Report status honestly: if verify fails or scope was cut, the phase stays `In Progress` with a note in the plan.
