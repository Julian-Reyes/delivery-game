import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import type { Finish } from './houses';
import { createRandom } from './random';

/**
 * Facade texture atlas for favela houses, painted with the 2D canvas at startup like every
 * other texture. Each tile is one bay of one floor (about 2.8 m square). Rows are wall
 * finishes, columns are what is in the bay. Plaster and block are painted pale so the
 * house's vertex colour tints them; brick keeps its own colour.
 */

export type Feature = 'blank' | 'grille' | 'shutters' | 'small' | 'door' | 'roller';

const FINISHES: readonly Finish[] = ['brick', 'block', 'plaster'];
const FEATURES: readonly Feature[] = ['blank', 'grille', 'shutters', 'small', 'door', 'roller'];
const TILE = 128;
/** Unpainted margin round each tile, so mipmaps do not bleed one tile into the next. */
const GUTTER = 4;
const WIDTH = FEATURES.length * TILE;
const HEIGHT = FINISHES.length * TILE;

type Ctx = CanvasRenderingContext2D;

function wallBase(ctx: Ctx, finish: Finish, x0: number, y0: number, random: () => number): void {
  if (finish === 'brick') {
    ctx.fillStyle = '#b8653d';
    ctx.fillRect(x0, y0, TILE, TILE);
    // Courses of brick with grey mortar, every brick a slightly different fired colour.
    const course = 8;
    const brick = 22;
    for (let row = 0; row * course < TILE; row++) {
      const shift = row % 2 === 0 ? 0 : brick / 2;
      for (let col = -1; col * brick < TILE; col++) {
        const tone = 0.85 + random() * 0.3;
        ctx.fillStyle = `rgb(${Math.round(184 * tone)},${Math.round(100 * tone)},${Math.round(62 * tone)})`;
        ctx.fillRect(x0 + col * brick + shift + 1, y0 + row * course + 1, brick - 2, course - 2);
      }
    }
    ctx.fillStyle = 'rgba(150,140,128,0.35)';
    for (let row = 0; row * 8 < TILE; row++) ctx.fillRect(x0, y0 + row * 8, TILE, 1);
  } else if (finish === 'block') {
    ctx.fillStyle = '#e4e2dd';
    ctx.fillRect(x0, y0, TILE, TILE);
    ctx.fillStyle = 'rgba(120,118,112,0.55)';
    for (let row = 0; row * 16 < TILE; row++) {
      ctx.fillRect(x0, y0 + row * 16, TILE, 2);
      const shift = row % 2 === 0 ? 0 : 20;
      for (let col = 0; col * 40 < TILE + 40; col++) {
        ctx.fillRect(x0 + col * 40 + shift, y0 + row * 16, 2, 16);
      }
    }
  } else {
    ctx.fillStyle = '#f2efe8';
    ctx.fillRect(x0, y0, TILE, TILE);
  }
  // Grime: speckle all over, darker streaks running down from the top.
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(60,55,50,${0.04 + random() * 0.08})`;
    ctx.fillRect(x0 + random() * TILE, y0 + random() * TILE, 1 + random() * 2, 1 + random() * 2);
  }
  for (let i = 0; i < 4; i++) {
    const sx = x0 + random() * TILE;
    const gradient = ctx.createLinearGradient(0, y0, 0, y0 + TILE * (0.3 + random() * 0.5));
    gradient.addColorStop(0, 'rgba(70,65,58,0.18)');
    gradient.addColorStop(1, 'rgba(70,65,58,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(sx, y0, 3 + random() * 6, TILE);
  }
}

function window_(ctx: Ctx, x: number, y: number, w: number, h: number, finish: Finish): void {
  // Concrete lintel and sill on raw walls; a painted frame on plaster.
  ctx.fillStyle = finish === 'plaster' ? '#d9d4ca' : '#a9a49b';
  ctx.fillRect(x - 4, y - 6, w + 8, 6);
  ctx.fillRect(x - 4, y + h, w + 8, 5);
  ctx.fillStyle = '#1f2a33';
  ctx.fillRect(x, y, w, h);
  // A hint of sky in the glass.
  const glass = ctx.createLinearGradient(0, y, 0, y + h);
  glass.addColorStop(0, 'rgba(140,175,200,0.45)');
  glass.addColorStop(1, 'rgba(30,40,50,0)');
  ctx.fillStyle = glass;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
}

function feature(
  ctx: Ctx,
  kind: Feature,
  finish: Finish,
  x0: number,
  y0: number,
  random: () => number,
): void {
  const cx = x0 + TILE / 2;
  switch (kind) {
    case 'blank':
      return;
    case 'grille': {
      const w = 54;
      const h = 46;
      const x = cx - w / 2;
      const y = y0 + 34;
      window_(ctx, x, y, w, h, finish);
      ctx.strokeStyle = '#2c2c2e';
      ctx.lineWidth = 2;
      for (let i = 1; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(x + (w * i) / 6, y);
        ctx.lineTo(x + (w * i) / 6, y + h);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
      ctx.stroke();
      return;
    }
    case 'shutters': {
      const w = 50;
      const h = 50;
      const x = cx - w / 2;
      const y = y0 + 32;
      window_(ctx, x, y, w, h, finish);
      const colors = ['#3f7cb0', '#2f8a5e', '#9a5a2e', '#d8d2c4'];
      ctx.fillStyle = colors[Math.floor(random() * colors.length)] ?? '#3f7cb0';
      // Half open: one leaf across the glass, one folded back against the wall.
      ctx.fillRect(x, y, w / 2, h);
      ctx.fillRect(x + w + 4, y, w / 4, h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < 8; i++) ctx.fillRect(x, y + 3 + i * 6, w / 2, 2);
      return;
    }
    case 'small': {
      window_(ctx, cx - 14 + (random() - 0.5) * 30, y0 + 30, 28, 22, finish);
      return;
    }
    case 'door': {
      const w = 40;
      const h = 82;
      const x = cx - w / 2;
      const y = y0 + TILE - h;
      ctx.fillStyle = finish === 'plaster' ? '#d0cabf' : '#9d988f';
      ctx.fillRect(x - 5, y - 6, w + 10, h + 6);
      const doors = ['#6b4a2f', '#3a4a5a', '#7a2f2a', '#48544a'];
      ctx.fillStyle = doors[Math.floor(random() * doors.length)] ?? '#6b4a2f';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + 4, y + 6, w - 8, 30);
      ctx.fillRect(x + 4, y + 42, w - 8, 34);
      ctx.fillStyle = '#c8b46a';
      ctx.fillRect(x + w - 9, y + 44, 4, 4);
      return;
    }
    case 'roller': {
      // A shop front: a corrugated steel roller shutter, half up.
      const w = TILE - 20;
      const h = 84;
      const x = x0 + 10;
      const y = y0 + TILE - h;
      ctx.fillStyle = '#5a5a5c';
      ctx.fillRect(x - 3, y - 8, w + 6, 8);
      ctx.fillStyle = '#b9bcbf';
      ctx.fillRect(x, y, w, h * 0.55);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < 12; i++) ctx.fillRect(x, y + i * 4, w, 2);
      ctx.fillStyle = '#26221e';
      ctx.fillRect(x, y + h * 0.55, w, h * 0.45);
      return;
    }
  }
}

export function createFacadeAtlas(anisotropy: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  const random = createRandom(31337);
  FINISHES.forEach((finish, row) => {
    FEATURES.forEach((kind, col) => {
      const x0 = col * TILE;
      const y0 = row * TILE;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, TILE, TILE);
      ctx.clip();
      wallBase(ctx, finish, x0, y0, random);
      feature(ctx, kind, finish, x0, y0, random);
      ctx.restore();
    });
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.minFilter = LinearMipmapLinearFilter;
  return texture;
}

/** Texture coordinates of one tile, inset by the gutter. Corners: u0, v0 (bottom), u1, v1. */
export function facadeUv(finish: Finish, kind: Feature): [number, number, number, number] {
  const col = FEATURES.indexOf(kind);
  const row = FINISHES.indexOf(finish);
  const u0 = (col * TILE + GUTTER) / WIDTH;
  const u1 = ((col + 1) * TILE - GUTTER) / WIDTH;
  // Canvas rows run down; texture v runs up.
  const v1 = 1 - (row * TILE + GUTTER) / HEIGHT;
  const v0 = 1 - ((row + 1) * TILE - GUTTER) / HEIGHT;
  return [u0, v0, u1, v1];
}
