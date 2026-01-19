from __future__ import annotations

from typing import Any, Dict, List, TYPE_CHECKING

from ..actions import actions

if TYPE_CHECKING:
    from ..runner import Runner


def list(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """List commands from palette config."""
    return cfg.get("data") or []


def pick(cfg: Dict[str, Any], name: str, runner: "Runner") -> None:
    """Execute picked command by name."""
    for item in list(cfg):
        if item.get("name") == name:
            actions.run_bash(item["cmd"])
            return
