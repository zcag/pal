from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Dict, List, TYPE_CHECKING

if TYPE_CHECKING:
    from .runner import Runner

CACHE_DIR = Path("~/.cache/pal/plugins").expanduser()
PLUGINS_DIR = Path("~/.config/pal/plugins").expanduser()
BUILTINS = {"apps", "combine", "palettes"}


def resolve(base: str) -> str | Path:
    """Resolve a base string to either a builtin name or executable path."""
    if base in BUILTINS:
        return base
    if base.startswith("/"):
        return Path(base)
    if base.startswith("github.com/"):
        return _resolve_github(base)
    return PLUGINS_DIR / base


def _resolve_github(base: str) -> Path:
    """Clone github repo if needed, return path to executable."""
    parts = base.split("/")
    # github.com/user/repo[/name]
    repo_parts = parts[:3]  # github.com/user/repo
    repo_url = f"https://{'/'.join(repo_parts)}.git"
    clone_dir = CACHE_DIR / "/".join(repo_parts)

    if not clone_dir.exists():
        clone_dir.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth=1", repo_url, str(clone_dir)],
            check=True, capture_output=True,
        )

    # executable name: explicit path within repo, or repo name
    exec_name = "/".join(parts[3:]) if len(parts) > 3 else parts[2]
    return clone_dir / exec_name


class ExecPalette:
    """Wraps an executable as a palette."""

    def __init__(self, path: Path):
        self.path = path

    def list(self, cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
        result = subprocess.run(
            [str(self.path), "list"],
            capture_output=True, text=True, check=True,
        )
        items = []
        for line in result.stdout.splitlines():
            line = line.strip()
            if line:
                items.append(json.loads(line))
        return items

    def pick(self, cfg: Dict[str, Any], name: str, runner: "Runner") -> None:
        subprocess.run(
            [str(self.path), "pick", name],
            check=True,
        )
