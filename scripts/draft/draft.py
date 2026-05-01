#!/usr/bin/env python3
"""Draft a DataLex starter model from a dbt project using AI assistance.

See scripts/draft/README.md for usage and the OSS plan Phase 1.1 for context.
"""

from __future__ import annotations

import argparse
import difflib
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
SCHEMA_PATH = REPO_ROOT / "schemas" / "model.schema.json"

sys.path.insert(0, str(SCRIPT_DIR.parent))

from draft.manifest_loader import condense_manifest, load_manifest  # noqa: E402
from draft.prompt import build_messages  # noqa: E402

YAML_FENCE_RE = re.compile(r"```ya?ml\s*\n(.*?)\n```", re.DOTALL)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="AI-assisted DataLex starter from a dbt project.",
    )
    parser.add_argument("--dbt", type=Path, required=True, help="dbt project root")
    parser.add_argument("--domain", required=True, help="DataLex domain to assign")
    parser.add_argument("--out", type=Path, help="output file (default: stdout)")
    parser.add_argument("--force", action="store_true", help="overwrite --out if it exists")
    parser.add_argument("--model", default="claude-opus-4-7", help="Anthropic model id")
    parser.add_argument("--max-tokens", type=int, default=8000)
    parser.add_argument("--owner", help="email for model.owners (default: git user.email)")
    parser.add_argument("--include", help="dbt model name glob to include")
    return parser.parse_args()


def detect_owner_email(explicit: str | None) -> str:
    if explicit:
        return explicit
    try:
        result = subprocess.run(
            ["git", "config", "--get", "user.email"],
            capture_output=True,
            text=True,
            check=False,
        )
        email = result.stdout.strip()
        if email:
            return email
    except FileNotFoundError:
        pass
    return "data@example.com"


def call_anthropic(
    *,
    model: str,
    max_tokens: int,
    system: list[dict[str, Any]],
    messages: list[dict[str, Any]],
) -> str:
    try:
        import anthropic
    except ImportError:
        sys.stderr.write(
            "anthropic not installed. Run: pip install -r scripts/draft/requirements.txt\n"
        )
        sys.exit(2)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.stderr.write("ANTHROPIC_API_KEY not set in environment.\n")
        sys.exit(2)
    client = anthropic.Anthropic()
    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
    )
    text = "".join(
        block.text for block in response.content if getattr(block, "type", "") == "text"
    )
    usage = getattr(response, "usage", None)
    if usage is not None:
        cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
        cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
        sys.stderr.write(
            f"[draft] tokens: input={usage.input_tokens} "
            f"output={usage.output_tokens} "
            f"cache_read={cache_read} cache_write={cache_write}\n"
        )
    return text


def extract_yaml(text: str) -> str:
    match = YAML_FENCE_RE.search(text)
    if not match:
        sys.stderr.write(
            "[draft] model response did not contain a fenced YAML block. Raw:\n"
            f"{text}\n"
        )
        sys.exit(3)
    return match.group(1).strip() + "\n"


def validate_against_schema(yaml_text: str) -> dict[str, Any]:
    try:
        import jsonschema
    except ImportError:
        sys.stderr.write("jsonschema not installed; skipping schema validation.\n")
        return yaml.safe_load(yaml_text)
    if not SCHEMA_PATH.exists():
        sys.stderr.write(f"schema not found at {SCHEMA_PATH}; skipping validation.\n")
        return yaml.safe_load(yaml_text)
    import json
    schema = json.loads(SCHEMA_PATH.read_text())
    parsed = yaml.safe_load(yaml_text)
    validator = jsonschema.Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(parsed), key=lambda e: e.path)
    if errors:
        sys.stderr.write("[draft] schema validation FAILED:\n")
        for err in errors:
            location = ".".join(str(p) for p in err.absolute_path) or "<root>"
            sys.stderr.write(f"  {location}: {err.message}\n")
        sys.exit(4)
    return parsed


def summarize(parsed: dict[str, Any]) -> None:
    entity_count = len(parsed.get("entities") or [])
    field_count = sum(len(e.get("fields") or []) for e in (parsed.get("entities") or []))
    relationship_count = len(parsed.get("relationships") or [])
    rule_count = len(parsed.get("rules") or [])
    sys.stderr.write(
        f"[draft] entities={entity_count} fields={field_count} "
        f"relationships={relationship_count} rules={rule_count}\n"
    )


def write_or_diff(yaml_text: str, out: Path | None, force: bool) -> None:
    if out is None:
        sys.stdout.write(yaml_text)
        return
    if out.exists():
        existing = out.read_text()
        diff = "".join(
            difflib.unified_diff(
                existing.splitlines(keepends=True),
                yaml_text.splitlines(keepends=True),
                fromfile=str(out),
                tofile=f"{out} (proposed)",
            )
        )
        sys.stdout.write(diff or "[draft] no changes\n")
        if not force:
            sys.stderr.write(f"[draft] {out} exists; pass --force to overwrite.\n")
            return
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(yaml_text)
    sys.stderr.write(f"[draft] wrote {out}\n")


def main() -> None:
    args = parse_args()
    if not args.dbt.exists():
        sys.stderr.write(f"--dbt path does not exist: {args.dbt}\n")
        sys.exit(2)
    manifest = load_manifest(args.dbt)
    condensed = condense_manifest(manifest, include_glob=args.include)
    if not condensed["models"]:
        sys.stderr.write(
            "[draft] no dbt models found in manifest"
            + (f" matching --include {args.include!r}" if args.include else "")
            + ". Nothing to draft.\n"
        )
        sys.exit(2)
    owner = detect_owner_email(args.owner)
    system, messages = build_messages(
        domain=args.domain,
        owner=owner,
        condensed=condensed,
    )
    raw = call_anthropic(
        model=args.model,
        max_tokens=args.max_tokens,
        system=system,
        messages=messages,
    )
    yaml_text = extract_yaml(raw)
    parsed = validate_against_schema(yaml_text)
    summarize(parsed)
    write_or_diff(yaml_text, args.out, args.force)


if __name__ == "__main__":
    main()
