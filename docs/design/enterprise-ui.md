# DataLex Enterprise UI — Design Spec

> Status: **Implemented on `design/enterprise-ui`** (phases 1–6) · Owner: design
>
> This document describes the reorganization of the DataLex web shell into an
> enterprise-grade information architecture. It is a **reorganization of what
> already exists**, not a rebuild: the token system, the conceptual/logical/
> physical modeling discipline, the crow's-foot canvas, the semantic-diff
> overlay, and the AI proposal flow are all kept and re-surfaced.
>
> All six migration phases below have landed, plus the paper light theme as
> the new default. Verified live in both paper and midnight themes.

---

## 1. Why change

### What is already strong (keep, don't touch)

- **Design tokens** — 77 CSS variables, 4 themes (`midnight`, `obsidian`,
  `arctic`, `paper`), 3 densities, status + category semantics, all in
  `packages/web-app/src/styles/datalex-design.css`. This is the foundation;
  every new surface must be built from these tokens, never inline hex.
- **3-layer modeling** — conceptual → logical → physical. This is the core
  differentiator and the organizing idea of the whole product.
- **Semantic diff as a canvas overlay** — `DIFF_COLORS` (add / mod / del) in
  `src/design/Canvas.jsx`. Most modeling tools can't show change on the model
  itself.
- **YAML as source of truth** with AI proposals reviewed against a live
  diagram + YAML split (`AiPlanReviewEditor` in `src/design/Shell.jsx`).

### What blocks "enterprise" today

| # | Problem | Evidence in code |
|---|---------|------------------|
| 1 | **Too many competing navigation axes.** The topbar `ViewSwitcher` packs 8 modes that mix *workflow stages* (AI Setup, Readiness, Publish) with *object views* (Diagram, Docs) — two different axes in one control. Combined with the layer-specific bottom tabs, the right panel, the `DomainSwitcher` and the `DiffToggle`, there are ~5 independent nav surfaces and no single "where am I" model. | `Chrome.jsx` `VIEW_MODES` (8 entries); `Shell.jsx` `LOGICAL_BOTTOM_TABS` / `PHYSICAL_BOTTOM_TABS` / `CONCEPTUAL_BOTTOM_TABS` |
| 2 | **The 3 layers are not a first-class navigator.** The layer is *inferred from filenames/paths* rather than shown and switched explicitly. | `Shell.jsx` `shouldOpenDiagramSurface` (regex on `/conceptual/`, `.model.yaml`, `.diagram.yaml`) |
| 3 | **Version control is fragmented** across five places: `DiffToggle`, the Diff bottom tab, the History bottom tab, the Commit button, and the branch button on the tabs row. | `Chrome.jsx` `ProjectTabs` (branch button); `Shell.jsx` bottom-tab `diff` / `history`; topbar `onCommit` |
| 4 | **Contracts & governance are buried** in a bottom-drawer tab despite being central to the pitch. | `CONCEPTUAL_BOTTOM_TABS` → `modeler` labelled "Contracts" |
| 5 | **Heavy inline styling** partially bypasses the token system, hurting theme consistency and making the design hard to evolve. | `Shell.jsx` (2,197 lines) — toasts, modals, theme menu styled with inline `style={{}}` |

---

## 2. Organizing principle: Object × Layer × Lifecycle

Today's UI flattens three independent axes into one row of buttons. The
enterprise IA keeps them separate and gives each a dedicated control:

- **Object** — what you're looking at (a model file, a contract, a domain, a
  diff). → **left activity rail**.
- **Layer** — conceptual / logical / physical. → **layer spine** (always
  visible, top of the work area).
- **Lifecycle** — draft → validated → certified → published. → expressed as
  **state** on objects (contract badges, validation gate, publish view), not
  as a navigation mode.

---

## 3. Target information architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│ TOP BAR   DL DataLex · breadcrumb (Domain ▸ Layer ▸ file) · ⌘K search · AI · 🔔│
├──────┬────────────────────────────────────────────────────────┬───────────┤
│      │ LAYER SPINE   Conceptual → ●Logical → Physical    [views]│           │
│ ACT  ├────────────────────────────────────────────────────────┤ INSPECTOR │
│ RAIL │                                                          │ layer map │
│      │                  WORK SURFACE                            │ contract  │
│ Expl │            (diagram · table · docs)                      │ owner     │
│ Model│                                                          │ grain     │
│ Contr│                                                          │ keys      │
│ Vers │                                                          │           │
│ Pub  │                                                          │           │
├──────┴────────────────────────────────────────────────────────┴───────────┤
│ VERSION HUB   ⎇ branch · 3 changed · semantic gate ✓ · 12 snapshots · commit │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Activity rail (replaces the 8-button ViewSwitcher)

A 56px icon rail on the far left. Each item swaps the **left panel content**
(not the whole screen). Five destinations, mapped to the real axes:

| Rail item | Replaces today's | Left-panel content |
|-----------|------------------|--------------------|
| **Explore** | file explorer (left panel) | Projects, domains, files |
| **Model** | `ViewSwitcher` Diagram/Docs + bottom Build tab | Layer tree (C/L/P), entities, the Build/modeler forms |
| **Contracts** | `ViewSwitcher` Contracts/Readiness + bottom Contracts tab | Contract board, certification queue, blockers |
| **Version** | `DiffToggle` + bottom Diff/History + Commit + branch button | Source-control hub (§7) |
| **Publish** | `ViewSwitcher` Publish/Proposals | Manifest build, integration readiness, AI proposal inbox |

`AI Setup` stops being a top-level mode — it becomes a panel reachable from the
AI affordance in the top bar and from first-run onboarding.

### 3.2 Layer spine (makes the differentiator primary)

A persistent strip above the work surface: `Conceptual → Logical → Physical`,
with the active layer highlighted and **up/down mapping** affordances ("maps to
Billing concept", "generates `dim_invoice`"). This replaces the filename-regex
inference in `shouldOpenDiagramSurface` with an explicit, visible control.

To the right of the spine sit the **view toggles** for the current layer
(Diagram · Table · Docs) — these are object-view toggles, correctly separated
from the workflow modes that used to share the same row.

### 3.3 Inspector (right panel)

Always answers "what is this object, across all three axes": its **layer** and
what it maps to above/below, its **contract status + owner + grain**, its
**keys**, and quick links into Build / Version for the selection. Make the
width user-resizable (today it's a fixed `--right-w: 320px`); dense enterprise
schemas need more room.

### 3.4 Version hub (bottom strip + Version rail panel)

The 26px status row becomes a true **version hub**: current branch, change
count, semantic-gate state, snapshot count, and one "Review & commit" entry
point. Detail lives in the Version rail panel (§7). This consolidates the five
scattered git surfaces into one.

---

## 4. Data modeling surface

- **Layer-aware canvas.** Keep the custom crow's-foot canvas (`Canvas.jsx`).
  Tint entity headers/edges by layer so conceptual (idea), logical (platform-
  neutral), and physical (dialect-typed) cards are instantly distinguishable.
- **Always-on minimap + world bounds** for large schemas (the canvas already
  computes `getWorldBounds`; surface a minimap from it).
- **Build forms in the Model panel**, not a bottom drawer — creating entities,
  relationships and keys is core modeling, not a secondary tool.
- **Mapping ribbons** between layers: selecting a logical entity highlights its
  conceptual parent and physical target.

## 5. Contracts surface

Promote contracts from a bottom tab to a **first-class workspace** reached from
the Contracts rail item:

- **Status board** — columns Draft → Proposed → Certified, cards per contract.
- Each card shows **owner, grain, evidence, blockers** (the fields already
  modeled in the Readiness/Contracts views).
- **Certification queue** — what's blocking certification, per domain.
- Contract state is also shown inline on canvas cards and in the inspector, so
  governance is visible while modeling, not only in a separate screen.

## 6. Logic & physical diagrams

Both are the same canvas at different layers, so they share one surface and are
switched via the **layer spine**, not separate top-level modes:

- **Logical diagram** — platform-neutral entities, logical types, keys,
  relationships, role names, cardinality, identifying status.
- **Physical diagram** — dialect data types, PK/FK/AK, constraints, dbt model
  targets, generated-SQL readiness.
- A **"generate down / abstract up"** action on the spine moves a selection
  between layers, with the diff preview showing what the generation produced.

## 7. Git / versioning

Consolidate the five scattered surfaces into one **Version** destination:

- **Branch** — current branch, switch/create (today's `GitBranchDialog`).
- **Working changes** — git status + staging (today's `DiffPanel` git
  workspace).
- **Semantic diff** — the on-canvas add/mod/del overlay (`DiffToggle` +
  `DIFF_COLORS`), now toggled from the Version panel and reflected in the hub.
- **Semantic gate** — pass/fail against a baseline, shown in the bottom hub so
  it's always visible before commit.
- **History** — snapshot timeline (today's `HistoryPanel`), with restore.
- **Commit & push** — one flow (today's `CommitDialog`), entered from the hub's
  "Review & commit".

The principle: **one place to see and ship change**, with the semantic gate and
branch always visible in the bottom hub.

---

## 8. Styling & token hygiene

- **Move inline styles into CSS classes** driven by tokens. Audit `Shell.jsx`
  (toasts, modals, theme menu, `LayerSupportPanel`, `ToastContainer`) and lift
  inline `style={{}}` blocks into `datalex-design.css` / a component stylesheet.
  This keeps every surface themable across all 4 themes and makes the design
  legible to contributors and to design tooling.
- **No raw hex in components** — only `var(--*)` tokens.
- Add any missing tokens the new surfaces need (e.g. layer accent colors,
  rail-active state) to the `:root` block and every `[data-theme]` override.

---

## 9. Phased migration (as shipped)

1. ✅ **Token & style hygiene** — layer-accent tokens added to `:root`; toast
   and modal inline styles lifted into token-driven `.datalex-toast` /
   `.datalex-modal-*` classes. (`datalex-design.css`, `datalex-integration.css`)
2. ✅ **Layer spine** — always-visible C/L/P strip (`LayerSpine.jsx`) with the
   active layer highlighted via the layer-accent tokens.
3. ✅ **Activity rail** — `ActivityRail.jsx` (56px column) drives `shellViewMode`,
   grouped build / govern / ship; object-view toggles (Diagram/Table/Docs)
   moved to the spine; the top-bar `ViewSwitcher` retired.
4. ✅ **Version hub** — branch, working-change count, semantic gate, and a
   commit entry point consolidated into the bottom status strip (`Chrome.jsx`
   `StatusBar`); the rail's Version destination opens the diff surface.
5. ✅ **Contracts workspace** — promoted to a first-class rail destination
   backed by the existing `ContractsView` board, with per-destination empty
   states (`EnterpriseWorkbench.jsx`).
6. ✅ **Inspector** — right panel is drag-resizable (`.right-resizer`).

Beyond the six phases: **paper** (warm light) is now the default theme, and a
latent theme-switching bug (the static `<body data-theme>` winning the CSS
custom-property cascade) was fixed so all four themes switch live.

Each phase landed as an independent, build-verified commit.

---

## 10. Open questions

- Should the layer spine support a **split / side-by-side** view (logical and
  its physical target at once), or strictly one layer at a time?
- Do domains belong in the **Explore** rail item or as a **breadcrumb-only**
  filter (today's `DomainSwitcher`)?
- Multi-tenant / RBAC: where do **roles and permissions** surface for enterprise
  (per-project, per-contract ownership is already modeled)?

---

*Mockup of this IA was shared in the design review session that produced this
spec. Update this file as the direction is refined.*
