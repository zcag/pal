from __future__ import annotations

import os
import subprocess
from typing import Any, Dict, List, Optional


def _expand(s: str) -> str:
    return os.path.expanduser(s)


def _fmt_line(item: Dict[str, Any]) -> str:
    name = str(item.get("name", item.get("id", "")))
    desc = item.get("desc", "")
    icon = item.get("icon", "")
    text = f"{name} ({desc})" if desc else name
    if icon:
        return f"{text}\0icon\x1f{icon}"
    return text


def run(cfg: Dict[str, Any], palette: str, items: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    rofi_bin = _expand(str(cfg.get("bin", "rofi")))
    extra_args = cfg.get("args") or []
    if not isinstance(extra_args, list):
        extra_args = []

    clean_items: List[Dict[str, Any]] = []
    lines: List[str] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        clean_items.append(it)
        lines.append(_fmt_line(it))

    if not lines:
        return None

    cmd = [
        rofi_bin,
        "-dmenu",
        "-i",
        "-format", "i",
        "-p", f"{palette}",
        "-matching", "fuzzy",
        "-show-icons",
    ] + [str(a) for a in extra_args]

    p = subprocess.run(
        cmd,
        input="\n".join(lines),
        text=True,
        capture_output=True,
        check=False,
    )

    if p.returncode != 0: return None

    idx_str = (p.stdout or "").strip()
    if not idx_str: return None

    try: idx = int(idx_str)
    except ValueError: return None

    if idx < 0 or idx >= len(clean_items): return None
    return clean_items[idx]
