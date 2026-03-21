import sys
import unittest
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))

from dm_core.diffing import semantic_diff
from dm_core.modeling import transform_model
from dm_core.policy import policy_issues
from dm_core.schema import load_schema, schema_issues
from dm_core.semantic import lint_issues


SCHEMA_PATH = str(ROOT / "schemas" / "model.schema.json")
POLICY_SCHEMA_PATH = str(ROOT / "schemas" / "policy.schema.json")


def _schema():
    return load_schema(SCHEMA_PATH)


def _policy_schema():
    return load_schema(POLICY_SCHEMA_PATH)


def _phase1_logical_model() -> Dict[str, Any]:
    return {
        "model": {
            "name": "phase1_core",
            "kind": "logical",
            "spec_version": 3,
            "version": "1.0.0",
            "domain": "sales",
            "owners": ["data@example.com"],
            "state": "draft",
        },
        "entities": [
            {
                "name": "CustomerHub",
                "type": "hub",
                "description": "Customer hub.",
                "owner": "vault@example.com",
                "business_keys": [["customer_id"]],
                "hash_key": "customer_hk",
                "load_timestamp_field": "loaded_at",
                "record_source_field": "record_source",
                "fields": [
                    {"name": "customer_hk", "type": "string", "primary_key": True, "nullable": False, "description": "Hash key."},
                    {"name": "customer_id", "type": "string", "nullable": False, "description": "Business key."},
                    {"name": "loaded_at", "type": "timestamp", "nullable": False, "description": "Load time."},
                    {"name": "record_source", "type": "string", "nullable": False, "description": "Record source."},
                ],
            },
            {
                "name": "OrderHub",
                "type": "hub",
                "description": "Order hub.",
                "owner": "vault@example.com",
                "business_keys": [["order_id"]],
                "hash_key": "order_hk",
                "load_timestamp_field": "loaded_at",
                "record_source_field": "record_source",
                "fields": [
                    {"name": "order_hk", "type": "string", "primary_key": True, "nullable": False, "description": "Hash key."},
                    {"name": "order_id", "type": "string", "nullable": False, "description": "Business key."},
                    {"name": "loaded_at", "type": "timestamp", "nullable": False, "description": "Load time."},
                    {"name": "record_source", "type": "string", "nullable": False, "description": "Record source."},
                ],
            },
            {
                "name": "CustomerSat",
                "type": "satellite",
                "description": "Customer attributes satellite.",
                "owner": "vault@example.com",
                "parent_entity": "CustomerHub",
                "hash_diff_fields": ["customer_name"],
                "load_timestamp_field": "loaded_at",
                "record_source_field": "record_source",
                "fields": [
                    {"name": "customer_hk", "type": "string", "nullable": False, "description": "Parent key."},
                    {"name": "customer_name", "type": "string", "nullable": False, "description": "Customer name."},
                    {"name": "loaded_at", "type": "timestamp", "nullable": False, "description": "Load time."},
                    {"name": "record_source", "type": "string", "nullable": False, "description": "Record source."},
                ],
            },
            {
                "name": "OrderCustomerLink",
                "type": "link",
                "description": "Customer to order link.",
                "owner": "vault@example.com",
                "link_refs": ["CustomerHub", "OrderHub"],
                "hash_key": "order_customer_hk",
                "load_timestamp_field": "loaded_at",
                "record_source_field": "record_source",
                "fields": [
                    {"name": "order_customer_hk", "type": "string", "primary_key": True, "nullable": False, "description": "Hash key."},
                    {"name": "customer_hk", "type": "string", "nullable": False, "description": "Customer hash key."},
                    {"name": "order_hk", "type": "string", "nullable": False, "description": "Order hash key."},
                    {"name": "loaded_at", "type": "timestamp", "nullable": False, "description": "Load time."},
                    {"name": "record_source", "type": "string", "nullable": False, "description": "Record source."},
                ],
            },
            {
                "name": "CustomerDim",
                "type": "dimension_table",
                "description": "Customer dimension.",
                "owner": "mart@example.com",
                "natural_key": "customer_id",
                "surrogate_key": "customer_sk",
                "scd_type": 2,
                "conformed": True,
                "fields": [
                    {"name": "customer_sk", "type": "integer", "primary_key": True, "nullable": False, "description": "Surrogate key."},
                    {"name": "customer_id", "type": "string", "nullable": False, "description": "Natural key."},
                    {"name": "customer_name", "type": "string", "nullable": False, "description": "Customer name."},
                    {"name": "effective_from", "type": "date", "nullable": False, "description": "Effective from."},
                    {"name": "effective_to", "type": "date", "nullable": False, "description": "Effective to."},
                    {"name": "is_current", "type": "boolean", "nullable": False, "description": "Current flag."},
                ],
            },
            {
                "name": "SalesFact",
                "type": "fact_table",
                "description": "Sales fact.",
                "owner": "mart@example.com",
                "grain": ["order_id"],
                "dimension_refs": ["CustomerDim"],
                "fields": [
                    {"name": "order_id", "type": "string", "primary_key": True, "nullable": False, "description": "Order key."},
                    {"name": "customer_sk", "type": "integer", "nullable": False, "foreign_key": True, "description": "Dimension key."},
                    {"name": "net_amount", "type": "decimal(12,2)", "nullable": False, "description": "Net amount."},
                ],
            },
            {
                "name": "Party",
                "type": "logical_entity",
                "description": "Party supertype.",
                "owner": "modeler@example.com",
                "subtypes": ["Employee"],
                "candidate_keys": [["party_code"]],
                "fields": [
                    {"name": "party_code", "type": "string", "nullable": False, "description": "Party code."},
                ],
            },
            {
                "name": "Employee",
                "type": "logical_entity",
                "description": "Employee subtype.",
                "owner": "modeler@example.com",
                "subtype_of": "Party",
                "candidate_keys": [["party_code"]],
                "fields": [
                    {"name": "party_code", "type": "string", "nullable": False, "description": "Inherited party code."},
                    {"name": "employee_number", "type": "string", "nullable": False, "description": "Employee number."},
                ],
            },
        ],
        "relationships": [
            {
                "name": "sales_customer",
                "from": "SalesFact.customer_sk",
                "to": "CustomerDim.customer_sk",
                "cardinality": "many_to_one",
            }
        ],
    }


class TestPhase1Schema(unittest.TestCase):
    def test_schema_accepts_data_vault_primitives(self):
        issues = schema_issues(_phase1_logical_model(), _schema())
        self.assertEqual(len(issues), 0, issues)

    def test_policy_schema_accepts_modeling_convention(self):
        pack = {
            "pack": {"name": "phase1", "version": "1.0.0"},
            "policies": [{"id": "MC", "type": "modeling_convention", "severity": "warn", "params": {}}],
        }
        issues = schema_issues(pack, _policy_schema())
        self.assertEqual(len(issues), 0, issues)


class TestPhase1Lint(unittest.TestCase):
    def test_lint_detects_data_vault_and_dimensional_errors(self):
        model = _phase1_logical_model()
        model["entities"][0].pop("business_keys")
        model["entities"][2]["parent_entity"] = "CustomerDim"
        model["entities"][5]["dimension_refs"] = ["CustomerHub"]
        issues = lint_issues(model)
        codes = {issue.code for issue in issues}
        self.assertIn("HUB_MISSING_BUSINESS_KEYS", codes)
        self.assertIn("SATELLITE_PARENT_WRONG_TYPE", codes)
        self.assertIn("DIMENSION_REF_WRONG_TYPE", codes)

    def test_lint_detects_subtype_cycle_and_duplicate_candidate_key_fields(self):
        model = _phase1_logical_model()
        party = next(entity for entity in model["entities"] if entity["name"] == "Party")
        employee = next(entity for entity in model["entities"] if entity["name"] == "Employee")
        party["subtype_of"] = "Employee"
        employee["candidate_keys"] = [["party_code", "party_code"]]
        issues = lint_issues(model)
        codes = {issue.code for issue in issues}
        self.assertIn("SUBTYPE_CYCLE_DETECTED", codes)
        self.assertIn("CANDIDATE_KEY_DUPLICATE_FIELD", codes)


class TestPhase1Transform(unittest.TestCase):
    def test_logical_to_physical_preserves_phase1_primitives(self):
        physical = transform_model(_phase1_logical_model(), "physical", dialect="snowflake")
        self.assertEqual(physical["model"]["kind"], "physical")
        entity_types = {entity["name"]: entity["type"] for entity in physical["entities"]}
        self.assertEqual(entity_types["CustomerHub"], "hub")
        self.assertEqual(entity_types["OrderCustomerLink"], "link")
        self.assertEqual(entity_types["CustomerSat"], "satellite")


class TestPhase1Policy(unittest.TestCase):
    def test_modeling_convention_policy_passes_for_valid_model(self):
        policy_pack = {
            "pack": {"name": "phase1", "version": "1.0.0"},
            "policies": [
                {
                    "id": "MC",
                    "type": "modeling_convention",
                    "severity": "error",
                    "params": {
                        "allowed_model_kinds": ["logical"],
                        "allowed_entity_types": ["hub", "link", "satellite", "dimension_table", "fact_table", "logical_entity"],
                        "require_candidate_keys_for_types": ["logical_entity"],
                        "require_dimension_refs_for_types": ["fact_table"],
                        "require_data_vault_metadata": True,
                    },
                }
            ],
        }
        issues = policy_issues(_phase1_logical_model(), policy_pack)
        self.assertEqual(len(issues), 0, issues)

    def test_modeling_convention_policy_fails_when_structure_is_missing(self):
        model = _phase1_logical_model()
        fact = next(entity for entity in model["entities"] if entity["name"] == "SalesFact")
        fact["dimension_refs"] = []
        employee = next(entity for entity in model["entities"] if entity["name"] == "Employee")
        employee["candidate_keys"] = []

        policy_pack = {
            "pack": {"name": "phase1", "version": "1.0.0"},
            "policies": [
                {
                    "id": "MC",
                    "type": "modeling_convention",
                    "severity": "error",
                    "params": {
                        "require_candidate_keys_for_types": ["logical_entity"],
                        "require_dimension_refs_for_types": ["fact_table"],
                    },
                }
            ],
        }
        issues = policy_issues(model, policy_pack)
        messages = "\n".join(issue.message for issue in issues)
        self.assertIn("Employee", messages)
        self.assertIn("SalesFact", messages)


class TestPhase1Diff(unittest.TestCase):
    def test_diff_marks_phase1_metadata_and_layer_changes_as_breaking(self):
        old = transform_model(_phase1_logical_model(), "physical")
        old["model"]["layer"] = "transform"

        new = deepcopy(old)
        new["model"]["layer"] = "report"
        customer_dim = next(entity for entity in new["entities"] if entity["name"] == "CustomerDim")
        customer_dim["natural_key"] = "customer_name"

        diff = semantic_diff(old, new)
        self.assertTrue(diff["has_breaking_changes"])
        self.assertTrue(any("Model layer changed" in change for change in diff["breaking_changes"]))
        self.assertTrue(any("CustomerDim.natural_key" in change for change in diff["breaking_changes"]))


if __name__ == "__main__":
    unittest.main()
