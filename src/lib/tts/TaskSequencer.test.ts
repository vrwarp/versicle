import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskSequencer } from './TaskSequencer';

describe('TaskSequencer', () => {
  let sequencer: TaskSequencer;

  beforeEach(() => {
    sequencer = new TaskSequencer();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should execute tasks sequentially', async () => {
    const executionOrder: number[] = [];

    // We cannot use strict setTimeout inside the promise if we want to control it with fake timers easily
    // AND await the enqueue result, because enqueue awaits the task.
    // However, since enqueue returns a promise that resolves when the task is done,
    // we need to be careful.

    // Let's use a resolved promise with a delay using vi.advanceTimersByTime inside the task?
    // No, `enqueue` chains them on `pendingPromise`.

    // To verify sequentiality, we can use a flag.

    let task1Finished = false;

    const task1 = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        executionOrder.push(1);
        task1Finished = true;
    };

    const task2 = async () => {
        // If sequential, task1 must be finished
        if (task1Finished) {
            executionOrder.push(2);
        } else {
            executionOrder.push(999); // Error
        }
    };

    const p1 = sequencer.enqueue(task1);
    const p2 = sequencer.enqueue(task2);

    // Now we advance time to finish task1
    await vi.advanceTimersByTimeAsync(150);

    await Promise.all([p1, p2]);

    expect(executionOrder).toEqual([1, 2]);
  });

  it('should continue execution even if a task fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const executionOrder: number[] = [];

      const task1 = () => Promise.reject(new Error('Fail'));
      const task2 = async () => { executionOrder.push(2); };

      const p1 = sequencer.enqueue(task1);
      const p2 = sequencer.enqueue(task2);

      await Promise.all([p1, p2]);

      expect(executionOrder).toEqual([2]);
      expect(consoleSpy).toHaveBeenCalledWith("Audio task failed safely:", expect.any(Error));
  });

  it('should not execute tasks after destroy is called', async () => {
    const task1 = vi.fn().mockResolvedValue('ok');

    sequencer.destroy();
    await sequencer.enqueue(task1);

    expect(task1).not.toHaveBeenCalled();
  });
});
