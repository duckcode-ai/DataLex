# 2. Connect an Existing dbt Repo

DataLex is designed to adopt an existing dbt repo, not replace it.

## Prepare the dbt repo

From your dbt project root:

```bash
dbt parse
```

This creates or refreshes `target/manifest.json`. DataLex can scan YAML without
it, but the manifest gives better model, metric, exposure, and relationship
evidence.

## Open the repo

```bash
cd ~/path/to/your-dbt-project
datalex serve --project-dir .
```

Or open DataLex first and use **Connect** to choose the local folder.

## Confirm detection

The Connect screen should show whether DataLex found:

- `dbt_project.yml`
- `target/manifest.json`
- dbt YAML
- semantic models
- metrics
- exposures
- existing dbt contracts
- owners, descriptions, tests, and tags
- existing `DataLex/` artifacts

## If the manifest is missing

DataLex will continue with a weaker YAML-only scan. For better AI results,
return to the dbt repo and run:

```bash
dbt parse
```

## Next

Continue to [Configure AI](03-configure-ai.md).
