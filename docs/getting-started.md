# Getting started with DataLex

This page is the map. Pick the tutorial that matches what you have in
hand right now — we assume nothing, and every path finishes with a
reviewable YAML tree on disk plus a working ER diagram in the browser.

## Before you start

You need one thing: Python 3.9+ with `pip`. Everything else — the
Express API server, the web app, the built-in ER diagram, the dbt
importers, the nine warehouse connectors — ships inside the wheel.

```bash
pip install datalex-cli
datalex serve
```

That opens `http://localhost:3030` in your browser. If `node` isn't on
your PATH, install Node 20+ (https://nodejs.org) or run
`pip install "nodejs-bin>=20,<21"` and re-run `datalex serve`. The
server binds one port — no CORS, no second terminal, no Docker.

## Pick your path

| You have...                                  | Start here                                             | Time   |
|----------------------------------------------|--------------------------------------------------------|--------|
| Nothing — just want to see DataLex work      | [Jaffle-shop one-click demo](tutorials/jaffle-shop-walkthrough.md)    | 3 min  |
| An existing dbt project (local folder)       | [Import an existing dbt project](tutorials/import-existing-dbt.md)    | 5 min  |
| A dbt git repo (public or private)           | [Import an existing dbt project](tutorials/import-existing-dbt.md#from-a-git-url)    | 5 min  |
| A live warehouse (Snowflake/Postgres/etc.)   | [Pull a warehouse schema](tutorials/warehouse-pull.md)                | 7 min  |
| Just dbt + DuckDB, no UI, CLI-only           | [CLI dbt-sync tutorial](tutorial-dbt-sync.md)                         | 5 min  |

The three GUI tutorials are all built on the same underlying flow:

1. **Explorer** (left panel) renders your model as a file tree that
   mirrors the on-disk layout.
2. **Canvas** (centre) is an ER diagram — drag from one column to
   another to create a foreign key. Positions persist in the YAML
   under `display: { x, y, width }`.
3. **Inspector** (right panel) edits one entity at a time: columns,
   relationships, enums, indexes, tests.

Every action writes back to disk on save (⌘S or the header's "Save
All" button), so your dbt project's git log sees real diffs — not
opaque tool-proprietary state.

## The mental model

DataLex sits between your dbt repo and your warehouse.

```
  warehouse   <────pull────>  DataLex YAML tree   <────sync────>   dbt project
   (live)                      (git-tracked)                       (models/*.yml)
```

- **Pull** introspects a live database and writes a DataLex model tree.
  Supported dialects: postgres, mysql, snowflake, bigquery, databricks,
  sqlserver, azure_sql, azure_fabric, redshift.
- **Sync** merges DataLex column metadata (description, data_type,
  tests, contracts) into your existing `schema.yml` files
  non-destructively. Anything you hand-authored in dbt stays.
- **Emit** writes dbt-parseable YAML back from scratch (for greenfield
  projects).

PRs A through E (v0.2.0) made all three flows work from one browser
tab with live progress streaming, drag-to-relate modeling, and
file/folder CRUD that round-trips through the filesystem.

## Troubleshooting install

| Symptom                                          | Fix                                                                  |
|--------------------------------------------------|----------------------------------------------------------------------|
| `datalex: command not found`                     | Your pip bin dir isn't on PATH — try `python -m datalex_cli serve`. |
| `ERROR: node was not found on PATH`              | `pip install "nodejs-bin>=20,<21"` or install Node 20+.             |
| Port 3030 already in use                         | `datalex serve --port 4040`                                          |
| "Web dist not found" in logs                     | You're on a source checkout without a build — `cd packages/web-app && npm install && npm run build`. |
| API errors like `No such file 'dm'`              | First run writes a `dm` shim into your project dir; if you cleared it, just re-run `datalex serve`. |
| Browser opens to blank page                      | Hard-reload (⌘⇧R). If it persists, check the server logs printed by `datalex serve`. |

## Where docs live

- `docs/getting-started.md` — this page
- `docs/tutorials/` — step-by-step walkthroughs
- `docs/architecture.md` — system design, layering, why the schema
  looks the way it does
- `docs/cli.md` — full CLI reference (every subcommand, every flag)
- `docs/api-contracts.md` — HTTP API reference for integrators
- `docs/datalex-layout.md` — the on-disk YAML layout specification
- `docs/tutorial-dbt-sync.md` — the original CLI-only dbt-sync demo

## Next steps after a tutorial

Once a tutorial writes a DataLex tree to disk, everything else is
git-native:

```bash
git init                                  # if the folder isn't already a repo
git add .
git commit -m "chore(model): baseline import"
```

From there you can review diffs on PR like any other code change. The
`datalex` CLI gives you offline tooling for CI:

- `datalex validate models/…/stg_customers.model.yaml` — schema check
- `datalex lint models/…/stg_customers.model.yaml` — semantic rules
- `datalex gate old new` — fail PRs on breaking schema changes
- `datalex generate dbt models/ --out dbt-project/` — re-emit dbt YAML
- `datalex policy-check models/ --policy policies/default.yaml` — enforce org rules

See `docs/cli.md` for the full list.
