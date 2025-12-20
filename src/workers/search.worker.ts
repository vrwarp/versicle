import { expose } from 'comlink';
import { SearchEngine } from '../lib/search-engine';

const engine = new SearchEngine();

expose(engine);
