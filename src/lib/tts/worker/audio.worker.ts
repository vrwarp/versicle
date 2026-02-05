import { WorkerAudioPlayerService } from './WorkerAudioPlayerService';
import type { MainToWorkerMessage } from './messages';

let service: WorkerAudioPlayerService | null = null;

self.addEventListener('message', (event) => {
    const msg = event.data as MainToWorkerMessage;

    if (msg.type === 'INIT') {
        if (!service) {
            service = WorkerAudioPlayerService.getInstance(msg.isNative);
            service.init();
        }
        return;
    }

    if (!service) {
        // Some messages might be for other listeners (like WorkerAudioPlayer)
        // so we shouldn't strictly warn unless we are sure.
        // But WorkerAudioPlayer listens to 'message' independently.
        // So this listener handles Service Logic.
        return;
    }

    switch (msg.type) {
        case 'PLAY':
            service.play();
            break;
        case 'PAUSE':
            service.pause();
            break;
        case 'STOP':
            service.stop();
            break;
        case 'NEXT':
            service.next();
            break;
        case 'PREV':
            service.prev();
            break;
        case 'SEEK':
            service.seek(msg.offset);
            break;
        case 'SEEK_TO':
            service.seekTo(msg.time);
            break;
        case 'SET_BOOK':
            service.setBookId(msg.bookId);
            break;
        case 'LOAD_SECTION':
            service.loadSection(msg.index, msg.autoPlay, msg.title);
            break;
        case 'LOAD_SECTION_BY_ID':
            service.loadSectionBySectionId(msg.sectionId, msg.autoPlay, msg.title);
            break;
        case 'SET_QUEUE':
            service.setQueue(msg.items, msg.startIndex);
            break;
        case 'JUMP_TO':
            service.jumpTo(msg.index);
            break;
        case 'SET_SPEED':
            service.setSpeed(msg.speed);
            break;
        case 'SET_VOICE':
            service.setVoice(msg.voiceId);
            break;
        case 'SET_PROVIDER':
            service.setProvider(msg.providerId, msg.config);
            break;
        case 'SET_PREROLL':
            service.setPrerollEnabled(msg.enabled);
            break;
        case 'SET_BG_AUDIO':
            service.setBackgroundAudioMode(msg.mode);
            break;
        case 'SET_BG_VOLUME':
            service.setBackgroundVolume(msg.volume);
            break;
        case 'PREVIEW':
            service.preview(msg.text);
            break;
        case 'DOWNLOAD_VOICE':
            service.downloadVoice(msg.voiceId);
            break;
        case 'DELETE_VOICE':
            service.deleteVoice(msg.voiceId);
            break;
        case 'CHECK_VOICE':
            service.isVoiceDownloaded(msg.voiceId, msg.reqId);
            break;
        case 'GET_ALL_VOICES':
            service.getVoices(msg.reqId);
            break;
    }
});
