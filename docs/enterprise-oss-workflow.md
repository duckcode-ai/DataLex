# Enterprise OSS workflow

DataLex OSS is an AI-first adoption layer for existing dbt projects. It does
not replace dbt SQL, dbt YAML, semantic metrics, or enforced dbt contracts.
The default flow is:

```text
Connect dbt repo -> AI Setup -> Readiness -> Generate -> Review -> Contracts -> Publish
```

The UI starts with AI Setup so teams can prove DataLex can analyze the
connected dbt project before proposal generation. Readiness still works without
AI, but Generate requires a saved and tested provider. Explorer, Diagram, Docs,
YAML, Diff, and Git remain available as drilldowns.

## What DataLex reads

On scan, DataLex looks for:

- `dbt_project.yml`
- `target/manifest.json`
- dbt YAML files when `manifest.json` is missing
- semantic models and metrics
- exposures
- owners, descriptions, tests, tags, and dbt contracts
- existing DataLex contracts, proposals, glossary, diagrams, and metric contracts
- DQL block references only when the optional DQL integration is enabled

For large repos, the scan rolls this into domain-level readiness instead of
showing every file by default.

## AI setup

DataLex OSS treats AI as the primary authoring path for enterprise adoption,
not a hidden manual fallback. The AI Setup step shows:

- detected dbt evidence: manifest, semantic metrics, exposures, tests, owners,
  descriptions, and existing dbt contracts
- provider cards for OpenAI, Claude, and Ollama
- whether the provider has a key or local model configured
- the project-private runtime settings path
- AI context index status

Provider settings are stored in `<project>/.datalex/agent/provider-settings.json`
and are ignored by Git. API keys are never written under the versioned
`DataLex/` folder and API responses redact secrets. Environment variables such
as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`,
and `OLLAMA_BASE_URL` override or supplement local settings.

If Generate is called before AI is ready, the API returns
`AI_PROVIDER_REQUIRED`. DataLex does not create placeholder domains, contracts,
or diagrams from deterministic path guesses. Models without explicit domain
evidence stay grouped under `unassigned` / "Needs AI domain proposal."

## What DataLex writes

New OSS writes use the canonical domain-first layout:

```text
DataLex/
  datalex.yaml
  domains/
    commerce.yaml
  commerce/
    conceptual/
    logical/
    physical/
    contracts/
    proposals/
    glossary/
    semantic/
  imported/
    dbt/
      commerce/
  generated/
    dbt/
      commerce/
  generated-sql/
    ddl/
    migrations/
  Skills/
```

DataLex still reads legacy paths such as `DataLex/<domain>/Contracts`,
`datalex/diagrams`, and old `models/conceptual` trees. New UI actions write
lowercase canonical paths only.

## Proposal lifecycle

AI generation writes `kind: proposal` files first:

```yaml
kind: proposal
name: commerce_core_certification
proposal_type: datalex_contract
status: draft
domain: commerce
evidence:
  source_models:
    - model.jaffle_shop.fct_orders
  semantic_metrics:
    - revenue
  inferred_grain: one row per order_id
  confidence: 0.82
  assumptions:
    - dbt remains the physical source of truth.
  open_questions:
    - Confirm revenue policy for cancelled orders.
```

Users approve, edit, ask AI to fix, reject, or certify. Certification is the
explicit step that writes approved artifacts. A core certification proposal
writes a small canonical pack:

- `domains/<domain>.yaml`
- `<domain>/conceptual/<pack>.diagram.yaml`
- `<domain>/logical/<pack>.diagram.yaml`
- `<domain>/physical/<pack>.diagram.yaml`
- `<domain>/contracts/<pack>.contract.yaml`
- `<domain>/semantic/<metric_family>.metric.yaml`
- `<domain>/glossary/<term>.term.yaml`
- `generated/dbt/<domain>/<model>.contract.yml`

Focused proposal types write only their artifact family. Rejected proposals
never enter `datalex-manifest.json`; generated contract and metric artifacts
from a rejected proposal are moved out of `certified` status.

## Contracts and metrics

DataLex contracts sit above dbt contracts:

- dbt contracts remain the source of truth for physical column shape.
- DataLex contracts add business meaning, grain, evidence, owner, metric
  dependencies, and DQL-ready ids.
- Metric contracts are separate `kind: metric_contract` files under
  `<domain>/semantic/`.

Only `status: certified` contracts and metric contracts are exported into the
DataLex manifest.

## Publish and DQL readiness

Publish builds the manifest:

```bash
datalex datalex manifest build DataLex --out datalex-manifest.json
```

The Publish screen shows:

- manifest status
- certified contracts
- draft proposals
- rejected proposals excluded
- optional integration status

DQL is default-off in DataLex OSS. Publish does not scan DQL blocks or run DQL
compile unless the project explicitly enables the integration:

```yaml
integrations:
  dql:
    enabled: true
    path: ../dql
    manifest: ../dql/dql-manifest.json
```

When enabled and the DQL CLI is available, Publish can run:

```bash
dql compile <dql-path> --datalex-manifest <DataLex/datalex-manifest.json>
```

If DQL is not configured, DataLex reports it as an optional integration and
does not block DataLex-only adoption.

## Enterprise scale defaults

The OSS UI prioritizes:

1. semantic metrics used by dashboards and apps
2. high-value fact tables
3. exposures
4. existing dbt contracts
5. marts
6. frequently referenced models
7. missing owner, grain, description, and relationship gaps

The goal is not to model every object. The goal is to create small,
reviewable certification packs such as:

```text
Revenue Core Certification Pack
- 3 fact-table contracts
- 42 metrics grouped into 7 metric families
- 1 conceptual diagram
- 1 logical diagram
- 1 physical diagram
- 12 glossary terms
- 6 dbt contract suggestions
```

That pack is reviewed as a business artifact first, then users drill into
low-confidence items and exact files.

Enterprise queues are intentionally bounded. The API returns truncation
metadata for proposal packs, contract opportunities, proposals, contracts, and
DQL blocks so the UI can show "showing X of Y" and ask users to filter by
domain, status, owner, or search term instead of rendering every model.
