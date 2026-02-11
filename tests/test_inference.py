"""Tests for PK/FK inference engine in base connector."""

import pytest
from dm_core.connectors.base import infer_primary_keys, infer_relationships


# ---------------------------------------------------------------------------
# Test data: simulates a Snowflake/BigQuery pull with NO constraints
# ---------------------------------------------------------------------------

def _make_entities():
    """Typical e-commerce schema with naming conventions but no PK/FK defined."""
    return [
        {
            "name": "Users",
            "type": "table",
            "fields": [
                {"name": "id", "type": "bigint", "nullable": True},
                {"name": "email", "type": "string", "nullable": True},
                {"name": "name", "type": "string", "nullable": True},
                {"name": "created_at", "type": "timestamp", "nullable": True},
            ],
        },
        {
            "name": "Orders",
            "type": "table",
            "fields": [
                {"name": "id", "type": "bigint", "nullable": True},
                {"name": "user_id", "type": "bigint", "nullable": True},
                {"name": "total", "type": "decimal", "nullable": True},
                {"name": "status", "type": "string", "nullable": True},
            ],
        },
        {
            "name": "OrderItems",
            "type": "table",
            "fields": [
                {"name": "id", "type": "bigint", "nullable": True},
                {"name": "order_id", "type": "bigint", "nullable": True},
                {"name": "product_id", "type": "bigint", "nullable": True},
                {"name": "quantity", "type": "integer", "nullable": True},
                {"name": "price", "type": "decimal", "nullable": True},
            ],
        },
        {
            "name": "Products",
            "type": "table",
            "fields": [
                {"name": "product_id", "type": "bigint", "nullable": True},
                {"name": "name", "type": "string", "nullable": True},
                {"name": "category_id", "type": "bigint", "nullable": True},
                {"name": "price", "type": "decimal", "nullable": True},
            ],
        },
        {
            "name": "Categories",
            "type": "table",
            "fields": [
                {"name": "category_id", "type": "bigint", "nullable": True},
                {"name": "name", "type": "string", "nullable": True},
                {"name": "parent_id", "type": "bigint", "nullable": True},
            ],
        },
    ]


# ---------------------------------------------------------------------------
# PK inference tests
# ---------------------------------------------------------------------------

class TestInferPrimaryKeys:
    def test_infers_id_column(self):
        entities = _make_entities()
        result, msgs = infer_primary_keys(entities)
        # Users, Orders, OrderItems all have 'id' → should be PK
        for ename in ("Users", "Orders", "OrderItems"):
            ent = next(e for e in result if e["name"] == ename)
            id_field = next(f for f in ent["fields"] if f["name"] == "id")
            assert id_field["primary_key"] is True
            assert id_field["nullable"] is False

    def test_infers_table_name_id(self):
        entities = _make_entities()
        result, msgs = infer_primary_keys(entities)
        # Products has 'product_id' → matches entity name pattern
        products = next(e for e in result if e["name"] == "Products")
        pk = next(f for f in products["fields"] if f["name"] == "product_id")
        assert pk["primary_key"] is True

    def test_skips_entities_with_existing_pk(self):
        entities = [
            {
                "name": "Existing",
                "type": "table",
                "fields": [
                    {"name": "id", "type": "bigint", "nullable": False, "primary_key": True},
                    {"name": "name", "type": "string", "nullable": True},
                ],
            }
        ]
        result, msgs = infer_primary_keys(entities)
        assert len(msgs) == 0  # no inference needed

    def test_no_fields_no_crash(self):
        entities = [{"name": "Empty", "type": "table", "fields": []}]
        result, msgs = infer_primary_keys(entities)
        assert len(msgs) == 0

    def test_messages_report_inferred_pks(self):
        entities = _make_entities()
        _, msgs = infer_primary_keys(entities)
        assert any("Inferred PK: Users.id" in m for m in msgs)
        assert any("Inferred PK: Orders.id" in m for m in msgs)


# ---------------------------------------------------------------------------
# FK / relationship inference tests
# ---------------------------------------------------------------------------

class TestInferRelationships:
    def test_infers_user_id_fk(self):
        entities = _make_entities()
        infer_primary_keys(entities)  # need PKs first
        rels, msgs = infer_relationships(entities)
        # Orders.user_id → Users.id
        user_rel = [r for r in rels if "user_id" in r["to"]]
        assert len(user_rel) == 1
        assert user_rel[0]["from"] == "Users.id"
        assert user_rel[0]["to"] == "Orders.user_id"
        assert user_rel[0]["cardinality"] == "one_to_many"

    def test_infers_order_id_fk(self):
        entities = _make_entities()
        infer_primary_keys(entities)
        rels, msgs = infer_relationships(entities)
        # OrderItems.order_id → Orders.id
        order_rel = [r for r in rels if "OrderItems.order_id" in r["to"]]
        assert len(order_rel) == 1
        assert order_rel[0]["from"] == "Orders.id"

    def test_infers_product_id_fk(self):
        entities = _make_entities()
        infer_primary_keys(entities)
        rels, msgs = infer_relationships(entities)
        # OrderItems.product_id → Products.product_id
        prod_rel = [r for r in rels if "OrderItems.product_id" in r["to"]]
        assert len(prod_rel) == 1
        assert prod_rel[0]["from"] == "Products.product_id"

    def test_infers_category_id_fk(self):
        entities = _make_entities()
        infer_primary_keys(entities)
        rels, msgs = infer_relationships(entities)
        # Products.category_id → Categories.category_id
        cat_rel = [r for r in rels if "Products.category_id" in r["to"]]
        assert len(cat_rel) == 1
        assert cat_rel[0]["from"] == "Categories.category_id"

    def test_does_not_self_reference_pk(self):
        """product_id in Products should NOT create a self-referencing FK."""
        entities = _make_entities()
        infer_primary_keys(entities)
        rels, msgs = infer_relationships(entities)
        self_refs = [r for r in rels if r["from"].startswith("Products.") and r["to"].startswith("Products.")]
        assert len(self_refs) == 0

    def test_marks_fk_flag_on_field(self):
        entities = _make_entities()
        infer_primary_keys(entities)
        infer_relationships(entities)
        orders = next(e for e in entities if e["name"] == "Orders")
        user_id_field = next(f for f in orders["fields"] if f["name"] == "user_id")
        assert user_id_field.get("foreign_key") is True

    def test_skips_existing_fk_fields(self):
        entities = [
            {"name": "Parent", "type": "table", "fields": [
                {"name": "id", "type": "bigint", "nullable": False, "primary_key": True},
            ]},
            {"name": "Child", "type": "table", "fields": [
                {"name": "id", "type": "bigint", "nullable": False, "primary_key": True},
                {"name": "parent_id", "type": "bigint", "nullable": True, "foreign_key": True},
            ]},
        ]
        rels, msgs = infer_relationships(entities)
        assert len(rels) == 0  # already marked, skip

    def test_skips_existing_relationships(self):
        entities = _make_entities()
        infer_primary_keys(entities)
        existing = [{"from": "Users.id", "to": "Orders.user_id", "name": "existing_fk", "cardinality": "one_to_many"}]
        rels, msgs = infer_relationships(entities, existing)
        # Should not duplicate the Users→Orders relationship
        user_rels = [r for r in rels if "Orders.user_id" in r["to"]]
        assert len(user_rels) == 0

    def test_inferred_flag_set(self):
        entities = _make_entities()
        infer_primary_keys(entities)
        rels, _ = infer_relationships(entities)
        for rel in rels:
            assert rel.get("inferred") is True

    def test_plural_singular_matching(self):
        """user_id should match 'Users' entity (plural) via singular 'user'."""
        entities = [
            {"name": "Users", "type": "table", "fields": [
                {"name": "id", "type": "bigint", "nullable": False, "primary_key": True},
            ]},
            {"name": "Posts", "type": "table", "fields": [
                {"name": "id", "type": "bigint", "nullable": False, "primary_key": True},
                {"name": "user_id", "type": "bigint", "nullable": True},
            ]},
        ]
        rels, msgs = infer_relationships(entities)
        assert len(rels) == 1
        assert rels[0]["from"] == "Users.id"
        assert rels[0]["to"] == "Posts.user_id"

    def test_camel_case_pattern(self):
        """userId should match Users entity."""
        entities = [
            {"name": "Users", "type": "table", "fields": [
                {"name": "id", "type": "bigint", "nullable": False, "primary_key": True},
            ]},
            {"name": "Comments", "type": "table", "fields": [
                {"name": "id", "type": "bigint", "nullable": False, "primary_key": True},
                {"name": "userId", "type": "bigint", "nullable": True},
            ]},
        ]
        rels, msgs = infer_relationships(entities)
        assert len(rels) == 1
        assert rels[0]["from"] == "Users.id"

    def test_no_match_no_relationship(self):
        """Columns that don't match any entity should not create relationships."""
        entities = [
            {"name": "Logs", "type": "table", "fields": [
                {"name": "id", "type": "bigint", "nullable": False, "primary_key": True},
                {"name": "random_id", "type": "bigint", "nullable": True},
                {"name": "message", "type": "string", "nullable": True},
            ]},
        ]
        rels, msgs = infer_relationships(entities)
        assert len(rels) == 0


# ---------------------------------------------------------------------------
# Integration: PK inference + FK inference together
# ---------------------------------------------------------------------------

class TestInferenceIntegration:
    def test_full_pipeline_no_constraints(self):
        """Simulate a Snowflake pull with zero PK/FK constraints."""
        entities = _make_entities()
        # No field has primary_key or foreign_key set
        for ent in entities:
            for f in ent["fields"]:
                assert "primary_key" not in f
                assert "foreign_key" not in f

        # Run inference
        entities, pk_msgs = infer_primary_keys(entities)
        rels, fk_msgs = infer_relationships(entities)

        # Should have inferred PKs
        assert len(pk_msgs) > 0

        # Should have inferred relationships
        assert len(rels) > 0
        assert len(fk_msgs) > 0

        # Verify specific relationships exist
        rel_pairs = {(r["from"], r["to"]) for r in rels}
        assert ("Users.id", "Orders.user_id") in rel_pairs
        assert ("Orders.id", "OrderItems.order_id") in rel_pairs

    def test_total_inferred_count(self):
        """Should infer exactly the expected number of relationships."""
        entities = _make_entities()
        infer_primary_keys(entities)
        rels, _ = infer_relationships(entities)
        # Expected: user_id→Users, order_id→Orders, product_id→Products,
        #           category_id→Categories, parent_id→? (no match)
        # parent_id doesn't match any entity name, so no rel
        assert len(rels) == 4
