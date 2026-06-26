"""Update checks, install-method detection, and self-upgrade for the CLI.

This module powers three user-facing features:

  * A non-blocking "a newer version is on PyPI" notifier shown before most
    commands (``maybe_notify_update``). The network call runs in a daemon
    thread and the result is cached for ~24h, so a normal command never
    waits on PyPI.
  * ``datalex upgrade`` — runs the right upgrade command for however the
    user installed DataLex (pipx vs pip vs an editable dev checkout).
  * Install diagnostics consumed by ``datalex doctor`` to detect PATH
    shadowing (e.g. an old conda copy hiding a newer pipx one).

Everything here is best-effort and wrapped so a failure (no network,
read-only cache dir, odd environment) never breaks the actual command.
"""

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.request import Request, urlopen

PACKAGE_NAME = "datalex-cli"
PYPI_URL = f"https://pypi.org/pypi/{PACKAGE_NAME}/json"
CHECK_INTERVAL_SECONDS = 24 * 60 * 60  # once a day
NETWORK_TIMEOUT_SECONDS = 2.0
_ENV_OPT_OUT = "DATALEX_NO_UPDATE_CHECK"


# ---------------------------------------------------------------------------
# Version parsing / comparison (no hard dependency on `packaging`)
# ---------------------------------------------------------------------------

def _parse_version(value: str) -> Tuple[int, ...]:
    """Best-effort numeric version tuple. Pre-release suffixes are dropped,
    so ``1.12.0rc1`` compares equal to ``1.12.0`` — good enough to decide
    whether to *suggest* an upgrade."""
    parts: List[int] = []
    for chunk in str(value).split("."):
        digits = ""
        for ch in chunk:
            if ch.isdigit():
                digits += ch
            else:
                break
        if digits == "":
            break
        parts.append(int(digits))
    return tuple(parts) or (0,)


def is_newer(candidate: str, current: str) -> bool:
    """True if ``candidate`` is a strictly newer release than ``current``."""
    try:
        return _parse_version(candidate) > _parse_version(current)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Install-method detection
# ---------------------------------------------------------------------------

def _distribution():
    try:
        import importlib.metadata as md

        return md.distribution(PACKAGE_NAME)
    except Exception:
        return None


def is_editable_install() -> bool:
    """True when running from a ``pip install -e .`` / source checkout."""
    dist = _distribution()
    if dist is None:
        # No installed distribution metadata usually means a raw source run.
        return True
    try:
        raw = dist.read_text("direct_url.json")
        if raw:
            info = json.loads(raw)
            if info.get("dir_info", {}).get("editable"):
                return True
    except Exception:
        pass
    return False


def detect_install_method() -> str:
    """Return one of: ``"pipx"``, ``"editable"``, ``"pip"``."""
    if is_editable_install():
        return "editable"
    # pipx installs live in a dedicated venv whose path contains "pipx".
    location = ""
    dist = _distribution()
    if dist is not None:
        try:
            location = str(dist.locate_file(""))
        except Exception:
            location = ""
    haystack = (location + os.pathsep + sys.prefix + os.pathsep + sys.executable).lower()
    if "pipx" in haystack:
        return "pipx"
    return "pip"


def upgrade_command(method: Optional[str] = None) -> Optional[List[str]]:
    """The argv that upgrades DataLex for this install, or ``None`` when
    self-upgrade doesn't apply (editable/dev checkout)."""
    method = method or detect_install_method()
    if method == "editable":
        return None
    if method == "pipx":
        pipx = shutil.which("pipx") or "pipx"
        return [pipx, "upgrade", PACKAGE_NAME]
    # Plain pip: use the interpreter that's actually running this CLI so we
    # upgrade the *right* environment, not whatever `pip` resolves to.
    return [sys.executable, "-m", "pip", "install", "--upgrade", PACKAGE_NAME]


def upgrade_hint(method: Optional[str] = None) -> str:
    """A short, copy-pasteable upgrade instruction for messages."""
    method = method or detect_install_method()
    if method == "editable":
        return "git pull  (you're on an editable/dev install)"
    cmd = upgrade_command(method)
    return " ".join(cmd) if cmd else "pip install --upgrade datalex-cli"


# ---------------------------------------------------------------------------
# Cached PyPI version check
# ---------------------------------------------------------------------------

def _cache_path() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "datalex" / "update-check.json"


def _read_cache() -> dict:
    try:
        return json.loads(_cache_path().read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_cache(latest: str) -> None:
    try:
        path = _cache_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"latest": latest, "checked_at": int(time.time())}),
            encoding="utf-8",
        )
    except Exception:
        pass


def fetch_latest_version() -> Optional[str]:
    """Query PyPI for the latest released version. Returns ``None`` on any
    failure (offline, timeout, malformed response)."""
    try:
        req = Request(PYPI_URL, headers={"Accept": "application/json"})
        with urlopen(req, timeout=NETWORK_TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        version = data.get("info", {}).get("version")
        return version or None
    except Exception:
        return None


def _refresh_cache_async() -> None:
    def _worker() -> None:
        latest = fetch_latest_version()
        if latest:
            _write_cache(latest)

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()


def check_now(current_version: str) -> Tuple[Optional[str], bool]:
    """Synchronously check PyPI (used by ``datalex upgrade --check``).
    Returns ``(latest_version, is_outdated)``."""
    latest = fetch_latest_version()
    if latest:
        _write_cache(latest)
    outdated = bool(latest and is_newer(latest, current_version))
    return latest, outdated


def maybe_notify_update(current_version: str) -> None:
    """Print a one-line upgrade notice to stderr when a newer version is
    known, and kick off a background refresh if the cache is stale.

    Non-blocking: the notice is drawn from the *previous* run's cached
    result, so the current command never waits on the network.
    """
    try:
        if os.environ.get(_ENV_OPT_OUT):
            return
        # Don't nag in scripts/CI/pipelines or for dev checkouts.
        if not sys.stderr.isatty():
            return
        if is_editable_install():
            return

        cache = _read_cache()
        latest = cache.get("latest")
        checked_at = cache.get("checked_at", 0)

        if latest and is_newer(latest, current_version):
            hint = upgrade_hint()
            sys.stderr.write(
                f"\n✨ DataLex {latest} is available "
                f"(you have {current_version}).\n"
                f"   Upgrade:  {hint}\n"
                f"   (silence this with {_ENV_OPT_OUT}=1)\n\n"
            )

        if (time.time() - checked_at) > CHECK_INTERVAL_SECONDS:
            _refresh_cache_async()
    except Exception:
        # An update check must never break the user's actual command.
        pass
