<!-- vendored from engineering@4e72116 — edit the source, not this copy -->
# Development lifecycle

How work moves from idea to shipped change. Artifacts live under `docs/`:

| Directory | Holds |
|---|---|
| `docs/inbox/` | Untriaged ideas — `YYYY-MM-DD-<slug>.md`, frontmatter `status:` (`inbox`/`triaged`/`designing`/`planning`/`doing`/`wontfix`) + `links:`; items may carry a `triage:` block (date, disposition, `agent-ok:`) stamped by the fleet triage sweep and confirmed by PR merge — treat a merged marking as the item's routing verdict |
| `docs/research/` | Investigations / spikes — `YYYY-MM-<slug>/` |
| `docs/product-specs/` | Requirements — `<slug>.md` (undated) |
| `docs/design-docs/` | Designs — `YYYY-MM-DD-<slug>.md`, opens with `**Date:**` and `**Status:** Draft → Approved` |
| `docs/exec-plans/{active,completed}/` | Phased plans — `YYYY-MM-DD-<slug>.md` |
| `docs/decisions/` | Repo-level ADRs |

To capture a new idea mid-work: create `docs/inbox/YYYY-MM-DD-<slug>.md` with `status: inbox` and an empty `links:` block — capture is cheap, triage comes later.

**Workflow** — enter at the step that fits (direct, already-specified requests usually start at 3 or 4):

0. **Inbox** (skill: `/triage`): if the work started as an untriaged idea, triage it first — propose where it routes: steps 1–5; trivial → a direct PR (item deleted on merge); not worth doing → `status: wontfix` with a one-line reason (file kept — rejection records are useful). **Promote only with confirmation.**
1. **Research**: only when we can't yet propose a specific change. Outcomes may promote to an ADR in `docs/decisions/` and/or a design doc (see `docs/research/README.md` where present).
2. **Product spec**: only if requirements need writing.
3. **Design doc** (skill: `/design-doc`): created as `**Status:** Draft`; only a human flips it to `Approved`. Evolve an existing doc on the same topic rather than duplicating; a material edit to an Approved doc reverts it to `Draft` for re-approval.
4. **Exec plan** (skill: `/exec-plan`): created **only from an Approved design** — or via a deliberate skip-design decision recorded in the plan header (the triage ready-to-plan path, or a direct request noted as such). Extend an existing active plan rather than starting a parallel one. Each phase is a `##` section with a `**Status:** Not Started | In Progress | Done` marker on its own line — tooling parses this shape; a status may carry a `— <note>` suffix (e.g. `Done — [PR link]`), statuses outside the enum are invalid — describing a self-contained, independently mergeable change: a PR, not a commit.
5. **Implementation** (skill: `/implement-phase`): phase by phase, one PR each; **phases run in order — a phase starts only when every earlier phase is `Done`**. Per phase: verification green → **docs check** (is the package/repo documentation — CLAUDE.md index, `docs/` topic files — still accurate and complete for this change? updates ship in the same PR; "none affected" is a valid outcome but must be stated, never silently assumed) → **`/code-review`** (every finding fixed or explicitly dispositioned; re-verify after fixes) → phase `Done`. **Human review of the PR is the terminal gate.** The final phase's PR also carries the closing bookkeeping: plan moved to `completed/`, source inbox item deleted.

The step skills execute the full precondition and bookkeeping checks — use them when performing the step.

**Process rules:**

- A new rule discovered during work goes into the right `docs/` topic file before finishing — never only in conversation history. Workflow-level rules are proposals for the shared lifecycle: file them as an inbox item in **this repo's** `docs/inbox/` — never edit the vendored guideline copy. The fleet triage sweep marks such items for re-homing to the canonical source (`disposition: re-home`); the move itself is downstream per-item work.
- On any user correction or suggestion, ask: line-specific or general pattern? If general, extract it to a topic file immediately — the user should never give the same feedback twice.
- Verified dependency facts get recorded in a topic file, not remembered.
- When a design doc or plan ships for a component that has a topic file, cross-link both ways.

The `engineering/` command center runs an extended variant of step 0 — single-service items move to that repo's inbox, and promotions target workspace ADRs/conventions rather than design docs.
