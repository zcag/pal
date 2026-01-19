from __future__ import annotations

import os
import subprocess
from typing import Any, Dict, List, Optional


def _expand(s: str) -> str:
    return os.path.expanduser(s)


def _fmt_line(idx: int, palette: str, item: Dict[str, Any]) -> str:
    name = str(item.get("name", item.get("id", "")))
    desc = str(item.get("desc", ""))
    return f"{idx}\t[{palette}]\t{name}\t{desc}"


def run(cfg: Dict[str, Any], palette: str, items: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    fzf_bin = _expand(str(cfg.get("bin", "fzf")))
    extra_args = cfg.get("args") or []
    if not isinstance(extra_args, list):
        extra_args = []

    lines: List[str] = []
    clean_items: List[Dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        idx = len(clean_items)
        clean_items.append(it)
        lines.append(_fmt_line(idx, palette, it))

    if not lines:
        return None

    cmd = [
        fzf_bin,
        "--delimiter=\t",
        "--with-nth=2,3,4",
        "--nth=2,3,4",
        "--prompt",
        f"{palette}> ",
    ] + [str(a) for a in extra_args]

    p = subprocess.run(
        cmd,
        input="\n".join(lines),
        text=True,
        capture_output=True,
        check=False,
    )

    if p.returncode != 0: return None

    sel = (p.stdout or "").strip()
    if not sel: return None

    idx_str = sel.split("\t", 1)[0]
    try: idx = int(idx_str)
    except ValueError: return None

    if idx < 0 or idx >= len(clean_items): return None
    return clean_items[idx]
