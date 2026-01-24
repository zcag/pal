from __future__ import annotations

from typing import Any, Dict

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
        all_palettes = self.cfg.get("PALETTES", {})
        pal_cfg = all_palettes.get(palname, {}).copy()
        pal_cfg["_palettes_cfg"] = all_palettes

        if pal_cfg.get("auto_list"):
            items = palettes.load_data(pal_cfg)
        else:
            items = palettes.load(pal_cfg.get("base", palname)).list(pal_cfg)

        picked = self.fe.run(self.fe_cfg, palname, items)
        if not picked:
            return

        if pal_cfg.get("auto_pick", pal_cfg.get("auto_list")):
            self._auto_pick(pal_cfg, picked)
        else:
            palettes.load(pal_cfg.get("base", palname)).pick(pal_cfg, picked.get("name"), self)

    def _auto_pick(self, cfg: Dict[str, Any], item: Dict[str, Any]) -> None:
        """Dispatch pick action based on item fields."""
        if "cmd" in item:
            actions.run_bash(item["cmd"])
        elif "url" in item:
            actions.open_url(item["url"])
        elif "file" in item:
            actions.open_file(item["file"])
        elif "copy" in item:
            actions.copy_to_clipboard(item["copy"])
