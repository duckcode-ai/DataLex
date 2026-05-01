# `scripts/draft/` — AI-assisted DataLex starter from a dbt project

Phase 1.1 of the OSS plan. A standalone script that turns a dbt project's
`target/manifest.json` into a draft `*.model.yaml` you can review, edit, and
commit. Reviewable AI output — never silent rewrites of project files.

This is a **script**, not yet a CLI command. Phase 2.2 will productize the
working script as `datalex draft` under `packages/cli/`. The script form keeps
the iteration loop tight while we tune the prompt + few-shot pack.

## Install

```bash
pip install -r scripts/draft/requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
```

## Run against jaffle-shop-DataLex

```bash
# In jaffle-shop-DataLex first:
dbt parse  # produces target/manifest.json

# Then from the DataLex repo:
python scripts/draft/draft.py \
  --dbt /Users/Kranthi_1/DuckCode-DQL/jaffle-shop-DataLex \
  --domain commerce
```

Prints proposed YAML to stdout. To write to disk:

```bash
python scripts/draft/draft.py \
  --dbt /Users/Kranthi_1/DuckCode-DQL/jaffle-shop-DataLex \
  --domain commerce \
  --out /Users/Kranthi_1/DuckCode-DQL/jaffle-shop-DataLex/DataLex/commerce.draft.model.yaml
```

If `--out` already exists, the script prints a unified diff and exits without
writing. Pass `--force` to overwrite (the diff is still printed first).

## Flags

| flag | required | default | purpose |
|---|---|---|---|
| `--dbt PATH` | yes | — | dbt project root (must contain `target/manifest.json` or `dbt_project.yml`; if only the project file, the script runs `dbt parse` for you) |
| `--domain NAME` | yes | — | DataLex domain to assign (e.g., `commerce`, `finance`) |
| `--out PATH` | no | stdout | write proposed YAML to this path |
| `--force` | no | false | allow `--out` to overwrite an existing file |
| `--model NAME` | no | `claude-opus-4-7` | Anthropic model id |
| `--max-tokens N` | no | `8000` | output token cap |
| `--owner EMAIL` | no | repeats CLI user | populate `model.owners` |
| `--include PATTERN` | no | all models | only include dbt models matching glob (e.g., `marts.*`) |

## What the output looks like

Running against `jaffle-shop-DataLex` produces a single fenced YAML block
shaped like this (truncated):

```yaml
model:
  name: commerce
  version: 1.0.0
  domain: commerce
  owners:
    - data@duckcode.ai
  state: draft

entities:
  - name: Customer
    type: table
    description: Customer dimension table, one row per customer with lifecycle metrics.
    tags: [GOLD, MART, PII]
    fields:
      - name: customer_id
        type: integer
        primary_key: true
        nullable: false
        description: Primary key for the customer.
      - name: customer_name
        type: string
      ...
  - name: Order
    type: table
    fields:
      - name: order_id
        type: integer
        primary_key: true
        nullable: false
      ...

relationships:
  - name: customer_orders
    from: Customer.customer_id
    to: Order.customer_id
    cardinality: one_to_many

governance:
  classification:
    Customer.customer_email: PII
```

Stderr also prints a one-line summary you'll use to gauge quality:

```
[draft] tokens: input=4321 output=1208 cache_read=0 cache_write=3840
[draft] entities=3 fields=18 relationships=2 rules=1
```

Cache hits land on the second run against the same project (look for
`cache_read` rising and `cache_write=0`).

## Acceptance bar

Phase 1 success criterion (per the OSS plan): on jaffle-shop-DataLex, the
draft produces output the user accepts ≥50% of on first review.

How to score yourself after a run:

1. **Entity coverage** — every `marts.*` dbt model becomes an entity, named
   business-style (e.g., `dim_customers` → `Customer`, `fct_orders` →
   `Order`). One point per correct entity name.
2. **Primary keys** — `primary_key: true` lands only where a `not_null` +
   `unique` test pair exists. One point per correct PK.
3. **PII classification** — `customer_email`, `customer_name`,
   `customer_address` flagged with `PII`. One point per correct flag.
4. **Relationships** — every dbt `ref()` from a child to a parent becomes a
   `relationships:` entry with `many_to_one` or `one_to_many` cardinality.
   One point per correct edge.
5. **No fabricated descriptions** — fields with no dbt description should
   have no description in the YAML rather than invented prose. Dock a
   point per fabrication.

Acceptance rate = (kept items) / (kept + corrected + dropped). Aim for
≥50% on the first run; iterate the prompt + few-shot pack to push it up.

## Verify without an API key

The deterministic part of the pipeline (manifest condenser) has pytest
coverage that runs without Anthropic. Use these to verify the loader on a
contributor machine before paying for a full run:

```bash
python -m pytest tests/test_draft_manifest_loader.py -v
```

8 tests cover: model extraction, per-column test linkage,
`refs` → relationship signals, `--include` glob filtering, DataLex `meta`
preservation, sources, and an opt-in integration test against the real
`jaffle-shop-DataLex/target/manifest.json` when present.

## Safety

- Never overwrites project files without `--force`.
- Never sends `ANTHROPIC_API_KEY` to logs or stdout.
- Output is JSON-Schema validated against `schemas/model.schema.json` before
  printing — if validation fails, the script prints the validator errors and
  exits non-zero rather than emit invalid YAML.
- The script does **not** modify the dbt project. Only reads `manifest.json`.

## Prompt caching

System prompt + few-shot pack are sent with `cache_control:
{"type": "ephemeral"}`. Repeated runs against the same dbt project pay only
for the dynamic input portion after the first call.
