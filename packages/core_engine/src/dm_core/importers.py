import json
import re
from datetime import date
from typing import Any, Dict, List, Optional, Tuple


CREATE_TABLE_RE = re.compile(
    r"create\s+table\s+(?:if\s+not\s+exists\s+)?([\w\"\.\.]+)\s*\((.*?)\)\s*;",
    flags=re.IGNORECASE | re.DOTALL,
)
CREATE_VIEW_RE = re.compile(
    r"create\s+(?:or\s+replace\s+)?view\s+(?:if\s+not\s+exists\s+)?([\w\"\.\.]+)",
    flags=re.IGNORECASE,
)
CREATE_MVIEW_RE = re.compile(
    r"create\s+(?:or\s+replace\s+)?materialized\s+view\s+(?:if\s+not\s+exists\s+)?([\w\"\.\.]+)",
    flags=re.IGNORECASE,
)
CREATE_INDEX_RE = re.compile(
    r"create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([\w\"]+)\s+on\s+([\w\"\.\.]+)\s*\(([^)]+)\)",
    flags=re.IGNORECASE,
)
TABLE_RE = re.compile(r"^\s*table\s+([\w\"]+)\s*\{\s*$", flags=re.IGNORECASE)
REF_RE = re.compile(r"^\s*ref\s*:\s*([\w]+)\.([\w]+)\s*([<>-]+)\s*([\w]+)\.([\w]+)", flags=re.IGNORECASE)


def _to_pascal(name: str) -> str:
    name = name.replace('"', "")
    parts = re.split(r"[^A-Za-z0-9]+", name)
    return "".join(part[:1].upper() + part[1:] for part in parts if part)


def _to_model_name(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_")
    cleaned = cleaned.lower()
    return cleaned or "imported_model"


def _split_top_level(body: str) -> List[str]:
    parts: List[str] = []
    current: List[str] = []
    depth = 0
    in_single = False
    in_double = False

    for char in body:
        if char == "'" and not in_double:
            in_single = not in_single
        elif char == '"' and not in_single:
            in_double = not in_double
        elif not in_single and not in_double:
            if char == "(":
                depth += 1
            elif char == ")":
                depth = max(0, depth - 1)
            elif char == "," and depth == 0:
                parts.append("".join(current).strip())
                current = []
                continue
        current.append(char)

    if current:
        parts.append("".join(current).strip())
    return [part for part in parts if part]


def _default_model(model_name: str, domain: str, owners: List[str]) -> Dict[str, Any]:
    return {
        "model": {
            "name": _to_model_name(model_name),
            "version": "1.0.0",
            "domain": domain,
            "owners": owners,
            "state": "draft",
        },
        "entities": [],
        "relationships": [],
        "governance": {"classification": {}, "stewards": {}},
        "rules": [],
    }


def _parse_default_value(rest: str) -> Optional[str]:
    """Extract DEFAULT value from column definition tail."""
    m = re.search(r"default\s+('(?:[^']*)'|\S+)", rest, re.IGNORECASE)
    if m:
        val = m.group(1).strip("'")
        return val
    return None


def _parse_check_constraint(rest: str) -> Optional[str]:
    """Extract CHECK constraint expression from column definition tail."""
    m = re.search(r"check\s*\((.+?)\)", rest, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return None


def import_sql_ddl(
    ddl_text: str,
    model_name: str = "imported_sql_model",
    domain: str = "imported",
    owners: List[str] = None,
) -> Dict[str, Any]:
    owners = owners or ["data-team@example.com"]
    model = _default_model(model_name=model_name, domain=domain, owners=owners)

    entity_fields: Dict[str, List[Dict[str, Any]]] = {}
    entity_meta: Dict[str, Dict[str, Any]] = {}
    primary_keys: Dict[str, List[str]] = {}
    relationships: List[Dict[str, Any]] = []
    indexes: List[Dict[str, Any]] = []

    # --- Parse CREATE TABLE ---
    for match in CREATE_TABLE_RE.finditer(ddl_text):
        table_token = match.group(1).strip()
        schema_name = ""
        parts = table_token.replace('"', '').split(".")
        if len(parts) >= 2:
            schema_name = parts[-2]
        table_raw = parts[-1]
        entity_name = _to_pascal(table_raw)
        entity_fields.setdefault(entity_name, [])
        primary_keys.setdefault(entity_name, [])
        if schema_name:
            entity_meta.setdefault(entity_name, {})["schema"] = schema_name

        body = match.group(2)
        for definition in _split_top_level(body):
            lowered = definition.lower()
            if lowered.startswith("primary key"):
                cols_match = re.search(r"\((.*?)\)", definition)
                if cols_match:
                    cols = [col.strip().replace('"', "") for col in cols_match.group(1).split(",")]
                    primary_keys[entity_name].extend(cols)
                continue

            if lowered.startswith("foreign key"):
                fk_match = re.search(
                    r"foreign\s+key\s*\((.*?)\)\s+references\s+([\w\"\.\.]+)\s*\((.*?)\)",
                    definition,
                    flags=re.IGNORECASE,
                )
                if fk_match:
                    local_field = fk_match.group(1).strip().replace('"', "")
                    ref_table = fk_match.group(2).strip().split(".")[-1].replace('"', "")
                    ref_field = fk_match.group(3).strip().replace('"', "")
                    parent_entity = _to_pascal(ref_table)
                    child_entity = entity_name
                    relationships.append(
                        {
                            "name": f"{parent_entity.lower()}_{child_entity.lower()}_{local_field}_fk",
                            "from": f"{parent_entity}.{ref_field}",
                            "to": f"{child_entity}.{local_field}",
                            "cardinality": "one_to_many",
                        }
                    )
                continue

            # Table-level CHECK constraint
            if lowered.startswith("check") or (lowered.startswith("constraint") and "check" in lowered):
                continue

            col_match = re.match(r"^\s*\"?([A-Za-z_][A-Za-z0-9_]*)\"?\s+([^\s,]+(?:\([^)]*\))?)(.*)$", definition)
            if not col_match:
                continue

            col_name = col_match.group(1)
            col_type = col_match.group(2)
            rest = col_match.group(3)
            rest_lower = rest.lower()

            field: Dict[str, Any] = {
                "name": col_name,
                "type": col_type.lower(),
                "nullable": "not null" not in rest_lower,
            }
            if "primary key" in rest_lower:
                field["primary_key"] = True
            if "unique" in rest_lower:
                field["unique"] = True

            default_val = _parse_default_value(rest)
            if default_val is not None:
                field["default"] = default_val

            check_expr = _parse_check_constraint(rest)
            if check_expr:
                field["check"] = check_expr

            ref_match = re.search(
                r"references\s+([\w\"\.\.]+)\s*\((.*?)\)",
                rest,
                flags=re.IGNORECASE,
            )
            if ref_match:
                ref_table = ref_match.group(1).strip().split(".")[-1].replace('"', "")
                ref_field = ref_match.group(2).strip().replace('"', "")
                parent_entity = _to_pascal(ref_table)
                child_entity = entity_name
                field["foreign_key"] = True
                relationships.append(
                    {
                        "name": f"{parent_entity.lower()}_{child_entity.lower()}_{col_name}_fk",
                        "from": f"{parent_entity}.{ref_field}",
                        "to": f"{child_entity}.{col_name}",
                        "cardinality": "one_to_many",
                    }
                )

            entity_fields[entity_name].append(field)

    # --- Parse CREATE VIEW / CREATE MATERIALIZED VIEW ---
    for m in CREATE_MVIEW_RE.finditer(ddl_text):
        view_token = m.group(1).strip().replace('"', '').split(".")[-1]
        ename = _to_pascal(view_token)
        if ename not in entity_fields:
            entity_fields[ename] = []
            entity_meta.setdefault(ename, {})["type"] = "materialized_view"

    for m in CREATE_VIEW_RE.finditer(ddl_text):
        view_token = m.group(1).strip().replace('"', '').split(".")[-1]
        ename = _to_pascal(view_token)
        # Don't overwrite materialized_view
        if ename not in entity_fields:
            entity_fields[ename] = []
            entity_meta.setdefault(ename, {})["type"] = "view"

    # --- Parse CREATE INDEX ---
    for m in CREATE_INDEX_RE.finditer(ddl_text):
        idx_name = m.group(1).strip().replace('"', '')
        idx_table = m.group(2).strip().replace('"', '').split(".")[-1]
        idx_cols = [c.strip().replace('"', '') for c in m.group(3).split(",")]
        # Check for UNIQUE by looking at the full matched statement prefix
        stmt_prefix = ddl_text[max(0, m.start()-50):m.start() + 30].lower()
        is_unique = bool(re.search(r"create\s+unique\s+index", stmt_prefix, re.IGNORECASE))
        idx_entity = _to_pascal(idx_table)
        indexes.append({
            "name": idx_name,
            "entity": idx_entity,
            "fields": idx_cols,
            "unique": is_unique,
        })

    # --- Build entities ---
    for entity_name, fields in sorted(entity_fields.items()):
        pk_set = {value for value in primary_keys.get(entity_name, []) if value}
        for field in fields:
            if field["name"] in pk_set:
                field["primary_key"] = True
                field["nullable"] = False

        meta = entity_meta.get(entity_name, {})
        entity: Dict[str, Any] = {
            "name": entity_name,
            "type": meta.get("type", "table"),
            "description": f"Imported from SQL on {date.today().isoformat()}",
            "fields": fields,
        }
        if meta.get("schema"):
            entity["schema"] = meta["schema"]
        model["entities"].append(entity)

    deduped: Dict[Tuple[str, str, str, str], Dict[str, str]] = {}
    for rel in relationships:
        key = (rel["name"], rel["from"], rel["to"], rel["cardinality"])
        deduped[key] = rel
    model["relationships"] = sorted(deduped.values(), key=lambda x: x["name"])

    if indexes:
        model["indexes"] = indexes

    return model


def import_dbml(
    dbml_text: str,
    model_name: str = "imported_dbml_model",
    domain: str = "imported",
    owners: List[str] = None,
) -> Dict[str, Any]:
    owners = owners or ["data-team@example.com"]
    model = _default_model(model_name=model_name, domain=domain, owners=owners)

    entities: Dict[str, Dict[str, Any]] = {}
    current_entity: str = ""

    for raw_line in dbml_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("//"):
            continue

        table_match = TABLE_RE.match(line)
        if table_match:
            table_name = table_match.group(1).replace('"', "")
            current_entity = _to_pascal(table_name)
            entities[current_entity] = {
                "name": current_entity,
                "type": "table",
                "description": f"Imported from DBML on {date.today().isoformat()}",
                "fields": [],
            }
            continue

        if line == "}":
            current_entity = ""
            continue

        ref_match = REF_RE.match(line)
        if ref_match:
            left_table = _to_pascal(ref_match.group(1))
            left_field = ref_match.group(2)
            direction = ref_match.group(3)
            right_table = _to_pascal(ref_match.group(4))
            right_field = ref_match.group(5)

            if ">" in direction:
                parent_table, parent_field = right_table, right_field
                child_table, child_field = left_table, left_field
            else:
                parent_table, parent_field = left_table, left_field
                child_table, child_field = right_table, right_field

            model["relationships"].append(
                {
                    "name": f"{parent_table.lower()}_{child_table.lower()}_{child_field}_fk",
                    "from": f"{parent_table}.{parent_field}",
                    "to": f"{child_table}.{child_field}",
                    "cardinality": "one_to_many",
                }
            )
            continue

        if current_entity:
            # Example: user_id integer [pk, not null, unique]
            field_match = re.match(
                r"^([A-Za-z_][A-Za-z0-9_]*)\s+([^\s\[]+)(?:\s*\[(.*?)\])?$",
                line,
            )
            if not field_match:
                continue

            field_name = field_match.group(1)
            field_type = field_match.group(2).lower()
            attrs = (field_match.group(3) or "").lower()

            field = {
                "name": field_name,
                "type": field_type,
                "nullable": "not null" not in attrs,
            }
            if "pk" in attrs:
                field["primary_key"] = True
                field["nullable"] = False
            if "unique" in attrs:
                field["unique"] = True
            entities[current_entity]["fields"].append(field)

    model["entities"] = sorted(entities.values(), key=lambda x: x["name"])

    deduped: Dict[Tuple[str, str, str, str], Dict[str, str]] = {}
    for rel in model["relationships"]:
        key = (rel["name"], rel["from"], rel["to"], rel["cardinality"])
        deduped[key] = rel
    model["relationships"] = sorted(deduped.values(), key=lambda x: x["name"])

    return model


# ---------------------------------------------------------------------------
# Spark schema importer (JSON struct type files)
# ---------------------------------------------------------------------------

_SPARK_TYPE_MAP = {
    "string": "string",
    "integer": "integer",
    "int": "integer",
    "long": "bigint",
    "bigint": "bigint",
    "short": "smallint",
    "smallint": "smallint",
    "byte": "tinyint",
    "tinyint": "tinyint",
    "float": "float",
    "double": "float",
    "boolean": "boolean",
    "binary": "binary",
    "date": "date",
    "timestamp": "timestamp",
    "timestamp_ntz": "timestamp",
    "void": "string",
}


def _spark_field_type(spark_type: Any) -> str:
    """Map a Spark schema type to a DataLex field type."""
    if isinstance(spark_type, str):
        lower = spark_type.lower()
        if lower.startswith("decimal"):
            return lower
        if lower.startswith("varchar") or lower.startswith("char"):
            return "string"
        if lower.startswith("array") or lower.startswith("map") or lower.startswith("struct"):
            return "json"
        return _SPARK_TYPE_MAP.get(lower, "string")
    if isinstance(spark_type, dict):
        type_name = spark_type.get("type", "string")
        if isinstance(type_name, str):
            lower = type_name.lower()
            if lower == "struct":
                return "json"
            if lower == "array":
                return "json"
            if lower == "map":
                return "json"
            if lower == "udt":
                return "json"
            return _SPARK_TYPE_MAP.get(lower, "string")
        return "json"
    return "string"


def import_spark_schema(
    schema_text: str,
    model_name: str = "imported_spark_schema",
    domain: str = "imported",
    owners: List[str] = None,
    table_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Import a Spark schema JSON file into a DataLex model.

    Supports:
    - Single StructType schema (from df.schema.json() or DESCRIBE TABLE output)
    - Array of named table schemas [{name: "...", schema: {...}}, ...]
    - Databricks catalog export format with table_name + columns
    """
    owners = owners or ["data-team@example.com"]
    model = _default_model(model_name=model_name, domain=domain, owners=owners)

    schema = json.loads(schema_text)

    tables_to_process: List[Tuple[str, Dict[str, Any]]] = []

    if isinstance(schema, list):
        # Array of table schemas
        for idx, item in enumerate(schema):
            if isinstance(item, dict):
                name = item.get("name") or item.get("table_name") or f"table_{idx}"
                inner = item.get("schema") or item.get("columns") or item
                tables_to_process.append((name, inner))
    elif isinstance(schema, dict):
        if schema.get("type") == "struct" and "fields" in schema:
            # Single StructType
            name = table_name or model_name
            tables_to_process.append((name, schema))
        elif "columns" in schema:
            # Databricks-style: {table_name: "...", columns: [...]}
            name = schema.get("table_name") or schema.get("name") or table_name or model_name
            tables_to_process.append((name, schema))
        elif "fields" in schema:
            name = table_name or model_name
            tables_to_process.append((name, schema))

    for tbl_name, tbl_schema in tables_to_process:
        entity_name = _to_pascal(tbl_name)

        # Extract fields from StructType or columns array
        raw_fields = []
        if isinstance(tbl_schema, dict):
            if "fields" in tbl_schema:
                raw_fields = tbl_schema["fields"]
            elif "columns" in tbl_schema:
                raw_fields = tbl_schema["columns"]
        elif isinstance(tbl_schema, list):
            raw_fields = tbl_schema

        fields: List[Dict[str, Any]] = []
        for raw_field in raw_fields:
            if not isinstance(raw_field, dict):
                continue

            fname = raw_field.get("name", "")
            if not fname:
                continue

            ftype_raw = raw_field.get("type", raw_field.get("data_type", "string"))
            ftype = _spark_field_type(ftype_raw)
            nullable = raw_field.get("nullable", True)

            field: Dict[str, Any] = {
                "name": fname,
                "type": ftype,
                "nullable": bool(nullable),
            }

            metadata = raw_field.get("metadata", {})
            if isinstance(metadata, dict):
                if metadata.get("comment"):
                    field["description"] = metadata["comment"]
                if metadata.get("sensitivity"):
                    field["sensitivity"] = metadata["sensitivity"]

            if raw_field.get("comment"):
                field["description"] = raw_field["comment"]

            fields.append(field)

        entity: Dict[str, Any] = {
            "name": entity_name,
            "type": "table",
            "description": f"Imported from Spark schema on {date.today().isoformat()}",
            "fields": fields,
        }
        model["entities"].append(entity)

    return model
