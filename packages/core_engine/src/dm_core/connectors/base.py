"""Base connector interface and registry for database connectors."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class ConnectorConfig:
    """Configuration for a database connector."""

    connector_type: str
    host: str = ""
    port: int = 0
    database: str = ""
    schema: str = ""
    user: str = ""
    password: str = ""
    warehouse: str = ""
    project: str = ""
    dataset: str = ""
    catalog: str = ""
    token: str = ""
    connection_string: str = ""
    tables: Optional[List[str]] = None
    exclude_tables: Optional[List[str]] = None
    model_name: str = "imported_model"
    domain: str = "imported"
    owners: Optional[List[str]] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def effective_owners(self) -> List[str]:
        return self.owners or ["data-team@example.com"]


@dataclass
class ConnectorResult:
    """Result of a schema pull operation."""

    model: Dict[str, Any]
    tables_found: int = 0
    columns_found: int = 0
    relationships_found: int = 0
    indexes_found: int = 0
    warnings: List[str] = field(default_factory=list)

    def summary(self) -> str:
        lines = [
            f"Tables: {self.tables_found}",
            f"Columns: {self.columns_found}",
            f"Relationships: {self.relationships_found}",
            f"Indexes: {self.indexes_found}",
        ]
        if self.warnings:
            lines.append(f"Warnings: {len(self.warnings)}")
            for w in self.warnings:
                lines.append(f"  - {w}")
        return "\n".join(lines)


def _to_pascal(name: str) -> str:
    name = name.replace('"', "")
    parts = re.split(r"[^A-Za-z0-9]+", name)
    return "".join(part[:1].upper() + part[1:] for part in parts if part)


def _to_model_name(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return cleaned or "imported_model"


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
        "indexes": [],
        "governance": {"classification": {}, "stewards": {}},
        "rules": [],
    }


class BaseConnector(ABC):
    """Abstract base class for all database connectors."""

    connector_type: str = ""
    display_name: str = ""
    required_package: str = ""

    @abstractmethod
    def test_connection(self, config: ConnectorConfig) -> Tuple[bool, str]:
        """Test if the connection can be established.

        Returns (success, message).
        """

    @abstractmethod
    def pull_schema(self, config: ConnectorConfig) -> ConnectorResult:
        """Pull schema from the database and return a ConnectorResult."""

    def list_schemas(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        """List available schemas/datasets in the database.

        Returns a list of dicts with at least: {"name": str, "table_count": int}.
        Override in subclasses.
        """
        return []

    def list_tables(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        """List tables in the configured schema.

        Returns a list of dicts with at least:
        {"name": str, "type": str, "row_count": int|None, "column_count": int}.
        Override in subclasses.
        """
        return []

    def check_driver(self) -> Tuple[bool, str]:
        """Check if the required Python driver package is installed."""
        if not self.required_package:
            return True, "No driver required"
        try:
            __import__(self.required_package)
            return True, f"{self.required_package} is installed"
        except ImportError:
            return False, f"Missing driver: pip install {self.required_package}"

    def _build_model(self, config: ConnectorConfig) -> Dict[str, Any]:
        return _default_model(
            model_name=config.model_name,
            domain=config.domain,
            owners=config.effective_owners(),
        )

    def _entity_name(self, table_name: str) -> str:
        return _to_pascal(table_name)

    def _should_include_table(self, table_name: str, config: ConnectorConfig) -> bool:
        if config.tables and table_name not in config.tables:
            return False
        if config.exclude_tables and table_name in config.exclude_tables:
            return False
        return True


# ---------------------------------------------------------------------------
# Connector registry
# ---------------------------------------------------------------------------

_REGISTRY: Dict[str, BaseConnector] = {}


def _register(connector: BaseConnector) -> None:
    _REGISTRY[connector.connector_type] = connector


def get_connector(connector_type: str) -> Optional[BaseConnector]:
    """Get a connector by type name."""
    return _REGISTRY.get(connector_type)


def list_connectors() -> List[Dict[str, str]]:
    """List all registered connectors."""
    result = []
    for name, conn in sorted(_REGISTRY.items()):
        ok, msg = conn.check_driver()
        result.append({
            "type": name,
            "name": conn.display_name,
            "driver": conn.required_package or "none",
            "installed": ok,
            "status": msg,
        })
    return result


def register_all() -> None:
    """Register all built-in connectors."""
    from dm_core.connectors.postgres import PostgresConnector
    from dm_core.connectors.mysql import MySQLConnector
    from dm_core.connectors.snowflake import SnowflakeConnector
    from dm_core.connectors.bigquery import BigQueryConnector
    from dm_core.connectors.databricks import DatabricksConnector

    for cls in [PostgresConnector, MySQLConnector, SnowflakeConnector, BigQueryConnector, DatabricksConnector]:
        _register(cls())


register_all()
