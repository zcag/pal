from __future__ import annotations

from typing import Any, Dict, List, TYPE_CHECKING

from .. import platform

if TYPE_CHECKING:
    from ..runner import Runner


def list(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """List installed applications."""
    return platform.get().list_apps()


def pick(cfg: Dict[str, Any], name: str, runner: "Runner") -> None:
    """Run picked application."""
    plat = platform.get()
    for item in plat.list_apps():
        if item.get("name") == name:
            plat.run_app(item)
            return
