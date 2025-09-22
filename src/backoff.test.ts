import { describe, it, expect } from 'vitest';
import {
  exponentialBackoff,
  linearBackoff,
  fixedBackoff,
  noBackoff,
  compositeBackoff,
  jitteredExponentialBackoff,
  presets,
} from './backoff';

describe('backoff helpers', () => {
  describe('exponentialBackoff', () => {
    it('should generate exponential delays', () => {
      const backoff = exponentialBackoff({ base: 100, max: 10_000 });

      expect(backoff(1)).toBe(100); // 100 * 2^0
      expect(backoff(2)).toBe(200); // 100 * 2^1
      expect(backoff(3)).toBe(400); // 100 * 2^2
      expect(backoff(4)).toBe(800); // 100 * 2^3
    });

    it('should respect maximum delay', () => {
      const backoff = exponentialBackoff({ base: 100, max: 300 });

      expect(backoff(1)).toBe(100);
      expect(backoff(2)).toBe(200);
      expect(backoff(3)).toBe(300); // Capped at max
      expect(backoff(4)).toBe(300); // Still capped
    });

    it('should apply custom multiplier', () => {
      const backoff = exponentialBackoff({ base: 100, multiplier: 3 });

      expect(backoff(1)).toBe(100); // 100 * 3^0
      expect(backoff(2)).toBe(300); // 100 * 3^1
      expect(backoff(3)).toBe(900); // 100 * 3^2
    });

    it('should apply jitter when specified', () => {
      const backoff = exponentialBackoff({ base: 100, jitter: 0.5 });

      const delay1 = backoff(1);
      const delay2 = backoff(1);
      const delay3 = backoff(1);

      // All should be around 100ms but with variation due to jitter
      expect(delay1).toBeGreaterThan(50);
      expect(delay1).toBeLessThan(150);

      // Values should vary (very small chance they're identical)
      const allSame = delay1 === delay2 && delay2 === delay3;
      expect(allSame).toBe(false);
    });
  });

  describe('linearBackoff', () => {
    it('should generate linear delays', () => {
      const backoff = linearBackoff({ base: 100 });

      expect(backoff(1)).toBe(100); // 100 * 1
      expect(backoff(2)).toBe(200); // 100 * 2
      expect(backoff(3)).toBe(300); // 100 * 3
      expect(backoff(4)).toBe(400); // 100 * 4
    });

    it('should respect maximum delay', () => {
      const backoff = linearBackoff({ base: 100, max: 250 });

      expect(backoff(1)).toBe(100);
      expect(backoff(2)).toBe(200);
      expect(backoff(3)).toBe(250); // Capped at max
      expect(backoff(4)).toBe(250); // Still capped
    });
  });

  describe('fixedBackoff', () => {
    it('should generate fixed delays', () => {
      const backoff = fixedBackoff({ base: 500 });

      expect(backoff(1)).toBe(500);
      expect(backoff(2)).toBe(500);
      expect(backoff(3)).toBe(500);
      expect(backoff(99)).toBe(500);
    });

    it('should apply jitter when specified', () => {
      const backoff = fixedBackoff({ base: 1000, jitter: 0.2 });

      const delay1 = backoff(1);
      const delay2 = backoff(1);

      // Should be around 1000ms with ±20% jitter
      expect(delay1).toBeGreaterThan(800);
      expect(delay1).toBeLessThan(1200);
      expect(delay2).toBeGreaterThan(800);
      expect(delay2).toBeLessThan(1200);
    });
  });

  describe('noBackoff', () => {
    it('should always return 0', () => {
      const backoff = noBackoff();

      expect(backoff(1)).toBe(0);
      expect(backoff(5)).toBe(0);
      expect(backoff(100)).toBe(0);
    });
  });

  describe('compositeBackoff', () => {
    it('should switch strategies based on attempt', () => {
      const backoff = compositeBackoff([
        { maxAttempts: 2, backoff: fixedBackoff({ base: 100 }) },
        { maxAttempts: Infinity, backoff: exponentialBackoff({ base: 200 }) },
      ]);

      expect(backoff(1)).toBe(100); // Fixed strategy
      expect(backoff(2)).toBe(100); // Fixed strategy
      expect(backoff(3)).toBe(800); // Exponential strategy (200 * 2^(3-1) = 200 * 2^2)
      expect(backoff(4)).toBe(1600); // Exponential strategy (200 * 2^(4-1) = 200 * 2^3)
    });

    it('should fallback to last strategy', () => {
      const backoff = compositeBackoff([
        { maxAttempts: 1, backoff: fixedBackoff({ base: 100 }) },
        { maxAttempts: 2, backoff: linearBackoff({ base: 200 }) },
      ]);

      expect(backoff(1)).toBe(100); // First strategy
      expect(backoff(2)).toBe(400); // Second strategy (200 * 2)
      expect(backoff(5)).toBe(1000); // Fallback to second (200 * 5)
    });
  });

  describe('jitteredExponentialBackoff', () => {
    it('should be exponential with 10% jitter', () => {
      const backoff = jitteredExponentialBackoff({ base: 100 });

      const delay = backoff(2); // Should be ~200ms with jitter
      expect(delay).toBeGreaterThan(180);
      expect(delay).toBeLessThan(220);
    });
  });

  describe('presets', () => {
    it('should provide fast preset', () => {
      const backoff = presets.fast();

      expect(backoff(1)).toBe(500);
      expect(backoff(2)).toBe(1000);
      expect(backoff(3)).toBe(2000);
      expect(backoff(4)).toBe(4000); // Capped at max
    });

    it('should provide standard preset', () => {
      const backoff = presets.standard();

      expect(backoff(1)).toBe(1000);
      expect(backoff(2)).toBe(2000);
      expect(backoff(3)).toBe(4000);
      expect(backoff(4)).toBe(8000);
      expect(backoff(5)).toBe(16_000); // Capped at max
    });

    it('should provide slow preset', () => {
      const backoff = presets.slow();

      expect(backoff(1)).toBe(2000);
      expect(backoff(2)).toBe(4000);
      expect(backoff(3)).toBe(8000);
    });

    it('should provide network resilient preset with jitter', () => {
      const backoff = presets.networkResilient();

      const delay1 = backoff(1);
      const delay2 = backoff(1);

      // Should be around 1000ms but with jitter variation
      expect(delay1).toBeGreaterThan(900);
      expect(delay1).toBeLessThan(1100);

      // Should have variation due to jitter
      expect(delay1).not.toBe(delay2);
    });

    it('should provide aggressive preset', () => {
      const backoff = presets.aggressive();

      expect(backoff(1)).toBe(200);
      expect(backoff(2)).toBe(400);
      expect(backoff(3)).toBe(800);
      expect(backoff(4)).toBe(1600);
      expect(backoff(5)).toBe(2000); // Capped at max
    });
  });

  describe('default options', () => {
    it('should work with no options provided', () => {
      const exp = exponentialBackoff();
      const lin = linearBackoff();
      const fix = fixedBackoff();

      expect(exp(1)).toBe(1000); // Default base
      expect(lin(1)).toBe(1000); // Default base
      expect(fix(1)).toBe(1000); // Default base
    });
  });
});
