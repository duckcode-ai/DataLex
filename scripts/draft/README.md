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

## Acceptance bar

Phase 1 success criterion (per the OSS plan): on jaffle-shop-DataLex, the
draft produces output the user accepts ≥50% of on first review. The script
prints an end-of-run summary (`entities drafted: N, fields drafted: M,
relationships drafted: R`) so you can track this manually.

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
