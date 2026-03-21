from __future__ import annotations

from copy import deepcopy
import re
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from dm_core.issues import Issue

MODEL_KINDS = {"conceptual", "logical", "physical"}
DIMENSIONAL_ENTITY_TYPES = {"fact_table", "dimension_table", "bridge_table"}
DATA_VAULT_ENTITY_TYPES = {"hub", "link", "satellite"}
LOGICAL_ENTITY_TYPES = {"concept", "logical_entity"} | DIMENSIONAL_ENTITY_TYPES | DATA_VAULT_ENTITY_TYPES
PHYSICAL_ENTITY_TYPES = {
    "table",
    "view",
    "materialized_view",
    "external_table",
    "snapshot",
    *DIMENSIONAL_ENTITY_TYPES,
    *DATA_VAULT_ENTITY_TYPES,
}
SUPPORTED_NAMING_STYLES = {"pascal_case", "snake_case", "lower_snake_case", "upper_snake_case"}


def _clone(model: Dict[str, Any]) -> Dict[str, Any]:
    return deepcopy(model) if isinstance(model, dict) else {}


def _to_snake(text: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", str(text or "").strip())
    cleaned = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", cleaned)
    cleaned = re.sub(r"__+", "_", cleaned).strip("_").lower()
    if not cleaned:
        return ""
    if cleaned[0].isdigit():
        cleaned = f"f_{cleaned}"
    return cleaned


def _to_pascal(text: str) -> str:
    parts = re.split(r"[^A-Za-z0-9]+", str(text or "").strip())
    joined = "".join(p[:1].upper() + p[1:] for p in parts if p)
    return joined or "Entity"


def _to_upper_snake(text: str) -> str:
    return _to_snake(text).upper()


def _merge_unique_strings(*values: Iterable[str]) -> List[str]:
    seen: Set[str] = set()
    merged: List[str] = []
    for collection in values:
        if not isinstance(collection, list):
            continue
        for item in collection:
            value = str(item or "").strip()
            if not value or value in seen:
                continue
            seen.add(value)
            merged.append(value)
    return merged


def infer_model_kind(model: Dict[str, Any]) -> str:
    meta = model.get("model", {})
    declared = str(meta.get("kind") or "").strip().lower()
    if declared in MODEL_KINDS:
        return declared

    entity_types = {
        str(entity.get("type") or "").strip().lower()
        for entity in model.get("entities", [])
        if isinstance(entity, dict)
    }
    if "concept" in entity_types:
        return "conceptual"
    if "logical_entity" in entity_types:
        return "logical"
    return "physical"


def _has_v3_sections(model: Dict[str, Any]) -> bool:
    return any(
        model.get(key)
        for key in ("domains", "enums", "templates", "naming_rules", "subject_areas")
    )


def _coerce_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _coerce_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _templates_map(model: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    items = {}
    for template in _coerce_list(model.get("templates")):
        if not isinstance(template, dict):
            continue
        name = str(template.get("name") or "").strip()
        if name:
            items[name] = template
    return items


def _domains_map(model: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    items = {}
    for domain in _coerce_list(model.get("domains")):
        if not isinstance(domain, dict):
            continue
        name = str(domain.get("name") or "").strip()
        if name:
            items[name] = domain
    return items


def _template_names(entity: Dict[str, Any]) -> List[str]:
    names = []
    single = str(entity.get("template") or "").strip()
    if single:
        names.append(single)
    names.extend(
        str(item or "").strip()
        for item in _coerce_list(entity.get("templates"))
        if str(item or "").strip()
    )
    # preserve order while deduplicating
    return list(dict.fromkeys(names))


def _merge_template(entity: Dict[str, Any], template: Dict[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(entity)

    for key, value in _coerce_dict(template.get("entity_defaults")).items():
        merged.setdefault(key, deepcopy(value))

    merged["tags"] = _merge_unique_strings(template.get("tags"), merged.get("tags"))

    template_fields = [deepcopy(field) for field in _coerce_list(template.get("fields")) if isinstance(field, dict)]
    local_fields = [deepcopy(field) for field in _coerce_list(merged.get("fields")) if isinstance(field, dict)]
    local_by_name = {str(field.get("name") or ""): field for field in local_fields if field.get("name")}

    resolved_fields: List[Dict[str, Any]] = []
    for field in template_fields:
        name = str(field.get("name") or "")
        if name and name in local_by_name:
            override = deepcopy(local_by_name.pop(name))
            merged_field = deepcopy(field)
            merged_field.update(override)
            resolved_fields.append(merged_field)
        else:
            resolved_fields.append(field)
    resolved_fields.extend(local_by_name.values())
    if resolved_fields:
        merged["fields"] = resolved_fields

    return merged


def _apply_templates(model: Dict[str, Any]) -> None:
    templates = _templates_map(model)
    if not templates:
        return
    resolved_entities: List[Dict[str, Any]] = []
    for entity in _coerce_list(model.get("entities")):
        if not isinstance(entity, dict):
            continue
        merged = deepcopy(entity)
        for template_name in _template_names(entity):
            template = templates.get(template_name)
            if template:
                merged = _merge_template(merged, template)
        resolved_entities.append(merged)
    model["entities"] = resolved_entities


def _apply_domain_defaults(model: Dict[str, Any]) -> None:
    domains = _domains_map(model)
    if not domains:
        return

    for entity in _coerce_list(model.get("entities")):
        if not isinstance(entity, dict):
            continue
        fields = []
        for field in _coerce_list(entity.get("fields")):
            if not isinstance(field, dict):
                continue
            merged = deepcopy(field)
            domain_name = str(merged.get("domain") or "").strip()
            domain = domains.get(domain_name)
            if domain:
                if not merged.get("type") and domain.get("data_type"):
                    merged["type"] = domain.get("data_type")
                for key in ("nullable", "default", "check", "sensitivity", "description", "examples"):
                    if key not in merged and key in domain:
                        merged[key] = deepcopy(domain[key])
                merged["tags"] = _merge_unique_strings(domain.get("tags"), merged.get("tags"))
                if merged.get("enum") is None and domain.get("enum"):
                    merged["enum"] = domain.get("enum")
            fields.append(merged)
        entity["fields"] = fields


def normalize_model(model: Dict[str, Any]) -> Dict[str, Any]:
    normalized = _clone(model)
    meta = _coerce_dict(normalized.get("model"))
    normalized["model"] = meta
    meta["kind"] = infer_model_kind(normalized)

    if _has_v3_sections(normalized) or meta.get("kind") != "physical" or meta.get("spec_version") == 3:
        meta["spec_version"] = 3

    for key in ("entities", "relationships", "indexes", "glossary", "metrics", "rules", "domains", "enums", "templates", "subject_areas"):
        normalized[key] = _coerce_list(normalized.get(key))
    normalized["governance"] = _coerce_dict(normalized.get("governance"))
    normalized["display"] = _coerce_dict(normalized.get("display"))
    normalized["naming_rules"] = _coerce_dict(normalized.get("naming_rules"))

    _apply_templates(normalized)
    _apply_domain_defaults(normalized)

    return normalized


def _style_rule(naming_rules: Dict[str, Any], key: str) -> Tuple[str, str]:
    raw = naming_rules.get(key)
    if isinstance(raw, str):
        return raw, ""
    if isinstance(raw, dict):
        return str(raw.get("style") or "").strip().lower(), str(raw.get("pattern") or "").strip()
    return "", ""


def _matches_style(value: str, style: str) -> bool:
    if not value or not style:
        return True
    if style == "pascal_case":
        return bool(re.fullmatch(r"[A-Z][A-Za-z0-9]*", value))
    if style in {"snake_case", "lower_snake_case"}:
        return bool(re.fullmatch(r"[a-z][a-z0-9_]*", value))
    if style == "upper_snake_case":
        return bool(re.fullmatch(r"[A-Z][A-Z0-9_]*", value))
    return True


def _apply_style(value: str, style: str) -> str:
    if not style or not value:
        return value
    if style == "pascal_case":
        return _to_pascal(value)
    if style in {"snake_case", "lower_snake_case"}:
        return _to_snake(value)
    if style == "upper_snake_case":
        return _to_upper_snake(value)
    return value


def _rename_entity_refs(model: Dict[str, Any], entity_map: Dict[str, str], field_maps: Dict[str, Dict[str, str]]) -> None:
    if not entity_map and not field_maps:
        return

    def rewrite_ref(ref: str) -> str:
        if "." not in ref:
            return ref
        entity_name, field_name = ref.split(".", 1)
        next_entity = entity_map.get(entity_name, entity_name)
        next_field = field_maps.get(entity_name, {}).get(field_name, field_name)
        return f"{next_entity}.{next_field}"

    for relationship in _coerce_list(model.get("relationships")):
        relationship["from"] = rewrite_ref(str(relationship.get("from") or ""))
        relationship["to"] = rewrite_ref(str(relationship.get("to") or ""))

    governance = _coerce_dict(model.get("governance"))
    for map_name in ("classification", "stewards"):
        values = _coerce_dict(governance.get(map_name))
        rewritten = {}
        for key, value in values.items():
            rewritten[rewrite_ref(str(key))] = value
        governance[map_name] = rewritten

    for glossary in _coerce_list(model.get("glossary")):
        glossary["related_fields"] = [rewrite_ref(str(item)) for item in _coerce_list(glossary.get("related_fields"))]

    for index in _coerce_list(model.get("indexes")):
        entity_name = str(index.get("entity") or "")
        index["entity"] = entity_map.get(entity_name, entity_name)
        if entity_name in field_maps:
            index["fields"] = [field_maps[entity_name].get(str(name), str(name)) for name in _coerce_list(index.get("fields"))]

    for metric in _coerce_list(model.get("metrics")):
        entity_name = str(metric.get("entity") or "")
        metric["entity"] = entity_map.get(entity_name, entity_name)
        if entity_name in field_maps:
            mapping = field_maps[entity_name]
            metric["grain"] = [mapping.get(str(name), str(name)) for name in _coerce_list(metric.get("grain"))]
            metric["dimensions"] = [mapping.get(str(name), str(name)) for name in _coerce_list(metric.get("dimensions"))]
            if metric.get("time_dimension"):
                metric["time_dimension"] = mapping.get(str(metric.get("time_dimension")), str(metric.get("time_dimension")))

    for entity in _coerce_list(model.get("entities")):
        if not isinstance(entity, dict):
            continue
        if entity.get("subtype_of"):
            entity["subtype_of"] = entity_map.get(str(entity.get("subtype_of")), str(entity.get("subtype_of")))
        entity["subtypes"] = [entity_map.get(str(name), str(name)) for name in _coerce_list(entity.get("subtypes"))]
        entity["dimension_refs"] = [entity_map.get(str(name), str(name)) for name in _coerce_list(entity.get("dimension_refs"))]
        if entity.get("natural_key"):
            mapping = field_maps.get(str(entity.get("name") or ""), {})
            entity["natural_key"] = mapping.get(str(entity.get("natural_key")), str(entity.get("natural_key")))
        if entity.get("surrogate_key"):
            mapping = field_maps.get(str(entity.get("name") or ""), {})
            entity["surrogate_key"] = mapping.get(str(entity.get("surrogate_key")), str(entity.get("surrogate_key")))
        if entity.get("grain"):
            mapping = field_maps.get(str(entity.get("name") or ""), {})
            entity["grain"] = [mapping.get(str(name), str(name)) for name in _coerce_list(entity.get("grain"))]
        candidate_keys = []
        mapping = field_maps.get(str(entity.get("name") or ""), {})
        for keyset in _coerce_list(entity.get("candidate_keys")):
            candidate_keys.append([mapping.get(str(name), str(name)) for name in _coerce_list(keyset)])
        if candidate_keys:
            entity["candidate_keys"] = candidate_keys


def standards_issues(model: Dict[str, Any]) -> List[Issue]:
    normalized = normalize_model(model)
    issues: List[Issue] = []

    naming_rules = _coerce_dict(normalized.get("naming_rules"))
    domains = _domains_map(normalized)
    templates = _templates_map(normalized)
    subject_area_names = {
        str(item.get("name") or "").strip()
        for item in _coerce_list(normalized.get("subject_areas"))
        if isinstance(item, dict)
    }

    for entity in _coerce_list(normalized.get("entities")):
        if not isinstance(entity, dict):
            continue
        entity_name = str(entity.get("name") or "")
        entity_style, entity_pattern = _style_rule(naming_rules, "entity")
        if entity_style and not _matches_style(entity_name, entity_style):
            issues.append(Issue("warn", "ENTITY_NAMING_RULE", f"Entity '{entity_name}' does not match naming rule '{entity_style}'.", f"/entities/{entity_name}/name"))
        if entity_pattern and not re.fullmatch(entity_pattern, entity_name):
            issues.append(Issue("warn", "ENTITY_NAMING_PATTERN", f"Entity '{entity_name}' does not match configured pattern '{entity_pattern}'.", f"/entities/{entity_name}/name"))

        area = str(entity.get("subject_area") or "").strip()
        if area and subject_area_names and area not in subject_area_names:
            issues.append(Issue("warn", "SUBJECT_AREA_NOT_DEFINED", f"Entity '{entity_name}' references subject_area '{area}' which is not declared in subject_areas.", f"/entities/{entity_name}/subject_area"))

        for template_name in _template_names(entity):
            if template_name not in templates:
                issues.append(Issue("warn", "TEMPLATE_NOT_FOUND", f"Entity '{entity_name}' references missing template '{template_name}'.", f"/entities/{entity_name}/templates"))

        for field in _coerce_list(entity.get("fields")):
            if not isinstance(field, dict):
                continue
            field_name = str(field.get("name") or "")
            field_style, field_pattern = _style_rule(naming_rules, "field")
            if field_style and not _matches_style(field_name, field_style):
                issues.append(Issue("warn", "FIELD_NAMING_RULE", f"Field '{entity_name}.{field_name}' does not match naming rule '{field_style}'.", f"/entities/{entity_name}/fields/{field_name}/name"))
            if field_pattern and not re.fullmatch(field_pattern, field_name):
                issues.append(Issue("warn", "FIELD_NAMING_PATTERN", f"Field '{entity_name}.{field_name}' does not match configured pattern '{field_pattern}'.", f"/entities/{entity_name}/fields/{field_name}/name"))
            domain_name = str(field.get("domain") or "").strip()
            if domain_name and domain_name not in domains:
                issues.append(Issue("warn", "DOMAIN_NOT_FOUND", f"Field '{entity_name}.{field_name}' references missing domain '{domain_name}'.", f"/entities/{entity_name}/fields/{field_name}/domain"))

        physical_style, physical_pattern = _style_rule(naming_rules, "physical_name")
        physical_name = str(entity.get("physical_name") or "")
        if physical_name:
            if physical_style and not _matches_style(physical_name, physical_style):
                issues.append(Issue("warn", "PHYSICAL_NAME_RULE", f"physical_name '{physical_name}' does not match naming rule '{physical_style}'.", f"/entities/{entity_name}/physical_name"))
            if physical_pattern and not re.fullmatch(physical_pattern, physical_name):
                issues.append(Issue("warn", "PHYSICAL_NAME_PATTERN", f"physical_name '{physical_name}' does not match configured pattern '{physical_pattern}'.", f"/entities/{entity_name}/physical_name"))

    for relationship in _coerce_list(normalized.get("relationships")):
        name = str(relationship.get("name") or "")
        style, pattern = _style_rule(naming_rules, "relationship")
        if style and name and not _matches_style(name, style):
            issues.append(Issue("warn", "RELATIONSHIP_NAMING_RULE", f"Relationship '{name}' does not match naming rule '{style}'.", "/relationships"))
        if pattern and name and not re.fullmatch(pattern, name):
            issues.append(Issue("warn", "RELATIONSHIP_NAMING_PATTERN", f"Relationship '{name}' does not match configured pattern '{pattern}'.", "/relationships"))

    for index in _coerce_list(normalized.get("indexes")):
        name = str(index.get("name") or "")
        style, pattern = _style_rule(naming_rules, "index")
        if style and name and not _matches_style(name, style):
            issues.append(Issue("warn", "INDEX_NAMING_RULE", f"Index '{name}' does not match naming rule '{style}'.", "/indexes"))
        if pattern and name and not re.fullmatch(pattern, name):
            issues.append(Issue("warn", "INDEX_NAMING_PATTERN", f"Index '{name}' does not match configured pattern '{pattern}'.", "/indexes"))

    return issues


def apply_standards_fixes(model: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    fixed = normalize_model(model)
    changes: List[str] = []
    naming_rules = _coerce_dict(fixed.get("naming_rules"))

    entity_style, _ = _style_rule(naming_rules, "entity")
    field_style, _ = _style_rule(naming_rules, "field")
    relationship_style, _ = _style_rule(naming_rules, "relationship")
    index_style, _ = _style_rule(naming_rules, "index")
    physical_style, _ = _style_rule(naming_rules, "physical_name")

    entity_map: Dict[str, str] = {}
    field_maps: Dict[str, Dict[str, str]] = {}
    for entity in _coerce_list(fixed.get("entities")):
        if not isinstance(entity, dict):
            continue
        old_entity_name = str(entity.get("name") or "")
        new_entity_name = _apply_style(old_entity_name, entity_style)
        if new_entity_name and new_entity_name != old_entity_name:
            entity_map[old_entity_name] = new_entity_name
            entity["name"] = new_entity_name
            changes.append(f"Renamed entity {old_entity_name} -> {new_entity_name}")

        local_field_map: Dict[str, str] = {}
        for field in _coerce_list(entity.get("fields")):
            if not isinstance(field, dict):
                continue
            old_field_name = str(field.get("name") or "")
            new_field_name = _apply_style(old_field_name, field_style)
            if new_field_name and new_field_name != old_field_name:
                local_field_map[old_field_name] = new_field_name
                field["name"] = new_field_name
                changes.append(f"Renamed field {old_entity_name}.{old_field_name} -> {new_field_name}")
        if local_field_map:
            field_maps[old_entity_name] = local_field_map

        if fixed.get("model", {}).get("kind") == "physical":
            if not entity.get("physical_name"):
                style = physical_style or "upper_snake_case"
                entity["physical_name"] = _apply_style(str(entity.get("name") or ""), style)
                changes.append(f"Generated physical_name for {entity.get('name')}")

    _rename_entity_refs(fixed, entity_map, field_maps)

    for relationship in _coerce_list(fixed.get("relationships")):
        name = str(relationship.get("name") or "")
        next_name = _apply_style(name, relationship_style)
        if next_name and next_name != name:
            relationship["name"] = next_name
            changes.append(f"Renamed relationship {name} -> {next_name}")

    for index in _coerce_list(fixed.get("indexes")):
        name = str(index.get("name") or "")
        next_name = _apply_style(name, index_style)
        if next_name and next_name != name:
            index["name"] = next_name
            changes.append(f"Renamed index {name} -> {next_name}")

    if not fixed.get("subject_areas"):
        derived_areas = sorted(
            {
                str(entity.get("subject_area") or "").strip()
                for entity in _coerce_list(fixed.get("entities"))
                if str(entity.get("subject_area") or "").strip()
            }
        )
        if derived_areas:
            fixed["subject_areas"] = [{"name": area} for area in derived_areas]
            changes.append("Created subject_areas library from entity subject_area usage")

    return fixed, changes


def _copy_entity(entity: Dict[str, Any]) -> Dict[str, Any]:
    copy = deepcopy(entity)
    copy["fields"] = [deepcopy(field) for field in _coerce_list(copy.get("fields")) if isinstance(field, dict)]
    return copy


def _logical_fields(entity: Dict[str, Any], naming_rules: Dict[str, Any]) -> List[Dict[str, Any]]:
    field_style, _ = _style_rule(naming_rules, "field")
    result = []
    for field in _coerce_list(entity.get("fields")):
        if not isinstance(field, dict):
            continue
        next_field = deepcopy(field)
        next_field["mapped_from"] = f"{entity.get('name')}.{field.get('name')}"
        next_field["name"] = _apply_style(str(field.get("name") or ""), field_style or "snake_case")
        next_field.pop("physical_name", None)
        result.append(next_field)
    return result


def _field_type_for_physical(field: Dict[str, Any], domains: Dict[str, Dict[str, Any]], dialect: str) -> str:
    domain = domains.get(str(field.get("domain") or "").strip(), {})
    physical_types = _coerce_dict(domain.get("physical_types"))
    if physical_types.get(dialect):
        return str(physical_types[dialect])
    if domain.get("data_type"):
        return str(domain.get("data_type"))
    return str(field.get("type") or "string")


def _keyset_to_primary_keys(entity: Dict[str, Any]) -> None:
    fields_by_name = {str(field.get("name") or ""): field for field in _coerce_list(entity.get("fields")) if isinstance(field, dict)}
    if any(field.get("primary_key") for field in fields_by_name.values()):
        return
    candidate_keys = _coerce_list(entity.get("candidate_keys"))
    if candidate_keys:
        first = _coerce_list(candidate_keys[0])
        for name in first:
            field = fields_by_name.get(str(name))
            if field:
                field["primary_key"] = True
                field["nullable"] = False


def _build_relationship_field_maps(model: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
    return {
        str(entity.get("name") or ""): {
            str(field.get("mapped_from") or field.get("name") or ""): str(field.get("name") or "")
            for field in _coerce_list(entity.get("fields"))
            if isinstance(field, dict)
        }
        for entity in _coerce_list(model.get("entities"))
        if isinstance(entity, dict)
    }


def _remap_relationships(source_model: Dict[str, Any], target_model: Dict[str, Any]) -> List[Dict[str, Any]]:
    entity_map = {
        str(entity.get("mapped_from") or entity.get("derived_from") or entity.get("name") or ""): str(entity.get("name") or "")
        for entity in _coerce_list(target_model.get("entities"))
        if isinstance(entity, dict)
    }
    field_map = _build_relationship_field_maps(target_model)

    relationships = []
    for relationship in _coerce_list(source_model.get("relationships")):
        if not isinstance(relationship, dict):
            continue
        new_rel = deepcopy(relationship)
        for key in ("from", "to"):
            ref = str(relationship.get(key) or "")
            if "." not in ref:
                continue
            source_entity, source_field = ref.split(".", 1)
            next_entity = entity_map.get(source_entity, source_entity)
            next_field = field_map.get(next_entity, {}).get(source_field, source_field)
            new_rel[key] = f"{next_entity}.{next_field}"
        relationships.append(new_rel)
    return relationships


def transform_model(model: Dict[str, Any], target_kind: str, dialect: str = "postgres") -> Dict[str, Any]:
    normalized = normalize_model(model)
    source_kind = infer_model_kind(normalized)
    target = str(target_kind or "").strip().lower()
    if target not in MODEL_KINDS:
        raise ValueError(f"Unsupported target kind '{target_kind}'. Use one of: conceptual, logical, physical.")
    if source_kind == target:
        return normalized

    if source_kind == "conceptual" and target == "physical":
        logical = transform_model(normalized, "logical", dialect=dialect)
        return transform_model(logical, "physical", dialect=dialect)

    naming_rules = _coerce_dict(normalized.get("naming_rules"))
    domains = _domains_map(normalized)
    transformed = deepcopy(normalized)
    transformed["model"]["kind"] = target
    transformed["model"]["spec_version"] = 3

    entities: List[Dict[str, Any]] = []
    for entity in _coerce_list(normalized.get("entities")):
        if not isinstance(entity, dict):
            continue
        next_entity = _copy_entity(entity)
        source_entity_name = str(entity.get("name") or "")

        if source_kind == "conceptual" and target == "logical":
            next_entity["type"] = "logical_entity"
            next_entity["derived_from"] = source_entity_name
            next_entity["mapped_from"] = source_entity_name
            next_entity["name"] = _apply_style(source_entity_name, _style_rule(naming_rules, "entity")[0] or "pascal_case")
            next_entity["fields"] = _logical_fields(entity, naming_rules)
            next_entity.pop("physical_name", None)
            next_entity.pop("schema", None)
            next_entity.pop("database", None)
            next_entity.pop("partition_by", None)
            next_entity.pop("cluster_by", None)
            next_entity.pop("distribution", None)
            next_entity.pop("storage", None)
            next_entity.pop("identity", None)
            next_entity.pop("sequence", None)
            next_entity.setdefault("candidate_keys", [])
            if any(field.get("primary_key") for field in next_entity.get("fields", [])):
                next_entity["candidate_keys"] = [[field["name"] for field in next_entity["fields"] if field.get("primary_key")]]
                for field in next_entity["fields"]:
                    field.pop("primary_key", None)

        elif source_kind in {"logical", "conceptual"} and target == "physical":
            source_entity_type = str(entity.get("type") or "")
            next_entity["type"] = "table" if source_entity_type in {"concept", "logical_entity"} else (source_entity_type or "table")
            next_entity["derived_from"] = source_entity_name
            next_entity["mapped_from"] = source_entity_name
            next_entity["physical_name"] = str(entity.get("physical_name") or _apply_style(source_entity_name, _style_rule(naming_rules, "physical_name")[0] or "upper_snake_case"))
            resolved_fields: List[Dict[str, Any]] = []
            for field in _coerce_list(entity.get("fields")):
                if not isinstance(field, dict):
                    continue
                next_field = deepcopy(field)
                next_field["mapped_from"] = str(field.get("mapped_from") or field.get("name") or "")
                next_field["type"] = _field_type_for_physical(next_field, domains, dialect)
                resolved_fields.append(next_field)
            next_entity["fields"] = resolved_fields
            _keyset_to_primary_keys(next_entity)

        else:
            raise ValueError(f"Unsupported transform path: {source_kind} -> {target}")

        entities.append(next_entity)

    transformed["entities"] = entities
    transformed["relationships"] = _remap_relationships(normalized, transformed)
    return normalize_model(transformed)


def merge_models_preserving_docs(current: Dict[str, Any], candidate: Dict[str, Any]) -> Dict[str, Any]:
    current_model = normalize_model(current)
    candidate_model = normalize_model(candidate)

    current_entities = {
        str(entity.get("name") or ""): entity
        for entity in _coerce_list(current_model.get("entities"))
        if isinstance(entity, dict)
    }

    merged = deepcopy(candidate_model)
    merged_entities: List[Dict[str, Any]] = []
    for entity in _coerce_list(candidate_model.get("entities")):
        if not isinstance(entity, dict):
            continue
        current_entity = current_entities.get(str(entity.get("name") or ""))
        if not current_entity:
            merged_entities.append(entity)
            continue

        next_entity = deepcopy(entity)
        for key in ("description", "owner", "subject_area", "tags", "grain", "sla"):
            if current_entity.get(key):
                next_entity[key] = deepcopy(current_entity[key])

        current_fields = {
            str(field.get("name") or ""): field
            for field in _coerce_list(current_entity.get("fields"))
            if isinstance(field, dict)
        }
        next_fields = []
        for field in _coerce_list(entity.get("fields")):
            if not isinstance(field, dict):
                continue
            current_field = current_fields.get(str(field.get("name") or ""))
            if not current_field:
                next_fields.append(field)
                continue
            merged_field = deepcopy(field)
            for key in ("description", "tags", "sensitivity", "examples", "deprecated", "deprecated_message", "domain"):
                if current_field.get(key):
                    merged_field[key] = deepcopy(current_field[key])
            next_fields.append(merged_field)
        next_entity["fields"] = next_fields
        merged_entities.append(next_entity)

    merged["entities"] = merged_entities
    if current_model.get("glossary"):
        merged["glossary"] = deepcopy(current_model["glossary"])
    if current_model.get("subject_areas"):
        merged["subject_areas"] = deepcopy(current_model["subject_areas"])
    return normalize_model(merged)
