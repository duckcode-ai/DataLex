# DataLex Docs

DataLex OSS is an AI-first adoption workflow for existing dbt projects.

The product flow is:

```text
Connect dbt repo -> AI Setup -> Readiness -> Generate -> Review -> Contracts -> Publish
```

DataLex keeps dbt as the physical source of truth and adds a Git-versioned
business layer under `DataLex/`.

## Start Here

1. [Getting Started](getting-started.md)
2. [Install and run DataLex](tutorials/01-install-and-run.md)
3. [Connect an existing dbt repo](tutorials/02-connect-existing-dbt.md)
4. [Configure AI](tutorials/03-configure-ai.md)
5. [Generate, review, and certify](tutorials/04-generate-review-certify.md)
6. [Publish the manifest](tutorials/05-publish-manifest.md)

## What DataLex Adds

- AI-generated proposal packs from dbt evidence
- business domains and ownership
- conceptual, logical, and physical diagrams
- DataLex business contracts
- metric contracts
- glossary terms
- dbt contract suggestions
- `datalex-manifest.json` for certified downstream use

## What DataLex Does Not Replace

- dbt SQL
- dbt model YAML
- dbt semantic metrics
- dbt tests
- dbt exposures
- enforced dbt physical contracts

## Main References

- [Enterprise OSS workflow](enterprise-oss-workflow.md)
- [DataLex layout](datalex-layout.md)
- [AI-agentic modeling](ai-agentic-modeling.md)
- [CLI reference](cli.md)
- [API contracts](api-contracts.md)
- [Manifest spec](manifest-spec/index.md)

## Optional DQL Integration

DQL is not required for DataLex OSS. DataLex publishes a certified manifest.
Cloud can combine DataLex and DQL later. OSS projects can opt into DQL readiness
explicitly through `datalex.yaml`.
