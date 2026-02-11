import argparse
import glob
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

import yaml

from dm_core import (
    compile_model,
    generate_changelog,
    generate_html_docs,
    generate_markdown_docs,
    generate_sql_ddl,
    import_dbml,
    import_sql_ddl,
    lint_issues,
    load_policy_pack,
    load_schema,
    load_yaml_model,
    policy_issues,
    project_diff,
    resolve_model,
    resolve_project,
    schema_issues,
    semantic_diff,
    write_changelog,
    write_dbt_scaffold,
    write_html_docs,
    write_markdown_docs,
)
from dm_core.issues import Issue, has_errors, to_lines

STARTER_MODEL = """model:
  name: starter_model
  version: 1.0.0
  domain: demo
  owners:
    - data-team@example.com
  state: draft

entities:
  - name: User
    type: table
    fields:
      - name: user_id
        type: integer
        primary_key: true
        nullable: false
      - name: email
        type: string
        nullable: false
"""

MULTI_MODEL_SHARED = """model:
  name: shared_dimensions
  spec_version: 2
  version: 1.0.0
  domain: shared
  owners:
    - data-team@example.com
  state: draft
  description: Shared dimension entities used across domain models

entities:
  - name: Customer
    type: table
    description: Customer master record
    schema: shared
    subject_area: customer_domain
    fields:
      - name: customer_id
        type: integer
        primary_key: true
        nullable: false
      - name: email
        type: string
        nullable: false
        unique: true
      - name: full_name
        type: string
        nullable: false
      - name: created_at
        type: timestamp
        nullable: false

indexes:
  - name: idx_customer_email
    entity: Customer
    fields: [email]
    unique: true
"""

MULTI_MODEL_ORDERS = """model:
  name: orders
  spec_version: 2
  version: 1.0.0
  domain: sales
  owners:
    - data-team@example.com
  state: draft
  description: Order domain model
  imports:
    - model: shared_dimensions
      alias: shared
      entities: [Customer]

entities:
  - name: Order
    type: table
    description: Customer orders
    schema: sales
    subject_area: order_domain
    fields:
      - name: order_id
        type: integer
        primary_key: true
        nullable: false
      - name: customer_id
        type: integer
        nullable: false
        foreign_key: true
      - name: total_amount
        type: decimal(12,2)
        nullable: false
      - name: order_date
        type: timestamp
        nullable: false

relationships:
  - name: order_customer
    from: Order.customer_id
    to: Customer.customer_id
    cardinality: many_to_one
    description: Order belongs to a customer (cross-model)
"""


def _default_schema_path() -> str:
    return str(Path.cwd() / "schemas" / "model.schema.json")


def _default_policy_schema_path() -> str:
    return str(Path.cwd() / "schemas" / "policy.schema.json")


def _default_policy_path() -> str:
    return str(Path.cwd() / "policies" / "default.policy.yaml")


def _print_issues(issues: List[Issue]) -> None:
    if not issues:
        print("No issues found.")
        return
    for line in to_lines(issues):
        print(line)


def _combined_issues(model: Dict[str, Any], schema: Dict[str, Any]) -> List[Issue]:
    issues = schema_issues(model, schema)
    issues.extend(lint_issues(model))
    return issues


def _validate_model_file(model_path: str, schema: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Issue]]:
    model = load_yaml_model(model_path)
    issues = _combined_issues(model, schema)
    return model, issues


def _print_issue_block(prefix: str, issues: List[Issue]) -> None:
    if not issues:
        print(f"{prefix}: No issues found.")
        return
    print(f"{prefix}:")
    for line in to_lines(issues):
        print(f"  {line}")


def _issues_as_json(issues: List[Issue]) -> List[Dict[str, str]]:
    return [
        {
            "severity": issue.severity,
            "code": issue.code,
            "message": issue.message,
            "path": issue.path,
        }
        for issue in issues
    ]


def _write_yaml(path: str, payload: Dict[str, Any]) -> None:
    output = yaml.safe_dump(payload, sort_keys=False)
    Path(path).write_text(output, encoding="utf-8")


def _init_schemas_and_policies(root: Path) -> List[Path]:
    """Copy schema and policy files into the workspace. Returns list of created paths."""
    created = []
    (root / "schemas").mkdir(parents=True, exist_ok=True)
    (root / "policies").mkdir(parents=True, exist_ok=True)

    schema_dst = root / "schemas" / "model.schema.json"
    policy_schema_dst = root / "schemas" / "policy.schema.json"
    default_policy_dst = root / "policies" / "default.policy.yaml"
    strict_policy_dst = root / "policies" / "strict.policy.yaml"

    if not schema_dst.exists():
        repo_schema = Path.cwd() / "schemas" / "model.schema.json"
        if repo_schema.exists():
            schema_dst.write_text(repo_schema.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            schema_dst.write_text("{}", encoding="utf-8")
    created.append(schema_dst)

    if not policy_schema_dst.exists():
        repo_policy_schema = Path.cwd() / "schemas" / "policy.schema.json"
        if repo_policy_schema.exists():
            policy_schema_dst.write_text(
                repo_policy_schema.read_text(encoding="utf-8"), encoding="utf-8"
            )
        else:
            policy_schema_dst.write_text("{}", encoding="utf-8")
    created.append(policy_schema_dst)

    repo_policy_dir = Path.cwd() / "policies"
    if not default_policy_dst.exists():
        repo_default = repo_policy_dir / "default.policy.yaml"
        if repo_default.exists():
            default_policy_dst.write_text(repo_default.read_text(encoding="utf-8"), encoding="utf-8")
    created.append(default_policy_dst)

    if not strict_policy_dst.exists():
        repo_strict = repo_policy_dir / "strict.policy.yaml"
        if repo_strict.exists():
            strict_policy_dst.write_text(repo_strict.read_text(encoding="utf-8"), encoding="utf-8")
    created.append(strict_policy_dst)

    return created


def cmd_init(args: argparse.Namespace) -> int:
    root = Path(args.path).resolve()
    created = _init_schemas_and_policies(root)

    if args.multi_model:
        # Multi-model project structure
        models_dir = root / "models"
        (models_dir / "shared").mkdir(parents=True, exist_ok=True)
        (models_dir / "orders").mkdir(parents=True, exist_ok=True)

        shared_dst = models_dir / "shared" / "shared_dimensions.model.yaml"
        orders_dst = models_dir / "orders" / "orders.model.yaml"
        config_dst = root / "dm.config.yaml"

        if not shared_dst.exists():
            shared_dst.write_text(MULTI_MODEL_SHARED, encoding="utf-8")
        created.append(shared_dst)

        if not orders_dst.exists():
            orders_dst.write_text(MULTI_MODEL_ORDERS, encoding="utf-8")
        created.append(orders_dst)

        if not config_dst.exists():
            config_dst.write_text(
                "schema: schemas/model.schema.json\n"
                "policy_schema: schemas/policy.schema.json\n"
                "policy_pack: policies/default.policy.yaml\n"
                "model_glob: \"models/**/*.model.yaml\"\n"
                "multi_model: true\n"
                "search_dirs:\n"
                "  - models/shared\n"
                "  - models/orders\n",
                encoding="utf-8",
            )
        created.append(config_dst)

        print(f"Initialized multi-model workspace at {root}")
    else:
        # Single-model project structure
        (root / "model-examples").mkdir(parents=True, exist_ok=True)
        sample_dst = root / "model-examples" / "starter.model.yaml"
        config_dst = root / "dm.config.yaml"

        if not sample_dst.exists():
            sample_dst.write_text(STARTER_MODEL, encoding="utf-8")
        created.append(sample_dst)

        if not config_dst.exists():
            config_dst.write_text(
                "schema: schemas/model.schema.json\n"
                "policy_schema: schemas/policy.schema.json\n"
                "policy_pack: policies/default.policy.yaml\n"
                "model_glob: \"**/*.model.yaml\"\n",
                encoding="utf-8",
            )
        created.append(config_dst)

        print(f"Initialized workspace at {root}")

    for path in created:
        print(f"- {path}")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    _, issues = _validate_model_file(args.model, schema)
    _print_issues(issues)
    return 1 if has_errors(issues) else 0


def cmd_lint(args: argparse.Namespace) -> int:
    model = load_yaml_model(args.model)
    issues = lint_issues(model)
    _print_issues(issues)
    return 1 if has_errors(issues) else 0


def cmd_compile(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    model, issues = _validate_model_file(args.model, schema)
    if has_errors(issues):
        _print_issues(issues)
        return 1

    canonical = compile_model(model)
    output = json.dumps(canonical, indent=2, sort_keys=False)

    if args.out:
        Path(args.out).write_text(output + "\n", encoding="utf-8")
        print(f"Wrote canonical model: {args.out}")
    else:
        print(output)

    return 0


def cmd_diff(args: argparse.Namespace) -> int:
    old_model = load_yaml_model(args.old)
    new_model = load_yaml_model(args.new)
    diff = semantic_diff(old_model, new_model)
    print(json.dumps(diff, indent=2))
    return 0


def cmd_validate_all(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    paths = sorted(
        {
            Path(path)
            for path in glob.glob(args.glob, recursive=True)
            if Path(path).is_file()
        }
    )

    if not paths:
        print(f"No files matched glob: {args.glob}")
        return 0

    failing_files = 0
    for path in paths:
        if any(path.match(pattern) for pattern in args.exclude):
            continue

        _, issues = _validate_model_file(str(path), schema)
        _print_issue_block(str(path), issues)
        if has_errors(issues):
            failing_files += 1

    if failing_files:
        print(f"Validation failed for {failing_files} file(s).")
        return 1

    print("All model files passed validation.")
    return 0


def cmd_gate(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)

    old_model, old_issues = _validate_model_file(args.old, schema)
    new_model, new_issues = _validate_model_file(args.new, schema)

    _print_issue_block(f"Old model ({args.old})", old_issues)
    _print_issue_block(f"New model ({args.new})", new_issues)

    combined_issues = list(old_issues) + list(new_issues)
    if has_errors(combined_issues):
        print("Gate failed: model validation errors detected.")
        return 1

    diff = semantic_diff(old_model, new_model)
    if args.output_json:
        print(json.dumps(diff, indent=2))
    else:
        summary = diff["summary"]
        print("Diff summary:")
        print(
            f"  entities +{summary['added_entities']} -{summary['removed_entities']} "
            f"changed:{summary['changed_entities']}"
        )
        print(
            f"  relationships +{summary['added_relationships']} -{summary['removed_relationships']}"
        )
        print(f"  breaking changes: {summary['breaking_change_count']}")
        if diff["breaking_changes"]:
            print("Breaking changes:")
            for item in diff["breaking_changes"]:
                print(f"  - {item}")

    if diff["has_breaking_changes"] and not args.allow_breaking:
        print("Gate failed: breaking changes detected. Use --allow-breaking to bypass.")
        return 2

    print("Gate passed.")
    return 0


def cmd_policy_check(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    policy_schema = load_schema(args.policy_schema)

    model, model_issues = _validate_model_file(args.model, schema)
    policy_pack = load_policy_pack(args.policy)
    policy_pack_issues = schema_issues(policy_pack, policy_schema)

    _print_issue_block(f"Model checks ({args.model})", model_issues)
    _print_issue_block(f"Policy pack checks ({args.policy})", policy_pack_issues)

    if has_errors(model_issues) or has_errors(policy_pack_issues):
        print("Policy check failed: validation errors detected before policy evaluation.")
        return 1

    evaluated_issues = policy_issues(model, policy_pack)
    _print_issue_block("Policy evaluation", evaluated_issues)

    if args.output_json:
        payload = {
            "model": args.model,
            "policy": args.policy,
            "summary": {
                "error_count": len([item for item in evaluated_issues if item.severity == "error"]),
                "warning_count": len([item for item in evaluated_issues if item.severity == "warn"]),
                "info_count": len([item for item in evaluated_issues if item.severity == "info"]),
            },
            "issues": _issues_as_json(evaluated_issues),
        }
        print(json.dumps(payload, indent=2))

    if has_errors(evaluated_issues):
        print("Policy check failed.")
        return 1

    print("Policy check passed.")
    return 0


def cmd_generate_sql(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    model, issues = _validate_model_file(args.model, schema)

    if has_errors(issues):
        _print_issues(issues)
        return 1

    ddl = generate_sql_ddl(model, dialect=args.dialect)
    if args.out:
        Path(args.out).write_text(ddl, encoding="utf-8")
        print(f"Wrote SQL DDL: {args.out}")
    else:
        print(ddl)

    return 0


def cmd_generate_dbt(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    model, issues = _validate_model_file(args.model, schema)

    if has_errors(issues):
        _print_issues(issues)
        return 1

    created = write_dbt_scaffold(
        model=model,
        out_dir=args.out_dir,
        source_name=args.source_name,
        project_name=args.project_name,
    )

    print(f"Created dbt scaffold files ({len(created)}):")
    for path in created:
        print(f"- {path}")

    return 0


def cmd_generate_metadata(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    model, issues = _validate_model_file(args.model, schema)

    if has_errors(issues):
        _print_issues(issues)
        return 1

    canonical = compile_model(model)
    payload = {
        "model": canonical.get("model", {}),
        "summary": {
            "entity_count": len(canonical.get("entities", [])),
            "relationship_count": len(canonical.get("relationships", [])),
            "index_count": len(canonical.get("indexes", [])),
            "glossary_term_count": len(canonical.get("glossary", [])),
            "rule_count": len(canonical.get("rules", [])),
        },
        "entities": canonical.get("entities", []),
        "relationships": canonical.get("relationships", []),
        "indexes": canonical.get("indexes", []),
        "glossary": canonical.get("glossary", []),
        "governance": canonical.get("governance", {}),
        "generated_by": "dm generate metadata",
    }
    output = json.dumps(payload, indent=2)

    if args.out:
        Path(args.out).write_text(output + "\n", encoding="utf-8")
        print(f"Wrote metadata export: {args.out}")
    else:
        print(output)

    return 0


def cmd_import_sql(args: argparse.Namespace) -> int:
    ddl_text = Path(args.input).read_text(encoding="utf-8")
    model = import_sql_ddl(
        ddl_text=ddl_text,
        model_name=args.model_name,
        domain=args.domain,
        owners=args.owner if args.owner else ["data-team@example.com"],
    )

    schema = load_schema(args.schema)
    issues = _combined_issues(model, schema)
    _print_issue_block("Imported model checks", issues)

    if args.out:
        _write_yaml(args.out, model)
        print(f"Wrote imported YAML model: {args.out}")
    else:
        print(yaml.safe_dump(model, sort_keys=False))

    return 1 if has_errors(issues) else 0


def cmd_import_dbml(args: argparse.Namespace) -> int:
    dbml_text = Path(args.input).read_text(encoding="utf-8")
    model = import_dbml(
        dbml_text=dbml_text,
        model_name=args.model_name,
        domain=args.domain,
        owners=args.owner if args.owner else ["data-team@example.com"],
    )

    schema = load_schema(args.schema)
    issues = _combined_issues(model, schema)
    _print_issue_block("Imported model checks", issues)

    if args.out:
        _write_yaml(args.out, model)
        print(f"Wrote imported YAML model: {args.out}")
    else:
        print(yaml.safe_dump(model, sort_keys=False))

    return 1 if has_errors(issues) else 0


def cmd_generate_docs(args: argparse.Namespace) -> int:
    model = load_yaml_model(args.model)
    fmt = args.format

    if fmt == "html":
        if args.out:
            write_html_docs(model, args.out, title=args.title)
            print(f"Wrote HTML docs: {args.out}")
        else:
            print(generate_html_docs(model, title=args.title))
    elif fmt == "markdown":
        if args.out:
            write_markdown_docs(model, args.out, title=args.title)
            print(f"Wrote Markdown docs: {args.out}")
        else:
            print(generate_markdown_docs(model, title=args.title))

    return 0


def cmd_generate_changelog(args: argparse.Namespace) -> int:
    old_model = load_yaml_model(args.old)
    new_model = load_yaml_model(args.new)
    diff = semantic_diff(old_model, new_model)

    old_version = old_model.get("model", {}).get("version", "")
    new_version = new_model.get("model", {}).get("version", "")

    if args.out:
        write_changelog(diff, args.out, old_version=old_version, new_version=new_version)
        print(f"Wrote changelog: {args.out}")
    else:
        print(generate_changelog(diff, old_version=old_version, new_version=new_version))

    return 0


def cmd_fmt(args: argparse.Namespace) -> int:
    model = load_yaml_model(args.model)
    canonical = compile_model(model)
    output = yaml.safe_dump(canonical, sort_keys=False, default_flow_style=False, allow_unicode=True)

    if args.write:
        Path(args.model).write_text(output, encoding="utf-8")
        print(f"Formatted: {args.model}")
    elif args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"Wrote formatted model: {args.out}")
    else:
        print(output)

    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    model = load_yaml_model(args.model)
    entities = model.get("entities", [])
    relationships = model.get("relationships", [])
    indexes = model.get("indexes", [])
    glossary = model.get("glossary", [])
    rules = model.get("rules", [])

    total_fields = sum(len(e.get("fields", [])) for e in entities)
    pk_count = sum(
        1 for e in entities for f in e.get("fields", []) if f.get("primary_key")
    )
    fk_count = sum(
        1 for e in entities for f in e.get("fields", []) if f.get("foreign_key")
    )
    nullable_count = sum(
        1 for e in entities for f in e.get("fields", []) if f.get("nullable", True)
    )
    described_fields = sum(
        1 for e in entities for f in e.get("fields", []) if f.get("description")
    )
    deprecated_count = sum(
        1 for e in entities for f in e.get("fields", []) if f.get("deprecated")
    )
    entity_types = {}
    for e in entities:
        t = e.get("type", "table")
        entity_types[t] = entity_types.get(t, 0) + 1
    subject_areas = set(e.get("subject_area") for e in entities if e.get("subject_area"))
    tags = set()
    for e in entities:
        for t in e.get("tags", []):
            tags.add(t)

    desc_coverage = f"{described_fields}/{total_fields}" if total_fields else "0/0"
    desc_pct = f"{described_fields / total_fields * 100:.0f}%" if total_fields else "0%"

    stats = {
        "model_name": model.get("model", {}).get("name", "unknown"),
        "version": model.get("model", {}).get("version", "unknown"),
        "entity_count": len(entities),
        "entity_types": entity_types,
        "total_fields": total_fields,
        "primary_keys": pk_count,
        "foreign_keys": fk_count,
        "nullable_fields": nullable_count,
        "relationship_count": len(relationships),
        "index_count": len(indexes),
        "glossary_terms": len(glossary),
        "rule_count": len(rules),
        "description_coverage": f"{desc_coverage} ({desc_pct})",
        "deprecated_fields": deprecated_count,
        "subject_areas": sorted(subject_areas),
        "tags": sorted(tags),
    }

    if args.output_json:
        print(json.dumps(stats, indent=2))
    else:
        print(f"Model: {stats['model_name']} v{stats['version']}")
        print(f"Entities: {stats['entity_count']}  ({', '.join(f'{v} {k}' for k, v in entity_types.items())})")
        print(f"Fields: {stats['total_fields']}  (PK: {pk_count}, FK: {fk_count}, nullable: {nullable_count})")
        print(f"Relationships: {stats['relationship_count']}")
        print(f"Indexes: {stats['index_count']}")
        print(f"Glossary terms: {stats['glossary_terms']}")
        print(f"Rules: {stats['rule_count']}")
        print(f"Description coverage: {desc_coverage} ({desc_pct})")
        if deprecated_count:
            print(f"Deprecated fields: {deprecated_count}")
        if subject_areas:
            print(f"Subject areas: {', '.join(sorted(subject_areas))}")
        if tags:
            print(f"Tags: {', '.join(sorted(tags))}")

    return 0


def cmd_resolve(args: argparse.Namespace) -> int:
    search_dirs = args.search_dir if args.search_dir else []
    resolved = resolve_model(args.model, search_dirs=search_dirs)

    if resolved.issues:
        for iss in resolved.issues:
            sev = iss.severity.upper()
            print(f"  [{sev}] {iss.code}: {iss.message}")

    summary = resolved.to_graph_summary()

    if args.output_json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"Root model: {summary['root_model']}")
        print(f"Models resolved: {summary['model_count']}")
        print(f"Total entities: {summary['total_entities']}")
        for m in summary["models"]:
            prefix = "*" if m["is_root"] else " "
            alias = f" (alias: {m.get('alias', '')})" if m.get("alias") else ""
            print(f"  {prefix} {m['name']}{alias}: {m['entity_count']} entities [{', '.join(m['entities'])}]")
        cross = summary["cross_model_relationships"]
        if cross:
            print(f"Cross-model relationships: {len(cross)}")
            for cr in cross:
                print(f"  {cr['from_model']}.{cr['from']} -> {cr['to_model']}.{cr['to']} ({cr['cardinality']})")

    has_errs = any(i.severity == "error" for i in resolved.issues)
    return 1 if has_errs else 0


def cmd_diff_all(args: argparse.Namespace) -> int:
    diff = project_diff(args.old, args.new)

    if args.output_json:
        print(json.dumps(diff, indent=2))
    else:
        s = diff["summary"]
        print(f"Project diff: {args.old} -> {args.new}")
        print(f"  Models: +{s['added_models']} -{s['removed_models']} changed:{s['changed_models']} unchanged:{s['unchanged_models']}")
        if diff["added_models"]:
            print(f"  Added: {', '.join(diff['added_models'])}")
        if diff["removed_models"]:
            print(f"  Removed: {', '.join(diff['removed_models'])}")
        if diff["changed_models"]:
            print(f"  Changed: {', '.join(diff['changed_models'])}")
            for name, mdiff in diff["model_diffs"].items():
                ms = mdiff["summary"]
                print(f"    [{name}] entities +{ms['added_entities']} -{ms['removed_entities']} changed:{ms['changed_entities']}")
        print(f"  Breaking changes: {s['breaking_change_count']}")
        if diff["breaking_changes"]:
            for bc in diff["breaking_changes"]:
                print(f"    - {bc}")

    if diff["has_breaking_changes"] and not args.allow_breaking:
        print("Project diff failed: breaking changes detected. Use --allow-breaking to bypass.")
        return 2

    return 0


def cmd_resolve_project(args: argparse.Namespace) -> int:
    search_dirs = args.search_dir if args.search_dir else []
    results = resolve_project(args.directory, search_dirs=search_dirs)

    total_issues = 0
    all_models = []

    for path, resolved in sorted(results.items()):
        name = resolved.root_model.get("model", {}).get("name", "unknown")
        imports = list(resolved.imported_models.keys())
        entities = [e.get("name", "") for e in resolved.unified_entities()]
        issue_count = len(resolved.issues)
        total_issues += issue_count

        all_models.append({
            "name": name,
            "file": path,
            "imports": imports,
            "entity_count": len(entities),
            "entities": entities,
            "issue_count": issue_count,
            "issues": [
                {"severity": i.severity, "code": i.code, "message": i.message}
                for i in resolved.issues
            ],
        })

    if args.output_json:
        print(json.dumps({"models": all_models, "total_issues": total_issues}, indent=2))
    else:
        print(f"Project: {args.directory}")
        print(f"Models found: {len(all_models)}")
        for m in all_models:
            imp_str = f" (imports: {', '.join(m['imports'])})" if m["imports"] else ""
            status = "OK" if m["issue_count"] == 0 else f"{m['issue_count']} issues"
            print(f"  {m['name']}: {m['entity_count']} entities{imp_str} [{status}]")
            for iss in m["issues"]:
                print(f"    [{iss['severity'].upper()}] {iss['code']}: {iss['message']}")
        print(f"Total issues: {total_issues}")

    return 1 if total_issues > 0 else 0


def cmd_schema(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    print(json.dumps(schema, indent=2))
    return 0


def cmd_policy_schema(args: argparse.Namespace) -> int:
    schema = load_schema(args.policy_schema)
    print(json.dumps(schema, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dm", description="DataLex CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    init_parser = sub.add_parser("init", help="Initialize a new workspace")
    init_parser.add_argument("--path", default=".", help="Workspace path")
    init_parser.add_argument("--multi-model", action="store_true", help="Create a multi-model project structure with domain directories")
    init_parser.set_defaults(func=cmd_init)

    validate_parser = sub.add_parser("validate", help="Validate model with schema + semantic rules")
    validate_parser.add_argument("model", help="Path to model YAML")
    validate_parser.add_argument("--schema", default=_default_schema_path(), help="Path to JSON schema")
    validate_parser.set_defaults(func=cmd_validate)

    lint_parser = sub.add_parser("lint", help="Run semantic lint checks")
    lint_parser.add_argument("model", help="Path to model YAML")
    lint_parser.set_defaults(func=cmd_lint)

    compile_parser = sub.add_parser("compile", help="Compile model to canonical JSON")
    compile_parser.add_argument("model", help="Path to model YAML")
    compile_parser.add_argument("--schema", default=_default_schema_path(), help="Path to JSON schema")
    compile_parser.add_argument("--out", help="Output file for canonical JSON")
    compile_parser.set_defaults(func=cmd_compile)

    diff_parser = sub.add_parser("diff", help="Semantic diff between two model files")
    diff_parser.add_argument("old", help="Old model YAML path")
    diff_parser.add_argument("new", help="New model YAML path")
    diff_parser.set_defaults(func=cmd_diff)

    validate_all_parser = sub.add_parser(
        "validate-all", help="Validate all model files matching a glob"
    )
    validate_all_parser.add_argument(
        "--glob", default="**/*.model.yaml", help="Glob pattern for model files"
    )
    validate_all_parser.add_argument(
        "--exclude",
        nargs="*",
        default=["**/node_modules/**", "**/.git/**", "**/.venv/**"],
        help="Glob-style path patterns to exclude",
    )
    validate_all_parser.add_argument(
        "--schema", default=_default_schema_path(), help="Path to JSON schema"
    )
    validate_all_parser.set_defaults(func=cmd_validate_all)

    gate_parser = sub.add_parser(
        "gate",
        help="PR gate: validate old/new models and fail on breaking changes by default",
    )
    gate_parser.add_argument("old", help="Old model YAML path")
    gate_parser.add_argument("new", help="New model YAML path")
    gate_parser.add_argument(
        "--schema", default=_default_schema_path(), help="Path to JSON schema"
    )
    gate_parser.add_argument(
        "--allow-breaking",
        action="store_true",
        help="Allow breaking changes (still fails on validation errors)",
    )
    gate_parser.add_argument(
        "--output-json", action="store_true", help="Print semantic diff as JSON"
    )
    gate_parser.set_defaults(func=cmd_gate)

    policy_parser = sub.add_parser("policy-check", help="Evaluate a model against a policy pack")
    policy_parser.add_argument("model", help="Path to model YAML")
    policy_parser.add_argument(
        "--policy", default=_default_policy_path(), help="Path to policy pack YAML"
    )
    policy_parser.add_argument(
        "--schema", default=_default_schema_path(), help="Path to model schema JSON"
    )
    policy_parser.add_argument(
        "--policy-schema",
        default=_default_policy_schema_path(),
        help="Path to policy schema JSON",
    )
    policy_parser.add_argument("--output-json", action="store_true", help="Print policy output as JSON")
    policy_parser.set_defaults(func=cmd_policy_check)

    generate_parser = sub.add_parser("generate", help="Generate artifacts from model YAML")
    generate_sub = generate_parser.add_subparsers(dest="generate_command", required=True)

    gen_sql_parser = generate_sub.add_parser("sql", help="Generate SQL DDL")
    gen_sql_parser.add_argument("model", help="Path to model YAML")
    gen_sql_parser.add_argument("--dialect", default="postgres", choices=["postgres", "snowflake", "bigquery", "databricks"])
    gen_sql_parser.add_argument("--out", help="Output SQL file path")
    gen_sql_parser.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    gen_sql_parser.set_defaults(func=cmd_generate_sql)

    gen_dbt_parser = generate_sub.add_parser("dbt", help="Generate dbt project scaffold")
    gen_dbt_parser.add_argument("model", help="Path to model YAML")
    gen_dbt_parser.add_argument("--out-dir", required=True, help="Target directory for scaffold files")
    gen_dbt_parser.add_argument("--source-name", default="raw", help="dbt source name")
    gen_dbt_parser.add_argument("--project-name", default="data_modeling_mvp", help="dbt project name")
    gen_dbt_parser.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    gen_dbt_parser.set_defaults(func=cmd_generate_dbt)

    gen_metadata_parser = generate_sub.add_parser("metadata", help="Generate metadata JSON export")
    gen_metadata_parser.add_argument("model", help="Path to model YAML")
    gen_metadata_parser.add_argument("--out", help="Output metadata JSON path")
    gen_metadata_parser.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    gen_metadata_parser.set_defaults(func=cmd_generate_metadata)

    gen_docs_parser = generate_sub.add_parser("docs", help="Generate data dictionary documentation")
    gen_docs_parser.add_argument("model", help="Path to model YAML")
    gen_docs_parser.add_argument("--format", default="html", choices=["html", "markdown"], help="Output format")
    gen_docs_parser.add_argument("--out", help="Output file path")
    gen_docs_parser.add_argument("--title", help="Custom page title")
    gen_docs_parser.set_defaults(func=cmd_generate_docs)

    gen_changelog_parser = generate_sub.add_parser("changelog", help="Generate changelog from model diff")
    gen_changelog_parser.add_argument("old", help="Old model YAML path")
    gen_changelog_parser.add_argument("new", help="New model YAML path")
    gen_changelog_parser.add_argument("--out", help="Output changelog file path")
    gen_changelog_parser.set_defaults(func=cmd_generate_changelog)

    import_parser = sub.add_parser("import", help="Import SQL/DBML into model YAML")
    import_sub = import_parser.add_subparsers(dest="import_command", required=True)

    import_sql_parser = import_sub.add_parser("sql", help="Import SQL DDL file")
    import_sql_parser.add_argument("input", help="Path to SQL DDL file")
    import_sql_parser.add_argument("--out", help="Write output YAML model file")
    import_sql_parser.add_argument("--model-name", default="imported_sql_model", help="Model name")
    import_sql_parser.add_argument("--domain", default="imported", help="Domain value")
    import_sql_parser.add_argument(
        "--owner",
        action="append",
        default=[],
        help="Owner email (repeatable)",
    )
    import_sql_parser.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    import_sql_parser.set_defaults(func=cmd_import_sql)

    import_dbml_parser = import_sub.add_parser("dbml", help="Import DBML file")
    import_dbml_parser.add_argument("input", help="Path to DBML file")
    import_dbml_parser.add_argument("--out", help="Write output YAML model file")
    import_dbml_parser.add_argument("--model-name", default="imported_dbml_model", help="Model name")
    import_dbml_parser.add_argument("--domain", default="imported", help="Domain value")
    import_dbml_parser.add_argument(
        "--owner",
        action="append",
        default=[],
        help="Owner email (repeatable)",
    )
    import_dbml_parser.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    import_dbml_parser.set_defaults(func=cmd_import_dbml)

    resolve_parser = sub.add_parser("resolve", help="Resolve cross-model imports and show unified graph")
    resolve_parser.add_argument("model", help="Path to root model YAML")
    resolve_parser.add_argument(
        "--search-dir",
        action="append",
        default=[],
        help="Additional directories to search for imported models (repeatable)",
    )
    resolve_parser.add_argument("--output-json", action="store_true", help="Print graph as JSON")
    resolve_parser.set_defaults(func=cmd_resolve)

    resolve_project_parser = sub.add_parser("resolve-project", help="Resolve all models in a project directory")
    resolve_project_parser.add_argument("directory", help="Project directory path")
    resolve_project_parser.add_argument(
        "--search-dir",
        action="append",
        default=[],
        help="Additional search directories (repeatable)",
    )
    resolve_project_parser.add_argument("--output-json", action="store_true", help="Print results as JSON")
    resolve_project_parser.set_defaults(func=cmd_resolve_project)

    diff_all_parser = sub.add_parser("diff-all", help="Semantic diff between two model directories")
    diff_all_parser.add_argument("old", help="Old model directory")
    diff_all_parser.add_argument("new", help="New model directory")
    diff_all_parser.add_argument("--output-json", action="store_true", help="Print diff as JSON")
    diff_all_parser.add_argument(
        "--allow-breaking",
        action="store_true",
        help="Allow breaking changes (exit 0 even with breaking changes)",
    )
    diff_all_parser.set_defaults(func=cmd_diff_all)

    fmt_parser = sub.add_parser("fmt", help="Auto-format YAML model to canonical style")
    fmt_parser.add_argument("model", help="Path to model YAML")
    fmt_parser.add_argument("--write", "-w", action="store_true", help="Overwrite the input file in-place")
    fmt_parser.add_argument("--out", help="Output file path (alternative to --write)")
    fmt_parser.set_defaults(func=cmd_fmt)

    stats_parser = sub.add_parser("stats", help="Print model statistics")
    stats_parser.add_argument("model", help="Path to model YAML")
    stats_parser.add_argument("--output-json", action="store_true", help="Print stats as JSON")
    stats_parser.set_defaults(func=cmd_stats)

    schema_parser = sub.add_parser("print-schema", help="Print active model schema JSON")
    schema_parser.add_argument("--schema", default=_default_schema_path(), help="Path to JSON schema")
    schema_parser.set_defaults(func=cmd_schema)

    policy_schema_parser = sub.add_parser("print-policy-schema", help="Print policy schema JSON")
    policy_schema_parser.add_argument(
        "--policy-schema",
        default=_default_policy_schema_path(),
        help="Path to policy schema JSON",
    )
    policy_schema_parser.set_defaults(func=cmd_policy_schema)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
