"""Tests for Phase 4: Advanced Import & Reverse Engineering (SQL DDL only).

Note: JSON Schema, dbt manifest, and Avro importers were removed in the
database connector rework. Those tests now live in test_connectors.py.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packages" / "core_engine" / "src"))

from dm_core.importers import import_sql_ddl

FIXTURES = Path(__file__).resolve().parent / "fixtures"
DM_CLI = str(Path(__file__).resolve().parent.parent / "dm")


# ---------------------------------------------------------------------------
# Enhanced SQL DDL Importer
# ---------------------------------------------------------------------------

class TestSQLDDLEnhanced:
    def test_basic_import_still_works(self):
        ddl = """
        CREATE TABLE customers (
            customer_id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE
        );
        """
        model = import_sql_ddl(ddl)
        assert len(model["entities"]) == 1
        assert model["entities"][0]["name"] == "Customers"
        assert model["entities"][0]["type"] == "table"

    def test_default_values(self):
        ddl = """
        CREATE TABLE orders (
            order_id INTEGER PRIMARY KEY,
            status TEXT DEFAULT 'pending',
            total DECIMAL(10,2) DEFAULT 0
        );
        """
        model = import_sql_ddl(ddl)
        fields = {f["name"]: f for f in model["entities"][0]["fields"]}
        assert fields["status"].get("default") == "pending"
        assert fields["total"].get("default") == "0"

    def test_check_constraints(self):
        ddl = """
        CREATE TABLE products (
            product_id INTEGER PRIMARY KEY,
            price DECIMAL(10,2) CHECK(price > 0),
            quantity INTEGER CHECK(quantity >= 0)
        );
        """
        model = import_sql_ddl(ddl)
        fields = {f["name"]: f for f in model["entities"][0]["fields"]}
        assert fields["price"].get("check") == "price > 0"
        assert fields["quantity"].get("check") == "quantity >= 0"

    def test_create_view(self):
        ddl = """
        CREATE TABLE customers (
            customer_id INTEGER PRIMARY KEY
        );
        CREATE VIEW customer_summary AS SELECT * FROM customers;
        """
        model = import_sql_ddl(ddl)
        entities = {e["name"]: e for e in model["entities"]}
        assert "CustomerSummary" in entities
        assert entities["CustomerSummary"]["type"] == "view"

    def test_create_materialized_view(self):
        ddl = """
        CREATE TABLE orders (
            order_id INTEGER PRIMARY KEY
        );
        CREATE MATERIALIZED VIEW daily_sales AS SELECT * FROM orders;
        """
        model = import_sql_ddl(ddl)
        entities = {e["name"]: e for e in model["entities"]}
        assert "DailySales" in entities
        assert entities["DailySales"]["type"] == "materialized_view"

    def test_create_or_replace_view(self):
        ddl = """
        CREATE OR REPLACE VIEW my_view AS SELECT 1;
        """
        model = import_sql_ddl(ddl)
        entities = {e["name"]: e for e in model["entities"]}
        assert "MyView" in entities
        assert entities["MyView"]["type"] == "view"

    def test_create_index(self):
        ddl = """
        CREATE TABLE customers (
            customer_id INTEGER PRIMARY KEY,
            email TEXT NOT NULL
        );
        CREATE INDEX idx_customer_email ON customers (email);
        """
        model = import_sql_ddl(ddl)
        assert "indexes" in model
        assert len(model["indexes"]) == 1
        idx = model["indexes"][0]
        assert idx["name"] == "idx_customer_email"
        assert idx["entity"] == "Customers"
        assert idx["fields"] == ["email"]

    def test_create_unique_index(self):
        ddl = """
        CREATE TABLE users (
            user_id INTEGER PRIMARY KEY,
            username TEXT
        );
        CREATE UNIQUE INDEX idx_users_username ON users (username);
        """
        model = import_sql_ddl(ddl)
        assert "indexes" in model
        idx = model["indexes"][0]
        assert idx["unique"] is True

    def test_schema_qualified_table(self):
        ddl = """
        CREATE TABLE analytics.customers (
            customer_id INTEGER PRIMARY KEY
        );
        """
        model = import_sql_ddl(ddl)
        entity = model["entities"][0]
        assert entity["name"] == "Customers"
        assert entity.get("schema") == "analytics"

    def test_foreign_key_sets_fk_flag(self):
        ddl = """
        CREATE TABLE customers (
            customer_id INTEGER PRIMARY KEY
        );
        CREATE TABLE orders (
            order_id INTEGER PRIMARY KEY,
            customer_id INTEGER REFERENCES customers(customer_id)
        );
        """
        model = import_sql_ddl(ddl)
        orders = next(e for e in model["entities"] if e["name"] == "Orders")
        fk_field = next(f for f in orders["fields"] if f["name"] == "customer_id")
        assert fk_field.get("foreign_key") is True

    def test_multi_column_index(self):
        ddl = """
        CREATE TABLE orders (
            order_id INTEGER PRIMARY KEY,
            customer_id INTEGER,
            order_date DATE
        );
        CREATE INDEX idx_orders_cust_date ON orders (customer_id, order_date);
        """
        model = import_sql_ddl(ddl)
        idx = model["indexes"][0]
        assert idx["fields"] == ["customer_id", "order_date"]

    def test_snowflake_style_ddl(self):
        ddl = """
        CREATE TABLE IF NOT EXISTS warehouse.analytics.customers (
            customer_id INTEGER NOT NULL,
            email VARCHAR(255) NOT NULL,
            PRIMARY KEY (customer_id)
        );
        """
        model = import_sql_ddl(ddl)
        entity = model["entities"][0]
        assert entity["name"] == "Customers"
        fields = {f["name"]: f for f in entity["fields"]}
        assert fields["customer_id"].get("primary_key") is True

    def test_table_level_check_skipped(self):
        ddl = """
        CREATE TABLE products (
            product_id INTEGER PRIMARY KEY,
            price DECIMAL(10,2),
            CHECK (price > 0)
        );
        """
        model = import_sql_ddl(ddl)
        # Should not crash, entity should have 2 fields
        assert len(model["entities"][0]["fields"]) == 2

