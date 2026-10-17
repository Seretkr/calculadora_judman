"""Gera os ícones do launcher (raio amarelo sobre fundo azul-escuro)."""
import os
import sys

from PIL import Image, ImageDraw

SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
BIG = 1024


def master():
    img = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([40, 40, BIG - 40, BIG - 40], radius=220, fill=(15, 23, 42, 255))
    d.ellipse([170, 170, BIG - 170, BIG - 170], fill=(30, 41, 59, 255))
    bolt = [(580, 140), (300, 560), (480, 560), (420, 884), (724, 440), (540, 440), (640, 140)]
    d.polygon(bolt, fill=(250, 204, 21, 255))
    return img


def main(res_dir):
    img = master()
    for density, size in SIZES.items():
        out = os.path.join(res_dir, "mipmap-" + density)
        os.makedirs(out, exist_ok=True)
        img.resize((size, size), Image.LANCZOS).save(os.path.join(out, "ic_launcher.png"))
    img.resize((512, 512), Image.LANCZOS).save(os.path.join(res_dir, "..", "icon-512.png"))


if __name__ == "__main__":
    main(sys.argv[1])
