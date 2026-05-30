// アプリアイコン生成（依存なし: Node標準のzlibでPNGエンコード）
// 緑の角丸正方形 + 白い皿(リング) + フォーク&ナイフ
const zlib = require('zlib');
const fs = require('fs');

const GREEN = [46, 125, 50];
const WHITE = [255, 255, 255];

function makeIcon(S) {
  const buf = Buffer.alloc(S * S * 4); // RGBA, 透明
  const put = (x, y, rgb, a = 255) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= S || y < 0 || y >= S) return;
    const i = (y * S + x) * 4;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = a;
  };

  // 角丸正方形（緑）
  const r = S * 0.22;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let inside = true;
      if (x < r && y < r && (x - r) ** 2 + (y - r) ** 2 > r * r) inside = false;
      else if (x > S - r && y < r && (x - (S - r)) ** 2 + (y - r) ** 2 > r * r) inside = false;
      else if (x < r && y > S - r && (x - r) ** 2 + (y - (S - r)) ** 2 > r * r) inside = false;
      else if (x > S - r && y > S - r && (x - (S - r)) ** 2 + (y - (S - r)) ** 2 > r * r) inside = false;
      if (inside) put(x, y, GREEN);
    }
  }

  const cx = S / 2, cy = S * 0.52;

  // 白い皿（リング）
  const plateR = S * 0.30, ring = S * 0.045;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= plateR && d >= plateR - ring) put(x, y, WHITE);
    }

  const vbar = (x0, w, top, bot) => {
    for (let y = Math.round(top); y < Math.round(bot); y++)
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) put(x, y, WHITE);
  };

  const bw = S * 0.030;
  // フォーク（左）
  const fx = cx - S * 0.11;
  vbar(fx - bw / 2, bw, cy - S * 0.13, cy + S * 0.15);
  for (const k of [-1, 0, 1]) vbar(fx + k * S * 0.035 - S * 0.010, S * 0.020, cy - S * 0.20, cy - S * 0.11);
  // ナイフ（右）
  const kx = cx + S * 0.11;
  vbar(kx - bw * 0.7, bw * 1.4, cy - S * 0.20, cy - S * 0.02);
  vbar(kx - bw / 2, bw, cy - S * 0.02, cy + S * 0.15);

  return buf;
}

function writePng(path, S, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    const crcBuf = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(crcBuf) >>> 0 : crc32(crcBuf));
    return Buffer.concat([len, t, data, crc]);
  };
  // CRC (zlib.crc32 may not exist on all versions)
  function crc32(b) {
    let c = ~0;
    for (let i = 0; i < b.length; i++) {
      c ^= b[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return (~c) >>> 0;
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0;
    rgba.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  fs.writeFileSync(path, Buffer.concat([
    sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
  ]));
}

for (const s of [192, 512]) {
  writePng(__dirname + `/icon-${s}.png`, s, makeIcon(s));
  console.log('wrote icon-' + s + '.png');
}
