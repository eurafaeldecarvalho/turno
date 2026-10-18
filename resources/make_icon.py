# Gera resources/icon.png (256px) e resources/tray.png (32px) sem dependencias: relogio estilizado.
import zlib, struct, math, sys

def png(path, size):
    S = size / 256
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            px, py = (x + .5) / S, (y + .5) / S
            # quadrado arredondado
            r = 56; cx = min(max(px, r), 256 - r); cy = min(max(py, r), 256 - r)
            d = math.hypot(px - cx, py - cy)
            a = max(0.0, min(1.0, (r - d) * S + .5))
            col = (12, 12, 14)
            dc = math.hypot(px - 128, py - 128)
            ring = abs(dc - 78) < 11
            # ponteiros: para cima e para a direita (agendamento)
            hand1 = abs(px - 128) < 9 and 64 < py < 132
            hand2 = abs(py - 128) < 9 and 124 < px < 178
            if ring: col = (228, 228, 231)
            if hand1 or hand2: col = (245, 158, 11)
            if dc < 13: col = (245, 158, 11)
            row += bytes([*col, int(a * 255)])
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)

png('resources/icon.png', 256)
png('resources/tray.png', 32)
print('ok')
