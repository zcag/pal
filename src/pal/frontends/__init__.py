from __future__ import annotations

import importlib
from typing import Any, Dict, List, Optional, Protocol


class Frontend(Protocol):
    def run(self, cfg: Dict[str, Any], palette: str, items: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]: ...


def load(name: str) -> Frontend:
    """Dynamically load a frontend module by name."""
    return importlib.import_module(f".{name}", package="pal.frontends")
