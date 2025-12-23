/**
 * Error thrown when a task is cancelled.
 */
export class CancellationError extends Error {
  constructor(message = 'Task cancelled') {
    super(message);
    this.name = 'CancellationError';
  }
}

/**
 * Runs a generator function that yields Promises, allowing for the execution flow to be cancelled.
 *
 * ## Why use this pattern?
 * Standard async/await functions in JavaScript cannot be easily cancelled from the outside.
 * Once an async function starts awaiting a promise, it will continue to execute the subsequent lines
 * when the promise resolves, even if the result is no longer needed (e.g., a React component unmounted,
 * or a new request superseded the old one).
 *
 * Common workarounds involve manually checking an `isCancelled` boolean after every `await`:
 *
 * ```ts
 * const load = async () => {
 *   const data = await fetchData();
 *   if (isCancelled) return; // Manual check
 *   const processed = await processData(data);
 *   if (isCancelled) return; // Manual check
 *   setState(processed);
 * }
 * ```
 *
 * This pattern is error-prone and verbose. The `runCancellable` utility automates this check.
 * By using a generator, the runner controls the resumption of execution. If the task is cancelled,
 * the runner throws a `CancellationError` into the generator, ensuring `finally` blocks are executed
 * for cleanup.
 *
 * ## Usage Example
 *
 * ```ts
 * import { runCancellable, CancellationError } from './cancellable-task-runner';
 *
 * useEffect(() => {
 *   // Define your logic as a generator
 *   const loadData = function* (id: string) {
 *      setIsLoading(true);
 *      try {
 *        // Use `yield` instead of `await`
 *        const data = yield api.fetchItem(id);
 *        // If cancelled while fetching, this line is never reached (CancellationError is thrown).
 *        setResult(data);
 *      } catch (err) {
 *        if (err instanceof CancellationError) {
 *          // Handle cancellation specifically if needed
 *        } else {
 *          // Handle other errors
 *          setError(err);
 *        }
 *      } finally {
 *        // Finally blocks run even on cancellation
 *        setIsLoading(false);
 *      }
 *   };
 *
 *   // Start the task
 *   const { cancel } = runCancellable(loadData(currentId), () => {
 *      console.log('Task was cancelled!');
 *   });
 *
 *   // Cleanup on unmount or dependency change
 *   return () => cancel();
 * }, [currentId]);
 * ```
 *
 * @param generator - The generator object (created by calling a generator function) that yields Promises.
 * @param onCancel - Optional callback invoked if the task is cancelled.
 * @returns An object containing `result` (Promise resolving to the generator's return value) and `cancel` (function to stop execution).
 */
export function runCancellable<TReturn = void>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generator: Generator<Promise<any> | any, TReturn, any>,
  onCancel?: () => void
) {
  let cancelled = false;

  const resultPromise = new Promise<TReturn>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iterate = async (arg?: any) => {
      if (cancelled) return;

      try {
        const result = generator.next(arg);
        if (result.done) {
          resolve(result.value);
          return;
        }

        // Check if cancelled immediately after next (in case sync logic inside next caused cancellation)
        if (cancelled) return;

        // Wait for the yielded promise
        const value = await result.value;
        if (!cancelled) {
          iterate(value);
        }
      } catch (err) {
        if (!cancelled) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            const thrownResult = generator.throw?.(err);
            if (thrownResult && thrownResult.done) {
                resolve(thrownResult.value);
            } else {
                // If threw and not done, it means it caught the error and yielded again.
                // Continue iteration with the value yielded from catch block.
                // Note: standard generator behavior if catch block yields is `value` is the yielded thing.
                if (thrownResult) {
                    iterate(thrownResult.value);
                }
            }
          } catch (e) {
            // If the generator doesn't handle the error, it might be re-thrown here.
            // We catch it to prevent unhandled promise rejections in the runner.
            // And reject the result promise.
            reject(e);
          }
        }
      }
    };

    void iterate();
  });

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;

    try {
        // Throw CancellationError into the generator to trigger finally blocks
        if (generator.throw) {
            const result = generator.throw(new CancellationError());
            if (!result.done) {
                console.warn(
                    'Generator did not complete after cancellation. ' +
                    'Ensure you are not catching CancellationError and continuing execution, ' +
                    'or yielding more promises in the finally block.',
                    new Error().stack
                );
            }
        }
    } catch (err) {
        // If the generator throws an error (other than completing), log it if it's not the CancellationError itself re-thrown
        if (!(err instanceof CancellationError)) {
             console.error('Error during generator cancellation:', err);
        }
    }

    onCancel?.();
  };

  return { result: resultPromise, cancel };
}
