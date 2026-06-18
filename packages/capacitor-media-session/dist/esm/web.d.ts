import { WebPlugin } from '@capacitor/core';
import type { MetadataOptions, PlaybackStateOptions, ActionHandlerOptions, PositionStateOptions, MediaSessionPlugin, ActionHandler } from './definitions';
import type { PluginListenerHandle } from '@capacitor/core';
export declare class MediaSessionWeb extends WebPlugin implements MediaSessionPlugin {
    setMetadata(options: MetadataOptions): Promise<void>;
    setPlaybackState(options: PlaybackStateOptions): Promise<void>;
    setActionHandler(options: ActionHandlerOptions): Promise<void>;
    setPositionState(options: PositionStateOptions): Promise<void>;
    addListener(eventName: 'onMediaAction', listenerFunc: ActionHandler): Promise<PluginListenerHandle>;
}
