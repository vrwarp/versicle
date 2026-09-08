import * as Comlink from 'comlink';
import { installAppErrorTransferHandler } from '@lib/comlinkAppError';
import { SearchEngine } from '@lib/search-engine';

installAppErrorTransferHandler();
const engine = new SearchEngine();
Comlink.expose(engine);
