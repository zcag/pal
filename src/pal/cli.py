from __future__ import annotations

import json
import typer

from .config import load_settings, read_defaults_text, user_config_path
from .runner import Runner

app = typer.Typer(add_completion=False)


@app.command()
def where():
    """Print the optional user config path."""
    typer.echo(str(user_config_path()))


@app.command()
def defaults():
    """Print packaged defaults.yaml (reference)."""
    typer.echo(read_defaults_text())


@app.command("config-show")
def config_show():
    """Print resolved config (defaults + optional user overlay) as JSON."""
    s = load_settings()
    typer.echo(json.dumps(s.as_dict(), ensure_ascii=False, indent=2))


@app.command()
def run(
    frontend: str = typer.Argument(None),
    palette: str = typer.Argument(None),
):
    """Run the palette picker."""
    cfg = load_settings().as_dict()
    palcfg = cfg.get("PAL") or {}

    fe_name = frontend or palcfg.get("default_frontend")
    palname = palette or palcfg.get("default_palette")

    runner = Runner(fe_name, cfg)
    runner.run_palette(palname)



