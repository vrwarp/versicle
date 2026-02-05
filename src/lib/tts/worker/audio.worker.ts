import * as Comlink from 'comlink';
import { WorkerAudioPlayerService } from './WorkerAudioPlayerService';

const service = new WorkerAudioPlayerService();
Comlink.expose(service);
