from __future__ import annotations

import subprocess
from configparser import ConfigParser
from pathlib import Path
from typing import Any, Dict, List

from .base import Platform


class LinuxPlatform(Platform):
    def _desktop_dirs(self) -> List[Path]:
        return [
            Path("/usr/share/applications"),
            Path.home() / ".local/share/applications",
        ]

    def _parse_desktop(self, path: Path) -> Dict[str, Any] | None:
        try:
            cfg = ConfigParser(interpolation=None)
            cfg.read(path)
            entry = cfg["Desktop Entry"]
            if entry.get("Type") != "Application":
                return None
            if entry.get("NoDisplay", "").lower() == "true":
                return None
            name = entry.get("Name", path.stem)
            icon = entry.get("Icon", "")
            exec_cmd = entry.get("Exec", "")
            return {"name": name, "icon": icon, "exec": exec_cmd, "path": str(path)}
        except Exception:
            return None

    def _clean_exec(self, exec_cmd: str) -> str:
        for code in ["%u", "%U", "%f", "%F", "%d", "%D", "%n", "%N", "%k", "%v", "%i", "%c"]:
            exec_cmd = exec_cmd.replace(code, "")
        return exec_cmd.strip()

    def list_apps(self) -> List[Dict[str, Any]]:
        seen: set[str] = set()
        items: List[Dict[str, Any]] = []
        for d in self._desktop_dirs():
            if not d.is_dir():
                continue
            for f in d.glob("*.desktop"):
                if f.name in seen:
                    continue
                seen.add(f.name)
                item = self._parse_desktop(f)
                if item:
                    items.append(item)
        return sorted(items, key=lambda x: x["name"].lower())

    def run_app(self, app: Dict[str, Any]) -> None:
        exec_cmd = self._clean_exec(app["exec"])
        subprocess.Popen(exec_cmd, shell=True, start_new_session=True)

    def open_url(self, url: str) -> None:
        subprocess.Popen(["xdg-open", url], start_new_session=True)

    def open_file(self, path: str) -> None:
        subprocess.Popen(["xdg-open", path], start_new_session=True)

    def copy_to_clipboard(self, text: str) -> None:
        subprocess.run(["wl-copy", text], check=False)
