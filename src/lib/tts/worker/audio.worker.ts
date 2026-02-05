import { WorkerAudioPlayerService } from './WorkerAudioPlayerService';
import type { MainToWorkerMessage } from './messages';

// The worker instance
let service: WorkerAudioPlayerService;

self.onmessage = async (e: MessageEvent<MainToWorkerMessage>) => {
    const msg = e.data;

    if (msg.type === 'INIT') {
        service = WorkerAudioPlayerService.getInstance(msg.isNative);
        // We might want to set initial provider here if passed
        if (msg.provider) {
             await service.setProvider(msg.provider, msg.config);
        }
        await service.init();
        return;
    }

    if (!service) {
        console.error("WorkerAudioPlayerService not initialized");
        return;
    }

    switch (msg.type) {
        case 'SET_BOOK':
            service.setBookId(msg.bookId);
            break;
        case 'SET_PROVIDER':
            await service.setProvider(msg.providerId, msg.config);
            break;
        case 'PLAY':
            await service.play();
            break;
        case 'PAUSE':
            await service.pause();
            break;
        case 'STOP':
            await service.stop();
            break;
        case 'NEXT':
            await service.next();
            break;
        case 'PREV':
            await service.prev();
            break;
        case 'JUMP_TO':
            await service.jumpTo(msg.index);
            break;
        case 'SEEK_TO':
            await service.seekTo(msg.time);
            break;
        case 'SEEK':
            await service.seek(msg.offset);
            break;
        case 'SET_SPEED':
            await service.setSpeed(msg.speed);
            break;
        case 'SET_VOICE':
            await service.setVoice(msg.voiceId);
            break;
        case 'PREVIEW':
            await service.preview(msg.text);
            break;
        case 'LOAD_SECTION':
            // Ensure we pass both arguments, defaulting autoPlay to true if not specified
            await service.loadSection(msg.index, msg.autoPlay ?? true);
            break;
        case 'LOAD_SECTION_BY_ID':
             await service.loadSectionBySectionId(msg.sectionId, msg.autoPlay ?? true, msg.title);
             break;
        case 'SET_QUEUE':
            await service.setQueue(msg.items, msg.startIndex);
            break;
        case 'SKIP_NEXT_SECTION':
            await service.skipToNextSection();
            break;
        case 'SKIP_PREV_SECTION':
            await service.skipToPreviousSection();
            break;
        case 'GET_ALL_VOICES':
            await service.getVoices(msg.reqId);
            break;
        case 'CHECK_VOICE':
            await service.isVoiceDownloaded(msg.voiceId, msg.reqId);
            break;
        case 'DOWNLOAD_VOICE':
            await service.downloadVoice(msg.voiceId);
            break;
        case 'DELETE_VOICE':
            await service.deleteVoice(msg.voiceId);
            break;
        case 'SET_PREROLL':
            service.setPrerollEnabled(msg.enabled);
            break;
        case 'SET_BG_MODE':
            service.setBackgroundAudioMode(msg.mode);
            break;
        case 'SET_BG_VOLUME':
            service.setBackgroundVolume(msg.volume);
            break;
    }
};
