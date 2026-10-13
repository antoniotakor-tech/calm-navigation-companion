"""Minimal QR Code encoder (byte mode, error correction level M, versions 1-9).

Written for the campaign so no extra package has to be installed. Follows the
QR Code Model 2 spec (ISO/IEC 18004); structure mirrors Project Nayuki's
reference implementation. Every generated code is checked with a real QR
scanner (the browser's BarcodeDetector) before use - see campaign/README.md.
"""

# Level M tables, index = version (1..9)
ECC_PER_BLOCK = [None, 10, 16, 26, 18, 24, 16, 18, 22, 22]
NUM_BLOCKS = [None, 1, 1, 1, 2, 2, 4, 4, 4, 5]
ALIGN = [None, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46]]


def _gf_mul(x, y):
    z = 0
    for i in range(7, -1, -1):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z & 0xFF


def _rs_divisor(degree):
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(len(result)):
            result[j] = _gf_mul(result[j], root)
            if j + 1 < len(result):
                result[j] ^= result[j + 1]
        root = _gf_mul(root, 0x02)
    return result


def _rs_remainder(data, divisor):
    result = [0] * len(divisor)
    for b in data:
        factor = b ^ result.pop(0)
        result.append(0)
        for i, coef in enumerate(divisor):
            result[i] ^= _gf_mul(coef, factor)
    return result


def _raw_modules(ver):
    result = (16 * ver + 128) * ver + 64
    if ver >= 2:
        n = ver // 7 + 2
        result -= (25 * n - 10) * n - 55
        if ver >= 7:
            result -= 36
    return result


def _data_codewords(ver):
    return _raw_modules(ver) // 8 - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]


class QR:
    def __init__(self, text):
        data = text.encode("utf-8")
        for ver in range(1, 10):
            cap_bits = _data_codewords(ver) * 8
            if 4 + 8 + len(data) * 8 <= cap_bits:
                break
        else:
            raise ValueError("Text too long for this encoder (max version 9)")
        self.version = ver
        self.size = ver * 4 + 17
        # --- data bit stream ---
        bits = []
        def put(val, n):
            bits.extend((val >> i) & 1 for i in range(n - 1, -1, -1))
        put(0b0100, 4); put(len(data), 8)
        for b in data:
            put(b, 8)
        put(0, min(4, cap_bits - len(bits)))
        put(0, (-len(bits)) % 8)
        pad = 0xEC
        while len(bits) < cap_bits:
            put(pad, 8); pad ^= 0xEC ^ 0x11
        codewords = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
        all_cw = self._add_ecc(codewords)
        # --- matrix ---
        n = self.size
        self.mod = [[False] * n for _ in range(n)]
        self.fn = [[False] * n for _ in range(n)]
        self._function_patterns()
        self._draw_codewords(all_cw)
        best, best_pen = 0, None
        for m in range(8):
            self._apply_mask(m); self._format_bits(m)
            pen = self._penalty()
            if best_pen is None or pen < best_pen:
                best, best_pen = m, pen
            self._apply_mask(m)  # undo (XOR)
        self._apply_mask(best); self._format_bits(best)

    # Nayuki-style helpers (x = column, y = row)
    def _set(self, x, y, dark):
        self.mod[y][x] = dark; self.fn[y][x] = True

    def _function_patterns(self):
        n = self.size
        for i in range(n):
            self._set(6, i, i % 2 == 0); self._set(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (n - 4, 3), (3, n - 4)):
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    x, y = cx + dx, cy + dy
                    if 0 <= x < n and 0 <= y < n:
                        self._set(x, y, max(abs(dx), abs(dy)) not in (2, 4))
        pos = ALIGN[self.version]; last = len(pos) - 1
        for i, a in enumerate(pos):
            for j, b in enumerate(pos):
                if (i == 0 and j == 0) or (i == 0 and j == last) or (i == last and j == 0):
                    continue
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        self._set(a + dx, b + dy, max(abs(dx), abs(dy)) != 1)
        self._format_bits(0)
        if self.version >= 7:
            rem = self.version
            for _ in range(12):
                rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
            vbits = self.version << 12 | rem
            for i in range(18):
                bit = (vbits >> i) & 1 == 1
                a, b = n - 11 + i % 3, i // 3
                self._set(a, b, bit); self._set(b, a, bit)

    def _format_bits(self, mask):
        data = (0b00 << 3) | mask  # level M = 00
        rem = data
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        bits = ((data << 10) | rem) ^ 0x5412
        g = lambda i: (bits >> i) & 1 == 1
        n = self.size
        for i in range(0, 6):
            self._set(8, i, g(i))
        self._set(8, 7, g(6)); self._set(8, 8, g(7)); self._set(7, 8, g(8))
        for i in range(9, 15):
            self._set(14 - i, 8, g(i))
        for i in range(0, 8):
            self._set(n - 1 - i, 8, g(i))
        for i in range(8, 15):
            self._set(8, n - 15 + i, g(i))
        self._set(8, n - 8, True)

    def _add_ecc(self, data):
        ver = self.version
        nb, ecl = NUM_BLOCKS[ver], ECC_PER_BLOCK[ver]
        raw = _raw_modules(ver) // 8
        short = nb - raw % nb
        short_len = raw // nb
        div = _rs_divisor(ecl)
        blocks, k = [], 0
        for i in range(nb):
            dat = data[k:k + short_len - ecl + (0 if i < short else 1)]
            k += len(dat)
            ecc = _rs_remainder(dat, div)
            if i < short:
                dat = dat + [0]
            blocks.append(dat + ecc)
        out = []
        for i in range(len(blocks[0])):
            for j, blk in enumerate(blocks):
                if i != short_len - ecl or j >= short:
                    out.append(blk[i])
        return out

    def _draw_codewords(self, cw):
        n, i = self.size, 0
        right = n - 1
        while right >= 1:
            if right == 6:
                right = 5
            for vert in range(n):
                for j in range(2):
                    x = right - j
                    up = ((right + 1) & 2) == 0
                    y = n - 1 - vert if up else vert
                    if not self.fn[y][x] and i < len(cw) * 8:
                        self.mod[y][x] = (cw[i >> 3] >> (7 - (i & 7))) & 1 == 1
                        i += 1
            right -= 2

    def _apply_mask(self, m):
        f = [lambda x, y: (x + y) % 2 == 0, lambda x, y: y % 2 == 0, lambda x, y: x % 3 == 0,
             lambda x, y: (x + y) % 3 == 0, lambda x, y: (x // 3 + y // 2) % 2 == 0,
             lambda x, y: x * y % 2 + x * y % 3 == 0, lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
             lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0][m]
        for y in range(self.size):
            for x in range(self.size):
                if not self.fn[y][x] and f(x, y):
                    self.mod[y][x] = not self.mod[y][x]

    def _penalty(self):
        n, m, pen = self.size, self.mod, 0
        lines = [m[y] for y in range(n)] + [[m[y][x] for y in range(n)] for x in range(n)]
        pat1 = [True, False, True, True, True, False, True, False, False, False, False]
        pat2 = pat1[::-1]
        for line in lines:
            run, prev = 0, None
            for v in line:
                if v == prev:
                    run += 1
                else:
                    if run >= 5:
                        pen += 3 + run - 5
                    run, prev = 1, v
            if run >= 5:
                pen += 3 + run - 5
            for i in range(n - 10):
                seg = line[i:i + 11]
                if seg == pat1 or seg == pat2:
                    pen += 40
        for y in range(n - 1):
            for x in range(n - 1):
                c = m[y][x]
                if c == m[y][x + 1] == m[y + 1][x] == m[y + 1][x + 1]:
                    pen += 3
        dark = sum(sum(r) for r in m)
        total = n * n
        k = (abs(dark * 20 - total * 10) + total - 1) // total - 1
        return pen + k * 10

    # --- output ---
    def svg(self, border=4, dark="#2D2A3E", light="#FFFFFF"):
        n = self.size + border * 2
        parts = []
        for y in range(self.size):
            for x in range(self.size):
                if self.mod[y][x]:
                    parts.append(f"M{x + border},{y + border}h1v1h-1z")
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" shape-rendering="crispEdges">'
                f'<rect width="100%" height="100%" fill="{light}"/><path d="{"".join(parts)}" fill="{dark}"/></svg>')

    def svg_paths(self, border=4):
        return "".join(f"M{x + border},{y + border}h1v1h-1z" for y in range(self.size) for x in range(self.size) if self.mod[y][x])

    def image(self, scale=12, border=4, dark=(45, 42, 62), light=(255, 255, 255)):
        from PIL import Image
        n = (self.size + border * 2) * scale
        im = Image.new("RGB", (n, n), light)
        px = im.load()
        for y in range(self.size):
            for x in range(self.size):
                if self.mod[y][x]:
                    for dy in range(scale):
                        for dx in range(scale):
                            px[(x + border) * scale + dx, (y + border) * scale + dy] = dark
        return im
