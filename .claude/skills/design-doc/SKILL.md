---
name: design-doc
description: Create a design document following the konko-ai development lifecycle — use when asked to design a feature or change ("let's write a design doc for X"). Works in any konko-ai repo.
---
<!-- vendored from engineering@4e72116 — edit the source, not this copy -->

# /design-doc — create a design document

State-machine position: after the product spec (if any), before the exec plan. The rules live in the repo's `docs/guidelines/development-lifecycle.md` (vendored; canonical in `engineering/`) — this skill executes them.

## Preconditions — establish state before writing

1. Identify the target repo (cwd, or named in the request) and read its `CLAUDE.md` index.
2. Look for prior state: a linked inbox item in `docs/inbox/`, a product spec in `docs/product-specs/` covering this, and existing design docs touching the same component (prefer evolving one over duplicating it).
3. If requirements are genuinely unclear and no spec exists, stop and say so — propose writing the spec or ask the targeted questions first. Don't design against guesses.

## Steps

1. Read the relevant spec, the topic docs the change touches (via the repo's CLAUDE.md index), and the code entry points involved.
2. Draft `docs/design-docs/YYYY-MM-DD-<slug>.md`, opening with `**Date:**` and `**Status:** Draft`.
3. Sections, adapted to the change: problem, design overview, domain model, API changes, data flow, migration strategy, edge cases, file impact summary.
4. If an inbox item spawned this work: set its `status: designing` and cross-link item ↔ doc both ways.

## Postconditions

- The doc exists as **Draft**. Only a human flips it to **Approved** — never do it yourself, and never start implementation or an exec plan from a Draft. A material edit to an Approved doc reverts its status to `Draft` for re-approval.
- Next verb, typically in a fresh session once Approved: `/exec-plan <design-doc>`.
