import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskSequencer } from './TaskSequencer';

describe('TaskSequencer Predictability', () => {
    let sequencer: TaskSequencer;

    beforeEach(() => {
        sequencer = new TaskSequencer();
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns a promise that allows caller to await task completion and receive its exact return value', async () => {
        const task1 = async () => 'hello';

        // This is the bug: enqueue returns Promise<T | void>
        // Let's see if the returned promise correctly returns 'hello'
        const result = await sequencer.enqueue(task1);
        expect(result).toBe('hello');
    });

    it('returns a promise that rejects if the task throws, allowing the caller to handle the specific error', async () => {
        const task1 = async () => {
            throw new Error('Specific Error');
        };

        // If the sequencer catches the error internally and just returns void, the caller never knows it failed!
        // A predictable sequencer should allow the caller to await and catch the error.
        let caught = false;
        try {
            await sequencer.enqueue(task1);
        } catch (e: unknown) {
            caught = true;
            if (e instanceof Error) {
                expect(e.message).toBe('Specific Error');
            }
        }

        expect(caught).toBe(true);
    });
});
