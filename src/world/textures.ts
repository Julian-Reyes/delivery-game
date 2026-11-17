import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { BRAND } from '../brand';
import { createRandom } from './geo';

/**
 * Every texture in the game is painted here at startup with the 2D canvas API, so there
 * are no image files to license. All ground textures tile seamlessly.
 */

const SIZE = 256;

type Painter = (ctx: CanvasRenderingContext2D, random: () => number) => void;

function paint(width: number, height: number, seed: number, painter: Painter): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  painter(ctx, createRandom(seed));
  return canvas;
}

function tiling(canvas: HTMLCanvasElement, anisotropy: number): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

/** Scatter small dots of the given colors: the grain that stops a flat fill looking fake. */
function speckle(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  count: number,
  colors: readonly string[],
  maxSize = 2,
): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)] ?? '#000';
    const size = 1 + random() * (maxSize - 1);
    ctx.fillRect(random() * SIZE, random() * SIZE, size, size);
  }
}

const asphalt: Painter = (ctx, random) => {
  ctx.fillStyle = '#4b4e54';
  ctx.fillRect(0, 0, SIZE, SIZE);
  speckle(ctx, random, 5200, ['#5a5d63', '#3f4247', '#66696e', '#35383c']);
  // Hairline cracks.
  ctx.strokeStyle = 'rgba(30,30,32,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    let x = random() * SIZE;
    let y = random() * SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let j = 0; j < 7; j++) {
      x += (random() - 0.5) * 34;
      y += (random() - 0.5) * 34;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
};

/** Paralelepípedo: rows of rough rectangular granite setts, each row offset from the last. */
const cobble: Painter = (ctx, random) => {
  ctx.fillStyle = '#3a3632';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const rows = 8;
  const columns = 4;
  const stoneH = SIZE / rows;
  const stoneW = SIZE / columns;
  const tones = ['#8a8279', '#7b746c', '#989086', '#6f6962', '#a0968a', '#847a6e'];
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : stoneW / 2;
    for (let column = -1; column <= columns; column++) {
      const x = column * stoneW + offset;
      const y = row * stoneH;
      const inset = 2 + random() * 1.5;
      ctx.fillStyle = tones[Math.floor(random() * tones.length)] ?? '#888';
      ctx.beginPath();
      ctx.roundRect(x + inset, y + inset, stoneW - inset * 2, stoneH - inset * 2, 5);
      ctx.fill();
      // Worn highlight on the crown of each stone.
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.roundRect(x + inset + 4, y + inset + 3, stoneW - inset * 2 - 12, stoneH * 0.3, 4);
      ctx.fill();
    }
  }
  speckle(ctx, random, 1800, ['rgba(0,0,0,0.18)', 'rgba(255,255,255,0.10)']);
};

const sidewalk: Painter = (ctx, random) => {
  ctx.fillStyle = '#b6b1a7';
  ctx.fillRect(0, 0, SIZE, SIZE);
  speckle(ctx, random, 3600, ['#c4bfb5', '#a5a096', '#9a958c', '#cfcac0']);
  // Stains.
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = `rgba(70,62,52,${(0.04 + random() * 0.07).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(
      random() * SIZE,
      random() * SIZE,
      8 + random() * 26,
      6 + random() * 18,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  // Slab joints, drawn on the tile edges and centre so they line up when repeated.
  ctx.fillStyle = 'rgba(60,56,50,0.55)';
  for (const edge of [0, SIZE / 2]) {
    ctx.fillRect(edge - 1, 0, 2, SIZE);
    ctx.fillRect(0, edge - 1, SIZE, 2);
  }
  ctx.fillRect(SIZE - 1, 0, 1, SIZE);
  ctx.fillRect(0, SIZE - 1, SIZE, 1);
};

/** Black-and-white wave mosaic in the calçada portuguesa tradition. */
const mosaic: Painter = (ctx, random) => {
  ctx.fillStyle = '#e9e4da';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const bands = 4;
  const period = SIZE / bands;
  ctx.fillStyle = '#26262a';
  for (let band = -1; band <= bands; band++) {
    const top = band * period;
    ctx.beginPath();
    for (let x = 0; x <= SIZE; x += 4) {
      const y = top + Math.sin((x / SIZE) * Math.PI * 4) * period * 0.3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let x = SIZE; x >= 0; x -= 4) {
      const y = top + period * 0.5 + Math.sin((x / SIZE) * Math.PI * 4 + 0.9) * period * 0.3;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  // The little square stones.
  speckle(ctx, random, 2600, ['rgba(255,255,255,0.16)', 'rgba(0,0,0,0.14)'], 3);
};

const sand: Painter = (ctx, random) => {
  ctx.fillStyle = '#ead9ab';
  ctx.fillRect(0, 0, SIZE, SIZE);
  speckle(ctx, random, 4200, ['#f3e5bd', '#dcc892', '#e2d09e', '#f7ecca']);
};

const lot: Painter = (ctx, random) => {
  ctx.fillStyle = '#8d877c';
  ctx.fillRect(0, 0, SIZE, SIZE);
  speckle(ctx, random, 3600, ['#9c968b', '#7d776d', '#a59f94', '#6f6a61'], 3);
};

const grass: Painter = (ctx, random) => {
  ctx.fillStyle = '#5e9a45';
  ctx.fillRect(0, 0, SIZE, SIZE);
  speckle(ctx, random, 5200, ['#6fae52', '#4f873a', '#7cb95c', '#467a33', '#8a8a4a'], 3);
};

export interface GroundTextures {
  asphalt: CanvasTexture;
  cobble: CanvasTexture;
  sidewalk: CanvasTexture;
  mosaic: CanvasTexture;
  sand: CanvasTexture;
  lot: CanvasTexture;
  grass: CanvasTexture;
}

export function createGroundTextures(anisotropy: number): GroundTextures {
  return {
    asphalt: tiling(paint(SIZE, SIZE, 11, asphalt), anisotropy),
    cobble: tiling(paint(SIZE, SIZE, 12, cobble), anisotropy),
    sidewalk: tiling(paint(SIZE, SIZE, 13, sidewalk), anisotropy),
    mosaic: tiling(paint(SIZE, SIZE, 14, mosaic), anisotropy),
    sand: tiling(paint(SIZE, SIZE, 15, sand), anisotropy),
    lot: tiling(paint(SIZE, SIZE, 16, lot), anisotropy),
    grass: tiling(paint(SIZE, SIZE, 17, grass), anisotropy),
  };
}

/** How many metres one repeat of each ground texture covers. */
export const GROUND_TILE_METRES: Record<keyof GroundTextures, number> = {
  asphalt: 10,
  cobble: 2.5,
  sidewalk: 2.5,
  mosaic: 5,
  sand: 10,
  lot: 10,
  grass: 5,
};

// --- Shop signs -------------------------------------------------------------------------

const SIGN_COLUMNS = 4;
const SIGN_ROWS = 8;
const SIGN_W = 256;
const SIGN_H = 64;

/**
 * Invented, generic shop names in Portuguese. None is a real business or brand; keep it
 * that way when adding more.
 */
const SIGN_NAMES: readonly string[] = [
  'BAR DO ZECA',
  'PADARIA DA VILA',
  'AÇAÍ DO MORRO',
  'LANCHONETE DA TIA',
  'MERCADINHO',
  'FARMÁCIA',
  'BORRACHARIA',
  'SALÃO DA LU',
  'SUCOS NATURAIS',
  'PASTELARIA',
  'AÇOUGUE',
  'MOTO PEÇAS',
  'CHAVEIRO',
  'PAPELARIA',
  'HORTIFRUTI',
  'COMIDA A KILO',
  'PIZZARIA',
  'SORVETERIA',
  'ARMARINHO',
  'BARBEARIA',
  'CONSERTO DE CELULAR',
  'ÓTICA',
  'PET SHOP',
  'DEPÓSITO DE GÁS',
  'TAPIOCARIA',
  'CALÇADOS',
  'FLORICULTURA',
  'BOTECO DA LADEIRA',
  'CHURRASQUINHO',
  'ÁGUA DE COCO',
];

const SIGN_STYLES: readonly { background: string; text: string; border: string }[] = [
  { background: '#d62828', text: '#fff7e0', border: '#fff7e0' },
  { background: '#f7c600', text: '#1d1d1d', border: '#1d1d1d' },
  { background: '#1d6fb8', text: '#ffffff', border: '#ffd23f' },
  { background: '#1f8a4c', text: '#ffe066', border: '#ffe066' },
  { background: '#f4efe4', text: '#c1272d', border: '#c1272d' },
  { background: '#1d1d1d', text: '#ffd23f', border: '#ffd23f' },
  { background: '#ef7b22', text: '#ffffff', border: '#5a2a00' },
  { background: '#f4efe4', text: '#1d4f91', border: '#1d4f91' },
];

export const SIGN_COUNT = SIGN_COLUMNS * SIGN_ROWS;
/** Sign slots that advertise the fictional delivery app rather than a shop. */
export const APP_SIGN_SLOTS: readonly number[] = [SIGN_COUNT - 2, SIGN_COUNT - 1];

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): void {
  let size = 40;
  do {
    ctx.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    size -= 2;
  } while (ctx.measureText(text).width > maxWidth && size > 12);
}

/** One texture holding every sign, so all signs in the city share a single draw call. */
export function createSignAtlas(anisotropy: number): CanvasTexture {
  const canvas = paint(SIGN_COLUMNS * SIGN_W, SIGN_ROWS * SIGN_H, 21, (ctx) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let slot = 0; slot < SIGN_COUNT; slot++) {
      const x = (slot % SIGN_COLUMNS) * SIGN_W;
      const y = Math.floor(slot / SIGN_COLUMNS) * SIGN_H;
      const isApp = APP_SIGN_SLOTS.includes(slot);
      const style = isApp
        ? { background: '#1fb5a8', text: '#16202e', border: '#16202e' }
        : (SIGN_STYLES[slot % SIGN_STYLES.length] ?? SIGN_STYLES[0]);
      if (!style) continue;
      const text = isApp
        ? `${BRAND.appName} · PEÇA JÁ`
        : (SIGN_NAMES[slot % SIGN_NAMES.length] ?? 'LOJA');

      ctx.fillStyle = style.background;
      ctx.fillRect(x, y, SIGN_W, SIGN_H);
      ctx.strokeStyle = style.border;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 5.5, y + 5.5, SIGN_W - 11, SIGN_H - 11);
      ctx.fillStyle = style.text;
      fitText(ctx, text, SIGN_W - 30);
      ctx.fillText(text, x + SIGN_W / 2, y + SIGN_H / 2 + 2);
    }
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

/** UV corners of a sign slot, in the order bottom-left, bottom-right, top-right, top-left. */
export function signUvs(slot: number): readonly (readonly [number, number])[] {
  const column = slot % SIGN_COLUMNS;
  const row = Math.floor(slot / SIGN_COLUMNS);
  // Stay a texel inside the slot so neighbours do not bleed in at a distance.
  const padU = 1.5 / (SIGN_COLUMNS * SIGN_W);
  const padV = 1.5 / (SIGN_ROWS * SIGN_H);
  const u0 = column / SIGN_COLUMNS + padU;
  const u1 = (column + 1) / SIGN_COLUMNS - padU;
  const v1 = 1 - row / SIGN_ROWS - padV;
  const v0 = 1 - (row + 1) / SIGN_ROWS + padV;
  return [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
}
