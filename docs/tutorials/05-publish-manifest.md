# 5. Publish the DataLex Manifest

The manifest is the OSS handoff from DataLex to downstream tools.

## Build from the UI

Open **Publish** and click **Build DataLex Manifest**.

The screen shows:

- manifest status
- certified contracts
- draft proposals
- rejected proposals excluded
- warnings
- optional integration status

## Build from the CLI

From your dbt repo root:

```bash
datalex datalex manifest build DataLex --out DataLex/datalex-manifest.json
```

Only certified contracts and metric contracts enter the manifest.

## DQL is optional in OSS

DataLex OSS does not require DQL. Publish focuses on the DataLex manifest.

DQL readiness appears only when `datalex.yaml` enables it:

```yaml
integrations:
  dql:
    enabled: true
    path: ../dql
    manifest: ../dql/dql-manifest.json
```

## Check Git

Review the generated files:

```bash
git status
git diff
```

Commit only the approved artifacts.

## Next

For isolated installs, continue to [Run DataLex with Docker](06-docker.md).
