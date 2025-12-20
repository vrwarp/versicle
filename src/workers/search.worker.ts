import * as Comlink from 'comlink';
import { SearchEngine } from '../lib/search-engine';

const engine = new SearchEngine();
Comlink.expose(engine);
