# CLI Reference

The CLI installs as both `datalex` and `dm`. Use `datalex` in new docs.

```bash
datalex --help
datalex datalex --help
```

## Start the local app

```bash
datalex serve
datalex serve --project-dir ~/path/to/your-dbt-project
```

Use this path for the OSS UI workflow:

```text
Connect -> AI Setup -> Readiness -> Generate -> Review -> Contracts -> Publish
```

## Build the DataLex manifest

```bash
datalex datalex manifest build DataLex --out DataLex/datalex-manifest.json
```

Useful flags:

- `--out <path>` writes the manifest to a specific file.
- `--output-json` prints the manifest JSON to stdout.
- `--datalex-version <version>` writes an explicit producer version.

Only certified contracts and metric contracts enter the manifest.

## Validate a DataLex project

```bash
datalex datalex validate DataLex
```

Use this before committing generated artifacts.

## Inspect a DataLex project

```bash
datalex datalex info DataLex
```

This summarizes discovered domains, entities, contracts, policies, and related
artifacts.

## dbt import and emit

DataLex OSS now recommends the UI enterprise workflow for dbt adoption, but the
CLI still exposes dbt round-trip commands.

```bash
datalex dbt import target/manifest.json --out-root DataLex/imported/dbt
datalex datalex dbt sync . --out-root DataLex/imported/dbt
datalex datalex dbt emit DataLex --out-dir build/dbt
```

Use `dbt parse` first when possible so `target/manifest.json` is fresh.

## Diffs and package checks

```bash
datalex datalex diff DataLex-main DataLex --exit-on-breaking
datalex datalex mesh check DataLex --strict
```

These commands are useful in CI after proposals are certified.

## AI provider setup

AI provider settings for the enterprise workflow are configured in the UI under
**AI Setup**. Settings are stored under:

```text
<project>/.datalex/agent/provider-settings.json
```

Environment variables can supplement local settings:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export OLLAMA_BASE_URL="http://localhost:11434"
```

## Install extras

```bash
python3 -m pip install -U 'datalex-cli[serve]'
python3 -m pip install -U 'datalex-cli[serve,duckdb]'
python3 -m pip install -U 'datalex-cli[serve,postgres]'
python3 -m pip install -U 'datalex-cli[serve,snowflake]'
python3 -m pip install -U 'datalex-cli[serve,all]'
```

## Tutorials

- [Install and run](tutorials/01-install-and-run.md)
- [Connect an existing dbt repo](tutorials/02-connect-existing-dbt.md)
- [Configure AI](tutorials/03-configure-ai.md)
- [Generate, review, and certify](tutorials/04-generate-review-certify.md)
- [Publish the manifest](tutorials/05-publish-manifest.md)
