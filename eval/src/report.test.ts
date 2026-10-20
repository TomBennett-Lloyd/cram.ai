import { describe, expect, it } from 'vitest';
import { MachineClass } from './report';

describe('MachineClass', () => {
  it('admits each listed class', () => {
    for (const machine of MachineClass.options) expect(MachineClass.parse(machine)).toBe(machine);
  });

  it('refuses a class outside the closed set, so a label cannot drift and split a baseline', () => {
    expect(MachineClass.safeParse('dev-mac').success).toBe(false);
  });
});
