# DataLex UX & Information-Architecture Redesign Spec

> Status: **Draft for review** · Owner: product · Scope: web-app IA + naming; no engine rewrite
> Goal: make DataLex a **clean, simple, effective** surface for agentic analytics on
> **DataLex + dbt (+ optional DQL)** — so a first-time user can go from a dbt repo to a
> published manifest without getting lost.

This spec proposes **no new engine capability**. It is almost entirely **subtractive**:
renames, removing duplicate triggers, one navigation model, and surfacing one feature
(layer transforms) that the engine already implements. Code changes come *after* this is
approved.

---

## 1. Diagnosis (why this is needed)

The docs describe one clean linear spine, repeated verbatim across README, getting-started,
and enterprise-oss-workflow:

```
Connect dbt → AI Setup → Readiness → Generate → Review → Certify → Publish
```

The UI does **not** present that spine. Three concrete failures (verbatim from user testing
by the maintainer):

1. **"When I click Contracts I can't create a contract."** The rail's *"Certified Contract
   Surface"* is read-only; contracts are actually created via **Proposals → Certify** or a
   deeply-buried conceptual-layer drawer tab. The word **"Contracts" labels three different
   surfaces**, and the most obvious one creates nothing.
2. **"I don't understand what the Proposal page is for."** A proposal is the AI-drafted,
   not-yet-trusted change pack that a human certifies into a real contract — but nothing in
   the UI says that. It's named after the mechanism, not the outcome.
3. **"Validation / Diff / Build / Policy feel like duplicates."** They are distinct, but
   **"Build" is the same component as the conceptual "Contracts" tab**, the word **"gate"
   appears four times** with redundant buttons, and **git has three entry points** — so the
   drawer reads as repetitive.

Root cause: **navigation mixes the linear workflow with the editing workspace**, and **core
nouns are overloaded** ("Contracts" ×3, "gate" ×4, "Build" = author + = publish, "transform"
= rewrite + = AI-infer).

---

## 2. Design principles (north star)

1. **The workflow *is* the navigation.** A numbered Connect→…→Publish spine, always visible,
   with a "you are here" state.
2. **One word, one meaning.** Every core noun maps to exactly one surface (see §7 vocabulary
   canon). No exceptions.
3. **Name surfaces by outcome, not mechanism.** "Generate a contract," not "Proposals."
4. **Subtract before adding.** Remove duplicate triggers and surfaces before building anything.
5. **Stable shell.** Tabs and panels do not appear/disappear as the user switches files.
6. **Progressive disclosure.** OSS users never see cloud-only concepts (DQL) unless they opt in.
7. **Empty states teach.** Every surface that can be empty explains the next action and links to it.

---

## 3. Target information architecture

Two top-level modes, cleanly separated:

```
┌─ WORKFLOW (the spine) ───────────────────────────────────────────────┐
│  1 Connect → 2 AI → 3 Readiness → 4 Generate → 5 Review → 6 Certify → 7 Publish │
│                          └──────── "Studio" / proposal queue ────────┘          │
└──────────────────────────────────────────────────────────────────────┘
┌─ MODEL workspace (secondary) ────────────────────────────────────────┐
│  Layer: Conceptual ⇄ Logical ⇄ Physical   ·   View: Diagram · Table · Docs │
│  Inspector tabs (stable): Validate · Diff · Author · Policy · History       │
└──────────────────────────────────────────────────────────────────────┘
┌─ VERSION (single git surface) ───────────────────────────────────────┐
│  branch · changes · semantic gate · commit · push · PR                │
└──────────────────────────────────────────────────────────────────────┘
```

- **Workflow** = the 7 steps. Steps 4–6 (Generate/Review/Certify) are the proposal lifecycle.
- **Model** = the editing canvas for a single artifact, with a **stable** inspector. The
  layer indicator becomes **navigable** (click to switch layers; see §6.6).
- **Version** = the *only* place git/diff lives. Removed from the inspector and status bar
  (which instead *link* here).

### Primary nav (left rail) — before → after

| Today (mixed) | Proposed (workflow spine) |
|---|---|
| Home | Home |
| Connect, AI (open dialogs) | **1 · Connect**, **2 · AI** (numbered steps) |
| Domains, Contracts, Proposals | **3 · Readiness**, **4–6 · Studio** (Generate/Review/Certify) |
| Readiness | (folded into step 3) |
| Model | **Model** (secondary workspace, visually separated) |
| Version, Publish | **7 · Publish** · **Version** (utility, bottom) |

---

## 4. Surface-by-surface redesign

Each entry: **Problem → Change → Files**.

### 4.1 The "Contracts" triple-meaning  *(Tier 1 — highest impact)*

**Problem.** "Contracts" labels (a) the read-only rail board *"Certified Contract Surface,"*
(b) the conceptual-layer drawer tab that *is the same component* as "Build"
([ModelerPanel.jsx](../../packages/web-app/src/components/panels/ModelerPanel.jsx)), and
(c) the Proposals→Certify action that actually writes a contract file.

**Change.**
- Rename the rail board → **"Certified"** (contracts that already passed review). Add an
  empty state: *"No certified contracts yet. Contracts are created in **Studio → Generate →
  Certify**."* with a button that navigates to Studio.
- The conceptual drawer tab is renamed to **"Author"** (it is an editor, see §4.3) — so the
  word "Contracts" no longer appears as a tab.
- "Create a contract" has exactly **one** discoverable entry: **Studio**.

**Files.**
[EnterpriseWorkbench.jsx](../../packages/web-app/src/components/enterprise/EnterpriseWorkbench.jsx)
(`ContractsView` header + empty state),
[ActivityRail.jsx](../../packages/web-app/src/design/ActivityRail.jsx) (label),
[Shell.jsx](../../packages/web-app/src/design/Shell.jsx) (bottom-tab definitions, lines ~182–208).

### 4.2 "Proposals" → "Studio" (name by outcome)  *(Tier 1)*

**Problem.** The page is titled *"AI Proposal Queue."* Users don't know a proposal is the
draft of a future contract.

**Change.**
- Rename the destination to **"Studio"** (or "Generate") — the place you *make* contracts
  with AI. Keep "proposal" as the internal noun for a draft item, but the *page* is named for
  what the user is trying to do.
- Add a one-line subhead: *"AI drafts contracts from your dbt evidence. Review each draft,
  then certify the ones you trust — only certified contracts get published."*
- Make the 4→5→6 progression visible inside Studio: **Generate** (left) → **Review** cards
  (center) → **Certify** (per-card action), mirroring the spine.

**Files.** [EnterpriseWorkbench.jsx](../../packages/web-app/src/components/enterprise/EnterpriseWorkbench.jsx)
(`ProposalsView`), [ActivityRail.jsx](../../packages/web-app/src/design/ActivityRail.jsx).

### 4.3 "Build" → "Author"; remove the double-label  *(Tier 1)*

**Problem.** The authoring panel is labeled **"Build"** on logical/physical and **"Contracts"**
on conceptual — one component, two misleading names. Separately, *"Build the manifest"* (Publish)
is a *different* concept, so "Build" is doubly ambiguous.

**Change.** Label the authoring panel **"Author"** on every layer. Reserve the word **"Build"**
exclusively for manifest build under **Publish**.

**Files.** [ModelerPanel.jsx](../../packages/web-app/src/components/panels/ModelerPanel.jsx),
[Shell.jsx](../../packages/web-app/src/design/Shell.jsx) (tab labels).

### 4.4 Collapse the "gate" overload  *(Tier 1)*

**Problem.** "Gate" appears as: Validation's *dbt Readiness* gate, Diff's *semantic* gate,
Build's *Standards Gate*, and the status-bar *"Gate: passing."* Three different buttons
(Validation "Rerun gate," Docs "Run CI readiness gate," Build "Run gate") all call the same
`runDbtReadinessReview`.

**Change.**
- Adopt **one user-facing name per distinct check**:
  - **"Readiness check"** = the dbt-readiness score (was "dbt Readiness gate").
  - **"Breaking-change check"** = the semantic diff gate (lives in Version/Diff only).
  - Drop "Standards Gate" as a separate widget; fold standards into **Validate** findings.
- **One** Readiness-check trigger (in Validate). Remove the duplicate buttons in Docs and
  Author.
- Status-bar "Gate: passing" → **"Checks: passing"**, links to Validate.

**Files.** [ValidationPanel.jsx](../../packages/web-app/src/components/panels/ValidationPanel.jsx),
[DiffPanel.jsx](../../packages/web-app/src/components/panels/DiffPanel.jsx),
[ModelerPanel.jsx](../../packages/web-app/src/components/panels/ModelerPanel.jsx),
[DocsView.jsx](../../packages/web-app/src/components/docs/DocsView.jsx) (line ~1323),
[Chrome.jsx](../../packages/web-app/src/design/Chrome.jsx) (StatusBar).

### 4.5 Clarify Validate / Diff / Policy (keep, don't merge)  *(Tier 1 copy, Tier 2 structure)*

These stay as distinct inspector tabs, with one-line purpose headers so they never read as
duplicates:

| Tab | One-line purpose (shown in UI) | Backend |
|---|---|---|
| **Validate** | "Is this artifact well-formed and documented?" | `schema_issues` + `lint_issues` |
| **Diff** | "What changed vs the baseline, and is it breaking?" (semantic only — git moves to Version) | `semantic_diff` |
| **Policy** | "Org-wide governance rules this project must satisfy." | `policy_issues` / policy packs |

**Change.** Add the purpose headers; **remove the git console from Diff** (→ Version, §4.7).

**Files.** [ValidationPanel.jsx](../../packages/web-app/src/components/panels/ValidationPanel.jsx),
[DiffPanel.jsx](../../packages/web-app/src/components/panels/DiffPanel.jsx),
[PolicyPacksPanel.jsx](../../packages/web-app/src/components/panels/PolicyPacksPanel.jsx).

### 4.6 Make conceptual/logical/physical navigable  *(Tier 2 — highest-leverage feature)*

**Problem.** [LayerSpine.jsx](../../packages/web-app/src/design/LayerSpine.jsx) is
display-only ("v1 is a display surface"); there's no way to move between a model's layers, and
no in-UI transform — even though [`transform_model()`](../../packages/core_engine/src/datalex_core/modeling.py)
(conceptual→logical→physical) and `POST /api/model/transform` already exist.

**Change.**
- Make the spine **click-to-switch** between the conceptual/logical/physical siblings of the
  active model.
- Add **"Generate logical →"** and **"Generate physical →"** actions that call the existing
  transform endpoint and open the result. This directly serves the "conceptual/logical/physical
  for business diagrams" product goal with code that already exists.

**Files.** [LayerSpine.jsx](../../packages/web-app/src/design/LayerSpine.jsx),
[api.js](../../packages/web-app/src/lib/api.js) (transform call),
[Shell.jsx](../../packages/web-app/src/design/Shell.jsx) (layer switching).

### 4.7 One Version surface  *(Tier 2)*

**Problem.** Git/diff is reachable from the rail "Version," the status-bar widgets, **and** the
Diff inspector tab — three overlapping surfaces.

**Change.** Consolidate all git (status, stage, commit, push, PR, branch, semantic gate) into a
single **Version** drawer. The status bar and the (now semantic-only) Diff tab *link* here
rather than re-implement it.

**Files.** [DiffPanel.jsx](../../packages/web-app/src/components/panels/DiffPanel.jsx),
[Chrome.jsx](../../packages/web-app/src/design/Chrome.jsx),
[Shell.jsx](../../packages/web-app/src/design/Shell.jsx).

### 4.8 Fence off DQL in OSS  *(Tier 2)*

**Problem.** DQL copy appears in Publish and contract help text, but DQL is default-off and
lives in a separate repo — leaving OSS users with an undefined term.

**Change.** Hide DQL surfaces unless `datalex.yaml` opts in. Where a reference is unavoidable,
show a single tooltip: *"DQL is the optional downstream query layer — configured separately."*

**Files.** [EnterpriseWorkbench.jsx](../../packages/web-app/src/components/enterprise/EnterpriseWorkbench.jsx)
(`PublishView` DQL panel), contract help strings in
[ModelerPanel.jsx](../../packages/web-app/src/components/panels/ModelerPanel.jsx).

### 4.9 Remove orphans & hidden views  *(Tier 2 cleanup)*

- The `ai-setup` enterprise page is unreachable (the rail "AI" opens Settings instead) —
  either wire it up or delete it.
- `Views` / `Enums` / `Capabilities` render full surfaces but aren't on the spine's toggles —
  either add them to the Model view switcher or remove.

**Files.** [Shell.jsx](../../packages/web-app/src/design/Shell.jsx),
[ActivityRail.jsx](../../packages/web-app/src/design/ActivityRail.jsx),
[LayerSpine.jsx](../../packages/web-app/src/design/LayerSpine.jsx).

---

## 5. Stable inspector (no more layer-dependent shuffling)

**Today** the bottom-drawer tab set changes per layer (Conceptual: Validation/Contracts/
Dictionary/Relationships/History; Logical: Validation/Diff/Build/Policy/History; Physical:
drops History). **Proposed** — one stable set on every layer, with tabs disabling (not
disappearing) when N/A:

```
Validate · Diff · Author · Policy · History
```

Dictionary/Relationships become sections *inside* Author (they're authoring concerns), not
top-level tabs.

---

## 6. Before / after user flows

### Flow A — "Create my first contract"
**Before:** Click rail "Contracts" → dead end (read-only) → no idea where to go.
**After:** Spine shows step 4–6 **Studio** → Generate → review cards → **Certify** → contract
appears under **Certified**. One obvious path.

### Flow B — "Understand a proposal"
**Before:** "AI Proposal Queue" with no explanation.
**After:** **Studio** subhead explains draft→certify; Generate/Review/Certify laid out as the
visible 4→5→6 progression.

### Flow C — "Check my model before publishing"
**Before:** Four ambiguously-named checks + four "gate" buttons.
**After:** **Validate** (well-formed?), **Diff** (breaking?), **Policy** (governance?), each
with a one-line purpose; a single **Readiness check** button; breaking-change check in Version.

### Flow D — "Build conceptual → logical → physical"
**Before:** Spine looks navigable but isn't; must hand-create each layer file.
**After:** Click spine to switch layers; **"Generate logical →"** runs the existing transform.

---

## 7. Vocabulary canon (one word → one meaning)

| Term | The single meaning | The one surface it appears |
|---|---|---|
| **Contract** | Certified business agreement (`kind: contract`, `status: certified`) | Certified board + Author editor |
| **Proposal** | AI draft of a future contract (`status: draft`) | Studio (internal noun) |
| **Studio** | Where you generate/review/certify contracts with AI | Primary nav steps 4–6 |
| **Certified** | The read-only library of approved contracts | Primary nav |
| **Author** | The editor for entities/keys/relationships | Inspector tab |
| **Validate** | "Is this artifact well-formed + documented?" | Inspector tab |
| **Diff** | "What changed and is it breaking?" (semantic) | Inspector tab |
| **Policy** | Org governance rules | Inspector tab |
| **Readiness check** | dbt-adoption score | One button in Validate |
| **Build** | Compile certified artifacts → `datalex-manifest.json` | Publish only |
| **Publish** | Step 7: produce the manifest | Primary nav |
| **Version** | All git: branch/commit/push/PR/breaking-change gate | Single drawer |
| **DQL** | Optional downstream query layer (separate repo) | Hidden unless opted in |

Banned overloads after this spec: "gate" (split into named checks), "Build" as authoring,
"Contracts" as a tab, "transform" as both rewrite and AI-infer (rename the AI agents to
"conceptualize"/"canonicalize" in UI copy).

---

## 8. Phased rollout

| Phase | Contents | Risk | Outcome |
|---|---|---|---|
| **P1 — Naming & empty states** | §4.1–4.5 (renames, purpose headers, Certified empty state, de-dup gate buttons) | Low (copy/labels) | Resolves all 3 reported confusions |
| **P2 — Nav spine** | §3 workflow rail with "you are here"; separate Model workspace | Medium | Linear flow becomes felt |
| **P3 — Layers + Version** | §4.6 navigable layers + transform buttons; §4.7 single Version | Medium | Core modeling value surfaced |
| **P4 — Cleanup** | §4.8 DQL fencing; §4.9 orphans/hidden views; §5 stable inspector | Low–Med | Removes dead ends |
| **P5 — Architecture debt** (separate track) | flatten `datalex datalex`; one CLI; move cert-pack writing from JS→Python core; reconcile contract file-shape docs | High | Long-term maintainability |

P1 alone fixes the three questions that started this review and is almost entirely safe
copy/label work.

---

## 9. Decisions — RESOLVED during implementation

1. **Name for steps 4–6**: **"Generate"** chosen (not "Studio" — the codebase
   already tried and abandoned "Studio" as unclear; "Generate" matches the
   documented spine step).
2. **Single name for the readiness check**: **"Readiness check"** — "gate"
   eliminated from all user-facing copy.
3. **Contract file shape** — RESOLVED by reading the code: the canonical
   on-disk shape is standalone `<domain>/contracts/<name>.contract.yaml` with
   root `kind: contract`. All three write paths agree; the nested
   `entities[].contracts[]` shape exists **only** in the compiled
   `datalex-manifest.json` output. No bug; contract-list UI is safe to build.
4. **`ai-setup` / hidden views**: **kept** — `ai-setup` is the harmless
   EnterpriseWorkbench fallback default; Views/Enums/Capabilities stay
   palette-reachable. Deleting them was judged higher-risk than the benefit.
5. **DQL**: already fenced — the Publish DQL panel only renders when
   `scan.integrations.dql.enabled`. Softened the remaining DQL copy in the
   Author panel so OSS users aren't shown an undefined term as a hard gate.

## 9b. Implementation status (this branch)

- **P1 (naming/empty-states/gate-dedup/purpose-headers)** — done, builds.
- **P2 (numbered workflow-spine rail)** — done, builds.
- **P3a (navigable layers + Generate logical/physical via `transform_model`)** — done, builds.
- **P3b (single Version surface — naming unified; the rail "Version" and the
  bottom tab are now one consistently-named surface)** — done, builds.
- **P4 (stable inspector tab set; DQL fencing/copy)** — done, builds.
- **P5 (architecture debt)** — not started; tracked below as future work.

---

## 10. Out of scope (explicitly)

- No change to the Python core engine's validation/diff/transform logic.
- No change to the manifest schema or the dbt round-trip.
- No new AI capability — only surfacing existing endpoints more clearly.
- The architecture-debt track (P5) is acknowledged but sequenced last.

---

### Appendix — key files referenced
- Shell / view dispatch: `packages/web-app/src/design/Shell.jsx`
- Primary nav: `packages/web-app/src/design/ActivityRail.jsx`
- Layer nav: `packages/web-app/src/design/LayerSpine.jsx`
- Chrome (top/status bars): `packages/web-app/src/design/Chrome.jsx`
- Enterprise pages (Certified/Studio/Readiness/Publish): `packages/web-app/src/components/enterprise/EnterpriseWorkbench.jsx`
- Inspector panels: `packages/web-app/src/components/panels/{ValidationPanel,DiffPanel,ModelerPanel,PolicyPacksPanel}.jsx`
- API client: `packages/web-app/src/lib/api.js`
- Layer transform engine: `packages/core_engine/src/datalex_core/modeling.py` (`transform_model`)
- Certification logic (currently JS): `packages/api-server/index.js`
- Intended workflow docs: `docs/enterprise-oss-workflow.md`, `docs/getting-started.md`, `docs/ai-agentic-modeling.md`
