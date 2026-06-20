"""DataLex loader, snippet expansion, diff, and migrator smoke tests.

These cover the Phase A vertical slice: kind-dispatched YAML load, snippet
`use:` inlining, explicit rename tracking, and v3→DataLex migration.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))

from datalex_core.datalex import load_project
from datalex_core.datalex.diff import diff_entities
from datalex_core.datalex.manifest import build_manifest, manifest_summary
from datalex_core.datalex.migrate_layout import migrate_project
from datalex_core.datalex.types import parse_type


def _write(p: Path, body: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body, encoding="utf-8")


def _mk_project(root: Path) -> None:
    _write(root / "datalex.yaml", "kind: project\nname: t\nversion: '1'\n")
    _write(
        root / "models" / "physical" / "postgres" / "customer.yaml",
        "kind: entity\nlayer: physical\ndialect: postgres\nname: customer\n"
        "columns:\n"
        "  - name: id\n    type: bigint\n    primary_key: true\n    nullable: false\n"
        "  - name: email\n    type: string(320)\n    use: pii_email\n",
    )
    _write(
        root / ".datalex" / "snippets" / "pii_email.yaml",
        "kind: snippet\nname: pii_email\ntargets: [column]\napply:\n  sensitivity: pii-email\n  tags: [pii]\n",
    )


class TypeParserTests(unittest.TestCase):
    def test_parameterized_and_composite(self) -> None:
        self.assertEqual(parse_type("decimal(12,2)").kind, "decimal")
        self.assertEqual(parse_type("array<string>").kind, "array")
        self.assertEqual(parse_type("map<string,integer>").kind, "map")
        s = parse_type("struct<a:string,b:integer>")
        self.assertEqual(s.kind, "struct")
        self.assertEqual([f[0] for f in s.fields], ["a", "b"])


class ProjectLoaderTests(unittest.TestCase):
    def test_loads_and_expands_snippet(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _mk_project(root)
            project = load_project(root, strict=True)
            self.assertEqual(1, len(project.entities))
            email_col = next(
                c for c in project.entity("customer").get("columns", []) if c["name"] == "email"
            )
            self.assertEqual("pii-email", email_col.get("sensitivity"))
            self.assertIn("pii", email_col.get("tags", []))

    def test_discovers_new_and_legacy_diagram_folders_without_manifest_glob(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "new"
            legacy_root = Path(tmp) / "legacy"
            _write(root / "datalex.yaml", "kind: project\nname: t\nversion: '1'\n")
            _write(
                root / "DataLex" / "sales" / "Conceptual" / "sales.diagram.yaml",
                "kind: diagram\nname: sales\nlayer: conceptual\nentities: []\nrelationships: []\n",
            )
            project = load_project(root, strict=True)
            self.assertEqual({"sales"}, set(project.diagrams.keys()))

            _write(legacy_root / "datalex.yaml", "kind: project\nname: legacy_t\nversion: '1'\n")
            _write(
                legacy_root / "datalex" / "diagrams" / "legacy.diagram.yaml",
                "kind: diagram\nname: legacy\nlayer: physical\nentities: []\nrelationships: []\n",
            )
            legacy_project = load_project(legacy_root, strict=True)
            self.assertEqual({"legacy"}, set(legacy_project.diagrams.keys()))

    def test_loads_canonical_modeling_primitives(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root / "datalex.yaml",
                "kind: project\nname: t\nversion: '1'\ndialects: [postgres]\ndefault_dialect: postgres\n",
            )
            _write(
                root / "models" / "conceptual" / "customer.yaml",
                "kind: entity\nlayer: conceptual\nname: customer\n"
                "logical_name: Customer\ndescription: A buyer or account.\ndomain: sales\n",
            )
            _write(
                root / "models" / "conceptual" / "order.yaml",
                "kind: entity\nlayer: conceptual\nname: order\ndescription: A commercial order.\ndomain: sales\n",
            )
            _write(
                root / "relationships" / "customer_places_order.yaml",
                "kind: relationship\nlayer: conceptual\nname: customer_places_order\n"
                "from: {entity: customer}\nto: {entity: order}\n"
                "cardinality: one_to_many\nrole_name: places\n",
            )
            _write(
                root / "data_types" / "email.yaml",
                "kind: data_type\nname: email\nbase: string\nprecision: any\n"
                "physical:\n  postgres: {type: varchar(320)}\n",
            )
            _write(
                root / "semantic" / "customer_metrics.yaml",
                "kind: semantic_model\nname: customer_metrics\nentity: customer\n"
                "metrics:\n  - name: customer_count\n    type: simple\n",
            )

            project = load_project(root, strict=True)

            self.assertEqual("Customer", project.entity("customer", layer="conceptual")["logical_name"])
            self.assertIn("customer_places_order", project.relationships)
            self.assertIn("email", project.data_types)
            self.assertIn("customer_metrics", project.semantic_models)

    def test_loads_contracts_and_manifest_exports_only_certified(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root / "datalex.yaml", "kind: project\nname: t\nversion: '1'\n")
            _write(
                root / "models" / "dbt" / "fct_orders.yaml",
                "kind: model\nname: fct_orders\ndomain: commerce\n"
                "columns:\n"
                "  - name: order_id\n    type: bigint\n    constraints: [{type: primary_key}]\n",
            )
            _write(
                root / "contracts" / "orders.contract.yaml",
                "kind: contract\nname: monthly_orders\ndomain: commerce\nentity: Order\n"
                "version: 1\nstatus: certified\nowner: data@example.com\n"
                "source: {kind: dbt_model, ref: model.acme.fct_orders}\n"
                "signature:\n  outputs:\n    - {name: order_count, type: integer}\n",
            )
            _write(
                root / "contracts" / "draft.contract.yaml",
                "kind: contract\nname: draft_metric\ndomain: commerce\nentity: Order\n"
                "version: 1\nstatus: draft\n",
            )
            _write(
                root / ".datalex" / "proposals" / "orders.yaml",
                "kind: proposal\nname: orders_contract\nproposal_type: dbt_contract\nstatus: draft\n"
                "target: fct_orders\n",
            )

            project = load_project(root, strict=True)
            self.assertEqual(2, len(project.contracts))
            self.assertEqual(1, len(project.proposals))

            manifest = build_manifest(project)
            summary = manifest_summary(manifest)
            self.assertEqual(1, summary["contracts"])
            commerce = next(d for d in manifest["domains"] if d["name"] == "commerce")
            contracts = [
                c
                for entity in commerce["entities"]
                for c in entity.get("contracts", [])
            ]
            self.assertEqual(["commerce.Order.monthly_orders"], [c["id"] for c in contracts])

    def test_loads_domain_first_contracts_proposals_and_metric_contracts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root / "datalex.yaml",
                "kind: project\nname: t\nversion: '1'\n"
                "models:\n"
                "  - '*/conceptual/**/*.yaml'\n"
                "  - '*/logical/**/*.yaml'\n"
                "  - '*/physical/**/*.yaml'\n"
                "domains: domains/**/*.yaml\n"
                "diagrams:\n"
                "  - '*/conceptual/**/*.yaml'\n"
                "  - '*/logical/**/*.yaml'\n"
                "  - '*/physical/**/*.yaml'\n"
                "contracts: '*/contracts/**/*.yaml'\n"
                "proposals: '*/proposals/**/*.yaml'\n"
                "metric_contracts: '*/semantic/**/*.yaml'\n",
            )
            _write(
                root / "domains" / "commerce.yaml",
                "kind: domain\nname: commerce\ndescription: Commercial order and revenue logic.\n",
            )
            _write(
                root / "commerce" / "conceptual" / "revenue.diagram.yaml",
                "kind: diagram\nname: revenue\nlayer: conceptual\ndomain: commerce\nentities: []\nrelationships: []\n",
            )
            _write(
                root / "commerce" / "contracts" / "orders.contract.yaml",
                "kind: contract\nname: order_revenue\ndomain: commerce\nentity: OrderRevenue\n"
                "version: 1\nstatus: certified\nsource: {kind: dbt_model, ref: model.acme.fct_orders}\n",
            )
            _write(
                root / "commerce" / "proposals" / "orders.proposal.yaml",
                "kind: proposal\nname: orders_pack\nproposal_type: datalex_contract\nstatus: draft\n"
                "domain: commerce\ntarget: fct_orders\n",
            )
            _write(
                root / "commerce" / "semantic" / "revenue.metric.yaml",
                "kind: metric_contract\nname: revenue\ndomain: commerce\nstatus: certified\n"
                "formula: sum(order_item_revenue)\ngrain: order_item_id\ntime_dimension: ordered_at\n"
                "dependencies: [\"ref('order_items')\"]\nowner: analytics\n",
            )
            _write(
                root / "commerce" / "semantic" / "draft.metric.yaml",
                "kind: metric_contract\nname: draft_metric\ndomain: commerce\nstatus: draft\nformula: count(*)\n",
            )

            project = load_project(root, strict=True)
            self.assertEqual({"revenue"}, set(project.diagrams.keys()))
            self.assertEqual(1, len(project.contracts))
            self.assertEqual(1, len(project.proposals))
            self.assertEqual(2, len(project.metric_contracts))

            manifest = build_manifest(project)
            summary = manifest_summary(manifest)
            self.assertEqual(1, summary["contracts"])
            self.assertEqual(1, summary["metrics"])
            commerce = next(d for d in manifest["domains"] if d["name"] == "commerce")
            self.assertEqual(["commerce.metric.revenue"], [m["id"] for m in commerce["metrics"]])

    def test_relationship_validation_is_layer_aware(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root / "datalex.yaml", "kind: project\nname: t\nversion: '1'\n")
            _write(
                root / "models" / "logical" / "customer.yaml",
                "kind: entity\nlayer: logical\nname: customer\ncolumns:\n  - name: id\n    type: string\n",
            )
            _write(
                root / "relationships" / "bad.yaml",
                "kind: relationship\nlayer: logical\nname: bad_rel\n"
                "from: {entity: customer, column: missing_id}\nto: {entity: order, column: id}\n",
            )

            project = load_project(root, strict=False)
            codes = {err["code"] for err in project.errors.to_list()}
            self.assertIn("REL_COLUMN_MISSING", codes)
            self.assertIn("REL_TARGET_MISSING", codes)

    def test_enterprise_modeling_fixture_loads(self) -> None:
        fixture = ROOT / "model-examples" / "enterprise-modeling-foundation"
        project = load_project(fixture, strict=True)
        self.assertEqual(6, len(project.entities))
        self.assertEqual(2, len(project.relationships))
        self.assertEqual(3, len(project.data_types))
        self.assertEqual(1, len(project.semantic_models))
        self.assertEqual(3, len(project.diagrams))


class DiffTests(unittest.TestCase):
    def test_explicit_rename_is_not_drop_add(self) -> None:
        old = {
            "physical:customer": {
                "kind": "entity", "layer": "physical", "dialect": "postgres",
                "name": "customer", "columns": [{"name": "id", "type": "bigint"}],
            }
        }
        new = {
            "physical:party": {
                "kind": "entity", "layer": "physical", "dialect": "postgres",
                "name": "party", "previous_name": "customer",
                "columns": [{"name": "id", "type": "bigint"}],
            }
        }
        result = diff_entities(old, new)
        self.assertEqual(result["renamed"], [("physical:customer", "physical:party")])
        self.assertEqual(result["added"], [])
        self.assertEqual(result["removed"], [])

    def test_column_type_change_is_breaking(self) -> None:
        old = {
            "physical:x": {
                "kind": "entity", "layer": "physical", "name": "x",
                "columns": [{"name": "a", "type": "integer"}],
            }
        }
        new = {
            "physical:x": {
                "kind": "entity", "layer": "physical", "name": "x",
                "columns": [{"name": "a", "type": "bigint"}],
            }
        }
        result = diff_entities(old, new)
        self.assertTrue(any("type changed" in b for b in result["breaking"]))


class MigratorTests(unittest.TestCase):
    def test_migrates_starter_commerce(self) -> None:
        v3 = ROOT / "model-examples" / "starter-commerce.model.yaml"
        if not v3.exists():
            self.skipTest("starter-commerce.model.yaml not present")
        with tempfile.TemporaryDirectory() as tmp:
            report = migrate_project(str(v3), output_root=tmp, default_dialect="postgres")
            self.assertTrue(report.manifest_written)
            self.assertGreater(report.entities_written, 0)
            project = load_project(tmp, strict=True)
            self.assertEqual(report.entities_written, len(project.entities))


if __name__ == "__main__":
    unittest.main()
