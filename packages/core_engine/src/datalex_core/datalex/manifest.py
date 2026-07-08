"""DataLex manifest builder for DQL and agent consumers.

The DataLex project tree is optimized for authoring and review. This module
compiles that tree into the public `datalex-manifest.json` contract surface:
domains, entities, fields, glossary, and certified contracts only.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from datalex_core.datalex.project import DataLexProject

MANIFEST_SPEC_VERSION = "1.0.0"


def build_manifest(
    project: DataLexProject,
    *,
    datalex_version: str = "1.11.0",
    manifest_spec_version: str = MANIFEST_SPEC_VERSION,
) -> Dict[str, Any]:
    """Compile a loaded DataLexProject into the v1 manifest shape.

    Draft/review/rejected contracts are intentionally excluded. They remain
    review artifacts until a human marks them `status: certified`.
    """
    domains: Dict[str, Dict[str, Any]] = {}

    def ensure_domain(name: str) -> Dict[str, Any]:
        key = _snake(name or "core")
        if key not in domains:
            source = project.domains.get(key) or {}
            domains[key] = {
                "name": key,
                "entities": [],
            }
            if source.get("description"):
                domains[key]["description"] = source["description"]
            owners = _owners(source)
            if owners:
                domains[key]["owners"] = owners
        return domains[key]

    entity_index: Dict[str, Dict[str, Any]] = {}

    for entity in _sorted_docs(project.entities.values()):
        domain_name = _domain_of(entity)
        domain = ensure_domain(domain_name)
        manifest_entity = _entity_to_manifest(entity)
        domain["entities"].append(manifest_entity)
        entity_index[_entity_key(domain_name, manifest_entity["name"])] = manifest_entity
        entity_index[_entity_key(domain_name, entity.get("name") or "")] = manifest_entity

    for model in _sorted_docs(project.models.values()):
        domain_name = _domain_of(model)
        domain = ensure_domain(domain_name)
        entity_name = _entity_display_name(model.get("name") or "Model")
        key = _entity_key(domain_name, entity_name)
        if key in entity_index:
            continue
        manifest_entity = _model_to_manifest_entity(model, entity_name)
        domain["entities"].append(manifest_entity)
        entity_index[key] = manifest_entity
        entity_index[_entity_key(domain_name, model.get("name") or "")] = manifest_entity

    for term in _sorted_docs(project.terms.values()):
        domain_name = _domain_of(term)
        domain = ensure_domain(domain_name)
        glossary = domain.setdefault("glossary", [])
        glossary.append(
            {
                "term": term.get("name") or term.get("term") or "",
                "definition": term.get("definition") or term.get("description") or "",
                **({"tags": term.get("tags")} if term.get("tags") else {}),
                # Business vocabulary -> physical column links, and term metadata.
                # dql's metadata catalog already consumes `related_fields` (term ->
                # Entity.field) for grounding; abbreviation/owner enrich the glossary.
                **({"related_fields": term.get("related_fields")} if term.get("related_fields") else {}),
                **({"abbreviation": term.get("abbreviation")} if term.get("abbreviation") else {}),
                **({"owner": term.get("owner")} if term.get("owner") else {}),
            }
        )

    for metric in _sorted_docs(project.metric_contracts.values()):
        status = str(metric.get("status") or "").lower()
        if status != "certified":
            continue
        domain_name = _domain_of(metric)
        domain = ensure_domain(domain_name)
        domain.setdefault("metrics", []).append(_metric_contract_to_manifest(metric, domain_name))

    diagnostics: List[Dict[str, Any]] = []
    for contract in _sorted_docs(project.contracts.values()):
        status = str(contract.get("status") or "").lower()
        if status != "certified":
            continue
        domain_name = _domain_of(contract)
        domain = ensure_domain(domain_name)
        entity_name = _entity_display_name(contract.get("entity") or contract.get("model") or "Entity")
        entity = entity_index.get(_entity_key(domain_name, entity_name)) or entity_index.get(
            _entity_key(domain_name, contract.get("entity") or "")
        )
        if entity is None:
            entity = {
                "name": entity_name,
                "contracts": [],
            }
            source = contract.get("source") or {}
            if isinstance(source, dict) and source.get("kind") and source.get("ref"):
                entity["binding"] = {"kind": source["kind"], "ref": source["ref"]}
            domain["entities"].append(entity)
            entity_index[_entity_key(domain_name, entity_name)] = entity

        manifest_contract = _contract_to_manifest(contract, domain_name, entity_name)
        entity.setdefault("contracts", []).append(manifest_contract)

    for err in project.errors.to_list():
        severity = str(err.get("severity") or "error").lower()
        diagnostics.append(
            {
                "severity": "warning" if severity == "warn" else severity,
                "message": err.get("message") or "",
                "code": err.get("code") or "DATALEX_LOAD",
                "path": err.get("file") or err.get("path"),
            }
        )

    manifest_project = project.manifest or {}
    payload: Dict[str, Any] = {
        "manifestSpecVersion": manifest_spec_version,
        "datalexVersion": datalex_version,
        "generatedAt": datetime.now(tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "project": {
            "name": manifest_project.get("name") or project.root.name,
        },
        "domains": [_sort_domain(domain) for _, domain in sorted(domains.items())],
    }
    if manifest_project.get("description"):
        payload["project"]["description"] = manifest_project["description"]
    if manifest_project.get("default_dialect"):
        payload["project"]["dialect"] = manifest_project["default_dialect"]
    if manifest_project.get("owner"):
        payload["project"]["owners"] = [manifest_project["owner"]]
    relationships = _build_relationships(project)
    if relationships:
        payload["relationships"] = relationships
    conformance = _build_conformance(project)
    if conformance:
        payload["conformance"] = conformance
    if diagnostics:
        payload["diagnostics"] = diagnostics
    return payload


def manifest_summary(manifest: Dict[str, Any]) -> Dict[str, int]:
    domains = manifest.get("domains") if isinstance(manifest, dict) else []
    entity_count = 0
    contract_count = 0
    metric_count = 0
    for domain in domains or []:
        entities = domain.get("entities") or []
        entity_count += len(entities)
        metric_count += len(domain.get("metrics") or [])
        for entity in entities:
            contract_count += len(entity.get("contracts") or [])
    return {
        "domains": len(domains or []),
        "entities": entity_count,
        "contracts": contract_count,
        "metrics": metric_count,
        "relationships": len(manifest.get("relationships") or []),
        "conformance": len(manifest.get("conformance") or []),
        "diagnostics": len(manifest.get("diagnostics") or []),
    }


def _sorted_docs(values: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(values, key=lambda d: (str(d.get("domain") or ""), str(d.get("name") or "")))


def _snake(value: Any) -> str:
    text = str(value or "core").strip().lower()
    text = re.sub(r"[^a-z0-9_]+", "_", text)
    text = text.strip("_")
    if not text:
        return "core"
    if not re.match(r"^[a-z]", text):
        text = f"d_{text}"
    return text


def _entity_display_name(value: Any) -> str:
    text = str(value or "Entity").strip()
    if not text:
        return "Entity"
    if re.match(r"^[A-Z][A-Za-z0-9]*$", text):
        return text
    parts = [p for p in re.split(r"[^A-Za-z0-9]+", text) if p]
    if not parts:
        return "Entity"
    return "".join(part[:1].upper() + part[1:] for part in parts)


def _domain_of(doc: Dict[str, Any]) -> str:
    return _snake(doc.get("domain") or ((doc.get("meta") or {}).get("domain")) or "core")


def _owners(doc: Dict[str, Any]) -> List[str]:
    owners: List[str] = []
    raw = doc.get("owners") or doc.get("owner")
    if isinstance(raw, str) and raw.strip():
        owners.append(raw.strip())
    elif isinstance(raw, list):
        owners.extend(str(o).strip() for o in raw if str(o).strip())
    return owners


def _entity_key(domain: str, entity: Any) -> str:
    return f"{_snake(domain)}::{str(entity or '').lower()}"


def _entity_to_manifest(entity: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "name": _entity_display_name(entity.get("logical_name") or entity.get("name")),
    }
    if entity.get("description"):
        out["description"] = entity["description"]
    if entity.get("tags"):
        out["tags"] = entity["tags"]
    fields = [_field_to_manifest(c) for c in (entity.get("columns") or entity.get("fields") or [])]
    if fields:
        out["fields"] = fields
    if entity.get("physical_name"):
        out["binding"] = {"kind": "table", "ref": entity["physical_name"]}
    return out


def _model_to_manifest_entity(model: Dict[str, Any], entity_name: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {"name": entity_name}
    if model.get("description"):
        out["description"] = model["description"]
    if model.get("tags"):
        out["tags"] = model["tags"]
    fields = [_field_to_manifest(c) for c in (model.get("columns") or [])]
    if fields:
        out["fields"] = fields
    unique_id = (((model.get("meta") or {}).get("datalex") or {}).get("dbt") or {}).get("unique_id")
    out["binding"] = {"kind": "dbt_model", "ref": unique_id or model.get("name")}
    return out


def _field_to_manifest(column: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"name": column.get("name") or "field"}
    if column.get("type") or column.get("data_type"):
        out["type"] = column.get("type") or column.get("data_type")
    if column.get("description"):
        out["description"] = column["description"]
    if column.get("primary_key"):
        out["primary_key"] = True
    if column.get("nullable") is not None:
        out["nullable"] = column["nullable"]
    if column.get("unique"):
        out["unique"] = True
    if column.get("tags"):
        out["tags"] = column["tags"]
    if column.get("classification") or column.get("sensitivity"):
        out["classification"] = column.get("classification") or column.get("sensitivity")
    return out


def _contract_to_manifest(contract: Dict[str, Any], domain: str, entity_name: str) -> Dict[str, Any]:
    contract_id = contract.get("id") or f"{_snake(domain)}.{_entity_display_name(entity_name)}.{contract.get('name')}"
    out: Dict[str, Any] = {
        "id": contract_id,
        "name": contract.get("display_name") or contract.get("name") or contract_id.rsplit(".", 1)[-1],
        "version": int(contract.get("version") or 1),
    }
    for key in ("description", "owner", "tags", "signature"):
        if contract.get(key):
            out[key] = contract[key]
    if contract.get("business_definition") and "description" not in out:
        out["description"] = contract["business_definition"]
    for key in ("grain", "source", "dbt_contract", "evidence", "metrics", "dimensions", "required_tests", "review"):
        if contract.get(key):
            out[key] = contract[key]
    return out


def _metric_contract_to_manifest(metric: Dict[str, Any], domain: str) -> Dict[str, Any]:
    metric_id = metric.get("id") or f"{_snake(domain)}.metric.{_snake(metric.get('name'))}"
    out: Dict[str, Any] = {
        "id": metric_id,
        "name": metric.get("display_name") or metric.get("name") or metric_id.rsplit(".", 1)[-1],
    }
    for key in (
        "description",
        "owner",
        "formula",
        "grain",
        "time_dimension",
        "dependencies",
        "dimensions",
        "source",
        "evidence",
        "tags",
    ):
        if metric.get(key):
            out[key] = metric[key]
    return out


def _build_relationships(project: DataLexProject) -> List[Dict[str, Any]]:
    """Export typed relationships (with cardinality) so agents can plan grain-safe
    joins. Endpoints are resolved to the manifest's domain + display-name convention
    so a relationship lines up with the entities/contracts a consumer already resolved.
    Relationships whose endpoints can't be resolved at their layer are skipped.
    """
    out: List[Dict[str, Any]] = []
    for rel in sorted(project.relationships.values(), key=lambda r: str(r.get("name") or "")):
        layer = str(rel.get("layer") or "physical")
        endpoints: Dict[str, Dict[str, Any]] = {}
        ok = True
        for side in ("from", "to"):
            ep = rel.get(side)
            if not isinstance(ep, dict) or not ep.get("entity"):
                ok = False
                break
            ent = project.entities.get(f"{layer}:{ep['entity']}")
            resolved: Dict[str, Any] = {
                "domain": _domain_of(ent) if ent else "core",
                "entity": _entity_display_name((ent or {}).get("logical_name") or ep["entity"]),
            }
            if ep.get("column"):
                resolved["column"] = ep["column"]
            if ep.get("role"):
                resolved["role"] = ep["role"]
            endpoints[side] = resolved
        if not ok:
            continue
        item: Dict[str, Any] = {
            "name": rel.get("name"),
            "type": rel.get("type") or "reference",
            "layer": layer,
            "from": endpoints["from"],
            "to": endpoints["to"],
        }
        for key in ("cardinality", "verb", "role_name", "description"):
            if rel.get(key):
                item[key] = rel[key]
        for key in ("optional", "identifying"):
            if isinstance(rel.get(key), bool):
                item[key] = rel[key]
        out.append(item)
    return out


def _concept_keys(entity: Dict[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    candidate = entity.get("candidate_keys") or []
    business = entity.get("business_keys") or []
    if candidate and isinstance(candidate[0], list):
        out["canonical_key"] = [str(c) for c in candidate[0]]
    if business and isinstance(business[0], list):
        out["business_key"] = [str(c) for c in business[0]]
    return out


def _physical_canonical_key(entity: Dict[str, Any]) -> Optional[List[str]]:
    """Canonical join key for a physical entity standing on its own: primary-key
    columns, else a declared unique_key, else the first candidate-key set."""
    cols = entity.get("columns") or []
    pk = [c.get("name") for c in cols if isinstance(c, dict) and c.get("primary_key") and c.get("name")]
    if pk:
        return [str(c) for c in pk]
    uk = entity.get("unique_key")
    if isinstance(uk, str) and uk:
        return [uk]
    if isinstance(uk, list) and uk:
        return [str(x) for x in uk]
    cks = entity.get("candidate_keys")
    if isinstance(cks, list) and cks and isinstance(cks[0], list) and cks[0]:
        return [str(x) for x in cks[0]]
    return None


def _build_conformance(project: DataLexProject) -> List[Dict[str, Any]]:
    """Export entity conformance: one record per business concept with its canonical
    key and the physical models that realize it. This is what lets an agent treat
    several physical tables as the same entity and join them on a stable key.
    """
    physical_by_logical: Dict[str, List[Dict[str, Any]]] = {}
    for key, ent in project.entities.items():
        if not key.startswith("physical:"):
            continue
        logical_name = ent.get("logical")
        if logical_name:
            physical_by_logical.setdefault(str(logical_name), []).append(ent)

    concept_names = {
        key.split(":", 1)[1] for key in project.entities if key.startswith("logical:")
    }
    concept_names.update(physical_by_logical.keys())

    out: List[Dict[str, Any]] = []
    for name in sorted(concept_names):
        concept = project.entities.get(f"logical:{name}") or project.entities.get(
            f"conceptual:{name}"
        )
        physical = sorted(
            physical_by_logical.get(name, []), key=lambda e: str(e.get("name") or "")
        )
        keys = _concept_keys(concept) if concept else {}
        canonical = keys.get("canonical_key")
        if not canonical and physical:
            pk = [c.get("name") for c in (physical[0].get("columns") or []) if c.get("primary_key")]
            if pk:
                canonical = [str(c) for c in pk]
        if not canonical and not physical:
            continue
        record: Dict[str, Any] = {
            "concept": _entity_display_name((concept or {}).get("logical_name") or name),
            "domain": _domain_of(concept)
            if concept
            else (_domain_of(physical[0]) if physical else "core"),
            "layer": "logical" if project.entities.get(f"logical:{name}") else "conceptual",
        }
        if canonical:
            record["canonical_key"] = canonical
        if keys.get("business_key"):
            record["business_key"] = keys["business_key"]
        implements = (concept or {}).get("implements")
        if implements:
            record["implements"] = [str(i) for i in implements]
        physical_out: List[Dict[str, Any]] = []
        for p in physical:
            entry: Dict[str, Any] = {
                "entity": _entity_display_name(p.get("logical_name") or p.get("name"))
            }
            if p.get("physical_name"):
                entry["binding"] = {"kind": "table", "ref": p["physical_name"]}
            physical_out.append(entry)
        if physical_out:
            record["physical"] = physical_out
        out.append(record)

    # Physical-anchored conformance: a physical entity not tied to a logical concept
    # (a diagram-only / physical-first model, e.g. dbt tables modeled directly) still
    # anchors a joinable concept on its own key + table binding, so agents can plan
    # grain-safe joins on the real tables even when the logical<->physical link wasn't
    # authored. Entities already realized under a logical concept are skipped.
    linked = {id(e) for ents in physical_by_logical.values() for e in ents}
    for key, ent in sorted(project.entities.items()):
        if not key.startswith("physical:") or ent.get("logical") or id(ent) in linked:
            continue
        canonical = _physical_canonical_key(ent)
        physical_name = ent.get("physical_name") or ent.get("name")
        if not canonical or not physical_name:
            continue
        concept = _entity_display_name(ent.get("logical_name") or ent.get("name"))
        out.append({
            "concept": concept,
            "domain": _domain_of(ent),
            "layer": "physical",
            "canonical_key": canonical,
            "physical": [{"entity": concept, "binding": {"kind": "table", "ref": physical_name}}],
        })
    return out


def _sort_domain(domain: Dict[str, Any]) -> Dict[str, Any]:
    domain["entities"] = sorted(domain.get("entities") or [], key=lambda e: e.get("name") or "")
    for entity in domain["entities"]:
        if entity.get("contracts"):
            entity["contracts"] = sorted(
                entity["contracts"],
                key=lambda c: (c.get("id") or "", c.get("version") or 0),
            )
        if entity.get("fields"):
            entity["fields"] = sorted(entity["fields"], key=lambda f: f.get("name") or "")
    if domain.get("glossary"):
        domain["glossary"] = sorted(domain["glossary"], key=lambda t: t.get("term") or "")
    if domain.get("metrics"):
        domain["metrics"] = sorted(domain["metrics"], key=lambda m: m.get("id") or m.get("name") or "")
    return domain
