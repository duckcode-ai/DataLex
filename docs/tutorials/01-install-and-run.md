# 1. Install and Run DataLex

Use PyPI for normal OSS usage.

## Install

```bash
python3 -m pip install -U 'datalex-cli[serve]'
datalex --version
```

The `[serve]` extra includes the local UI runtime.

## Start the app

```bash
datalex serve
```

Open:

```text
http://localhost:3030
```

## Start inside a dbt repo

```bash
cd ~/path/to/your-dbt-project
datalex serve --project-dir .
```

This opens DataLex with your dbt repo already registered.

## Optional drivers

Install only what you need:

```bash
python3 -m pip install -U 'datalex-cli[serve,duckdb]'
python3 -m pip install -U 'datalex-cli[serve,postgres]'
python3 -m pip install -U 'datalex-cli[serve,snowflake]'
python3 -m pip install -U 'datalex-cli[serve,all]'
```

## Next

Continue to [Connect an existing dbt repo](02-connect-existing-dbt.md).
