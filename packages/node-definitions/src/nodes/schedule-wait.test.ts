import { describe, expect, it, vi } from 'vitest';
import { scheduleTriggerNode } from './trigger/schedule-trigger';
import { waitNode } from './logic/wait';
import { nodeRegistry } from '../registry';
import { NodeExecutionError, type NodeExecutionContext, type NodeLogger } from '../contract';

const silentLogger: NodeLogger = { debug() {}, info() {}, warn() {}, error() {} };

function ctx<C, I>(config: C, input: I, signal: AbortSignal): NodeExecutionContext<C, I> {
  return { config, input, nodeId: 'n', executionId: 'e', logger: silentLogger, signal, services: {} };
}

describe('trigger.schedule y logic.wait', () => {
  it('están registrados; el schedule es trigger', () => {
    const types = nodeRegistry.all().map((d) => d.type);
    expect(types).toContain('trigger.schedule');
    expect(types).toContain('logic.wait');
    expect(nodeRegistry.isTrigger('trigger.schedule')).toBe(true);
    expect(nodeRegistry.isTrigger('logic.wait')).toBe(false);
  });

  it('schedule expone firedAt y cron', async () => {
    const result = await scheduleTriggerNode.execute(
      ctx({ cron: '0 9 * * *', timezone: 'UTC' }, {}, new AbortController().signal),
    );
    const output = (result as { output: { firedAt: string; cron: string } }).output;
    expect(output.cron).toBe('0 9 * * *');
    expect(typeof output.firedAt).toBe('string');
  });

  it('wait pausa y pasa la entrada intacta', async () => {
    vi.useFakeTimers();
    try {
      const promise = waitNode.execute(ctx({ seconds: 3 }, { keep: 1 }, new AbortController().signal));
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;
      expect((result as { output: { keep: number } }).output.keep).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('wait se cancela si la señal está abortada', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(waitNode.execute(ctx({ seconds: 5 }, {}, controller.signal))).rejects.toBeInstanceOf(
      NodeExecutionError,
    );
  });
});
