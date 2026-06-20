---
hide:
  - navigation
  - toc
---

# DataLex

> **YAML-first data modeling that makes contracts machine-checkable for the AI era.**

In 2026, AI agents answer the same business question different ways and return different numbers. CFOs and data leaders are starting to ask "can we trust the AI numbers?" — and right now the answer is "no."

DataLex is the layer that turns that "no" into "yes" — by giving your dbt project a governed conceptual model and machine-enforceable contracts that AI tools can't bypass.

---

## Why DataLex

- **Sits above dbt, never replaces it.** Reads `target/manifest.json`, never writes back without a reviewable diff. Your dbt project stays the source of truth for transformations.
- **Conceptual, logical, and physical layers stay connected.** Business meaning, data structure, and dbt implementation share one YAML graph instead of drifting across SQL, tickets, and tribal knowledge.
- **AI-first enterprise adoption.** Connect a dbt repo, configure OpenAI, Claude, or Ollama, scan readiness, then generate small reviewable packs for domains, contracts, diagrams, glossary terms, and metric contracts.
- **Reviewable AI authoring.** DataLex proposes contracts from manifest/YAML/semantic evidence; you accept, edit, certify, and commit. No silent rewrites of project files.
- **Optional DQL checks.** When a [DQL block](datalex-and-dql.md) references a contract by id, the DQL compiler can resolve it against your DataLex manifest. DQL stays optional in OSS and is enabled explicitly.
- **Open source forever.** Apache 2.0. No closed-source language features.

---

## Install

=== "pip"

    ```bash
    pip install datalex-cli
    ```

=== "AI drafting — Anthropic"

    ```bash
    pip install datalex-cli[draft]
    export ANTHROPIC_API_KEY=sk-ant-...
    datalex draft --dbt /path/to/dbt-project --domain commerce
    ```

=== "AI drafting — OpenAI"

    ```bash
    pip install datalex-cli[draft-openai]
    export OPENAI_API_KEY=sk-...
    datalex draft --dbt /path/to/dbt-project --domain commerce --provider openai
    ```

=== "AI drafting — Gemini"

    ```bash
    pip install datalex-cli[draft-gemini]
    export GOOGLE_API_KEY=...
    datalex draft --dbt /path/to/dbt-project --domain commerce --provider gemini
    ```

=== "AI drafting — local Ollama"

    ```bash
    pip install datalex-cli[draft-ollama]   # no SDK needed; uses HTTP
    ollama serve
    datalex draft --dbt /path/to/dbt-project --domain commerce \
                  --provider ollama --model llama3.1:8b
    ```

The CLI auto-detects the provider from env vars when `--provider` is
omitted: `ANTHROPIC_API_KEY` > `OPENAI_API_KEY` > `GOOGLE_API_KEY` >
Ollama fallback. Pin a specific provider explicitly with the flag.

=== "Run web UI"

    ```bash
    pip install datalex-cli[serve]
    datalex serve
    ```

---

## Five-minute path

1. **[Enterprise OSS workflow](enterprise-oss-workflow.md)** — connect an existing dbt repo, set up AI, scan readiness, generate proposal packs, certify, and publish.
2. **[Get started](getting-started.md)** — install, scaffold a project, compile your first model.
3. **[Walk through Jaffle Shop](tutorials/jaffle-shop-walkthrough.md)** — full dbt + DuckDB + DataLex example.
4. **[Layered modeling](datalex-layout.md)** — when to use conceptual vs. logical vs. physical.
5. **[End-to-end DataLex + DQL tutorial](tutorials/datalex-plus-dql-end-to-end.md)** — optional companion flow using both example repos.
6. **[The DataLex + DQL stack](datalex-and-dql.md)** — how the two languages can combine for certified AI analytics.
7. **[Contracts for DQL blocks](contracts-for-dql-blocks.md)** - what a contract means for a DQL block, where it comes from, and how it supports fast draft work plus trusted publish gates.

---

## Architecture in one diagram

```mermaid
flowchart LR
    Source[(Source data)] --> dbt
    dbt --> Manifest[dbt manifest.json]
    Manifest --> DataLex[DataLex compiler]
    DataLex --> ContractsManifest[DataLex manifest]
    ContractsManifest -. optional .-> DQL[DQL compiler]
    DQL -. optional .-> Blocks[Certified blocks]
    Blocks -. optional .-> MCP[DQL MCP for AI agents]
    Blocks -. optional .-> Apps[Apps + dashboards]
    ContractsManifest --> Catalog[Atlan / Marquez / Monte Carlo]
```

DataLex is the business/domain contract layer above dbt. DQL can consume the
published DataLex manifest when you enable that companion flow. Both speak the
[public manifest spec](https://github.com/duckcode-ai/manifest-spec).

---

## Open source

DataLex is Apache 2.0 and built in the open at [`duckcode-ai/DataLex`](https://github.com/duckcode-ai/DataLex). File issues, send PRs, drop into [Discord](https://discord.gg/Dnm6bUvk).

For the broader plan — manifest-spec versioning, the DQL companion, the launch checklist — see [`ROADMAP.md`](https://github.com/duckcode-ai/DataLex/blob/main/ROADMAP.md).
