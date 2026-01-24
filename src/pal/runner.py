from __future__ import annotations

from typing import Any, Dict, List

from .config import load_settings
from .actions import actions
from . import frontends
from . import palettes


class Runner:
    def __init__(self, fe_name: str, cfg: Dict[str, Any] | None = None):
        self.cfg = cfg or load_settings().as_dict()
        self.fe_name = fe_name
        self.fe = frontends.load(fe_name)
        self.fe_cfg = self.cfg.get("FRONTENDS", {}).get(fe_name, {})

    def run_palette(self, palname: str) -> None:
        pal_cfg = self._resolve_cfg(palname)
        items = self._list(palname, pal_cfg)
        picked = self.fe.run(self.fe_cfg, palname, items)
        if picked:
            self._pick(pal_cfg, picked)

    def _resolve_cfg(self, palname: str) -> Dict[str, Any]:
        all_palettes = self.cfg.get("PALETTES", {})
        paths = self.cfg.get("PAL", {}).get("paths", {})
        pal_cfg = all_palettes.get(palname, {}).copy()
        pal_cfg["_palettes_cfg"] = all_palettes
        pal_cfg["_paths"] = paths
        return pal_cfg

    def _list(self, palname: str, pal_cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
        """List items from palette. Cache boundary — wrap this for caching."""
        if pal_cfg.get("auto_list"):
            return palettes.load_data(pal_cfg)
        base = pal_cfg.get("base", palname)
        return palettes.load(base, pal_cfg.get("_paths")).list(pal_cfg)

    def _pick(self, pal_cfg: Dict[str, Any], item: Dict[str, Any]) -> None:
        if pal_cfg.get("auto_pick", pal_cfg.get("auto_list")):
            self._auto_pick(item)
        else:
            base = pal_cfg.get("base")
            palettes.load(base, pal_cfg.get("_paths")).pick(pal_cfg, item.get("name"), self)

    def _auto_pick(self, item: Dict[str, Any]) -> None:
        if "cmd" in item:
            actions.run_bash(item["cmd"])
        elif "url" in item:
            actions.open_url(item["url"])
        elif "file" in item:
            actions.open_file(item["file"])
        elif "copy" in item:
            actions.copy_to_clipboard(item["copy"])
