# DataLex Architecture

## 1. System Overview
DataLex is a YAML-first data modeling platform (Schema v2) with three runtime surfaces:
1. CLI (`dm`) for validation, linting, diffing, formatting, stats, policy checks, generation, and imports.
2. Core engine (`packages/core_engine`) for deterministic model processing.
3. Web UI (`packages/web-app`) for visual modeling, quality gate review, and change tracking.

## 2. Core Planes

### 2.1 Authoring Plane
- Source of truth: `*.model.yaml` files.
- Authoring channels:
  - direct YAML editing
  - visual node-focused property editing (round-trip into YAML)
- Workspace supports multi-file current/baseline comparisons.

### 2.2 Validation and Compile Plane
- Structural validation: JSON Schema v2 (`schemas/model.schema.json`).
- Semantic validation: duplicate names, PK rules (tables only — views/materialized_views/external_tables/snapshots exempt), reference integrity, index validation, glossary validation, deprecated field warnings, computed field checks, governance checks.
- Canonical compiler: deterministic ordering for entities/fields/relationships/indexes/glossary.
- Diff engine: change summary + breaking-change detection including index removal tracking.

### 2.3 Governance and Policy Plane
- Policy packs in YAML (`policies/*.policy.yaml`).
- Policy schema (`schemas/policy.schema.json`).
- Policy evaluation command: `dm policy-check`.
- CI gate can combine schema + semantic + policy enforcement.

### 2.4 Visualization Plane
- React Flow renderer for entity-relationship graph.
- View controls:
  - layout mode (`grid`, `layered`, `circle`)
  - density (`compact`, `normal`, `wide`)
  - scope filters (entity type, tag)
  - search/focus, edge style, field density, label toggles
- Property panel updates selected entity directly in YAML (safe subset).

### 2.5 Integration Plane
- Import:
  - SQL DDL -> YAML (`dm import sql`)
  - DBML -> YAML (`dm import dbml`)
- Generate:
  - SQL DDL (`dm generate sql --dialect postgres|snowflake|bigquery|databricks`)
  - dbt scaffold with v2 metadata (`dm generate dbt`)
  - metadata JSON export (`dm generate metadata`)
- Utilities:
  - Auto-format YAML to canonical style (`dm fmt`)
  - Model statistics (`dm stats`)

### 2.6 Documentation & Data Dictionary Plane
- HTML data dictionary generator (`dm_core/docs_generator.py`): self-contained single-page site with entity catalog, field details, relationship map, indexes, glossary, data classifications, and client-side search.
- Markdown export for GitHub wiki / Confluence integration.
- Auto-changelog generation from semantic diffs between model versions.
- CLI commands:
  - `dm generate docs <model>` — generate HTML or Markdown data dictionary (`--format html|markdown`)
  - `dm generate changelog <old> <new>` — generate changelog from model diff
- Web UI: Dictionary panel with expandable entity cards, field tables, inline search across entities/fields/tags/glossary.

### 2.7 Multi-Model Resolution Plane
- Cross-file imports via `model.imports` with alias, entity filtering, and path resolution.
- Resolver (`dm_core/resolver.py`): recursive import resolution, cycle detection, duplicate entity warnings.
- Unified entity/relationship/index graph across all imported models.
- Project-level resolution: scan all `*.model.yaml` files in a directory.
- Project-level diff: compare two model directories for added/removed/changed models.
- CLI commands:
  - `dm resolve <model>` — resolve a single model and its imports
  - `dm resolve-project <dir>` — resolve all models in a project
  - `dm diff-all <old-dir> <new-dir>` — project-level semantic diff
  - `dm init --multi-model` — scaffold a multi-model project structure
- Web UI: Model Graph panel for visualizing cross-model dependencies and cross-model relationship badges in EntityPanel.
- API server: `/api/projects/:id/model-graph` endpoint for project-wide model dependency graph.

## 3. End-to-End Data Flow
1. User edits/imports YAML (single or multi-model project).
2. CLI/UI runs structural + semantic checks.
3. For multi-model projects, resolver builds unified graph from imports.
4. Canonical model is compiled for deterministic diff and generation.
5. Policy pack is evaluated for governance rules.
6. Outputs:
   - UI diagram + gate report (with cross-model annotations)
   - SQL/dbt/metadata artifacts
   - CI pass/fail result
   - Project-level diff reports

## 4. Non-Enterprise Prototype Boundaries
Excluded in this prototype scope:
- SSO/OIDC/SAML
- RBAC and workspace isolation services
- audit log service and approval workflow backend

These remain for the enterprise platform phase.
