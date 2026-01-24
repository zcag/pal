from __future__ import annotations

import importlib
import json
from pathlib import Path
from typing import Any, Dict, Protocol, List, TYPE_CHECKING

if TYPE_CHECKING:
    from ..runner import Runner


class Palette(Protocol):
    def list(self, cfg: Dict[str, Any]) -> List[Dict[str, Any]]: ...
    def pick(self, cfg: Dict[str, Any], name: str, runner: "Runner") -> None: ...


def load(base: str, paths: Dict[str, Any] | None = None) -> Palette:
    """Load a palette by base string (builtin name, github url, or path)."""
    from ..plugins import resolve, ExecPalette

    resolved = resolve(base, paths)
    if isinstance(resolved, str):
        return importlib.import_module(f".{resolved}", package="pal.palettes")
    return ExecPalette(resolved)


def load_data(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Load items from config 'data' list or 'data_file' jsonl path."""
    if "data" in cfg:
        return cfg["data"] or []
    if "data_file" in cfg:
        path = Path(cfg["data_file"]).expanduser()
        items = []
        for line in path.read_text().splitlines():
            line = line.strip()
            if line:
                items.append(json.loads(line))
        return items
    return []
