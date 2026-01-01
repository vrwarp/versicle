import { describe, it, expect, vi } from 'vitest';
import { TaskSequencer } from './TaskSequencer';

describe('TaskSequencer', () => {
    it('should execute tasks sequentially', async () => {
        const sequencer = new TaskSequencer();
        const executionOrder: number[] = [];

        const task1 = () => new Promise<void>(resolve => setTimeout(() => {
            executionOrder.push(1);
            resolve();
        }, 50));

        const task2 = () => new Promise<void>(resolve => setTimeout(() => {
            executionOrder.push(2);
            resolve();
        }, 10));

        sequencer.enqueue(task1);
        await sequencer.enqueue(task2);

        expect(executionOrder).toEqual([1, 2]);
    });

    it('should handle errors gracefully and continue execution', async () => {
        const sequencer = new TaskSequencer();
        const executionOrder: number[] = [];
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const failingTask = () => new Promise<void>((_, reject) => setTimeout(() => {
            reject(new Error('Task failed'));
        }, 20));

        const task2 = () => new Promise<void>(resolve => setTimeout(() => {
            executionOrder.push(2);
            resolve();
        }, 10));

        // We do not await failingTask immediately because we want to see if task2 runs after it fails
        const p1 = sequencer.enqueue(failingTask);
        const p2 = sequencer.enqueue(task2);

        await p1; // Should resolve (as undefined) even if inner task rejected
        await p2;

        expect(consoleSpy).toHaveBeenCalled();
        expect(executionOrder).toEqual([2]);
    });

    it('should stop executing tasks after destroy is called', async () => {
        const sequencer = new TaskSequencer();
        const executionOrder: number[] = [];

        const task1 = () => new Promise<void>(resolve => setTimeout(() => {
            executionOrder.push(1);
            resolve();
        }, 10));

        const task2 = () => new Promise<void>(resolve => {
            executionOrder.push(2);
            resolve();
        });

        await sequencer.enqueue(task1);
        sequencer.destroy();
        await sequencer.enqueue(task2);

        expect(executionOrder).toEqual([1]);
    });
});
