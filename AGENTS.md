# Agent guide — DataLex

Guidance for AI agents (and humans) making changes here. Most of DataLex is yours
to evolve freely. The one thing to be careful about is the **shared design
contract** below.

## ⚠️ Shared design contract with Governed Analytics Cloud — do not break

DataLex is embedded inside the **Governed Analytics Cloud**, which reskins the
embedded surface to the global theme. That works only because DataLex exposes a
small, stable contract that the cloud drives from outside. The canonical source
is the cloud's `@duckcodeai/design-tokens` package (and `docs/adr/ADR-0002` in the
cloud repo). **Renaming or removing any of the following silently breaks the
cloud embed** — and the cloud's sync runs a contract check
(`scripts/embed-contract.test.mjs`) that will **fail the build** if you do:

1. **Theme selector** — `data-theme` on `<html>` (mirrored on `<body>` by the
   Shell), values **`paper` | `white` | `obsidian`**. Keep these theme blocks in
   `packages/web-app/src/styles/datalex-design.css`. `white` is the cloud's crisp
   light theme — do not drop it.
2. **Token vocabulary** — the shared semantic vars every surface reads:
   `--bg-0..4`, `--bg-canvas`, `--text-primary/secondary/tertiary/muted`,
   `--accent`/`--accent-hover`/`--accent-dim`/`--accent-fg`,
   `--border-subtle/default/strong`. **No app-prefixed colour vars** (no
   `--lux-color-*`). Rename a token → rename it in the cloud's design-tokens too.
3. **Theme persistence key** — `dm_theme` (the `uiStore` key). The cloud writes it
   (and sets `data-theme`) to drive the embedded theme. Don't rename it.
4. **Layout classes the cloud's fit override targets** — `.app` (the shell grid),
   `.activity-rail`, `.topbar`, `.topchrome`, `.left-resizer`. The cloud hides its
   own chrome and collapses the activity-rail column by selecting these. Renaming
   them re-opens the gap / brings back hidden chrome.

If you must change any of the above, **coordinate with the cloud repo**
(`governed-analytics-cloud`): update `packages/design-tokens` + the
`embed-overrides/datalex.css`, and run `node scripts/embed-contract.test.mjs`
there. Standalone DataLex is unaffected by the cloud — these are just stability
guarantees on the names the cloud depends on.

## General
- Web app: `packages/web-app` (React/Vite, Zustand, React Flow). Build: `npm run
  build` inside that package.
- See `CONTRIBUTING.md` for setup, tests, and the release process.
