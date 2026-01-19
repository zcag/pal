from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Dict, List

from .base import Platform


class MacOSPlatform(Platform):
    def _app_dirs(self) -> List[Path]:
        return [
            Path("/Applications"),
            Path.home() / "Applications",
        ]

    def list_apps(self) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        for d in self._app_dirs():
            if not d.is_dir():
                continue
            for f in d.glob("*.app"):
                name = f.stem
                items.append({"name": name, "icon": "", "exec": str(f), "path": str(f)})
        return sorted(items, key=lambda x: x["name"].lower())

    def run_app(self, app: Dict[str, Any]) -> None:
        subprocess.Popen(["open", app["path"]], start_new_session=True)

    def open_url(self, url: str) -> None:
        subprocess.Popen(["open", url], start_new_session=True)

    def open_file(self, path: str) -> None:
        subprocess.Popen(["open", path], start_new_session=True)

    def copy_to_clipboard(self, text: str) -> None:
        subprocess.run(["pbcopy"], input=text.encode(), check=False)
