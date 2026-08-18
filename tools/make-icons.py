#!/usr/bin/env python3
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BG = (10, 14, 26)
MOON = (255, 180, 84)


def in_rounded_rect(x, y, s):
    r = s * 0.234
    x0 = y0 = 0.0
    x1 = y1 = float(s)
    if x0 + r <= x <= x1 - r or y0 + r <= y <= y1 - r:
        return True
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def in_moon(x, y, s):
    k = s / 512.0
    r = 150.0 * k
    cx = 344.0 * k
    cy = 224.0 * k
    dx = 48.0 * k
    in_c1 = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    in_c2 = (x - (cx - dx)) ** 2 + (y - cy) ** 2 <= r * r
    return in_c1 and not in_c2


def render(size):
    pixels = bytearray()
    for y in range(size):
        for x in range(size):
            if not in_rounded_rect(x + 0.5, y + 0.5, size):
                pixels += b"\x00\x00\x00\x00"
            elif in_moon(x + 0.5, y + 0.5, size):
                pixels += bytes(MOON) + b"\xff"
            else:
                pixels += bytes(BG) + b"\xff"
    return bytes(pixels)


def write_png(path, size, rgba):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    stride = size * 4
    raw = b"".join(b"\x00" + rgba[y * stride : (y + 1) * stride] for y in range(size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


for size in (192, 512):
    write_png(os.path.join(ROOT, "icon-%d.png" % size), size, render(size))
    print("icon-%d.png written" % size)