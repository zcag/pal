from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, TYPE_CHECKING

if TYPE_CHECKING:
    from ..runner import Runner


def _builtin_palettes() -> List[str]:
    """Discover builtin palettes by scanning the palettes directory."""
    palettes_dir = Path(__file__).parent
    return [
        f.stem for f in palettes_dir.glob("*.py")
        if f.stem not in ("__init__", "palettes")
    ]


def list(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """List available palettes."""
    return [{"name": name, "icon": "folder"} for name in sorted(_builtin_palettes())]


def pick(cfg: Dict[str, Any], name: str, runner: "Runner") -> None:
    """Run the picked palette."""
    runner.run_palette(name)
