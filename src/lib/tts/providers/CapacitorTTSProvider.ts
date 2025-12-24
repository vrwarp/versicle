import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { Capacitor } from '@capacitor/core';
import type { ITTSProvider, TTSOptions, TTSEvent, TTSVoice } from './types';

export class CapacitorTTSProvider implements ITTSProvider {
  id = 'local';
  private voiceMap = new Map<string, TTSVoice>();
  private eventListeners: ((event: TTSEvent) => void)[] = [];
  private activeUtteranceId = 0;

  private lastText: string | null = null;
  private lastOptions: TTSOptions | null = null;

  private stopTimeout: ReturnType<typeof setTimeout> | null = null;
  private isForegroundServiceActive = false;
  private lastMetadataTitle: string | null = null;

  async init(): Promise<void> {
    await this.getVoices();
    try {
        await TextToSpeech.addListener('onRangeStart', (info) => {
             this.emit({ type: 'boundary', charIndex: info.start });
        });
    } catch (e) {
        console.warn('Failed to add listener for TTS', e);
    }
  }

  async getVoices(): Promise<TTSVoice[]> {
    try {
      const { voices } = await TextToSpeech.getSupportedVoices();
      const mappedVoices: TTSVoice[] = (voices || []).map(v => ({
        id: v.voiceURI,
        name: v.name,
        lang: v.lang,
        provider: 'local'
      }));

      this.voiceMap.clear();
      mappedVoices.forEach(v => this.voiceMap.set(v.id, v));

      return mappedVoices;
    } catch (e) {
      console.warn('Failed to load native voices', e);
      return [];
    }
  }

  async play(text: string, options: TTSOptions): Promise<void> {
    // Cancel any pending stop timeout
    if (this.stopTimeout) {
        clearTimeout(this.stopTimeout);
        this.stopTimeout = null;
    }

    this.lastText = text;
    this.lastOptions = options;

    await this.engageForegroundService(options);

    const myId = ++this.activeUtteranceId;

    let lang = 'en-US';
    const voice = this.voiceMap.get(options.voiceId);
    if (voice) {
      lang = voice.lang;
    }

    // Call speak but don't await completion for the promise return.
    // However, we want to know if it STARTED.
    // The plugin doesn't give a "started" promise.
    // We'll emit start immediately.
    this.emit({ type: 'start' });

    TextToSpeech.speak({
        text,
        lang,
        rate: options.speed,
        category: 'playback',
        queueStrategy: 0 // Flush
    }).then(() => {
        if (this.activeUtteranceId === myId) {
            this.emit({ type: 'end' });
        }
    }).catch((e) => {
        if (this.activeUtteranceId === myId) {
            this.emit({ type: 'error', error: e });
        }
    });
  }

  private async engageForegroundService(options: TTSOptions) {
      if (Capacitor.getPlatform() !== 'android') return;

      const title = options.metadata?.title || 'Chapter';

      // If service is active and title hasn't changed, do nothing
      if (this.isForegroundServiceActive && this.lastMetadataTitle === title) {
          return;
      }

      try {
          // Create channel only if not active (or maybe just once? createNotificationChannel is idempotent usually)
          // But to be safe, we can do it if not active.
          if (!this.isForegroundServiceActive) {
              await ForegroundService.createNotificationChannel({
                  id: 'versicle_tts_channel',
                  name: 'Versicle Playback',
                  description: 'Controls for background reading',
                  importance: 3
              });
          }

          await ForegroundService.startForegroundService({
              id: 1001,
              title: 'Versicle',
              body: `Reading: ${title}`,
              smallIcon: 'ic_stat_versicle',
              notificationChannelId: 'versicle_tts_channel',
              buttons: [{ id: 101, title: 'Pause' }]
          });

          this.isForegroundServiceActive = true;
          this.lastMetadataTitle = title;
      } catch (e) {
          console.error('Background engagement failed', e);
      }
  }

  async preload(_text: string, _options: TTSOptions): Promise<void> {
      void _text;
      void _options;
      // No-op
  }

  stop(): void {
    this.activeUtteranceId++;
    TextToSpeech.stop().catch(e => console.warn('Failed to stop TTS', e));

    // Delayed stop for foreground service
    if (this.stopTimeout) clearTimeout(this.stopTimeout);

    this.stopTimeout = setTimeout(async () => {
        if (Capacitor.getPlatform() === 'android' && this.isForegroundServiceActive) {
            try {
                await ForegroundService.stopForegroundService();
                this.isForegroundServiceActive = false;
                this.lastMetadataTitle = null;
            } catch (e) {
                console.warn('Failed to stop foreground service', e);
            }
        }
        this.stopTimeout = null;
    }, 1000);
  }

  pause(): void {
    // Native pause not reliable, so we stop.
    this.stop();
  }

  async resume(): Promise<void> {
      // Native resume not reliable. We restart the current sentence.
      if (this.lastText && this.lastOptions) {
          await this.play(this.lastText, this.lastOptions);
      }
  }

  on(callback: (event: TTSEvent) => void): void {
      this.eventListeners.push(callback);
  }

  private emit(event: TTSEvent) {
      this.eventListeners.forEach(l => l(event));
  }
}
