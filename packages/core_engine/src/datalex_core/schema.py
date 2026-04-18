import json
from pathlib import Path
from typing import Any, Dict, List

from jsonschema import Draft202012Validator

from datalex_core.issues import Issue
from datalex_core.modeling import normalize_model


def load_schema(schema_path: str) -> Dict[str, Any]:
    path = Path(schema_path)
    if not path.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _to_json_path(parts: List[Any]) -> str:
    if not parts:
        return "/"
    formatted = []
    for part in parts:
        formatted.append(str(part))
    return "/" + "/".join(formatted)


def _looks_like_model_schema(schema: Dict[str, Any]) -> bool:
    schema_id = str(schema.get("$id") or "")
    if schema_id.endswith("/model.schema.json"):
        return True
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return False
    return "model" in properties and "entities" in properties


def schema_issues(model: Dict[str, Any], schema: Dict[str, Any]) -> List[Issue]:
    if _looks_like_model_schema(schema):
        model = normalize_model(model)
    validator = Draft202012Validator(schema)
    issues: List[Issue] = []

    for error in sorted(validator.iter_errors(model), key=lambda e: list(e.absolute_path)):
        issues.append(
            Issue(
                severity="error",
                code="SCHEMA_VALIDATION_FAILED",
                message=error.message,
                path=_to_json_path(list(error.absolute_path)),
            )
        )

    return issues
