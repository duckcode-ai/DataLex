# Changelog

All notable changes to the manifest spec will be documented here. Versions
follow SemVer and the policy in [versioning.md](versioning.md).

## [Unreleased]

### Added (backward compatible — new optional fields, no consumer changes required)
- DataLex manifest: top-level `relationships[]` — typed cross-entity relationships
  (`from`/`to` endpoints with optional join columns, `cardinality`, `layer`, `type`)
  so consumers can plan grain-safe and cross-domain joins.
- DataLex manifest: top-level `conformance[]` — concept-to-physical conformance
  records (`canonical_key`, `business_key`, `implements`, realizing `physical`
  models) that let a consumer treat several physical tables as one business entity.
- `$defs` for `relationship`, `relationshipEndpoint`, and `conformance`.

### Producers
- DataLex (1.12.x and later) emits `relationships[]` and `conformance[]` when the
  project models them (`relationship` docs + entity `logical`/`implements` back-refs
  and `business_keys`/`candidate_keys`).

### Consumers
- DQL `DataLexContractRegistry` (dql-core 1.6.x and later) indexes relationships +
  conformance and exposes `relationships()`, `conformance()`, `conformanceFor()`,
  and `joinPath()` — grain-safe join orientation with fan-out detection for
  Tier-2 cross-domain SQL generation.

## [1.0.0] - 2026-05-01

Initial public release.

### Added
- DataLex manifest schema covering domains, entities, contracts, governance,
  and rules at conceptual / logical / physical layers.
- DQL manifest schema covering blocks, apps, dashboards, lineage edges, and
  certification status.
- Cross-reference contract: DQL blocks declare `datalex_contract` to bind to
  a DataLex contract id. DQL compilers SHOULD enforce this at compile time
  starting at DQL 1.6.x.
- [`interop.md`](interop.md) describing the bridge.
- [`versioning.md`](versioning.md) describing the breaking-change discipline.
- Minimal example manifests for both languages.

### Producers
- DataLex 1.8.x emits manifests validated against `v1`.
- DQL 1.5.x emits manifests validated against `v1`.
