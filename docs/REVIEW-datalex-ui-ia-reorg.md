# Review / Merge Summary — Modeling-primary IA + cross-domain manifest moat

**DataLex branch:** `claude/datalex-ui-ia-reorg` — 16 commits, 19 files, **+1326 / −163**
**DQL branch (separate repo):** `claude/datalex-manifest-consumer` — 1 commit, 5 files
**Status:** build-verified (vite) + live-verified (preview browser). Ready for review.

---

## 1. Why this branch exists

The founder's question was whether DataLex had over-engineered itself around
*contract certification*. Grounded read of both codebases (not summaries) found:

- DQL already runs **without** DataLex — `datalex_contract` is optional; the gate
  only fires `if (datalexContract && ctx.datalexRegistry.isLoaded())`.
- Real proof point: `jaffle-shop-dql` ships **17 blocks, 9 certified, 0 contracts.**
- The contract *layer* was the unused/heavy part. Certification that matters lives
  in DQL (`status: certified`), not in a DataLex ceremony.

So the direction the founder locked: **modeling is primary in DataLex, contracts are
hidden (not deleted), certification lives in DQL.** And the real moat — the thing a
generic text-to-SQL agent can't do — is **grain-safe cross-domain joins**, which need
typed relationships + entity conformance flowing from DataLex into DQL.

This branch implements that direction end to end.

---

## 2. The moat substrate (the load-bearing change)

`eb0e5b5 feat(manifest): export entity relationships + conformance`

The v1 manifest carried entities/fields/metrics/glossary but **no cross-entity
relationships and no conformance** — so modeling helped humans, not the agent
(backwards for the cross-domain-accuracy goal). Fixed:

- **DataLex** — `manifest.py` now emits `relationships[]` (from/to/cardinality) and
  `conformance[]` (canonical key + the physical models that conform to a concept).
  Schema `$defs` + CHANGELOG updated; unit test
  `test_manifest_exports_relationships_and_conformance` against the
  `enterprise-modeling-foundation` fixture. `python3 -m unittest` → 12 pass.
- **DQL** (`claude/datalex-manifest-consumer`) — `DataLexContractRegistry` indexes the
  new fields and exposes `relationships()`, `conformance()`, `conformanceFor()`, and
  `joinPath()` (grain-safe orientation + fan-out detection) for Tier-2 SQL generation.
  `tsc` clean; full suite **405/405** (incl. 6 new registry tests).

This is the single change that turns "modeling" from documentation into the
cross-domain accuracy engine, and it's what makes the DataLex→DQL pairing defensible.

---

## 3. The IA reorg (modeling-primary, contracts hidden)

Domain-first information architecture — **Home portfolio → Domain workspace → Detail** —
replacing the old feature-inventory navigation.

- `8b47714` — Home portfolio + Domain workspace + Concept model view; rail regrouped to
  Home / Workspace / System (Govern group removed).
- `f95d6d4 (P1a)` — contracts **hidden** (tab removed, code retained), Home/Overview
  reframed modeling-first.
- `6eb0515 (P1b)` — **guided conceptual → logical → physical** build-or-skip flow:
  Build-with-AI (`aiConceptualize`) or Open-in-modeler per layer; folder convention
  `DataLex/<Domain>/<Layer>/`.
- `1e2e418 (P2)` — **end-to-end lineage view**: DataLex → dbt → DQL → app, fed from the
  manifest.
- `62e54de` / `a7a0c5b` — actionable domain cards + add-domain UI + manual contract form
  (form retained behind the hidden surface).
- `4c385e9` / `9772f7e` — copy reframed to modeling-primary; editable **Domain** field on
  the concept + logical inspectors (writes `domain` scalar to YAML).

Decision rule kept for future features: *configure once → Settings; whole portfolio →
Home; daily work → Domain; editing one object → Detail.*

---

## 4. Layout polish

`700ccc7` cleaner modeler (global AI panel, collapsible inspector, slim bottom drawer) ·
`e56c2bf` collapsible left explorer + edge reopen tabs · `ccbe081` persist panel
collapse state across reloads.

---

## 5. Bug fixes found by live testing (preview browser)

These are runtime bugs the build can't catch — caught only by driving the running app:

- `491628e` **Clicks did nothing (critical, user-reported).** `setShellViewMode` silently
  rejects any mode not in `VALID_SHELL_VIEW_MODES`; the new `domain`/`concept`/`lineage`
  modes were never added, so every domain-card click and Concept/Lineage rail item was a
  no-op. Fix: add the 3 modes to the allow-list; `loadShell` restores transient views to
  Home on reload.
- `b7e4aaf` **Diagram drag snap-back.** Stale localStorage layout cache overrode
  freshly-written YAML positions. Fix: write the cache synchronously on move-end.
- `252d48b` **Explorer file-open papercut.** The full-canvas guard over-blocked, so
  clicking a file on Home/domain/concept/lineage didn't switch to the modeler. Fix:
  baseline guard covers all full-canvas modes; main condition no longer blocks them.
- `326843d` **SubjectAreas missing-key warning.** Keyed on `a.id` (undefined for
  logical/physical areas). Fix: `key={a.id || a.label || \`area-${idx}\`}`.

---

## 6. Verification performed

- **Build:** `vite build` green on the web-app after each phase.
- **DataLex tests:** `python3 -m unittest tests.datalex.test_loader_and_diff` → 12 pass
  (4 unrelated errors are `import pytest` env-only, pre-existing).
- **DQL tests:** `tsc` clean + 405/405.
- **Live preview sweep** (vite on 5180, api on 3006): domain card → workspace, Model tab,
  Lineage all navigate; New-domain form writes a valid `kind: domain` file; editable
  Domain field round-trips to YAML; zero console errors after the SubjectAreas fix.

---

## 7. Known follow-ups (not in this branch)

1. **`jaffle-shop-DataLex` diagram-extraction gap.** Its models live inside diagrams with
   no standalone entities, so the manifest builds empty (Lineage/Concept views show empty
   for it; `enterprise-modeling-foundation` populates correctly). Real extraction gap —
   diagram-embedded entities should reach the manifest.
2. **Live DQL → app lineage** needs cross-project DQL data wired into the Lineage view
   (currently DataLex → dbt is populated; DQL → app is structural).
3. **Build-with-AI** path not live-tested end to end (needs an AI provider configured;
   it's a try/catch with a graceful error toast today).
4. **DQL branch** `claude/datalex-manifest-consumer` lives in the separate DQL repo and
   needs its own PR/merge.

---

## 8. Merge notes

- The branch was kept separate specifically so it can be **discarded cheaply** if the
  founder wants to reshape direction — nothing here is destructive; contracts are hidden,
  not deleted.
- Two PRs are needed: one in **DataLex** (`claude/datalex-ui-ia-reorg`) and one in **DQL**
  (`claude/datalex-manifest-consumer`); the manifest schema is the contract between them.
