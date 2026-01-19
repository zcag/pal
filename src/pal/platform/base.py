from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, List


class Platform(ABC):
    @abstractmethod
    def list_apps(self) -> List[Dict[str, Any]]:
        """List installed applications. Returns list of {name, icon, exec, path}."""
        ...

    @abstractmethod
    def run_app(self, app: Dict[str, Any]) -> None:
        """Launch an application."""
        ...

    @abstractmethod
    def open_url(self, url: str) -> None:
        """Open URL in default browser."""
        ...

    @abstractmethod
    def open_file(self, path: str) -> None:
        """Open file with default application."""
        ...

    @abstractmethod
    def copy_to_clipboard(self, text: str) -> None:
        """Copy text to clipboard."""
        ...
