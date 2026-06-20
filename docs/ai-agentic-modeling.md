# AI-Agentic Modeling

DataLex OSS treats AI as the primary generation path for business modeling on
top of dbt.

AI does not silently write trusted artifacts. It creates reviewable proposals.
Users certify the approved outputs.

## What AI reads

When a dbt project is connected, DataLex can build a local AI context from:

- `target/manifest.json`
- dbt model YAML
- semantic models and metrics
- tests and relationships
- exposures
- owners and descriptions
- existing dbt contracts
- existing DataLex contracts, proposals, diagrams, glossary, and metrics
- project skills under `DataLex/Skills/`

If the manifest is missing, DataLex can scan YAML, but proposals have weaker
evidence. Run `dbt parse` before generation when possible.

## Providers

The first-class OSS providers are:

- OpenAI
- Claude
- Ollama

Provider settings are stored locally:

```text
<project>/.datalex/agent/provider-settings.json
```

Secrets are redacted from API responses and are never written under versioned
`DataLex/`.

Environment variables can override or supplement local settings:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export OLLAMA_BASE_URL="http://localhost:11434"
```

## Ollama example

```bash
ollama pull gemma4:12b
ollama serve
```

In **AI Setup**:

```text
Provider: Ollama
Base URL: http://localhost:11434
Model: gemma4:12b
```

Click **Save**, then **Test**.

## Generation gate

Readiness works without AI.

Generate requires a saved and tested provider. If AI is not ready, the API
returns:

```text
AI_PROVIDER_REQUIRED
```

DataLex does not create random path-derived domains or fake placeholder
contracts. Unclear inventory stays under **Unassigned / Needs AI domain
proposal**.

## Proposal evidence

Every AI proposal should include:

- source dbt models
- columns used
- tests and relationships
- semantic metric references
- inferred grain
- assumptions
- confidence
- open questions
- exact files changed

## Certification

AI output starts as `kind: proposal` with `status: draft`.

Users can:

- approve
- edit
- ask AI to fix
- split
- reject
- certify

Only certified contracts and metric contracts enter `datalex-manifest.json`.
