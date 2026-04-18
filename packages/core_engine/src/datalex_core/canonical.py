from copy import deepcopy
from typing import Any, Dict, List

from datalex_core.modeling import normalize_model


def _sort_fields(fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(fields, key=lambda item: item.get("name", ""))


def _sort_entities(entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sorted_entities = []
    for entity in entities:
        cloned = deepcopy(entity)
        cloned["fields"] = _sort_fields(cloned.get("fields", []))
        if "grain" in cloned and isinstance(cloned["grain"], list):
            cloned["grain"] = sorted(cloned["grain"])
        if "tags" in cloned and isinstance(cloned["tags"], list):
            cloned["tags"] = sorted(cloned["tags"])
        if "subtypes" in cloned and isinstance(cloned["subtypes"], list):
            cloned["subtypes"] = sorted(cloned["subtypes"])
        if "dimension_refs" in cloned and isinstance(cloned["dimension_refs"], list):
            cloned["dimension_refs"] = sorted(cloned["dimension_refs"])
        if "link_refs" in cloned and isinstance(cloned["link_refs"], list):
            cloned["link_refs"] = sorted(cloned["link_refs"])
        if "partition_by" in cloned and isinstance(cloned["partition_by"], list):
            cloned["partition_by"] = sorted(cloned["partition_by"])
        if "cluster_by" in cloned and isinstance(cloned["cluster_by"], list):
            cloned["cluster_by"] = sorted(cloned["cluster_by"])
        if "hash_diff_fields" in cloned and isinstance(cloned["hash_diff_fields"], list):
            cloned["hash_diff_fields"] = sorted(cloned["hash_diff_fields"])
        if "candidate_keys" in cloned and isinstance(cloned["candidate_keys"], list):
            cloned["candidate_keys"] = sorted(
                [sorted(keyset) for keyset in cloned["candidate_keys"] if isinstance(keyset, list)],
                key=lambda item: tuple(item),
            )
        if "business_keys" in cloned and isinstance(cloned["business_keys"], list):
            cloned["business_keys"] = sorted(
                [sorted(keyset) for keyset in cloned["business_keys"] if isinstance(keyset, list)],
                key=lambda item: tuple(item),
            )
        sorted_entities.append(cloned)
    return sorted(sorted_entities, key=lambda item: item.get("name", ""))


def _sort_relationships(relationships: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        relationships,
        key=lambda item: (
            item.get("name", ""),
            item.get("from", ""),
            item.get("to", ""),
            item.get("cardinality", ""),
        ),
    )


def _sort_rules(rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(rules, key=lambda item: (item.get("name", ""), item.get("target", "")))


def _sort_indexes(indexes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        deepcopy(indexes),
        key=lambda item: (item.get("name", ""), item.get("entity", "")),
    )


def _sort_glossary(glossary: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sorted_terms = []
    for term in glossary:
        cloned = deepcopy(term)
        if "related_fields" in cloned and isinstance(cloned["related_fields"], list):
            cloned["related_fields"] = sorted(cloned["related_fields"])
        if "tags" in cloned and isinstance(cloned["tags"], list):
            cloned["tags"] = sorted(cloned["tags"])
        sorted_terms.append(cloned)
    return sorted(sorted_terms, key=lambda item: item.get("term", ""))


def _sort_metrics(metrics: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sorted_metrics = []
    for metric in metrics:
        cloned = deepcopy(metric)
        if "grain" in cloned and isinstance(cloned["grain"], list):
            cloned["grain"] = sorted(cloned["grain"])
        if "dimensions" in cloned and isinstance(cloned["dimensions"], list):
            cloned["dimensions"] = sorted(cloned["dimensions"])
        if "tags" in cloned and isinstance(cloned["tags"], list):
            cloned["tags"] = sorted(cloned["tags"])
        sorted_metrics.append(cloned)
    return sorted(sorted_metrics, key=lambda item: item.get("name", ""))


def _sort_domains(domains: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sorted_domains = []
    for domain in domains:
        cloned = deepcopy(domain)
        if "tags" in cloned and isinstance(cloned["tags"], list):
            cloned["tags"] = sorted(cloned["tags"])
        if "examples" in cloned and isinstance(cloned["examples"], list):
            cloned["examples"] = sorted(cloned["examples"], key=lambda item: str(item))
        sorted_domains.append(cloned)
    return sorted(sorted_domains, key=lambda item: item.get("name", ""))


def _sort_enums(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sorted_enums = []
    for item in items:
        cloned = deepcopy(item)
        if "values" in cloned and isinstance(cloned["values"], list):
            cloned["values"] = sorted(cloned["values"])
        sorted_enums.append(cloned)
    return sorted(sorted_enums, key=lambda item: item.get("name", ""))


def _sort_templates(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sorted_templates = []
    for item in items:
        cloned = deepcopy(item)
        cloned["fields"] = _sort_fields(cloned.get("fields", []))
        if "tags" in cloned and isinstance(cloned["tags"], list):
            cloned["tags"] = sorted(cloned["tags"])
        sorted_templates.append(cloned)
    return sorted(sorted_templates, key=lambda item: item.get("name", ""))


def _sort_subject_areas(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(deepcopy(items), key=lambda item: item.get("name", ""))


def compile_model(model: Dict[str, Any]) -> Dict[str, Any]:
    model = normalize_model(model)
    canonical: Dict[str, Any] = {
        "model": deepcopy(model.get("model", {})),
        "entities": _sort_entities(model.get("entities", [])),
        "relationships": _sort_relationships(model.get("relationships", [])),
        "indexes": _sort_indexes(model.get("indexes", [])),
        "rules": _sort_rules(model.get("rules", [])),
        "metrics": _sort_metrics(model.get("metrics", [])),
    }

    governance = deepcopy(model.get("governance", {}))
    classification = governance.get("classification")
    if isinstance(classification, dict):
        governance["classification"] = {
            key: classification[key] for key in sorted(classification.keys())
        }
    stewards = governance.get("stewards")
    if isinstance(stewards, dict):
        governance["stewards"] = {key: stewards[key] for key in sorted(stewards.keys())}

    canonical["governance"] = governance
    canonical["glossary"] = _sort_glossary(model.get("glossary", []))
    canonical["domains"] = _sort_domains(model.get("domains", []))
    canonical["enums"] = _sort_enums(model.get("enums", []))
    canonical["templates"] = _sort_templates(model.get("templates", []))
    canonical["subject_areas"] = _sort_subject_areas(model.get("subject_areas", []))
    canonical["naming_rules"] = deepcopy(model.get("naming_rules", {}))
    canonical["display"] = deepcopy(model.get("display", {}))

    owners = canonical["model"].get("owners")
    if isinstance(owners, list):
        canonical["model"]["owners"] = sorted(owners)

    return canonical
