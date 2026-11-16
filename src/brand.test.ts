import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';

describe('BRAND', () => {
  it('has non-empty display names', () => {
    expect(BRAND.gameName.trim()).not.toBe('');
    expect(BRAND.appName.trim()).not.toBe('');
  });

  it('never uses a real delivery brand as the app name', () => {
    const realBrands = ['ifood', 'rappi', 'uber', '99', 'loggi', 'doordash', 'deliveroo'];
    const app = BRAND.appName.toLowerCase();
    for (const brand of realBrands) {
      expect(app).not.toContain(brand);
    }
  });
});
