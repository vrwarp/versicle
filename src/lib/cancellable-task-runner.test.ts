import { describe, it, expect, vi, afterEach } from 'vitest';
import { runCancellable, CancellationError } from './cancellable-task-runner';

describe('runCancellable', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should run a generator to completion', async () => {
        const resultItems: string[] = [];
        const generatorFn = function* () {
            resultItems.push('start');
            yield Promise.resolve('step1');
            resultItems.push('middle');
            yield Promise.resolve('step2');
            resultItems.push('end');
            return 'finished';
        };

        const { result } = runCancellable(generatorFn());

        const value = await result;

        expect(resultItems).toEqual(['start', 'middle', 'end']);
        expect(value).toBe('finished');
    });

    it('should resolve yielded promises', async () => {
        let capturedValue: string | undefined;
        const generatorFn = function* () {
            capturedValue = yield Promise.resolve('resolved-value');
        };

        const { result } = runCancellable(generatorFn());
        await result;

        expect(capturedValue).toBe('resolved-value');
    });

    it('should handle yielded non-promises (sync values)', async () => {
        let capturedValue: string | undefined;
        const generatorFn = function* () {
            // yield a string directly
            capturedValue = yield 'sync-value';
        };

        const { result } = runCancellable(generatorFn());
        await result;

        expect(capturedValue).toBe('sync-value');
    });

    it('should stop execution when cancelled', async () => {
        const resultItems: string[] = [];
        const generatorFn = function* () {
            resultItems.push('start');
            yield new Promise((resolve) => setTimeout(resolve, 20));
            resultItems.push('should-not-be-reached');
        };

        const { cancel } = runCancellable(generatorFn());

        // Wait a bit, but less than the promise delay
        await new Promise((resolve) => setTimeout(resolve, 5));

        // Cancel the task
        cancel();

        // Wait longer than the promise delay
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect(resultItems).toEqual(['start']);
    });

    it('should throw CancellationError into generator on cancellation', async () => {
        let errorCaught: unknown;
        const generatorFn = function* () {
            try {
                yield new Promise((resolve) => setTimeout(resolve, 20));
            } catch (err) {
                errorCaught = err;
            }
        };

        const { cancel } = runCancellable(generatorFn());
        await new Promise((resolve) => setTimeout(resolve, 5));
        cancel();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(errorCaught).toBeInstanceOf(CancellationError);
    });

    it('should execute finally block on cancellation', async () => {
        let finallyExecuted = false;
        const generatorFn = function* () {
            try {
                yield new Promise((resolve) => setTimeout(resolve, 20));
            } finally {
                finallyExecuted = true;
            }
        };

        const { cancel } = runCancellable(generatorFn());
        await new Promise((resolve) => setTimeout(resolve, 5));
        cancel();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(finallyExecuted).toBe(true);
    });

    it('should call onCancel callback when cancelled', async () => {
        const onCancel = vi.fn();
        const generatorFn = function* () {
            yield new Promise((resolve) => setTimeout(resolve, 20));
        };

        const { cancel } = runCancellable(generatorFn(), onCancel);
        cancel();

        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('should log warning if generator ignores cancellation and continues', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const generatorFn = function* () {
            try {
                yield new Promise((resolve) => setTimeout(resolve, 20));
            } catch (err) {
                // Ignore error and continue yielding
            }
            yield Promise.resolve('ignoring cancellation');
        };

        const { cancel } = runCancellable(generatorFn());
        await new Promise((resolve) => setTimeout(resolve, 5));
        cancel();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Generator did not complete after cancellation'),
            expect.any(String)
        );
    });

    it('should handle errors thrown by generator by rejecting the result promise', async () => {
        const generatorFn = function* () {
             throw new Error('Test error');
        };

        const { result } = runCancellable(generatorFn());

        await expect(result).rejects.toThrow('Test error');
    });
});
