from __future__ import annotations

from pathlib import Path
from importlib.resources import as_file, files

from dynaconf import Dynaconf


def user_config_path() -> Path:
    # Optional user overlay. Tool works fine without it.
    return Path("~/.config/pal/config.yaml").expanduser()


def _defaults_yaml_ref():
    # Packaged resource reference (works from wheels/zip too).
    return files("pal").joinpath("defaults.yaml")


def load_settings() -> Dynaconf:
    user = user_config_path()
    user_files = [str(user)] if user.exists() else []

    with as_file(_defaults_yaml_ref()) as defaults_path:
        settings = Dynaconf(
            settings_files=[str(defaults_path), *user_files],
            merge_enabled=True,
            envvar_prefix="PAL",  # optional later; harmless now
        )
        # Force load while temp file still exists
        _ = settings.as_dict()
        return settings


def read_defaults_text() -> str:
    with as_file(_defaults_yaml_ref()) as defaults_path:
        return defaults_path.read_text(encoding="utf-8")
