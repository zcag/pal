"""Entry point — fast cache path before importing anything heavy."""
import sys
import json
import subprocess
from pathlib import Path

CACHE_DIR = Path("~/.cache/pal/fe").expanduser()


def main():
    args = sys.argv[1:]

    # fast path: pal run [frontend] [palette]
    if args and args[0] == "run":
        fe = args[1] if len(args) > 1 else "fzf"
        pal = args[2] if len(args) > 2 else "combine"
        cache_path = CACHE_DIR / fe / f"{pal}.json"

        if cache_path.exists():
            data = json.loads(cache_path.read_text())
            p = subprocess.run(
                data["cmd"], input=data["input"],
                text=True, capture_output=True, check=False,
            )
            if p.returncode == 0:
                sel = (p.stdout or "").strip()
                idx_str = sel.split("\t", 1)[0]
                try:
                    idx = int(idx_str)
                except ValueError:
                    return
                if 0 <= idx < len(data["items"]):
                    _pick(data["items"][idx])
            return

    # cold path: full CLI
    from .cli import app
    app()


def _pick(item):
    if "cmd" in item:
        subprocess.run(item["cmd"], shell=True)
    elif "url" in item:
        from .platform import get
        get().open_url(item["url"])
    elif "file" in item:
        from .platform import get
        get().open_file(item["file"])
    elif "copy" in item:
        from .platform import get
        get().copy_to_clipboard(item["copy"])


if __name__ == "__main__":
    main()
