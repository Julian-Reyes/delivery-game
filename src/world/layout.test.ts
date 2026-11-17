import { describe, expect, it } from 'vitest';
import {
  AVENUE_Z,
  CELL,
  CORRIDOR_HALF,
  CROSS_STREETS,
  CURB,
  HALF,
  HILL_STREETS_X,
  NORTH_ROW_Z,
  RAMPS,
  SPAWN,
  SPEED_BUMPS,
  heightAt,
  innerBlocks,
  isPark,
  surfaceAt,
  surfaceHeightAt,
} from './layout';

describe('heightAt', () => {
  it('is flat at sea level along the avenue', () => {
    for (const x of [-140, -30, 0, 75, 140]) expect(heightAt(x, AVENUE_Z)).toBe(0);
  });

  it('keeps every cross street level across its width', () => {
    for (const street of CROSS_STREETS) {
      for (const x of [-80, 0, 80]) {
        const centre = heightAt(x, street.z);
        expect(heightAt(x, street.z - CORRIDOR_HALF + 0.01)).toBeCloseTo(centre, 6);
        expect(heightAt(x, street.z + CORRIDOR_HALF - 0.01)).toBeCloseTo(centre, 6);
      }
    }
  });

  it('climbs from each cross street to the next', () => {
    let previous = 0;
    for (const street of CROSS_STREETS) {
      expect(heightAt(0, street.z)).toBe(street.height);
      expect(street.height).toBeGreaterThan(previous);
      previous = street.height;
    }
  });

  it('has no cliffs anywhere you can ride: never steeper than a 45% grade', () => {
    const step = 0.5;
    // North of the last row of buildings the ground deliberately ramps up into the hill.
    for (let z = -HALF; z < NORTH_ROW_Z - step; z += step) {
      for (const x of [-120, -30, 30, 120]) {
        const rise = Math.abs(heightAt(x, z + step) - heightAt(x, z));
        expect(rise / step).toBeLessThan(0.45);
      }
    }
  });

  it('is higher on the east side of the hill than the west', () => {
    expect(heightAt(90, 80)).toBeGreaterThan(heightAt(-90, 80));
  });

  it('dips below sea level out on the sand', () => {
    expect(heightAt(0, -149)).toBeLessThan(0);
  });
});

describe('surfaceAt', () => {
  it('lays out the seafront from sand to avenue', () => {
    expect(surfaceAt(0, -130)).toBe('sand');
    expect(surfaceAt(0, -110)).toBe('mosaic');
    expect(surfaceAt(0, AVENUE_Z)).toBe('asphalt');
    expect(surfaceAt(0, -91)).toBe('sidewalk');
  });

  it('puts road in the middle of each street and sidewalk at its edges', () => {
    const hillX = HILL_STREETS_X[1] ?? 0;
    expect(surfaceAt(hillX, 50)).toBe('asphalt');
    expect(surfaceAt(hillX + 6, 50)).toBe('sidewalk');
    expect(surfaceAt(hillX + 9, 50)).toBe('lot');
    expect(surfaceAt(60, -40)).toBe('asphalt');
    expect(surfaceAt(60, -46)).toBe('sidewalk');
  });

  it('has one cobblestone street, including through its intersections', () => {
    expect(surfaceAt(60, 20)).toBe('cobble');
    expect(surfaceAt(-30, 20)).toBe('cobble');
    expect(CROSS_STREETS.filter((street) => street.surface === 'cobble')).toHaveLength(1);
  });

  it('keeps the park as grass', () => {
    expect(surfaceAt(0, -10)).toBe('grass');
  });

  it('raises sidewalks above the road by the kerb height', () => {
    const road = surfaceHeightAt(-30, 50);
    const walk = surfaceHeightAt(-24, 50);
    expect(walk - road).toBeCloseTo(CURB + heightAt(-24, 50) - heightAt(-30, 50), 6);
  });
});

describe('layout data', () => {
  it('aligns every street edge to the cell grid', () => {
    const onGrid = (value: number): boolean => Number.isInteger((value + HALF) / CELL);
    for (const x of HILL_STREETS_X) expect(onGrid(x - CORRIDOR_HALF)).toBe(true);
    for (const street of CROSS_STREETS) expect(onGrid(street.z - CORRIDOR_HALF)).toBe(true);
  });

  it('makes twelve inner blocks with exactly one park', () => {
    const blocks = innerBlocks();
    expect(blocks).toHaveLength(12);
    expect(blocks.filter(isPark)).toHaveLength(1);
    for (const block of blocks) {
      expect(surfaceAt((block.x0 + block.x1) / 2, (block.z0 + block.z1) / 2)).not.toBe('asphalt');
    }
  });

  it('puts spawn, speed bumps and ramps on a road', () => {
    const roads = ['asphalt', 'cobble'];
    expect(roads).toContain(surfaceAt(SPAWN.x, SPAWN.z));
    for (const bump of SPEED_BUMPS) expect(roads).toContain(surfaceAt(bump.x, bump.z));
    for (const ramp of RAMPS) expect(roads).toContain(surfaceAt(ramp.x, ramp.z));
  });
});
