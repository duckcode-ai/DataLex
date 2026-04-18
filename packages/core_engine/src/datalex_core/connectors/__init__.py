"""Database connectors for pulling schema from live databases.

Each connector implements the same interface:
  pull_schema(connection_string, schema=None, tables=None, **kwargs) -> Dict[str, Any]

Returns a DataLex model dict ready for use.
"""

from datalex_core.connectors.base import (
    BaseConnector,
    ConnectorConfig,
    ConnectorResult,
    get_connector,
    list_connectors,
)
from datalex_core.connectors.postgres import PostgresConnector
from datalex_core.connectors.mysql import MySQLConnector
from datalex_core.connectors.snowflake import SnowflakeConnector
from datalex_core.connectors.bigquery import BigQueryConnector
from datalex_core.connectors.databricks import DatabricksConnector
from datalex_core.connectors.sqlserver import SQLServerConnector, AzureSQLConnector, AzureFabricConnector
from datalex_core.connectors.redshift import RedshiftConnector

__all__ = [
    "BaseConnector",
    "BigQueryConnector",
    "ConnectorConfig",
    "ConnectorResult",
    "DatabricksConnector",
    "MySQLConnector",
    "PostgresConnector",
    "SnowflakeConnector",
    "SQLServerConnector",
    "AzureSQLConnector",
    "AzureFabricConnector",
    "RedshiftConnector",
    "get_connector",
    "list_connectors",
]
