from __future__ import annotations

import subprocess
from typing import Any, Dict

from . import platform


class Actions:
    """Palette action handlers."""

    def run_bash(self, cmd: str) -> None:
        """Run a bash command."""
        subprocess.run(cmd, shell=True)

    def open_file(self, path: str) -> None:
        """Open a file in default editor."""
        platform.get().open_file(path)

    def open_url(self, url: str) -> None:
        """Open URL in browser."""
        platform.get().open_url(url)

    def copy_to_clipboard(self, text: str) -> None:
        """Copy text to clipboard."""
        platform.get().copy_to_clipboard(text)

    def bookmark(self, item: Dict[str, Any]) -> None:
        """Handle bookmark action."""
        raise NotImplementedError


actions = Actions()
