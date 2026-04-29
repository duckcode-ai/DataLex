"""Conceptualizer agent — propose a conceptual model from staging layer.

Inputs: a `models` dict (uid → DataLex doc) covering at least the staging
layer.
Outputs: a `ConceptualizerProposal` with:
  * entities — one per staging model (singularized + pascal-cased)
  * relationships — one per FK test in the staging layer, deduped
  * domains — distinct domain values found across staging

The agent is deterministic; an LLM is optional. The output ships as a
DataLex `proposal` shape so the existing `/api/ai/proposals/apply` flow
can persist it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Set, Tuple

from ._shared import (
    StagingModel,
    collect_staging_models,
    pascal_case,
    singularize,
    strip_staging_prefix,
)


@dataclass
class ConceptualizerProposal:
    entities: List[Dict[str, Any]] = field(default_factory=list)
    relationships: List[Dict[str, Any]] = field(default_factory=list)
    domains: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)

    def to_diagram(self, name: str = "conceptual_overview", layer: str = "conceptual") -> Dict[str, Any]:
        """Render as a DataLex diagram doc that can be applied via proposals."""
        return {
            "kind": "diagram",
            "name": name,
            "layer": layer,
            "entities": self.entities,
            "relationships": self.relationships,
            "domains": self.domains,
            "notes": self.notes,
        }


def _entity_name_from_model(model_name: str) -> str:
    base = strip_staging_prefix(model_name)
    return pascal_case(singularize(base))


def propose_conceptual_model(
    models: Dict[str, Dict[str, Any]],
) -> ConceptualizerProposal:
    """Cluster staging models into conceptual entities + relationships."""
    staging: List[StagingModel] = collect_staging_models(models)
    proposal = ConceptualizerProposal()
    if not staging:
        proposal.notes.append(
            "No staging-layer models detected (looked for stg_/staging_/src_/raw_ prefixes). "
            "Supply staging models or rename them to the expected convention."
        )
        return proposal

    # Entities — one per staging model, deduped by canonical name
    seen_entities: Dict[str, Dict[str, Any]] = {}
    name_for_model: Dict[str, str] = {}
    for sm in staging:
        entity_name = _entity_name_from_model(sm.name)
        name_for_model[sm.name] = entity_name
        if entity_name in seen_entities:
            seen_entities[entity_name]["sources"].append(sm.name)
            continue
        seen_entities[entity_name] = {
            "name": entity_name,
            "type": "concept",
            "description": sm.description or f"Conceptual entity derived from staging model {sm.name}.",
            "domain": sm.domain or _infer_domain(entity_name),
            "sources": [sm.name],
            "tags": ["conceptual", "from_staging"],
        }
    proposal.entities = list(seen_entities.values())

    # Domains
    domains: Set[str] = set(e["domain"] for e in proposal.entities if e.get("domain"))
    proposal.domains = sorted(d for d in domains if d)

    # Relationships — extract from FK metadata on staging columns
    rels_seen: Set[Tuple[str, str, str, str]] = set()
    for sm in staging:
        from_entity = name_for_model.get(sm.name)
        if not from_entity:
            continue
        for col in sm.columns:
            if not col.foreign_key:
                continue
            target_table, target_col = col.foreign_key
            target_entity = name_for_model.get(target_table) or pascal_case(
                singularize(strip_staging_prefix(target_table))
            )
            if not target_entity:
                continue
            cardinality = _infer_cardinality(col.name, col.primary_key)
            key = (from_entity, target_entity, col.name, target_col)
            if key in rels_seen:
                continue
            rels_seen.add(key)
            proposal.relationships.append(
                {
                    "name": f"{from_entity}_{target_entity}_{col.name}_fk",
                    "from": {"entity": from_entity, "field": col.name},
                    "to": {"entity": target_entity, "field": target_col},
                    "cardinality": cardinality,
                    "verb": _verb_from_columns(from_entity, target_entity, col.name),
                    "sources": [sm.name],
                }
            )

    if not proposal.relationships:
        proposal.notes.append(
            "No FK relationships were detected in the staging layer. "
            "Add `relationships` tests on FK-shaped columns (e.g. `customer_id`) to seed conceptual edges."
        )
    return proposal


def _infer_domain(entity_name: str) -> str:
    """Map common entity nouns to a default domain bucket."""
    name = entity_name.lower()
    domain_map = {
        "customer": "crm",
        "user": "crm",
        "account": "crm",
        "order": "sales",
        "invoice": "sales",
        "payment": "finance",
        "transaction": "finance",
        "ledger": "finance",
        "product": "catalog",
        "sku": "catalog",
        "shipment": "logistics",
        "address": "logistics",
        "employee": "hr",
        "campaign": "marketing",
        "lead": "marketing",
    }
    for key, value in domain_map.items():
        if key in name:
            return value
    return ""


def _infer_cardinality(column_name: str, is_primary_key: bool) -> str:
    """`customer_id` on `Order` typically means many orders → one customer."""
    if is_primary_key:
        return "one_to_one"
    return "many_to_one"


# ---------------------------------------------------------------------------
# Business-verb generation
#
# The previous implementation always emitted "<from> references <to>".  That
# read like a tautology on the diagram and offered no business meaning, so
# downstream UIs (DocsView narrative, OSI export) had nothing useful to
# render. This replacement combines three signals to pick a verb:
#
#   1. Direct entity-pair lookup — a small table of common business pairs
#      (Customer × Order = "places", Order × Product = "contains", …).
#   2. Column-name patterns — `created_by`, `parent_id`, `owner_id`,
#      `manager_id` etc. carry their own implicit verb.
#   3. Sensible default — the noun-form FK column rendered as a passive
#      "is associated with <to>" style, which we then short-circuit to
#      a verb in the lookup table where possible.
#
# Verbs use lowercase snake_case so the diagram edge label and the
# DocsView narrative stay consistent ("Customer places Order").
# ---------------------------------------------------------------------------

# Common business-domain pairs. Looked up case-insensitively after we
# strip a trailing 's' (in case singularization left noise behind).
_ENTITY_PAIR_VERBS: Dict[Tuple[str, str], str] = {
    ("customer", "order"):         "places",
    ("customer", "account"):       "owns",
    ("customer", "address"):       "lives_at",
    ("customer", "subscription"):  "subscribes_to",
    ("customer", "contract"):      "signs",
    ("customer", "payment"):       "pays",
    ("user", "account"):           "owns",
    ("user", "session"):           "starts",
    ("user", "subscription"):      "subscribes_to",
    ("order", "orderline"):        "contains",
    ("order", "lineitem"):         "contains",
    ("order", "product"):          "contains",
    ("order", "sku"):              "contains",
    ("order", "invoice"):          "generates",
    ("order", "payment"):          "is_paid_by",
    ("order", "shipment"):         "ships_as",
    ("order", "fulfillment"):      "fulfilled_by",
    ("invoice", "payment"):        "settled_by",
    ("invoice", "lineitem"):       "lists",
    ("payment", "transaction"):    "issues",
    ("transaction", "ledger"):     "posts_to",
    ("product", "category"):       "belongs_to",
    ("product", "supplier"):       "supplied_by",
    ("product", "sku"):            "has",
    ("shipment", "address"):       "ships_to",
    ("shipment", "carrier"):       "carried_by",
    ("employee", "department"):    "works_in",
    ("employee", "manager"):       "reports_to",
    ("employee", "team"):          "belongs_to",
    ("campaign", "lead"):          "generates",
    ("lead", "opportunity"):       "becomes",
    ("opportunity", "deal"):       "becomes",
    ("ticket", "customer"):        "raised_by",
    ("ticket", "agent"):           "handled_by",
}

# Column-name patterns that imply a verb regardless of the entity pair.
# Order matters — most specific patterns come first.
_COLUMN_NAME_VERBS: List[Tuple[str, str]] = [
    ("created_by",   "created_by"),
    ("updated_by",   "last_updated_by"),
    ("modified_by",  "modified_by"),
    ("owner_id",     "owned_by"),
    ("manager_id",   "managed_by"),
    ("parent_id",    "is_child_of"),
    ("source_id",    "sourced_from"),
    ("target_id",    "targets"),
    ("origin_id",    "originates_from"),
    ("approved_by",  "approved_by"),
]


def _normalize_entity(name: str) -> str:
    cleaned = (name or "").strip().lower()
    if not cleaned:
        return ""
    # Strip a single trailing 's' so "Orders" → "order" without breaking
    # words that genuinely end in 's' (we don't pluralize "address" → "addres").
    if cleaned.endswith("s") and not cleaned.endswith("ss") and len(cleaned) > 3:
        cleaned = cleaned[:-1]
    return cleaned


def _verb_from_columns(from_entity: str, to_entity: str, column_name: str = "") -> str:
    """Return a business-meaningful verb for a relationship edge label.

    Falls back to a passive "is_associated_with" form so the YAML always
    gets *some* verb — Phase 1A inline-edit lets the user override later.
    """
    col = (column_name or "").strip().lower()

    # 1. Column-name patterns carry their own verb.
    for needle, verb in _COLUMN_NAME_VERBS:
        if needle in col:
            return verb

    # 2. Direct entity-pair lookup (case-insensitive, depluralized).
    fa = _normalize_entity(from_entity)
    fb = _normalize_entity(to_entity)
    if fa and fb:
        for key, verb in (((fa, fb), True), ((fb, fa), False)):
            verb_value = _ENTITY_PAIR_VERBS.get(key)
            if verb_value:
                return verb_value

    # 3. Fallback. Use a passive form rather than the old tautology so
    # diagrams read clearly even when the lookup misses.
    return "is_associated_with"
