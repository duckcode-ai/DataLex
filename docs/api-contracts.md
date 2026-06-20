# Integration Contracts (Prototype)

## 1. Scope
The prototype exposes integration contracts through CLI commands rather than a hosted API service.

## 2. Import Contracts

### 2.1 SQL Import
Command:
```bash
datalex import sql <schema.sql> --out imported.model.yaml
```
Contract:
1. Input: SQL DDL with `CREATE TABLE` statements.
2. Output: YAML model conforming to `schemas/model.schema.json`.
3. Relationship mapping: FK -> one-to-many relationship.

### 2.2 DBML Import
Command:
```bash
datalex import dbml <schema.dbml> --out imported.model.yaml
```
Contract:
1. Input: DBML table/ref declarations.
2. Output: YAML model conforming to `schemas/model.schema.json`.

## 3. Generation Contracts

### 3.1 SQL DDL Generation
```bash
datalex generate sql model.yaml --dialect postgres --out model.sql
```
Output:
- SQL create table statements
- FK constraints derived from relationships

### 3.2 dbt Scaffold Generation
```bash
datalex generate dbt model.yaml --out-dir ./dbt
```
Output files:
1. `dbt_project.yml`
2. `models/staging/*.sql`
3. `models/staging/schema.yml`
4. `models/sources.yml`

### 3.3 Metadata Export
```bash
datalex generate metadata model.yaml --out metadata.json
```
Output:
- canonical model metadata JSON for external system ingestion.

### 3.4 Migration SQL Generation
```bash
datalex migrate old.model.yaml new.model.yaml --dialect snowflake --out migration.sql
```
Output:
- ordered migration SQL (CREATE/DROP/ALTER/INDEX)
- header with model version transition and dialect

### 3.5 Apply to Warehouse (Forward Engineering)
```bash
# Optional direct apply command (typically CI/CD-only)
datalex apply snowflake --sql-file migration.sql --dry-run
```
Output:
- execution summary (statement count, migration name, checksum)
- optional migration ledger entry in `datalex_migrations`
- in product mode, apply is expected through Git-hosted CI/CD pipelines

## 5. Local API Contracts (Forward Engineering)

### 5.1 Generate SQL
`POST /api/forward/generate-sql`
- body: `{ model_path, dialect, out? }`

### 5.2 Generate Migration SQL
`POST /api/forward/migrate`
- body: `{ old_model, new_model, dialect, out? }`

### 5.3 Apply SQL / Migration
`POST /api/forward/apply`
- disabled by default in product GitOps mode
- enable only with env: `DM_ENABLE_DIRECT_APPLY=true`
- when enabled, body supports exactly one input mode:
  - `{ connector, dialect?, sql_file, ...connectionParams }`
  - `{ connector, dialect?, sql, ...connectionParams }`
  - `{ connector, dialect?, old_model, new_model, model_schema?, ...connectionParams }`
- options: `dry_run`, `skip_ledger`, `ledger_table`, `migration_name`, `allow_destructive`
- policy preflight: `policy_pack`, `skip_policy_check` (model-diff mode)
- observability/artifacts: `output_json`, `report_json`, `write_sql`


### 5.4 GitOps Automation Endpoints
- `POST /api/git/branch/create`
  - body: `{ projectId, branch, from? }`
  - creates branch or checks out existing branch
- `POST /api/git/push`
  - body: `{ projectId, branch?, remote?, set_upstream? }`
  - pushes branch to remote (defaults to `origin`)
- `POST /api/git/pull`
  - body: `{ projectId, remote?, branch?, ff_only? }`
  - pulls latest changes (defaults to fast-forward only)
- `POST /api/git/github/pr`
  - body: `{ projectId, token, title, body?, base?, head?, draft? }`
  - opens a GitHub pull request using the project remote

### 5.5 Enterprise Adoption Endpoints
These endpoints power the OSS workflow:

```text
Connect dbt repo -> AI Setup -> Readiness -> Generate -> Review -> Contracts -> Publish
```

- `GET /api/ai/settings`
  - query: `projectId`
  - returns redacted OpenAI, Claude, and Ollama provider settings plus env var status
  - never returns raw API keys
- `POST /api/ai/settings`
  - body: `{ projectId, provider, model?, baseUrl?, apiKey? }`
  - stores project-private runtime settings under `<project>/.datalex/agent/provider-settings.json`
  - never writes AI provider secrets under versioned `DataLex/`
- `POST /api/ai/settings/test`
  - body: `{ projectId, provider, model?, baseUrl?, apiKey? }`
  - saves the provider input, calls the provider, and marks it `passed` or `failed`
  - generation requires a passed provider test
- `POST /api/ai/context/build`
  - body: `{ projectId }`
  - rebuilds the local AI context index from dbt manifest/YAML, semantic metrics, tests, exposures, descriptions, and DataLex artifacts
- `GET /api/ai/context/status`
  - query: `projectId`
  - returns whether the local AI context index exists and how many records it contains

- `POST /api/enterprise/scan`
  - body: `{ projectId?, dbtProjectPath? }`
  - scans dbt manifest/YAML, semantic models, metrics, exposures, tests, owners, DataLex artifacts, AI readiness, and optional DQL references
  - returns domain readiness, proposal priorities, contract status, and optional DQL readiness inputs
- `GET /api/enterprise/readiness`
  - query: `projectId` or `dbtProjectPath`
  - returns the cached readiness model used by the Readiness and Domains views
- `POST /api/enterprise/generate`
  - body: `{ projectId?, domain?, packType?, scopeSize?, scope? }`
  - requires a saved and test-passed AI provider
  - returns `409` with `AI_PROVIDER_REQUIRED` when AI is missing or untested
  - writes a small AI-generated `kind: proposal` draft under the canonical `DataLex/<domain>/proposals/` path
  - includes evidence, confidence, assumptions, open questions, and exact proposed files
- `POST /api/proposals/validate`
  - proposal mode body: `{ projectId, proposalPath }`
  - validates proposal shape and required review evidence before apply/certify
  - change-array mode remains available for low-level AI file patches
- `POST /api/proposals/apply`
  - proposal mode body: `{ projectId, proposalPath, status? }`
  - updates proposal lifecycle state for `draft`, `reviewed`, or `rejected`
  - use `/api/proposals/certify` for certification because that may write approved artifacts
  - change-array mode remains available for low-level AI file patches
- `POST /api/proposals/certify`
  - body: `{ projectId, proposalPath }`
  - creates certified artifacts from approved proposals: contracts, diagrams, glossary, metric contracts, and generated dbt suggestions as appropriate for the proposal type
- `POST /api/datalex/manifest/build`
  - body: `{ projectId, out?, outputJson? }`
  - builds `datalex-manifest.json`; only certified contracts and metric contracts are exported
- `POST /api/dql/readiness`
  - body: `{ projectId, datalexManifest?, dqlPath? }`
  - optional OSS integration endpoint; Publish calls it only when DQL integration is explicitly enabled in `datalex.yaml`
  - checks whether certified DQL blocks resolve their `datalex_contract` references
  - when a DQL folder and CLI are available, also runs `dql compile <dqlPath> --datalex-manifest <manifest>`
  - returns `compile.status` as `passed`, `failed`, `skipped`, or `not_configured`

## 4. Quality Contracts

### 4.1 Validation
```bash
datalex validate model.yaml
```
Exit codes:
1. `0`: pass
2. `1`: validation errors

### 4.2 Policy Check
```bash
datalex policy-check model.yaml --policy policies/default.policy.yaml
```
Exit codes:
1. `0`: no error-severity policy violations
2. `1`: policy errors or invalid model/policy pack

### 4.3 Gate
```bash
datalex gate old.yaml new.yaml
```
Exit codes:
1. `0`: pass
2. `1`: validation failure
3. `2`: breaking changes (without override)
