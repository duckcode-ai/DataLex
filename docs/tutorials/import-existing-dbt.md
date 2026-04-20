# Import an existing dbt project

This is the "bring your own dbt repo" path. You'll end with the same
DataLex tree you saw in the [jaffle-shop walkthrough](jaffle-shop-walkthrough.md),
but built from *your* models — with every `models/staging/`,
`models/marts/…` folder preserved exactly as it was on disk.

**Time:** 5 minutes. **Prerequisites:**

- Python 3.9+ with pip
- A dbt project you can read locally (either a folder path or a git URL)
- `dbt` itself installed if your project hasn't been compiled yet

---

## Decide where your import lives

The importer has two output modes:

| Mode         | Writes to                                       | When to use                                            |
|--------------|-------------------------------------------------|--------------------------------------------------------|
| **In-memory**    | The browser's Zustand store only             | Exploratory — poke at the tree, discard it, try again  |
| **On-disk**      | A real folder you pick                       | You want git diffs, PRs, CI — i.e., the real workflow  |

The GUI defaults to in-memory for safety. After you've reviewed the
tree, use **Save All** (top-bar button) to write it to a chosen folder.

## Option A — From a local folder

### 1. Start the server pointed at your project

```bash
datalex serve --project-dir ~/path/to/your-dbt-project
```

`--project-dir` sets the working directory for the api-server — this
is where `.dm-projects.json`, connection metadata, and the auto-generated
`dm` CLI shim live. It does **not** modify your dbt project files; it
only reads them.

### 2. Compile manifest.json (if you haven't)

The importer prefers `target/manifest.json` because it carries the
full dbt graph, column types, and `original_file_path` for each model
(which lets the Explorer preserve your folder structure).

```bash
cd ~/path/to/your-dbt-project
dbt compile    # or `dbt parse` for a lighter run
```

If `target/manifest.json` is missing, the importer falls back to
plain YAML parsing — you lose column types but folder layout still
works.

### 3. Run the import

1. Top bar → **Import dbt repo** (folder-arrow icon).
2. In the dialog, pick **Local folder**.
3. Click **Choose folder** and select your project root (the folder
   that contains `dbt_project.yml`). Safari/Firefox get a multi-file
   upload fallback; Chrome-based browsers get a native directory
   picker.
4. Click **Import**. The dialog shows a progress log while the
   api-server shells out to `dm dbt sync`. For big projects (200+
   models) expect a few seconds; the log streams each file.
5. The Explorer populates. Every YAML file lives at exactly the path
   it occupied in your dbt repo — `models/staging/customers/…`,
   `models/marts/finance/…`, etc.

### 4. Walk the tree

Open any model. The right-panel inspector now has:

- **Column-level lint** — missing `description`, `data_type`, or
  missing tests on primary-key columns each render a warning pill
  (`packages/web-app/src/lib/dbtLint.js`).
- **Column data types** — pulled from `manifest.json`'s compiled
  schema. Columns that dbt couldn't resolve (e.g. new models that
  haven't been built) show `—`.
- **dbt metadata** — the raw dbt fields (`meta`, `tests`, `contract`)
  are preserved under `meta.datalex.dbt.*` in the DataLex YAML. You
  can round-trip this back to dbt with `datalex generate dbt`.

### 5. Make an edit; see the diff

Rename a column description in the inspector. The **Diff** panel
(bottom) shows the patch. This is exactly the diff that'll land in
your git commit if you save.

### 6. Save to disk

Two options:

- **Edit in-place (live folder):** if you started with
  `--project-dir ~/my-dbt-repo`, DataLex uses that folder as the
  workspace root. Use **Save All** to flush every dirty file back to
  the original paths. Your `git status` will show real diffs.

- **Save to a fresh folder:** File menu → New Project → pick a
  different folder → save. Useful for a side-by-side migration
  without touching your real repo.

## Option B — From a git URL

### 1. Start the server

```bash
datalex serve
```

### 2. Trigger the git import

1. Top bar → **Import dbt repo**.
2. Switch to the **Git URL** tab.
3. Enter a public URL like `https://github.com/dbt-labs/jaffle-shop.git`
   or a private one.
4. Optional ref: branch, tag, or commit SHA (default: `main`).
5. Click **Import**. The api-server clones the repo into
   `$TMPDIR/datalex-dbt-<uuid>/`, runs `dm dbt sync` against it,
   streams progress to the dialog, and hands the resulting tree to
   the workspace store.

### 3. Save the imported tree

In-memory by default, just like Option A step 6. If you want a
permanent location, File menu → New Project → pick a folder →
**Save All**.

Private repos: the clone runs with whatever credentials are on the
api-server host. For a cloud-hosted `dm serve`, set up SSH or a
credential helper on that machine; we don't prompt for tokens in the
UI yet (tracked for a future PR).

## What stays in sync, what doesn't

The importer only reads from dbt. It doesn't push changes back
automatically. To emit DataLex → dbt:

```bash
# Re-emit schema.yml with DataLex column metadata merged non-destructively
datalex generate dbt models/ --out ~/your-dbt-repo/

# Or merge into a specific schema.yml
datalex datalex dbt sync models/staging/stg_customers.model.yaml \
  --dbt-schema ~/your-dbt-repo/models/staging/schema.yml
```

The `sync` form is non-destructive — anything you hand-authored
(custom tests, macros, meta fields) stays intact. Only DataLex-owned
fields (`description`, `data_type`, `tests` you added via the
inspector) are reconciled.

## Round-tripping: DataLex ↔ dbt

```
  dbt repo  ─── import ──▶  DataLex tree  ─── generate ──▶  dbt repo
   (models/…)               (models/…)                      (models/…)
     \__________________________________________________________/
                         same folder layout
```

The `models/staging/stg_*.model.yaml` files in the DataLex tree write
back to `models/staging/stg_*.yml` / `schema.yml` at the same
relative paths. There's no translation layer to get lost in.

## Troubleshooting

| Symptom                                         | Fix                                                                    |
|-------------------------------------------------|------------------------------------------------------------------------|
| "manifest.json not found"                       | Run `dbt compile` in your project first.                               |
| Explorer renders models as a flat list          | Your dbt version is old enough that `manifest.json` lacks `original_file_path`. Upgrade dbt or accept the flat layout. |
| Column `data_type` shows `—` everywhere         | dbt hasn't compiled the model's source columns. Run `dbt run` once.   |
| Git clone fails with auth error                 | The api-server host needs credentials. Configure SSH/PAT there, not in the UI. |
| "Import dbt repo" dialog hangs                  | Check the api-server logs (printed by `datalex serve`) — most often a Python dependency missing (`pip install dbt-core`). |
| Folders appear but files inside are empty       | The dbt schema YAML was unparseable. Run `dbt parse` and look for errors. |

## What to do next

- **Review diffs on every PR** — once you save to a folder, every
  DataLex edit lands as a YAML diff. No opaque tool state.
- **Add a CI gate** — `datalex gate old.yaml new.yaml` fails PRs on
  breaking schema changes. Wire it into your `.github/workflows/`.
- **Connect a warehouse too** — see
  [Pull a warehouse schema](warehouse-pull.md) for live column-type
  confirmation.
- **Full CLI reference** — `docs/cli.md`.
