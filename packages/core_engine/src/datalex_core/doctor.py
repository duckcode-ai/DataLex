"""Project health diagnostics for ``datalex doctor``.

Checks:
  - Schema files exist and are valid JSON
  - Policy schema exists and is valid JSON
  - Model files are discoverable and parse as YAML
  - Policy packs are discoverable and parse as YAML
  - Python dependencies are importable
  - CLI entry point is executable
"""

import importlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import yaml


class DiagnosticResult:
    """Single diagnostic check result."""

    __slots__ = ("name", "status", "message")

    def __init__(self, name: str, status: str, message: str = "") -> None:
        self.name = name
        self.status = status  # "ok", "warn", "error"
        self.message = message

    def to_dict(self) -> Dict[str, str]:
        return {"name": self.name, "status": self.status, "message": self.message}


def _check_file_exists(path: Path, label: str) -> DiagnosticResult:
    if path.exists():
        return DiagnosticResult(label, "ok", str(path))
    return DiagnosticResult(label, "error", f"Not found: {path}")


def _check_json_file(path: Path, label: str) -> DiagnosticResult:
    if not path.exists():
        return DiagnosticResult(label, "error", f"Not found: {path}")
    try:
        with path.open("r", encoding="utf-8") as f:
            json.load(f)
        return DiagnosticResult(label, "ok", str(path))
    except (json.JSONDecodeError, OSError) as exc:
        return DiagnosticResult(label, "error", f"Invalid JSON: {exc}")


def _check_yaml_file(path: Path, label: str) -> DiagnosticResult:
    if not path.exists():
        return DiagnosticResult(label, "error", f"Not found: {path}")
    try:
        with path.open("r", encoding="utf-8") as f:
            yaml.safe_load(f)
        return DiagnosticResult(label, "ok", str(path))
    except (yaml.YAMLError, OSError) as exc:
        return DiagnosticResult(label, "error", f"Invalid YAML: {exc}")


def _check_importable(module_name: str) -> DiagnosticResult:
    try:
        importlib.import_module(module_name)
        return DiagnosticResult(f"import {module_name}", "ok")
    except ImportError as exc:
        return DiagnosticResult(f"import {module_name}", "error", str(exc))


def _find_files(root: Path, pattern: str) -> List[Path]:
    return sorted(root.glob(pattern))


def _find_on_path(name: str) -> List[Path]:
    """Every executable named ``name`` found across $PATH, in PATH order,
    de-duplicated by resolved target (so symlinks to the same file count once)."""
    found: List[Path] = []
    seen: set = set()
    exts = [""]
    if os.name == "nt":
        exts = os.environ.get("PATHEXT", ".EXE;.BAT;.CMD").split(os.pathsep)
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        if not directory:
            continue
        for ext in exts:
            candidate = Path(directory) / (name + ext)
            try:
                if candidate.is_file() and os.access(str(candidate), os.X_OK):
                    key = str(candidate.resolve())
                    if key not in seen:
                        seen.add(key)
                        found.append(candidate)
            except OSError:
                continue
    return found


def _installed_version() -> str:
    try:
        import importlib.metadata as md

        return md.version("datalex-cli")
    except Exception:
        return "unknown"


def _check_install_environment() -> List[DiagnosticResult]:
    """Diagnose how `datalex` is installed and detect PATH shadowing — the
    classic "old conda copy hides my fresh install" trap."""
    results: List[DiagnosticResult] = []

    results.append(
        DiagnosticResult(
            "python_interpreter", "ok",
            f"{sys.executable} (prefix: {sys.prefix})",
        )
    )
    results.append(
        DiagnosticResult("installed_version", "ok", _installed_version())
    )

    binaries = _find_on_path("datalex")
    if not binaries:
        results.append(
            DiagnosticResult(
                "datalex_on_path", "warn",
                "No `datalex` executable found on PATH. The install dir may "
                "not be on PATH — consider `pipx install datalex-cli`.",
            )
        )
    elif len(binaries) == 1:
        results.append(DiagnosticResult("datalex_on_path", "ok", str(binaries[0])))
    else:
        running = binaries[0]
        shadowed = ", ".join(str(b) for b in binaries[1:])
        results.append(
            DiagnosticResult(
                "datalex_on_path", "warn",
                f"Multiple `datalex` installs found — the first on PATH wins: "
                f"RUNNING={running}; SHADOWED={shadowed}. "
                f"Reinstall into the active environment or use "
                f"`pipx install --force datalex-cli` for one canonical copy.",
            )
        )

    # Conda base environments are a common source of stale, shadowing copies.
    prefix_lower = sys.prefix.lower()
    if any(tok in prefix_lower for tok in ("anaconda", "miniconda", "miniforge")):
        results.append(
            DiagnosticResult(
                "conda_environment", "warn",
                f"Running inside a conda environment ({sys.prefix}). Installing "
                f"CLIs here often leads to PATH shadowing across envs. For a "
                f"stable global install, prefer `pipx install datalex-cli`.",
            )
        )

    return results


def run_diagnostics(project_dir: str) -> List[DiagnosticResult]:
    """Run all project diagnostics and return results."""
    root = Path(project_dir).resolve()
    results: List[DiagnosticResult] = []

    # 1. Project directory
    if root.is_dir():
        results.append(DiagnosticResult("project_directory", "ok", str(root)))
    else:
        results.append(DiagnosticResult("project_directory", "error", f"Not a directory: {root}"))
        return results

    # 2. Schema files
    model_schema = root / "schemas" / "model.schema.json"
    policy_schema = root / "schemas" / "policy.schema.json"
    results.append(_check_json_file(model_schema, "model_schema"))
    results.append(_check_json_file(policy_schema, "policy_schema"))

    # 3. Model files
    model_files = _find_files(root, "**/*.model.yaml")
    model_files = [f for f in model_files if ".git" not in str(f) and "node_modules" not in str(f)]
    if model_files:
        results.append(DiagnosticResult("model_files", "ok", f"Found {len(model_files)} model file(s)"))
        for mf in model_files:
            results.append(_check_yaml_file(mf, f"model:{mf.relative_to(root)}"))
    else:
        results.append(DiagnosticResult("model_files", "warn", "No *.model.yaml files found"))

    # 4. Policy packs
    policy_files = _find_files(root / "policies", "*.policy.yaml")
    if not policy_files:
        policy_files = _find_files(root, "**/*.policy.yaml")
        policy_files = [f for f in policy_files if ".git" not in str(f) and "node_modules" not in str(f)]
    if policy_files:
        results.append(DiagnosticResult("policy_packs", "ok", f"Found {len(policy_files)} policy pack(s)"))
        for pf in policy_files:
            results.append(_check_yaml_file(pf, f"policy:{pf.relative_to(root)}"))
    else:
        results.append(DiagnosticResult("policy_packs", "warn", "No *.policy.yaml files found"))

    # 5. Python dependencies
    for mod in ["yaml", "jsonschema"]:
        results.append(_check_importable(mod))

    # 6. datalex_core importable
    results.append(_check_importable("datalex_core"))

    # 7. CLI entry point
    cli_path = root / "datalex"
    if cli_path.exists():
        results.append(DiagnosticResult("cli_entrypoint", "ok", str(cli_path)))
        if os.access(str(cli_path), os.X_OK):
            results.append(DiagnosticResult("cli_executable", "ok"))
        else:
            results.append(DiagnosticResult("cli_executable", "warn", "datalex is not executable (chmod +x datalex)"))
    else:
        results.append(DiagnosticResult("cli_entrypoint", "warn", "datalex script not found at project root"))

    # 8. requirements.txt
    req_path = root / "requirements.txt"
    results.append(_check_file_exists(req_path, "requirements_txt"))

    # 9. Install / PATH environment (detects shadowing of the running CLI)
    results.extend(_check_install_environment())

    return results


def format_diagnostics(results: List[DiagnosticResult]) -> str:
    """Format diagnostic results as a human-readable string."""
    lines: List[str] = []
    lines.append("DataLex Doctor")
    lines.append("=" * 40)

    ok_count = sum(1 for r in results if r.status == "ok")
    warn_count = sum(1 for r in results if r.status == "warn")
    error_count = sum(1 for r in results if r.status == "error")

    for r in results:
        icon = {"ok": "\u2713", "warn": "!", "error": "\u2717"}.get(r.status, "?")
        msg = f"  [{icon}] {r.name}"
        if r.message:
            msg += f" — {r.message}"
        lines.append(msg)

    lines.append("")
    lines.append(f"Summary: {ok_count} ok, {warn_count} warnings, {error_count} errors")

    if error_count > 0:
        lines.append("Status: UNHEALTHY")
    elif warn_count > 0:
        lines.append("Status: OK (with warnings)")
    else:
        lines.append("Status: HEALTHY")

    return "\n".join(lines)


def diagnostics_as_json(results: List[DiagnosticResult]) -> Dict[str, Any]:
    """Return diagnostics as a JSON-serializable dict."""
    ok_count = sum(1 for r in results if r.status == "ok")
    warn_count = sum(1 for r in results if r.status == "warn")
    error_count = sum(1 for r in results if r.status == "error")
    return {
        "checks": [r.to_dict() for r in results],
        "summary": {"ok": ok_count, "warn": warn_count, "error": error_count},
        "healthy": error_count == 0,
    }
