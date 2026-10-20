import { describe, expect, it } from 'vitest';
import { LatencySummary, latencySummary, timed } from './latency';

describe('latencySummary', () => {
  it('takes the middle sample of an odd count and the largest', () => {
    expect(latencySummary([30, 10, 20], 'none')).toEqual({
      status: 'measured',
      samples: 3,
      medianMs: 20,
      maxMs: 30,
    });
  });

  it('takes the mean of the middle two of an even count', () => {
    expect(latencySummary([40, 10, 20, 30], 'none')).toMatchObject({ medianMs: 25, maxMs: 40 });
  });

  it('orders samples by value, not as strings', () => {
    expect(latencySummary([100, 9, 10], 'none')).toMatchObject({ medianMs: 10, maxMs: 100 });
  });

  it('summarises a single sample', () => {
    expect(latencySummary([5], 'none')).toMatchObject({ samples: 1, medianMs: 5, maxMs: 5 });
  });

  it('is not-measurable with no sample', () => {
    expect(latencySummary([], 'none')).toEqual({ status: 'not-measurable', reason: 'none' });
  });
});

describe('LatencySummary', () => {
  const measured = { status: 'measured', samples: 1, medianMs: 5, maxMs: 5 };

  it.each([{ samples: 0 }, { samples: 1.5 }, { medianMs: -1 }, { maxMs: -1 }])(
    'refuses a summary with %o',
    (field) => {
      expect(LatencySummary.safeParse({ ...measured, ...field }).success).toBe(false);
    },
  );
});

describe('timed', () => {
  const steppingClock = () => {
    let now = 0;
    return () => (now += 7);
  };

  it('records the duration of a call that resolves', async () => {
    const durations: number[] = [];
    await expect(
      timed(
        steppingClock(),
        (ms) => durations.push(ms),
        () => Promise.resolve('x'),
      ),
    ).resolves.toBe('x');
    expect(durations).toEqual([7]);
  });

  it('records the duration of a call that rejects, and rethrows', async () => {
    const durations: number[] = [];
    await expect(
      timed(
        steppingClock(),
        (ms) => durations.push(ms),
        () => Promise.reject(new Error('down')),
      ),
    ).rejects.toThrow('down');
    expect(durations).toEqual([7]);
  });
});
