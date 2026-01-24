from __future__ import annotations

from typing import Any, Dict, List, TYPE_CHECKING

if TYPE_CHECKING:
    from ..runner import Runner


def list(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """List available palettes from config."""
    all_palettes = cfg.get("_palettes_cfg", {})
    return [
        {"name": name}
        for name in sorted(all_palettes)
        if name != "combine"
    ]


def pick(cfg: Dict[str, Any], name: str, runner: "Runner") -> None:
    """Run the picked palette."""
    runner.run_palette(name)
