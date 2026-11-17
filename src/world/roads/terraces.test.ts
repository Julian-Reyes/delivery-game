import { describe, expect, it } from 'vitest';
import { traceContours } from './terraces';

describe('traceContours', () => {
  it('traces a straight contour across a plane sloping north', () => {
    const lines = traceContours((_, z) => z * 0.3, { x0: 0, x1: 100, z0: 0, z1: 100 }, 15);
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? [];
    expect(line.length).toBeGreaterThan(20);
    for (const p of line) expect(p.z).toBeCloseTo(50, 5);
  });

  it('closes a contour round a hilltop', () => {
    const lines = traceContours(
      (x, z) => 30 - Math.hypot(x - 50, z - 50) * 0.5,
      { x0: 0, x1: 100, z0: 0, z1: 100 },
      20,
    );
    expect(lines).toHaveLength(1);
    for (const p of lines[0] ?? []) expect(Math.hypot(p.x - 50, p.z - 50)).toBeCloseTo(20, 0);
  });
});
