from __future__ import annotations

import importlib
from typing import Any, Dict, Protocol, List, TYPE_CHECKING

if TYPE_CHECKING:
    from ..runner import Runner


class Palette(Protocol):
    def list(self, cfg: Dict[str, Any]) -> List[Dict[str, Any]]: ...
    def pick(self, cfg: Dict[str, Any], name: str, runner: "Runner") -> None: ...


def load(name: str) -> Palette:
    """Dynamically load a palette module by name."""
    mod = importlib.import_module(f".{name}", package="pal.palettes")
    return mod
