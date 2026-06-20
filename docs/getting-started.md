# Getting Started

This guide is the clean path for the OSS release:

```text
Install -> Connect dbt -> AI Setup -> Readiness -> Generate -> Review -> Publish
```

DataLex is built for existing dbt projects. It reads your dbt manifest, YAML,
semantic metrics, tests, exposures, owners, descriptions, and contracts. AI then
proposes business domains, contracts, diagrams, glossary terms, and metric
contracts. You review and certify the result before DataLex writes trusted
artifacts.

## 1. Install

```bash
python3 -m pip install -U 'datalex-cli[serve]'
datalex --version
```

Start the local app:

```bash
datalex serve
```

Open `http://localhost:3030`.

To start directly inside a dbt repo:

```bash
cd ~/path/to/your-dbt-project
datalex serve --project-dir .
```

## 2. Connect a dbt repo

In the UI, open **Connect** and choose your project folder.

DataLex checks for:

- `dbt_project.yml`
- `target/manifest.json`
- dbt YAML
- semantic models and metrics
- exposures
- tests and relationships
- owners and descriptions
- existing dbt contracts
- an existing `DataLex/` folder

If `target/manifest.json` is missing, DataLex can still scan YAML, but the AI
context is weaker. Run this in your dbt repo when possible:

```bash
dbt parse
```

## 3. Configure AI

Open **AI Setup**.

Choose one provider:

- **OpenAI** with `OPENAI_API_KEY`
- **Claude** with `ANTHROPIC_API_KEY`
- **Ollama** with a local model

Ollama example:

```bash
ollama pull gemma4:12b
ollama serve
```

In DataLex:

```text
Provider: Ollama
Base URL: http://localhost:11434
Model: gemma4:12b
```

Click **Save**, then **Test**. Generation stays blocked until a provider test
passes.

Settings are stored locally under:

```text
<your-dbt-project>/.datalex/agent/provider-settings.json
```

Secrets are never written under versioned `DataLex/`.

## 4. Scan readiness

Open **Readiness**.

The default view is domain-level and evidence-level. It does not render every
model in large projects.

Use it to see:

- total models
- fact-table candidates
- semantic metrics
- existing dbt contracts
- missing contracts
- exposures
- missing owners and descriptions
- unclear grains
- relationship gaps
- certified DataLex contracts

Models without clear domain evidence stay under **Unassigned / Needs AI domain
proposal** until AI proposes a real business domain.

## 5. Generate a focused pack

Open **Generate**.

Choose a small scope:

- one domain
- one model group
- one metric family
- selected models

Pick a proposal type:

- business domain
- conceptual diagram
- logical diagram
- physical dbt-backed diagram
- DataLex contract
- dbt contract suggestion
- metric contract family
- glossary/docs proposal

DataLex generates draft proposals with evidence, not certified artifacts.

## 6. Review and certify

Open **Review**.

Each proposal card should show:

- what will be added
- why AI believes it
- source dbt models
- columns used
- tests and relationships
- semantic metrics
- inferred grain
- assumptions
- confidence
- open questions
- exact files changed

You can approve, edit, ask AI to fix, split, reject, or certify. Only
certified contracts and metric contracts enter the published manifest.

## 7. Publish

Open **Publish** and build the manifest, or run:

```bash
datalex datalex manifest build DataLex --out DataLex/datalex-manifest.json
```

The manifest includes certified DataLex contracts and metric contracts. Rejected
proposals are excluded.

DQL readiness is hidden by default in OSS. It appears only when your
`datalex.yaml` explicitly enables DQL:

```yaml
integrations:
  dql:
    enabled: true
    path: ../dql
    manifest: ../dql/dql-manifest.json
```

## Tutorials

Follow these in order:

1. [Install and run DataLex](tutorials/01-install-and-run.md)
2. [Connect an existing dbt repo](tutorials/02-connect-existing-dbt.md)
3. [Configure AI](tutorials/03-configure-ai.md)
4. [Generate, review, and certify](tutorials/04-generate-review-certify.md)
5. [Publish the manifest](tutorials/05-publish-manifest.md)
6. [Run with Docker](tutorials/06-docker.md)
