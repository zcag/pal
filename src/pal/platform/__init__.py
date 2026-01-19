from __future__ import annotations

import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .base import Platform

_platform: "Platform | None" = None


def get() -> "Platform":
    global _platform
    if _platform is None:
        if sys.platform == "linux":
            from .linux import LinuxPlatform
            _platform = LinuxPlatform()
        elif sys.platform == "darwin":
            from .macos import MacOSPlatform
            _platform = MacOSPlatform()
        else:
            raise NotImplementedError(f"Unsupported platform: {sys.platform}")
    return _platform
