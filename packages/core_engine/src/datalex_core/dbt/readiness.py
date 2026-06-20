"""Enterprise dbt adoption assessment for DataLex.

This is the high-level inventory that answers: what can DataLex adopt from an
existing dbt repo, where do contracts already exist, and where should AI propose
contract/domain/metric enhancements next?
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


_MART_RE = re.compile(r"(^fct_|^dim_|mart|marts|presentation|report)", re.IGNORECASE)
_FACT_RE = re.compile(r"(^fct_|fact|_fact$|mart|marts)", re.IGNORECASE)


def assess_manifest(manifest_path: str) -> Dict[str, Any]:
    """Assess an existing dbt manifest for enterprise DataLex adoption."""
    with open(manifest_path, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)
    return assess_manifest_dict(manifest, manifest_path=manifest_path)


def assess_manifest_dict(manifest: Dict[str, Any], *, manifest_path: str = "") -> Dict[str, Any]:
    nodes = manifest.get("nodes") or {}
    metrics = manifest.get("metrics") or {}
    semantic_models = manifest.get("semantic_models") or {}
    exposures = manifest.get("exposures") or {}
    test_index = _build_test_index(nodes)
    exposure_index = _build_exposure_index(exposures)
    semantic_metric_names = sorted(_metric_names(metrics, semantic_models))

    domains: Dict[str, Dict[str, Any]] = {}
    opportunities: List[Dict[str, Any]] = []

    totals = {
        "models": 0,
        "contracted_models": 0,
        "missing_contracts": 0,
        "semantic_metrics": len(semantic_metric_names),
        "semantic_models": len(semantic_models),
        "exposures": len(exposures),
        "domains_detected": 0,
        "high_value_marts": 0,
        "missing_owners": 0,
        "missing_descriptions": 0,
        "unclear_grain": 0,
        "relationship_gaps": 0,
    }

    for uid, node in sorted(nodes.items()):
        if node.get("resource_type") != "model":
            continue
        totals["models"] += 1
        name = str(node.get("name") or uid.rsplit(".", 1)[-1])
        domain_name = _domain_of(node)
        domain = domains.setdefault(domain_name, _empty_domain(domain_name))
        domain["models"] += 1

        contracted = _contract_enforced(node)
        high_value = _is_high_value_model(node)
        owner_missing = not _owner_of(node)
        desc_missing = not str(node.get("description") or "").strip()
        grain_missing = _grain_missing(node)
        relationship_gaps = _relationship_gaps(node, test_index.get(uid, {}))
        exposure_count = len(exposure_index.get(uid, []))

        if contracted:
            totals["contracted_models"] += 1
            domain["contracted_models"] += 1
        else:
            totals["missing_contracts"] += 1
            domain["missing_contracts"] += 1
        if high_value:
            totals["high_value_marts"] += 1
            domain["high_value_marts"] += 1
        if owner_missing:
            totals["missing_owners"] += 1
            domain["gaps"].append("missing_owner")
        if desc_missing:
            totals["missing_descriptions"] += 1
            domain["gaps"].append("missing_description")
        if grain_missing:
            totals["unclear_grain"] += 1
            domain["gaps"].append("unclear_grain")
        if relationship_gaps:
            totals["relationship_gaps"] += relationship_gaps
            domain["gaps"].append("relationship_gaps")
        if exposure_count:
            domain["exposures"] += exposure_count

        if not contracted and (high_value or exposure_count or semantic_metric_names):
            opportunities.append(
                _contract_opportunity(
                    node,
                    unique_id=uid,
                    domain=domain_name,
                    reason=_opportunity_reason(high_value, exposure_count, semantic_metric_names),
                    test_names=sorted(_tests_for_model(test_index.get(uid, {}))),
                    semantic_metrics=semantic_metric_names[:20],
                )
            )

    for metric_name in semantic_metric_names:
        domain = domains.setdefault("semantic", _empty_domain("semantic"))
        domain["semantic_metrics"] += 1

    totals["domains_detected"] = len(domains)
    domain_rows = []
    for domain in domains.values():
        domain["gaps"] = sorted(set(domain["gaps"]))
        domain_rows.append(domain)

    opportunities.sort(
        key=lambda item: (
            0 if item.get("maturity") == "high_value" else 1,
            item.get("domain") or "",
            item.get("model") or "",
        )
    )

    return {
        "ok": True,
        "manifestPath": str(Path(manifest_path).resolve()) if manifest_path else "",
        "project": {
            "name": (manifest.get("metadata") or {}).get("project_name") or "dbt_project",
            "adapter": (manifest.get("metadata") or {}).get("adapter_type") or "",
        },
        "totals": totals,
        "domains": sorted(domain_rows, key=lambda row: row["name"]),
        "contract_opportunities": opportunities[:100],
        "flow": [
            "Connect dbt repo",
            "Adopt existing dbt contracts",
            "AI proposes missing contracts and business context",
            "Review and certify",
            "Build datalex-manifest.json for DQL",
        ],
    }


def _empty_domain(name: str) -> Dict[str, Any]:
    return {
        "name": name,
        "models": 0,
        "contracted_models": 0,
        "missing_contracts": 0,
        "semantic_metrics": 0,
        "exposures": 0,
        "high_value_marts": 0,
        "gaps": [],
    }


def _domain_of(node: Dict[str, Any]) -> str:
    cfg = node.get("config") if isinstance(node.get("config"), dict) else {}
    cfg_meta = cfg.get("meta") if isinstance(cfg.get("meta"), dict) else {}
    meta = node.get("meta") if isinstance(node.get("meta"), dict) else {}
    value = (
        node.get("domain")
        or meta.get("domain")
        or meta.get("subject_area")
        or cfg_meta.get("domain")
        or node.get("group")
        or _domain_from_path(node.get("original_file_path") or node.get("path"))
        or "core"
    )
    return _safe_domain(value)


def _domain_from_path(path: Any) -> Optional[str]:
    parts = [p for p in str(path or "").replace("\\", "/").split("/") if p]
    if "marts" in parts:
        idx = parts.index("marts")
        if idx + 1 < len(parts):
            return parts[idx + 1]
    if "models" in parts and len(parts) > parts.index("models") + 1:
        return parts[parts.index("models") + 1]
    return None


def _safe_domain(value: Any) -> str:
    text = str(value or "core").strip().lower()
    text = re.sub(r"[^a-z0-9_]+", "_", text).strip("_")
    return text or "core"


def _owner_of(node: Dict[str, Any]) -> str:
    cfg = node.get("config") if isinstance(node.get("config"), dict) else {}
    cfg_meta = cfg.get("meta") if isinstance(cfg.get("meta"), dict) else {}
    meta = node.get("meta") if isinstance(node.get("meta"), dict) else {}
    raw = node.get("owner") or meta.get("owner") or cfg_meta.get("owner")
    if isinstance(raw, dict):
        return str(raw.get("email") or raw.get("name") or "").strip()
    return str(raw or "").strip()


def _contract_enforced(node: Dict[str, Any]) -> bool:
    cfg = node.get("config") if isinstance(node.get("config"), dict) else {}
    contract = node.get("contract") if isinstance(node.get("contract"), dict) else {}
    cfg_contract = cfg.get("contract") if isinstance(cfg.get("contract"), dict) else {}
    return bool(contract.get("enforced") or cfg_contract.get("enforced"))


def _is_high_value_model(node: Dict[str, Any]) -> bool:
    name = str(node.get("name") or "")
    path = str(node.get("original_file_path") or node.get("path") or "")
    tags = " ".join(str(t) for t in (node.get("tags") or []))
    materialized = str((node.get("config") or {}).get("materialized") or "")
    return bool(_MART_RE.search(" ".join([name, path, tags, materialized])))


def _grain_missing(node: Dict[str, Any]) -> bool:
    meta = node.get("meta") if isinstance(node.get("meta"), dict) else {}
    cfg = node.get("config") if isinstance(node.get("config"), dict) else {}
    cfg_meta = cfg.get("meta") if isinstance(cfg.get("meta"), dict) else {}
    if node.get("grain") or meta.get("grain") or cfg_meta.get("grain"):
        return False
    return bool(_FACT_RE.search(str(node.get("name") or "")))


def _build_test_index(nodes: Dict[str, Any]) -> Dict[str, Dict[str, List[str]]]:
    out: Dict[str, Dict[str, List[str]]] = {}
    for node in nodes.values():
        if node.get("resource_type") != "test":
            continue
        parent = node.get("attached_node") or _first_model_dependency(node)
        column = node.get("column_name")
        test_name = ((node.get("test_metadata") or {}).get("name")) or node.get("name")
        if parent and column and test_name:
            out.setdefault(parent, {}).setdefault(str(column), []).append(str(test_name))
    return out


def _first_model_dependency(node: Dict[str, Any]) -> str:
    for dep in ((node.get("depends_on") or {}).get("nodes") or []):
        if str(dep).startswith(("model.", "source.")):
            return str(dep)
    return ""


def _relationship_gaps(node: Dict[str, Any], tests_by_column: Dict[str, List[str]]) -> int:
    gaps = 0
    columns = node.get("columns") or {}
    column_values = columns.values() if isinstance(columns, dict) else columns
    for column in column_values or []:
        name = str((column or {}).get("name") or "")
        if not name.endswith("_id") or name == "id":
            continue
        tests = {t.lower() for t in tests_by_column.get(name, [])}
        if "relationships" not in tests:
            gaps += 1
    return gaps


def _tests_for_model(tests_by_column: Dict[str, List[str]]) -> Iterable[str]:
    for tests in tests_by_column.values():
        yield from tests


def _metric_names(metrics: Dict[str, Any], semantic_models: Dict[str, Any]) -> List[str]:
    out = set()
    for metric in metrics.values():
        if metric.get("name"):
            out.add(str(metric["name"]))
    for sm in semantic_models.values():
        for measure in sm.get("measures") or []:
            if isinstance(measure, dict) and measure.get("name"):
                out.add(str(measure["name"]))
        for metric in sm.get("metrics") or []:
            if isinstance(metric, dict) and metric.get("name"):
                out.add(str(metric["name"]))
    return sorted(out)


def _build_exposure_index(exposures: Dict[str, Any]) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {}
    for exposure in exposures.values():
        name = str(exposure.get("name") or "")
        for dep in ((exposure.get("depends_on") or {}).get("nodes") or []):
            if str(dep).startswith("model."):
                out.setdefault(str(dep), []).append(name)
    return out


def _opportunity_reason(high_value: bool, exposure_count: int, semantic_metrics: List[str]) -> str:
    if high_value:
        return "high-value mart or presentation model without an enforced dbt contract"
    if exposure_count:
        return "downstream exposure depends on this model but no dbt contract is enforced"
    if semantic_metrics:
        return "semantic metrics exist in the project but this model has no enforced dbt contract"
    return "model has no enforced dbt contract"


def _contract_opportunity(
    node: Dict[str, Any],
    *,
    unique_id: str,
    domain: str,
    reason: str,
    test_names: List[str],
    semantic_metrics: List[str],
) -> Dict[str, Any]:
    columns = node.get("columns") or {}
    column_values = list(columns.values()) if isinstance(columns, dict) else list(columns or [])
    return {
        "model": node.get("name") or unique_id.rsplit(".", 1)[-1],
        "unique_id": unique_id,
        "domain": domain,
        "maturity": "high_value" if _is_high_value_model(node) else "candidate",
        "reason": reason,
        "evidence": {
            "source_models": [unique_id],
            "columns": [str(c.get("name")) for c in column_values if isinstance(c, dict) and c.get("name")][:30],
            "tests": test_names[:30],
            "semantic_metrics": semantic_metrics[:30],
            "inferred_grain": _infer_grain(node, column_values),
            "assumptions": [
                "dbt remains the source of truth for physical contract enforcement",
                "DataLex proposal should stay draft until reviewed by the owning data team",
            ],
            "confidence": 0.7 if _is_high_value_model(node) else 0.55,
            "open_questions": [
                "Which owner certifies this contract?",
                "What is the exact row grain and accepted downstream use?",
            ],
        },
    }


def _infer_grain(node: Dict[str, Any], columns: List[Dict[str, Any]]) -> str:
    meta = node.get("meta") if isinstance(node.get("meta"), dict) else {}
    if node.get("grain"):
        return str(node["grain"])
    if meta.get("grain"):
        return str(meta["grain"])
    for column in columns:
        name = str((column or {}).get("name") or "")
        if name.endswith("_id"):
            return f"one row per {name}"
    return ""
