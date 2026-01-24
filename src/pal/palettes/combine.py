from __future__ import annotations

from typing import Any, Dict, List, TYPE_CHECKING

from . import load, load_data

if TYPE_CHECKING:
    from ..runner import Runner


def _list_palette(palname: str, pal_cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    if pal_cfg.get("auto_list"):
        return load_data(pal_cfg)
    base = pal_cfg.get("base", palname)
    return load(base, pal_cfg.get("_paths")).list(pal_cfg)


def list(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """List items from configured palettes."""
    items: List[Dict[str, Any]] = []
    palettes_cfg = cfg.get("_palettes_cfg", {})

    for palname in cfg.get("include", []):
        pal_cfg = palettes_cfg.get(palname, {}).copy()
        pal_cfg["_palettes_cfg"] = palettes_cfg
        pal_cfg["_paths"] = cfg.get("_paths")
        try:
            for item in _list_palette(palname, pal_cfg):
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
            if not palname:
                return
            pal_cfg = palettes_cfg.get(palname, {}).copy()
            pal_cfg["_palettes_cfg"] = palettes_cfg
            pal_cfg["_paths"] = cfg.get("_paths")
            runner._pick(pal_cfg, item)
            return
