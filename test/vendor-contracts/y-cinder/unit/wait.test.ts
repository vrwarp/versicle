import { describe, it, expect } from 'vitest';
import { waitForConditionEquals, waitForConditionLessThan, waitForConditionTruthy } from '../utils/wait';

describe('Wait Utilities', () => {
    it('should resolve when condition is met', async () => {
        let val = 0;
        setTimeout(() => { val = 5; }, 50);

        const result = await waitForConditionEquals(
            () => val,
            5,
            { timeout: 200 }
        );

        expect(result).toBe(5);
    });

    it('should throw with last value on timeout', async () => {
        const val = 'wrong-value';
        // String values are not quoted in the output unless they are objects
        await expect(
            waitForConditionEquals(
                () => val,
                'expected-value',
                { timeout: 100, interval: 10 }
            )
        ).rejects.toThrow(/Last value: wrong-value/);
    });

    describe('regression: last error reporting', () => {
        it('reports the message of an Error thrown by the getter', async () => {
            await expect(
                waitForConditionTruthy(
                    () => { throw new Error('getter exploded'); },
                    { timeout: 50, interval: 10 }
                )
            ).rejects.toThrow(/Last error: getter exploded/);
        });

        it('reports a non-Error throw instead of printing "undefined"', async () => {
            await expect(
                waitForConditionTruthy(
                    () => { throw 'plain string failure'; },
                    { timeout: 50, interval: 10 }
                )
            ).rejects.toThrow(/Last error: plain string failure/);
        });
    });

    it('should throw with truncated value for large objects', async () => {
        const largeStr = 'a'.repeat(300);

        await expect(
            waitForConditionEquals(
                () => largeStr,
                'something else',
                { timeout: 50, message: 'Should be something else' }
            )
        ).rejects.toThrow(/\.\.\.$/); // Should end with ...
    });

    it('should support numeric assertions', async () => {
        let val = 10;
        setTimeout(() => { val = 4; }, 50);

        const result = await waitForConditionLessThan(
            () => val,
            5,
            { timeout: 200 }
        );
        expect(result).toBe(4);
    });
});
