# Gera os icones do Turno sem dependencias (relogio estilizado), com antialias por supersampling:
#   resources/icon.png  (512px, janela no Linux + fonte de alta resolucao)
#   resources/icon.ico  (16..256px multi-tamanho, icone do app/barra de tarefas no Windows)
#   resources/tray.png  (32px, bandeja)
# Uso: python resources/make_icon.py
import zlib, struct, math

# Cor de um ponto no espaco 256x256. a = cobertura da forma (0..1); as bordas sao duras,
# o antialiasing vem do supersampling em render().
def design(px, py):
    r = 56  # raio do canto do quadrado arredondado
    cx = min(max(px, r), 256 - r)
    cy = min(max(py, r), 256 - r)
    if math.hypot(px - cx, py - cy) > r:
        return (0, 0, 0, 0.0)
    col = (12, 12, 14)  # fundo
    dc = math.hypot(px - 128, py - 128)
    if abs(dc - 78) < 12:  # aro do relogio
        col = (228, 228, 231)
    # ponteiros: para cima e para a direita (agendamento)
    if (abs(px - 128) < 10 and 60 < py < 134) or (abs(py - 128) < 10 and 122 < px < 182):
        col = (245, 158, 11)
    if dc < 14:  # eixo central
        col = (245, 158, 11)
    return (col[0], col[1], col[2], 1.0)

def render(size, ss=4):
    S = size / 256.0
    out = []
    for y in range(size):
        row = bytearray([0])  # byte de filtro da linha PNG
        for x in range(size):
            R = G = B = A = 0.0
            for sy in range(ss):
                for sx in range(ss):
                    u = (x + (sx + 0.5) / ss) / S
                    v = (y + (sy + 0.5) / ss) / S
                    r, g, b, a = design(u, v)
                    R += r * a; G += g * a; B += b * a; A += a
            n = ss * ss
            a = A / n
            if A > 0:
                row += bytes([int(round(R / A)) & 255, int(round(G / A)) & 255, int(round(B / A)) & 255, int(round(a * 255)) & 255])
            else:
                row += b'\x00\x00\x00\x00'
        out.append(bytes(row))
    return b''.join(out)

def png_bytes(size, ss=4):
    raw = render(size, ss)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))

def write_png(path, size, ss=4):
    with open(path, 'wb') as f:
        f.write(png_bytes(size, ss))

# .ico com imagens PNG embutidas (suportado no Windows Vista+), um tamanho por entrada.
def write_ico(path, sizes):
    imgs = [(s, png_bytes(s)) for s in sizes]
    offset = 6 + 16 * len(imgs)
    entries = bytearray()
    body = bytearray()
    for s, data in imgs:
        dim = 0 if s >= 256 else s  # 0 = 256 no formato ICO
        entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        body += data
    with open(path, 'wb') as f:
        f.write(struct.pack('<HHH', 0, 1, len(imgs)) + bytes(entries) + bytes(body))

write_png('resources/icon.png', 512)
write_png('resources/tray.png', 32)
write_ico('resources/icon.ico', [16, 24, 32, 48, 64, 128, 256])
print('ok: icon.png (512), icon.ico (16-256), tray.png (32)')
