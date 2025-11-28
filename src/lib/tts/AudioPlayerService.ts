import type { ITTSProvider, TTSVoice, QueueItem } from './providers/types';
import { WebSpeechProvider } from './providers/WebSpeechProvider';
import { TTSCache } from './TTSCache';
import { SyncEngine, type AlignmentData } from './SyncEngine';

export type TTSStatus = 'playing' | 'paused' | 'stopped' | 'loading' | 'error';

type TTSListener = (status: TTSStatus, activeCfi: string | null) => void;

/**
 * Singleton service to manage TTS playback.
 * Handles queuing, provider switching, and HTML5 audio / WebSpeech coordination.
 */
export class AudioPlayerService {
  private static instance: AudioPlayerService;
  private provider: ITTSProvider;
  // @ts-expect-error cache unused for now
  private cache: TTSCache;
  private syncEngine: SyncEngine;

  private queue: QueueItem[] = [];
  private currentIndex: number = 0;

  private audioElement: HTMLAudioElement;
  private status: TTSStatus = 'stopped';
  private listeners: Set<TTSListener> = new Set();

  private currentVoiceId: string = '';
  private speed: number = 1.0;
  private currentSegmentUrl: string | null = null;

  // WebSpeech State
  private isWebSpeech: boolean = true;

  private constructor() {
    this.provider = new WebSpeechProvider(); // Default
    this.cache = new TTSCache();
    this.syncEngine = new SyncEngine();

    this.audioElement = new Audio();
    this.setupAudioListeners();
  }

  public static getInstance(): AudioPlayerService {
    if (!AudioPlayerService.instance) {
      AudioPlayerService.instance = new AudioPlayerService();
    }
    return AudioPlayerService.instance;
  }

  public setProvider(provider: ITTSProvider) {
      this.provider = provider;
      this.isWebSpeech = (provider instanceof WebSpeechProvider);

      // If we switch providers while playing, we should probably stop.
      if (this.status === 'playing' || this.status === 'paused') {
          this.stop();
      }
  }

  public async init() {
      await this.provider.init();
  }

  public async getVoices(): Promise<TTSVoice[]> {
      return this.provider.getVoices();
  }

  public setVoice(voiceId: string) {
      this.currentVoiceId = voiceId;
  }

  public setSpeed(speed: number) {
      this.speed = speed;
      this.audioElement.playbackRate = speed;
  }

  public subscribe(listener: TTSListener) {
      this.listeners.add(listener);
      return () => { this.listeners.delete(listener); };
  }

  private notify() {
      const currentCfi = (this.queue[this.currentIndex] && (this.status === 'playing' || this.status === 'loading' || this.status === 'paused'))
        ? this.queue[this.currentIndex].cfi
        : null;

      this.listeners.forEach(l => l(this.status, currentCfi));
  }

  /**
   * Setup media session for lock screen controls
   */
  private updateMediaSession() {
      if ('mediaSession' in navigator && this.queue[this.currentIndex]) {
          const item = this.queue[this.currentIndex];
          navigator.mediaSession.metadata = new MediaMetadata({
              title: item.title || 'Reading',
              artist: item.author || 'Versicle',
              album: item.bookTitle || 'Book',
              artwork: item.coverUrl ? [{ src: item.coverUrl, sizes: '512x512', type: 'image/png' }] : []
          });

          navigator.mediaSession.setActionHandler('play', () => this.play());
          navigator.mediaSession.setActionHandler('pause', () => this.pause());
          navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
          navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      }
  }

  /**
   * Load text into the queue.
   */
  public setQueue(items: QueueItem[]) {
      this.stop();
      this.queue = items;
      this.currentIndex = 0;
  }

  /**
   * Set current index in queue (e.g. from UI click)
   */
  public setQueueIndex(index: number) {
      if (index >= 0 && index < this.queue.length) {
          this.currentIndex = index;
          if (this.status === 'playing') {
              this.playCurrentSegment();
          } else {
              this.notify(); // Update active CFI
          }
      }
  }

  public async play() {
      if (this.queue.length === 0) return;

      if (this.status === 'paused') {
          // Resume
          if (this.isWebSpeech) {
               window.speechSynthesis.resume();
          } else {
              this.audioElement.play();
          }
          this.status = 'playing';
          this.notify();
          return;
      }

      this.status = 'playing';
      this.notify();
      this.playCurrentSegment();
  }

  public pause() {
      if (this.isWebSpeech) {
          window.speechSynthesis.pause();
      } else {
          this.audioElement.pause();
      }
      this.status = 'paused';
      this.notify();
  }

  public stop() {
      if (this.isWebSpeech) {
          window.speechSynthesis.cancel();
      } else {
          this.audioElement.pause();
          this.audioElement.currentTime = 0;
      }
      this.status = 'stopped';
      this.currentIndex = 0;
      this.notify();
  }

  public next() {
      if (this.currentIndex < this.queue.length - 1) {
          this.currentIndex++;
          this.playCurrentSegment();
      } else {
          this.stop(); // End of queue
      }
  }

  public prev() {
      if (this.currentIndex > 0) {
          this.currentIndex--;
          this.playCurrentSegment();
      }
  }

  private async playCurrentSegment() {
      if (this.currentIndex >= this.queue.length) {
          this.stop();
          return;
      }

      const item = this.queue[this.currentIndex];
      this.updateMediaSession();
      this.status = 'loading';
      this.notify();

      try {
          // Check Cache
          // TODO: Implement cache lookup here
          // For now, direct synthesize

          const segment = await this.provider.synthesize(item.text, this.currentVoiceId, this.speed);

          if (segment.isNative) {
             // WebSpeech provider logic
          } else if (segment.audio) {
              // Cloud Audio
              if (this.currentSegmentUrl) {
                  URL.revokeObjectURL(this.currentSegmentUrl);
              }
              this.currentSegmentUrl = URL.createObjectURL(segment.audio);
              this.audioElement.src = this.currentSegmentUrl;
              this.audioElement.playbackRate = this.speed;

              // Setup Sync
              if (segment.alignment) {
                  // Map Timepoint to AlignmentData
                  // Timepoint: { timeSeconds, charIndex, type }
                  // AlignmentData: { time, type, textOffset, value }
                  const alignment: AlignmentData[] = segment.alignment.map(tp => ({
                      time: tp.timeSeconds,
                      type: (tp.type as 'word' | 'sentence') || 'word',
                      textOffset: tp.charIndex
                  }));
                  this.syncEngine.setAlignment(alignment);
              } else {
                  this.syncEngine.setAlignment([]); // Fallback
              }

              await this.audioElement.play();
              this.status = 'playing';
              this.notify();
          }

      } catch (err) {
          console.error("Playback error", err);
          this.status = 'error';
          this.notify();
      }
  }

  private setupAudioListeners() {
      this.audioElement.onended = () => {
          this.next();
      };

      this.audioElement.onpause = () => {
          if (this.status !== 'stopped' && this.status !== 'loading') {
              this.status = 'paused';
              this.notify();
          }
      };

      this.audioElement.onplay = () => {
          this.status = 'playing';
          this.notify();
      };

      this.audioElement.ontimeupdate = () => {
         // Sync logic
      };
  }
}
