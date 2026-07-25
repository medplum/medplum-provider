---
name: triage
description: Triage one inbox item through the konko-ai development lifecycle — use when asked to triage an item in docs/inbox/ ("let's triage <item>"). Produces a written routing verdict, not an implementation. Works in any konko-ai repo.
---
<!-- vendored from engineering@4e72116 — edit the source, not this copy -->

# /triage — triage one inbox item

State-machine position: step 0 of the lifecycle. The rules live in the repo's `docs/guidelines/development-lifecycle.md` — this skill executes them. (In `engineering/`, its CLAUDE.md routes to an extended variant — service hand-offs, ADR/convention promotions — follow that there.)

**Boundary:** triage decides *where work goes* and prepares the paperwork. It never does the next verb's thinking — if you find yourself writing design sections or plan phases inside triage, stop; that's `/design-doc` or `/exec-plan`.

## Preconditions

1. Read the item's frontmatter (`status:`, `links:`, any `triage:` block) and body in full.
2. Check `links:` and the target directories for artifacts that already exist for this item — don't re-propose what's already in flight.
3. A `triage:` block merged to the repo's main branch is a **confirmed routing verdict** from the fleet sweep — the PR merge was the confirmation. Skip steps 1–3 and go straight to step 4 bookkeeping for the recorded disposition. An unmerged or absent block gets the full flow.

## Steps

1. **Assess** — the triage deliverable is a short written verdict, not a status flip:
   - What is the item actually asking for, in one sentence?
   - The axes: is the problem clear? Is the solution obvious? Will the change span multiple PRs?
   - A rough effort and verifiability guess (this feeds later `agent-ok` delegation decisions).
2. **Route** by the axes:
   - We don't yet know what to propose → **research** (`docs/research/<YYYY-MM>-<slug>/`).
   - Problem unclear → **product spec** (`docs/product-specs/<slug>.md`).
   - Solution not obvious → **design doc** (`docs/design-docs/<YYYY-MM-DD>-<slug>.md`).
   - Spans multiple PRs → **exec plan** (`docs/exec-plans/active/<YYYY-MM-DD>-<slug>.md`) — the deliberate "ready to plan" path when a formal design doc is skipped.
   - Trivial → open a PR directly; delete the item once the PR merges.
   - Not worth doing → `status: wontfix` with a one-line reason; keep the file — rejection records are useful.
3. **Propose the path, with the assessment, and wait for confirmation. Never promote without it.**
4. On confirmation, the bookkeeping:
   - Append the verdict to the item body as `Triage note (<date>): <one-line assessment → route>`.
   - Set the matching status (research/spec → `triaged`, design → `designing`, plan → `planning`) and cross-link item ↔ artifact both ways in `links:`.
   - Create the target artifact as a **stub only**: correct filename, header (`**Date:**` + `**Status:** Draft` for design docs), and the problem statement carried over from the item. The next verb evolves the stub.

## Postconditions

- The item flows into the workflow at the step its promotion targets; the stub is where the next verb (`/design-doc`, `/exec-plan`) picks up, in this session or a fresh one.
- When the promoted work ships, the item is **deleted** — the design doc, plan, and PR are the durable record; `done` is not a resting state.
