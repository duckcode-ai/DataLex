"""Multi-model resolver: resolves cross-file imports into a unified model graph.

Resolution strategy:
1. Load the root model file.
2. For each entry in model.imports, locate the target model file:
   a. If import.path is given, resolve relative to the root model's directory.
   b. Otherwise, scan search_dirs for <model_name>.model.yaml or <model_name>.model.yml.
3. Load each imported model (recursively resolving its own imports).
4. Build a unified graph containing all entities, relationships, indexes, glossary,
   and rules — with imported entities prefixed by their alias when referenced.
5. Validate: no circular imports, no duplicate entity names across models.
"""

import copy
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from dm_core.issues import Issue
from dm_core.loader import load_yaml_model


def _find_model_file(
    model_name: str,
    search_dirs: List[Path],
) -> Optional[Path]:
    """Search directories for a model file matching the given model name."""
    candidates = [
        f"{model_name}.model.yaml",
        f"{model_name}.model.yml",
    ]
    for search_dir in search_dirs:
        for candidate in candidates:
            path = search_dir / candidate
            if path.exists():
                return path
        # Also search subdirectories one level deep
        if search_dir.is_dir():
            for sub in sorted(search_dir.iterdir()):
                if sub.is_dir() and not sub.name.startswith("."):
                    for candidate in candidates:
                        path = sub / candidate
                        if path.exists():
                            return path
    return None


def _resolve_import_path(
    imp: Dict[str, Any],
    root_dir: Path,
    search_dirs: List[Path],
) -> Optional[Path]:
    """Resolve the file path for an import entry."""
    if imp.get("path"):
        candidate = root_dir / imp["path"]
        if candidate.exists():
            return candidate.resolve()
        return None

    model_name = imp.get("model", "")
    if not model_name:
        return None

    return _find_model_file(model_name, [root_dir] + search_dirs)


class ResolvedModel:
    """Result of resolving a multi-model project."""

    def __init__(self):
        self.root_model: Dict[str, Any] = {}
        self.imported_models: Dict[str, Dict[str, Any]] = {}  # alias -> model
        self.import_graph: Dict[str, List[str]] = {}  # model_name -> [imported model names]
        self.file_map: Dict[str, str] = {}  # model_name -> file path
        self.issues: List[Issue] = []

    @property
    def all_model_names(self) -> List[str]:
        names = [self.root_model.get("model", {}).get("name", "")]
        names.extend(sorted(self.imported_models.keys()))
        return [n for n in names if n]

    def unified_entities(self) -> List[Dict[str, Any]]:
        """Return all entities from root + imported models, with source_model annotation."""
        entities = []
        root_name = self.root_model.get("model", {}).get("name", "root")
        for entity in self.root_model.get("entities", []):
            e = copy.deepcopy(entity)
            e["_source_model"] = root_name
            entities.append(e)

        for alias, model in sorted(self.imported_models.items()):
            model_name = model.get("model", {}).get("name", alias)
            for entity in model.get("entities", []):
                e = copy.deepcopy(entity)
                e["_source_model"] = model_name
                e["_import_alias"] = alias
                entities.append(e)

        return entities

    def unified_relationships(self) -> List[Dict[str, Any]]:
        """Return all relationships from root + imported models."""
        rels = []
        root_name = self.root_model.get("model", {}).get("name", "root")
        for rel in self.root_model.get("relationships", []):
            r = copy.deepcopy(rel)
            r["_source_model"] = root_name
            rels.append(r)

        for alias, model in sorted(self.imported_models.items()):
            model_name = model.get("model", {}).get("name", alias)
            for rel in model.get("relationships", []):
                r = copy.deepcopy(rel)
                r["_source_model"] = model_name
                rels.append(r)

        return rels

    def unified_indexes(self) -> List[Dict[str, Any]]:
        """Return all indexes from root + imported models."""
        indexes = []
        root_name = self.root_model.get("model", {}).get("name", "root")
        for idx in self.root_model.get("indexes", []):
            i = copy.deepcopy(idx)
            i["_source_model"] = root_name
            indexes.append(i)

        for alias, model in sorted(self.imported_models.items()):
            model_name = model.get("model", {}).get("name", alias)
            for idx in model.get("indexes", []):
                i = copy.deepcopy(idx)
                i["_source_model"] = model_name
                indexes.append(i)

        return indexes

    def to_graph_summary(self) -> Dict[str, Any]:
        """Return a JSON-serializable summary of the resolved multi-model graph."""
        root_name = self.root_model.get("model", {}).get("name", "unknown")
        models = []

        # Root model summary
        root_entities = self.root_model.get("entities", [])
        models.append({
            "name": root_name,
            "file": self.file_map.get(root_name, ""),
            "entity_count": len(root_entities),
            "entities": [e.get("name", "") for e in root_entities],
            "imports": [
                imp.get("alias", imp.get("model", ""))
                for imp in self.root_model.get("model", {}).get("imports", [])
            ],
            "is_root": True,
        })

        # Imported model summaries
        for alias, model in sorted(self.imported_models.items()):
            model_name = model.get("model", {}).get("name", alias)
            imp_entities = model.get("entities", [])
            models.append({
                "name": model_name,
                "alias": alias,
                "file": self.file_map.get(model_name, ""),
                "entity_count": len(imp_entities),
                "entities": [e.get("name", "") for e in imp_entities],
                "imports": [
                    imp.get("alias", imp.get("model", ""))
                    for imp in model.get("model", {}).get("imports", [])
                ],
                "is_root": False,
            })

        # Cross-model relationships (relationships that reference entities from different models)
        cross_rels = []
        all_entities = self.unified_entities()
        entity_to_model = {}
        for e in all_entities:
            entity_to_model[e.get("name", "")] = e.get("_source_model", "")

        for rel in self.unified_relationships():
            from_entity = (rel.get("from", "") or "").split(".")[0]
            to_entity = (rel.get("to", "") or "").split(".")[0]
            from_model = entity_to_model.get(from_entity, "")
            to_model = entity_to_model.get(to_entity, "")
            if from_model and to_model and from_model != to_model:
                cross_rels.append({
                    "name": rel.get("name", ""),
                    "from_model": from_model,
                    "to_model": to_model,
                    "from": rel.get("from", ""),
                    "to": rel.get("to", ""),
                    "cardinality": rel.get("cardinality", ""),
                })

        return {
            "root_model": root_name,
            "model_count": len(models),
            "total_entities": sum(m["entity_count"] for m in models),
            "cross_model_relationships": cross_rels,
            "models": models,
            "issues": [
                {"severity": i.severity, "code": i.code, "message": i.message, "path": i.path}
                for i in self.issues
            ],
        }


def _detect_cycle(
    model_name: str,
    import_graph: Dict[str, List[str]],
    visiting: Set[str],
    visited: Set[str],
) -> bool:
    """DFS cycle detection in import graph."""
    if model_name in visiting:
        return True
    if model_name in visited:
        return False
    visiting.add(model_name)
    for dep in import_graph.get(model_name, []):
        if _detect_cycle(dep, import_graph, visiting, visited):
            return True
    visiting.remove(model_name)
    visited.add(model_name)
    return False


def resolve_model(
    root_path: str,
    search_dirs: Optional[List[str]] = None,
) -> ResolvedModel:
    """Resolve a model file and all its imports into a ResolvedModel.

    Args:
        root_path: Path to the root model YAML file.
        search_dirs: Additional directories to search for imported models.
                     The root model's directory is always searched first.

    Returns:
        ResolvedModel with all imported models resolved and issues collected.
    """
    result = ResolvedModel()
    root_file = Path(root_path).resolve()
    root_dir = root_file.parent

    extra_dirs = [Path(d).resolve() for d in (search_dirs or [])]

    # Load root model
    try:
        root_model = load_yaml_model(str(root_file))
    except Exception as exc:
        result.issues.append(Issue(
            severity="error",
            code="ROOT_LOAD_FAILED",
            message=f"Failed to load root model: {exc}",
            path="/",
        ))
        return result

    result.root_model = root_model
    root_name = root_model.get("model", {}).get("name", "unknown")
    result.file_map[root_name] = str(root_file)

    imports = root_model.get("model", {}).get("imports", [])
    if not imports:
        return result

    # Track import graph for cycle detection
    result.import_graph[root_name] = []

    # Resolve each import
    loaded_models: Dict[str, Dict[str, Any]] = {}  # model_name -> model data
    _resolve_imports_recursive(
        model_name=root_name,
        imports=imports,
        root_dir=root_dir,
        search_dirs=extra_dirs,
        loaded_models=loaded_models,
        result=result,
        depth=0,
        max_depth=10,
    )

    # Cycle detection
    visiting: Set[str] = set()
    visited: Set[str] = set()
    if _detect_cycle(root_name, result.import_graph, visiting, visited):
        result.issues.append(Issue(
            severity="error",
            code="CIRCULAR_IMPORT",
            message="Circular import detected in model dependency graph.",
            path="/model/imports",
        ))

    # Check for duplicate entity names across all models
    seen_entities: Dict[str, str] = {}  # entity_name -> source_model
    for entity in result.root_model.get("entities", []):
        ename = entity.get("name", "")
        if ename:
            seen_entities[ename] = root_name

    for alias, model in result.imported_models.items():
        model_name = model.get("model", {}).get("name", alias)
        for entity in model.get("entities", []):
            ename = entity.get("name", "")
            if ename and ename in seen_entities:
                result.issues.append(Issue(
                    severity="warn",
                    code="DUPLICATE_CROSS_MODEL_ENTITY",
                    message=f"Entity '{ename}' exists in both '{seen_entities[ename]}' and '{model_name}'. "
                            f"Use alias '{alias}' to disambiguate.",
                    path=f"/model/imports",
                ))
            elif ename:
                seen_entities[ename] = model_name

    return result


def _resolve_imports_recursive(
    model_name: str,
    imports: List[Dict[str, Any]],
    root_dir: Path,
    search_dirs: List[Path],
    loaded_models: Dict[str, Dict[str, Any]],
    result: ResolvedModel,
    depth: int,
    max_depth: int,
) -> None:
    """Recursively resolve imports."""
    if depth > max_depth:
        result.issues.append(Issue(
            severity="error",
            code="IMPORT_DEPTH_EXCEEDED",
            message=f"Import depth exceeded {max_depth}. Possible circular dependency.",
            path="/model/imports",
        ))
        return

    for imp in imports:
        imp_model_name = imp.get("model", "")
        alias = imp.get("alias", imp_model_name)
        entity_filter = imp.get("entities")  # None means all

        if not imp_model_name:
            result.issues.append(Issue(
                severity="error",
                code="INVALID_IMPORT",
                message="Import entry missing 'model' field.",
                path="/model/imports",
            ))
            continue

        # Track in import graph
        if model_name not in result.import_graph:
            result.import_graph[model_name] = []
        result.import_graph[model_name].append(imp_model_name)

        # Skip if already loaded
        if imp_model_name in loaded_models:
            model_data = loaded_models[imp_model_name]
        else:
            # Resolve file path
            file_path = _resolve_import_path(imp, root_dir, search_dirs)
            if not file_path:
                result.issues.append(Issue(
                    severity="error",
                    code="IMPORT_NOT_FOUND",
                    message=f"Cannot find model file for import '{imp_model_name}'.",
                    path="/model/imports",
                ))
                continue

            try:
                model_data = load_yaml_model(str(file_path))
            except Exception as exc:
                result.issues.append(Issue(
                    severity="error",
                    code="IMPORT_LOAD_FAILED",
                    message=f"Failed to load imported model '{imp_model_name}': {exc}",
                    path="/model/imports",
                ))
                continue

            actual_name = model_data.get("model", {}).get("name", "")
            if actual_name and actual_name != imp_model_name:
                result.issues.append(Issue(
                    severity="warn",
                    code="IMPORT_NAME_MISMATCH",
                    message=f"Import references '{imp_model_name}' but file declares model.name='{actual_name}'.",
                    path="/model/imports",
                ))

            loaded_models[imp_model_name] = model_data
            result.file_map[imp_model_name] = str(file_path)

            # Recursively resolve this model's imports
            sub_imports = model_data.get("model", {}).get("imports", [])
            if sub_imports:
                _resolve_imports_recursive(
                    model_name=imp_model_name,
                    imports=sub_imports,
                    root_dir=file_path.parent,
                    search_dirs=search_dirs,
                    loaded_models=loaded_models,
                    result=result,
                    depth=depth + 1,
                    max_depth=max_depth,
                )

        # Apply entity filter if specified
        if entity_filter:
            filtered = copy.deepcopy(model_data)
            available = {e.get("name", "") for e in model_data.get("entities", [])}
            for requested in entity_filter:
                if requested not in available:
                    result.issues.append(Issue(
                        severity="error",
                        code="IMPORT_ENTITY_NOT_FOUND",
                        message=f"Import '{alias}' requests entity '{requested}' which does not exist in '{imp_model_name}'.",
                        path="/model/imports",
                    ))
            filtered["entities"] = [
                e for e in model_data.get("entities", [])
                if e.get("name", "") in set(entity_filter)
            ]
            result.imported_models[alias] = filtered
        else:
            result.imported_models[alias] = copy.deepcopy(model_data)


def resolve_project(
    project_dir: str,
    search_dirs: Optional[List[str]] = None,
) -> Dict[str, ResolvedModel]:
    """Resolve all model files in a project directory.

    Returns a dict mapping model file path -> ResolvedModel.
    """
    project_path = Path(project_dir).resolve()
    results: Dict[str, ResolvedModel] = {}

    # Find all model files
    model_files = sorted(
        list(project_path.rglob("*.model.yaml")) +
        list(project_path.rglob("*.model.yml"))
    )

    extra_dirs = [Path(d).resolve() for d in (search_dirs or [])]
    all_dirs = [project_path] + extra_dirs

    for model_file in model_files:
        resolved = resolve_model(str(model_file), search_dirs=[str(d) for d in all_dirs])
        results[str(model_file)] = resolved

    return results
