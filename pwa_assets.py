"""Ícones PNG instaláveis (192/512), gerados com biblioteca padrão sem arquivos binários no Git."""
import functools
import struct
import zlib


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)


@functools.lru_cache(maxsize=2)
def icon_png(size):
    if size not in (192, 512):
        raise ValueError("Tamanho de ícone inválido.")
    raw = bytearray()
    n = float(size)
    for y in range(size):
        raw.append(0)
        for x in range(size):
            dx = (x + .5)/n - .5
            dy = (y + .5)/n - .5
            dist2 = dx*dx + dy*dy
            # Identidade visual: navy, círculo verde e arco branco tipo "C".
            color = (21, 39, 61)
            if dist2 < .365 * .365:
                color = (23, 125, 108)
            r = dist2 ** .5
            if .212 < r < .266 and not (dx > .08 and abs(dy) < .155):
                color = (255, 255, 255)
            raw.extend((*color, 255))
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return signature + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), level=8)) + chunk(b"IEND", b"")
