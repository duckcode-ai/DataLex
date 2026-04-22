# Jaffle-shop end-to-end walkthrough

The fastest way to see every DataLex feature with a real, canonical
dbt project: clone `dbt-labs/jaffle-shop` from GitHub and drive the
full round-trip — import → diagram → edit → autosave → git.

You'll end with:

- A browser tab showing the full jaffle-shop model (staging + marts)
  as both a file tree and an ER diagram
- Inline lint warnings for every column missing `description`,
  `data_type`, or primary-key tests
- A real `.git` history of your edits — DataLex writes back into the
  cloned repo, so `git log` / `git diff` show normal dbt changes

**Time:** 5 minutes. **Prerequisites:** Python 3.9+, Git, and network
access to `github.com`.

---

## Step 1 — Install and start the server

```bash
pip install 'datalex-cli[serve]'     # CLI + bundled Node, one command
datalex serve                        # opens http://localhost:3030
```

The first `datalex serve` call prints something like:

```
[datalex] Starting DataLex server on http://localhost:3030
[datalex]   server:   /…/datalex_core/_server/index.js
[datalex]   web dist: /…/datalex_core/_webapp
[datalex]   project:  /Users/you/current-dir
```

A browser tab opens on `http://localhost:3030`. If it doesn't, open
that URL manually or re-run with `--no-browser` and copy the link.

## Step 2 — Import jaffle-shop from GitHub

Two equivalent paths — pick whichever fits your workflow.

### Option A — Let DataLex do the clone for you

1. In the top bar, click **Import dbt repo** (the folder-with-arrow
   icon). The **Import dbt repository** dialog opens on the **Git URL**
   tab by default.
2. Paste `https://github.com/dbt-labs/jaffle-shop` into the **Git URL**
   field. Leave the branch as `main`. Keep **Skip live warehouse
   introspection** checked (we don't have warehouse creds yet).
3. Click **Import**. DataLex shells out to `git clone` on the API
   server, runs `datalex dbt import` against the checkout, and shows
   the **Import Results** panel.
4. Skim the report: how many models imported, the manifest-only banner
   (no warehouse creds was fine), any columns with `type: unknown`,
   and any unresolved relationships. Click **Open project**.

This path is read-only by design — the import tree lives in memory so
you can explore without mutating anything on disk. Save All is
disabled. If you want edits to persist, use Option B.

### Option B — Clone yourself, then open as a project

```bash
git clone https://github.com/dbt-labs/jaffle-shop ~/src/jaffle-shop
```

1. Back in the UI, open **Import dbt repo** → **Local folder** tab.
2. Paste the absolute path, e.g. `/Users/you/src/jaffle-shop`.
3. Leave **Edit in place** checked (the default). This registers the
   folder as a DataLex project: Save All writes edits back into each
   model's original `.yml`, and `git diff` in the clone shows normal
   dbt changes.
4. Click **Import**, review the Results panel, then **Open project**.

Whichever path you pick, the Explorer (left panel) populates with the
full jaffle-shop tree:

```
models/
  staging/
    stg_customers.yml
    stg_orders.yml
    stg_order_items.yml
    stg_products.yml
    stg_supplies.yml
    stg_locations.yml
  marts/
    customers.yml
    orders.yml
    order_items.yml
    products.yml
    locations.yml
```

## Step 3 — Build your first diagram

The Explorer tree is your source of truth; diagrams are how you pick
which models to visualize together.

1. In the Explorer toolbar, click **New Diagram** (the Layers icon).
   A new file `datalex/diagrams/untitled.diagram.yaml` is created and
   opens on the canvas (empty). You can also right-click any folder
   in the Explorer → **New diagram here…** to seed the file next to
   the models.
2. On the canvas toolbar, click **Add Entities**. The picker lists
   every entity resolved from the project, with a search box and a
   domain filter. Tick `stg_customers` and `stg_orders`, then
   **Add**. Both entities land on the canvas and auto-lay-out via
   ELK; the dashed FK edge between `stg_orders.customer_id` and
   `stg_customers.customer_id` renders automatically — inferred from
   the dbt `tests: - relationships:` on that column.
3. (Alternative) Drag `models/staging/stg_customers.yml` from the
   Explorer onto the canvas. Each model still renders as an entity —
   the picker and drag-drop are interchangeable.
4. Reposition nodes by dragging. The positions land in the diagram
   YAML's `entities[].x/y` — not in the model files — so you can have
   a second diagram with different coordinates for the same models.

## Step 4 — Open a model in the inspector

Click `models/staging/stg_customers.yml` in the Explorer.

- **Centre canvas** renders the entity as an ER node with columns
  listed inline. Other entities it references (via FKs) are positioned
  around it.
- **Right panel** shows the Inspector: tabs for Columns, Relationships,
  Indexes, Enums, Tests.
- **Columns tab** lists each column. Any column missing a
  `description` or `data_type` shows a warning pill — that's the lint
  rule (`packages/web-app/src/lib/dbtLint.js`) running client-side
  with no save-cost.

Try renaming a column description: click the description cell, type
something, blur. The YAML updates in-memory and **autosave** flushes
the change to disk ~800ms later — you'll see the **Diff** panel at
the bottom transition from pending to clean.

## Step 5 — Rename an entity and watch the cascade

1. In the Explorer, right-click `stg_customers.yml` → **Rename
   entity…**
2. Change the entity name from `stg_customers` to `stg_customer`.
3. Preview the rename. DataLex scans the whole project and lists
   every file that will be rewritten — `stg_orders.yml`,
   `customers.yml`, the diagram, and so on — each FK and relationship
   ref updated atomically.
4. Click **Rename**. The server snapshots every target file, applies
   the rewrites in a single transaction, and only then moves the file.
   If any write fails, the whole thing rolls back.

On Option B (edit-in-place), run `git diff` in the jaffle-shop clone —
you'll see the refactor as a coherent commit-sized change across
multiple files.

## Step 6 — Turn on auto-commit (optional)

1. Open the Commit dialog (`⌘⇧G` or the branch icon in the Chrome
   header).
2. Enable **Auto-commit on save**.
3. Back in the inspector, change three field descriptions in quick
   succession. Auto-commit debounces bursty saves: within ~3s you'll
   see **exactly one** new commit in `git log`.

Failure mode: if the commit fails (e.g. missing `user.email`), the
save itself still succeeds — the auto-commit error surfaces as a
toast so you can fix the config and retry manually.

## Step 7 — Apply DDL to a warehouse (optional)

1. In an open `.model.yaml`, press `⌘K` → **Apply to warehouse…**
2. Pick a dialect (DuckDB for a throwaway local run, Snowflake / BQ /
   Databricks if you have a connector profile saved).
3. Click **Generate DDL** — the preview shows the forward-engineered
   SQL.
4. Pick a connector profile. Leave **Dry run** checked for the first
   pass; hit **Dry run**. The server compiles and validates against
   the target without executing.
5. Uncheck **Dry run** → **Apply** when you're ready.

The endpoint is gated by `DM_ENABLE_DIRECT_APPLY` on the server. When
disabled (the GitOps default), the dialog instead instructs you to
commit the generated SQL and deploy via CI/CD.

## Step 8 — Export a PNG of the diagram

With any diagram open, press `⌘⇧E`. A PNG of the current canvas
downloads. That same action lives in the diagram toolbar overflow
menu for discoverability.

## What to do next

- **Try the live warehouse flow →** [Pull a warehouse schema](warehouse-pull.md)
- **Use your own dbt repo →** [Import an existing dbt project](import-existing-dbt.md)
- **Hook it into CI →** `datalex gate old.yaml new.yaml` fails PRs on
  breaking schema changes; see `docs/cli.md`.

## Troubleshooting

| Symptom                                     | Fix                                                                |
|---------------------------------------------|--------------------------------------------------------------------|
| Git-URL import fails with a network error   | Check that the API server has GitHub access (firewalls, proxies). Re-try with Option B: clone locally, then use the **Local folder** tab. |
| Import Results banner says "manifest-only"  | Expected — jaffle-shop doesn't ship a `profiles.yml` wired to your machine. Column `data_type`s show `unknown` until you add warehouse creds. |
| Rename cascade complains about a file       | The atomic endpoint rolls the whole rename back on any write failure. Fix the reported file (permissions, locks) and retry. |
| Diff panel keeps showing changes after save | Stale editor state — hit `⌘R`. The in-flight Zustand store and the on-disk bytes should match. |
| Auto-commit produces no commit              | Check `git config user.email` inside the cloned repo. The Chrome status bar shows the last auto-commit error as a toast. |
