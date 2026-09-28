# Quantises a store screenshot to a 256-colour PNG (a quarter of the size),
# called by shots.mjs: pngquant (libimagequant), which keeps a lone
# saturated colour (an extension's tile in a dark crumb, a green tag) that a
# median cut spends on the dark theme's many near-blacks; no dithering, which
# would add noise to the wallpaper's gradient and size to the file. make-shots
# requires pngquant (`brew install pngquant`), so every machine quantises alike.
import shutil
import subprocess
import sys

def quant(path):
    exe = shutil.which("pngquant")
    if not exe:
        sys.exit("shot-quant: pngquant is not installed (brew install pngquant)")
    subprocess.run([exe, "--force", "--speed", "1", "--nofs", "--output", path, "256", path], check=True)

quant(sys.argv[1])
