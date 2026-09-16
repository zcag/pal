# Quantises a store screenshot to a 256-colour PNG (a third of the size),
# called by shots.mjs. Median cut alone spends its boxes on the wallpaper's
# gradient and loses a lone saturated colour (a green tag, a tinted dot) or
# tints the dark text, so the saturated and the dark pixels are repeated
# under the image before the palette is built; no dithering, which would double the file for a gradient this soft.
import sys
from PIL import Image

def quant(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    data = lambda i: i.get_flattened_data() if hasattr(i, "get_flattened_data") else i.getdata()
    hsv = im.convert("HSV")
    # Dark pixels too: the text is a few pixels next to a gradient, and without them the palette's nearest dark is a tinted one.
    sat = [px for px, s, v in zip(data(im), data(hsv.getchannel("S")), data(hsv.getchannel("V"))) if s > 90 or v < 90]
    stack = im
    if sat:
        n = max(1, (w * h // 60) // len(sat))
        rows = (len(sat) * n) // w + 1
        strip = Image.new("RGB", (w, rows))
        strip.putdata((sat * n + [sat[0]] * w)[: w * rows])
        stack = Image.new("RGB", (w, h + rows))
        stack.paste(im, (0, 0))
        stack.paste(strip, (0, h))
    pal = stack.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    im.quantize(palette=pal, dither=Image.Dither.NONE).save(path, optimize=True)

quant(sys.argv[1])
