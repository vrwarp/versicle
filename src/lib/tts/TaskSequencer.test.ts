import { describe, it, expect, beforeEach } from 'vitest';
import { TaskSequencer } from './TaskSequencer';

describe('TaskSequencer', () => {
    let sequencer: TaskSequencer;

    beforeEach(() => {
        sequencer = new TaskSequencer();
    });

    it('should execute tasks sequentially', async () => {
        const results: number[] = [];
        const task1 = () => new Promise<void>(resolve => setTimeout(() => { results.push(1); resolve(); }, 50));
        const task2 = () => new Promise<void>(resolve => setTimeout(() => { results.push(2); resolve(); }, 10));

        const p1 = sequencer.enqueue(task1);
        const p2 = sequencer.enqueue(task2);

        await Promise.all([p1, p2]);
        expect(results).toEqual([1, 2]);
    });

    it('should handle task failures safely', async () => {
        const results: number[] = [];
        const task1 = () => new Promise<void>((_, reject) => setTimeout(() => reject('error'), 10));
        const task2 = () => new Promise<void>(resolve => { results.push(2); resolve(); });

        const p1 = sequencer.enqueue(task1);
        const p2 = sequencer.enqueue(task2);

        await p1; // Should resolve undefined (caught internally)
        await p2;

        expect(results).toEqual([2]);
    });

    it('should not execute tasks after destruction', async () => {
        const results: number[] = [];
        const task1 = () => new Promise<void>(resolve => { results.push(1); resolve(); });

        sequencer.destroy();
        await sequencer.enqueue(task1);

        expect(results).toEqual([]);
    });
});
