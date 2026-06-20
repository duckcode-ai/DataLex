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
    datalex_version: str = "1.10.0",
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
