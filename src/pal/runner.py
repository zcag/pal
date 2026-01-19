from __future__ import annotations

from typing import Any, Dict

from .config import load_settings
from . import frontends
from . import palettes


class Runner:
    def __init__(self, fe_name: str, cfg: Dict[str, Any] | None = None):
        self.cfg = cfg or load_settings().as_dict()
        self.fe_name = fe_name
        self.fe = frontends.load(fe_name)
        self.fe_cfg = self.cfg.get("FRONTENDS", {}).get(fe_name, {})

    def run_palette(self, palname: str) -> None:
        pal = palettes.load(palname)
        builtins = self.cfg.get("PALETTES", {}).get("builtins", {})
        pal_cfg = builtins.get(palname, {}).copy()
        pal_cfg["_palettes_cfg"] = builtins

        items = pal.list(pal_cfg)
        picked = self.fe.run(self.fe_cfg, palname, items)
        if picked:
            pal.pick(pal_cfg, picked.get("name"), self)
