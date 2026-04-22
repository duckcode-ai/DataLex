# DataLex web-app E2E tests

Playwright end-to-end suite that exercises the real user journey on a
cloned jaffle-shop checkout — no bundled fixture, no auto-import path.

## What runs

- `global-setup.js` clones `https://github.com/dbt-labs/jaffle-shop` into
  `packages/web-app/test-results/jaffle-shop/` once per machine. Cached
  on subsequent runs (git dir + `dbt_project.yml` presence check).
- `critical-path.spec.js` drives the full loop:
  1. App boots; onboarding dismissed via localStorage pre-seed.
  2. Import dbt dialog → Local folder tab → point at cached checkout.
  3. Results panel lists imported models; Open project.
  4. Rename `stg_customers` → `stg_customer`; confirm cascade.
  5. Edit a field type; wait for autosave; verify persistence on reload.
  6. Toggle auto-commit; edit; verify `git log` gains a commit.
  7. Open Apply-to-Warehouse → pick DuckDB → Generate DDL → Dry Run.
- `import-api.spec.js` hits the api-server directly (no DOM) for a
  cheap regression gate on the `/api/dbt/import` contract.

## Running locally

```bash
# From repo root, one-time:
npm --prefix packages/web-app install
npx --prefix packages/web-app playwright install chromium

# Run the full suite (starts api + web via Playwright webServer):
npm --prefix packages/web-app run test:e2e

# Interactive mode:
npm --prefix packages/web-app run test:e2e:ui
```

## Offline / air-gapped

`OFFLINE=1 npm run test:e2e` short-circuits global-setup so the rest
of the test tooling still compiles. You will need a real clone of
jaffle-shop for the critical-path spec to pass — there's no local
fallback by design.

## CI

GitHub Actions job `e2e-tests.yml` runs chromium-only on PRs that
touch `packages/web-app/` or `packages/api-server/`. Trace + HTML
report uploaded on failure.
