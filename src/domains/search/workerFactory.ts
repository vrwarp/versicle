/**
 * Production SearchEngineFactory: the Comlink-wrapped search worker
 * (`src/workers/search.worker.ts`, the 5-line keeper). Tests inject an
 * in-process factory instead — see SearchSession.test.ts.
 */
import * as Comlink from 'comlink';
import type { SearchEngine } from '@lib/search-engine';
import type { SearchEngineHandle } from './SearchSession';

export function createWorkerSearchEngineFactory(): () => SearchEngineHandle {
  return () => {
    const worker = new Worker(new URL('../../workers/search.worker.ts', import.meta.url), {
      type: 'module',
    });
    const remote = Comlink.wrap<SearchEngine>(worker);
    const listeners = new Set<(error: unknown) => void>();

    worker.onerror = (event) => {
      console.error('Worker script load/execution error:', event.error ?? event);
      for (const listener of listeners) listener(event.error ?? event);
    };

    return {
      // The Comlink remote returns promises for every member — structurally
      // a SearchEngineProtocol.
      engine: remote,
      dispose() {
        worker.terminate();
      },
      onError(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  };
}
