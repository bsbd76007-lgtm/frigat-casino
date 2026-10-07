'use client';

export interface KeyedSprite {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export interface KeyOptions {
  minLuminance?: number;
  maxSaturation?: number;
  trimBelowSubject?: boolean;
}

export function keyOutFlatBackground(
  image: HTMLImageElement,
  options: KeyOptions = {}
): KeyedSprite | null {
  const {
    minLuminance = 200,
    maxSaturation = 14,
    trimBelowSubject = true,
  } = options;

  const w = image.naturalWidth;
  const h = image.naturalHeight;
  if (!w || !h) return null;

  const source = document.createElement('canvas');
  source.width = w;
  source.height = h;
  const sctx = source.getContext('2d', { willReadFrequently: true });
  if (!sctx) return null;
  sctx.drawImage(image, 0, 0);

  let pixels: ImageData;
  try {
    pixels = sctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }

  const data = pixels.data;
  const count = w * h;

  const isBackground = (idx: number): boolean => {
    const o = idx * 4;
    if (data[o + 3] === 0) return true;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > maxSaturation) return false;
    return Math.min(r, g, b) >= minLuminance;
  };

  const opaque = new Uint8Array(count).fill(1);
  const seen = new Uint8Array(count);
  const stack: number[] = [];

  const seed = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (seen[idx]) return;
    seen[idx] = 1;
    if (!isBackground(idx)) return;
    opaque[idx] = 0;
    stack.push(idx);
  };

  for (let x = 0; x < w; x += 1) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    seed(0, y);
    seed(w - 1, y);
  }
  while (stack.length) {
    const idx = stack.pop() as number;
    const x = idx % w;
    const y = (idx - x) / w;
    seed(x + 1, y);
    seed(x - 1, y);
    seed(x, y + 1);
    seed(x, y - 1);
  }

  const label = new Int32Array(count).fill(-1);
  let bestId = -1;
  let bestSize = 0;
  let nextId = 0;

  for (let start = 0; start < count; start += 1) {
    if (!opaque[start] || label[start] !== -1) continue;
    const id = nextId;
    nextId += 1;
    let size = 0;
    stack.length = 0;
    stack.push(start);
    label[start] = id;

    while (stack.length) {
      const idx = stack.pop() as number;
      size += 1;
      const x = idx % w;
      const y = (idx - x) / w;
      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const n = ny * w + nx;
        if (!opaque[n] || label[n] !== -1) return;
        label[n] = id;
        stack.push(n);
      };
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }

    if (size > bestSize) {
      bestSize = size;
      bestId = id;
    }
  }
  if (bestId === -1) return null;
  for (let i = 0; i < count; i += 1) {
    if (opaque[i] && label[i] !== bestId) opaque[i] = 0;
  }

  const reachable = new Uint8Array(count);
  stack.length = 0;
  const flood = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (reachable[idx] || opaque[idx]) return;
    reachable[idx] = 1;
    stack.push(idx);
  };
  for (let x = 0; x < w; x += 1) {
    flood(x, 0);
    flood(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    flood(0, y);
    flood(w - 1, y);
  }
  while (stack.length) {
    const idx = stack.pop() as number;
    const x = idx % w;
    const y = (idx - x) / w;
    flood(x + 1, y);
    flood(x - 1, y);
    flood(x, y + 1);
    flood(x, y - 1);
  }
  for (let i = 0; i < count; i += 1) {
    if (!opaque[i] && !reachable[i]) opaque[i] = 1;
  }

  if (trimBelowSubject) {
    let lastColouredRow = 0;
    for (let i = 0; i < count; i += 1) {
      if (!opaque[i]) continue;
      const o = i * 4;
      const spread =
        Math.max(data[o], data[o + 1], data[o + 2]) -
        Math.min(data[o], data[o + 1], data[o + 2]);
      if (spread > 25) {
        const y = Math.floor(i / w);
        if (y > lastColouredRow) lastColouredRow = y;
      }
    }
    for (let y = lastColouredRow + 1; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) opaque[y * w + x] = 0;
    }
  }

  const alpha = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) alpha[i] = opaque[i] ? 255 : 0;
  const soft = Uint8Array.from(alpha);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const idx = y * w + x;
      let sum = 0;
      let boundary = false;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const a = alpha[(y + dy) * w + (x + dx)];
          sum += a;
          if (a !== alpha[idx]) boundary = true;
        }
      }
      if (boundary) soft[idx] = Math.round(sum / 9);
    }
  }

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (soft[y * w + x] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const octx = out.getContext('2d');
  if (!octx) return null;

  const cropped = octx.createImageData(cw, ch);
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const src = ((y + minY) * w + (x + minX)) * 4;
      const dst = (y * cw + x) * 4;
      cropped.data[dst] = data[src];
      cropped.data[dst + 1] = data[src + 1];
      cropped.data[dst + 2] = data[src + 2];
      cropped.data[dst + 3] = soft[(y + minY) * w + (x + minX)];
    }
  }
  octx.putImageData(cropped, 0, 0);

  return { canvas: out, width: cw, height: ch };
}

export function loadKeyedSprite(
  src: string,
  options?: KeyOptions
): Promise<KeyedSprite | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        resolve(keyOutFlatBackground(image, options));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}
