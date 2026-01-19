import json
from typer.testing import CliRunner

from pal.cli import app

runner = CliRunner()


def test_defaults_prints_yaml_reference():
    r = runner.invoke(app, ["defaults"])
    assert r.exit_code == 0
    assert "default_palette: combine" in r.stdout


def test_config_show_has_defaults():
    r = runner.invoke(app, ["config-show"])
    assert r.exit_code == 0
    cfg = json.loads(r.stdout)
    assert cfg["pal"]["default_palette"] == "combine"
    assert cfg["palettes"]["builtins"]["combine"]["enabled"] is True


def test_palettes_lists_builtin_combine_and_commands():
    r = runner.invoke(app, ["palettes"])
    assert r.exit_code == 0
    assert "combine\tbuiltin" in r.stdout
    assert "commands\tbuiltin" in r.stdout


def test_pick_commands_stub_ok():
    # builtin "commands" pick is stubbed to ok
    r = runner.invoke(app, ["pick", "commands", "anything"])
    assert r.exit_code == 0
    assert json.loads(r.stdout)["status"] == "ok"
