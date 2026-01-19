from __future__ import annotations

from typing import Any, Dict, List, TYPE_CHECKING

from . import load

if TYPE_CHECKING:
    from ..runner import Runner


def list(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """List items from configured palettes."""
    items: List[Dict[str, Any]] = []
    palettes_cfg = cfg.get("_palettes_cfg", {})
    include = cfg.get("include", [])

    for palname in include:
        pal_cfg = palettes_cfg.get(palname, {})
        try:
            pal = load(palname)
            for item in pal.list(pal_cfg):
                item = item.copy()
                item["_palette"] = palname
                items.append(item)
        except Exception:
            continue

    return items


def pick(cfg: Dict[str, Any], name: str, runner: "Runner") -> None:
    """Pick item and delegate to source palette."""
    palettes_cfg = cfg.get("_palettes_cfg", {})

    for item in list(cfg):
        if item.get("name") == name:
            palname = item.get("_palette")
            if palname:
                pal = load(palname)
                pal_cfg = palettes_cfg.get(palname, {})
                pal.pick(pal_cfg, name, runner)
            return
