import { describe, expect, it, vi } from 'vitest';
import { createRunController } from '../src/lib/run/controller';

/**
 * The contract behind every Cancel button: exactly one job at a time, an abort
 * reaches the engine through the signal it was handed, and finishing does not
 * fire an abort on its own.
 */
describe('run controller', () => {
  it('hands out a live signal and aborts it on cancel', () => {
    const runs = createRunController();
    const signal = runs.begin();
    const onAbort = vi.fn();
    signal.addEventListener('abort', onAbort);

    expect(signal.aborted).toBe(false);
    expect(runs.isActive()).toBe(true);

    runs.cancel();

    expect(signal.aborted).toBe(true);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(runs.isActive()).toBe(false);
  });

  it('cancelling twice is harmless', () => {
    const runs = createRunController();
    const signal = runs.begin();
    runs.cancel();
    runs.cancel();
    expect(signal.aborted).toBe(true);
  });

  it('starting a second run aborts the first, so one job is ever reachable', () => {
    const runs = createRunController();
    const first = runs.begin();
    const second = runs.begin();

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(runs.isActive()).toBe(true);
  });

  it('finishing clears the run without aborting its signal', () => {
    const runs = createRunController();
    const signal = runs.begin();

    runs.finish();

    // The job completed; nothing should reject it after the fact.
    expect(signal.aborted).toBe(false);
    expect(runs.isActive()).toBe(false);
  });

  it('cancel after finish does not reach a completed run', () => {
    const runs = createRunController();
    const signal = runs.begin();
    const onAbort = vi.fn();
    signal.addEventListener('abort', onAbort);

    runs.finish();
    runs.cancel();

    expect(onAbort).not.toHaveBeenCalled();
  });
});
