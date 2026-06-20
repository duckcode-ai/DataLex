"""DataLex <-> dbt integration: emit dbt YAML, import manifest.json, sync live warehouse."""

from datalex_core.dbt.emit import emit_dbt, build_sources_yaml, build_models_yaml, EmitReport
from datalex_core.dbt.manifest import import_manifest, write_import_result, ImportResult
from datalex_core.dbt.sync import sync_dbt_project, SyncReport, TableSyncRecord
from datalex_core.dbt.catalog import CatalogIndex, load_catalog, default_catalog_path
from datalex_core.dbt.readiness import assess_manifest, assess_manifest_dict

__all__ = [
    "emit_dbt",
    "build_sources_yaml",
    "build_models_yaml",
    "EmitReport",
    "import_manifest",
    "write_import_result",
    "ImportResult",
    "sync_dbt_project",
    "SyncReport",
    "TableSyncRecord",
    "CatalogIndex",
    "load_catalog",
    "default_catalog_path",
    "assess_manifest",
    "assess_manifest_dict",
]
