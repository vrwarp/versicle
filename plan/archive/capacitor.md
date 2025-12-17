**Implementation Guide: Versicle Hybrid Android Architecture**
==============================================================

**1\. Executive Summary: The "Umbrella" Architecture**
------------------------------------------------------

This document serves as the comprehensive technical blueprint for transforming Versicle from a browser-based Progressive Web App (PWA) into a robust **Hybrid Android Application**. The primary objective is to achieve reliable, uninterrupted background audio playback and Text-to-Speech (TTS) synthesis on devices running **Android 14 (API Level 34)** and higher.

### **The Challenge: Android's War on Background Processes**

Modern mobile operating systems, particularly Android 14, have adopted an aggressive stance against background resource usage to preserve battery life and enhance user privacy. The days of simply keeping a JavaScript timer running are over. The Operating System (OS) employs sophisticated mechanisms like **"Doze Mode"** (which cuts off network access and CPU cycles when the phone is stationary) and **"App Standby Buckets"** (which throttle apps based on usage frequency).

For a hybrid app like Versicle, where the logic lives in a WebView (essentially a Chrome tab), this presents a critical failure mode: when the screen turns off, the WebView is paused. Audio stops, network requests for the next TTS segment fail, and the "Reader" experience is broken. Furthermore, Android 14 introduces a strict policy where Foreground Services must declare a specific *type*. If an app claims to be a media player but doesn't behave like one according to strict OS metrics, it is unceremoniously killed.

To survive this environment, we must implement a **"Compliance Triad"**:

1.  **Foreground Service (The Shield):** A high-priority system notification that tells the OS, "The user is aware this app is running; do not kill it."

2.  **Media Session (The Proof):** A native system object that proves to the OS that the app is playing legitimate audio, allowing it to bypass background restrictions.

3.  **Audio Engine (The Content):** The actual source of the audio, whether it be the native TTS engine or an HTML5 stream.

### **The Solution: The "Umbrella" Architecture**

We will implement a unified **"Umbrella" Architecture**. In this model, the **Foreground Service** is not just a utility but a protective canopy that shelters the entire application lifecycle.

-   **For Native Voices:** The umbrella keeps the main application process alive while we delegate speech synthesis to the Android OS's highly efficient, offline TTS engine.

-   **For Cloud Voices (OpenAI/Google):** This is where the architecture shines. By raising the Foreground Service "shield," we trick the OS into keeping the **WebView** fully active. This allows your existing HTML5 `AudioElementPlayer` to continue fetching high-fidelity audio segments from the network, buffering them, and playing them via the Web Audio API, completely bypassing the standard background throttling that would otherwise silence the app.

**Phase 1: Capacitor Transition (Project Setup)**
-------------------------------------------------

This phase involves wrapping your existing React/Vite codebase with the Capacitor runtime. Capacitor acts as a bridge, allowing your web code to invoke native device code. Crucially, this transition is **non-destructive**; your web deployment workflow remains intact, and the PWA will continue to function as before.

### **Step 1.1: Install Capacitor Core**

Run the following commands in the root directory of your `versicle` repository to install the necessary dependencies.

```
# Install the core Capacitor runtime and the Command Line Interface (CLI)
npm install @capacitor/core
npm install -D @capacitor/cli

# Initialize the Capacitor Configuration
# This creates the foundational config file for the native project.
# - App Name: Versicle (Displayed on the home screen)
# - Package ID: com.vrwarp.versicle (Unique identifier for the Play Store)
# - Web Asset Dir: dist (This MUST match the 'build.outDir' in your vite.config.ts)
npx cap init Versicle com.vrwarp.versicle --web-dir=dist

```

*Note: Ensure you are using a Node.js version compatible with the latest Capacitor release (Node 18+ is recommended).*

### **Step 1.2: Configure Capacitor**

The default configuration is sufficient for basic apps, but for Versicle, we need specific settings to ensure secure communication with Cloud TTS providers. Open `capacitor.config.ts` and apply the following configuration.

**File:** `capacitor.config.ts`

```
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vrwarp.versicle',
  appName: 'Versicle',
  // Points to the Vite build output directory.
  // Capacitor will copy these files into the Native App bundle.
  webDir: 'dist',
  server: {
    // CRITICAL: Sets the WebView to load from https://localhost instead of http://
    // This is required for:
    // 1. Secure Cookies (if used for auth)
    // 2. Access to Secure Context features (Crypto API, some Audio APIs)
    // 3. CORS compliance when calling external APIs like OpenAI
    androidScheme: 'https',

    // Optional: Set to true only during development to allow live reloading
    // from a local server. Ensure this is false or omitted for production builds.
    cleartext: true
  },
  plugins: {
    // Explicitly enable CapacitorHttp if we plan to proxy requests through the native layer
    // to avoid CORS issues entirely (optional but recommended for robust networking).
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;

```

### **Step 1.3: Add Android Platform**

This command generates the `android/` folder in your project, which contains the complete Android Studio project structure. This folder effectively *is* your Android app.

```
# Install the Android platform driver
npm install @capacitor/android

# Create the android directory and sync the initial config
npx cap add android

```

**Phase 2: The Android Compliance Triad (Dependencies)**
--------------------------------------------------------

To satisfy Android 14's rigorous media policies, we cannot rely on generic background plugins. We must install a specific suite of native plugins that work in concert.

**Note on Versions (Capacitor 6):**
*   `@capawesome-team/capacitor-android-foreground-service`: Use `^6.0.0`
*   `@jofr/capacitor-media-session`: Use `^4.0.0`
*   `@capacitor-community/text-to-speech`: Use `^5.1.0` (Version 6+ requires Capacitor 7)
*   `@capawesome-team/capacitor-android-battery-optimization`: Use `^6.0.0`

```
# 1. Process Shield: @capawesome-team/capacitor-android-foreground-service
# This plugin manages the notification channels and the specific 'startForeground'
# calls required to promote the app process to a "perceptible" state.
npm install @capawesome-team/capacitor-android-foreground-service

# 2. Compliance Token: @jofr/capacitor-media-session
# This plugin bridges the gap between the WebView and the Android MediaSession API.
# It creates the Lock Screen controls (Play/Pause/Next) and, critically,
# provides the OS with the "active media session" token required to keep the service alive.
npm install @jofr/capacitor-media-session

# 3. Native Audio Engine: @capacitor-community/text-to-speech
# A wrapper around the android.speech.tts API. This provides zero-latency, offline,
# battery-efficient speech synthesis using the device's installed voices (Samsung/Google).
npm install @capacitor-community/text-to-speech

# 4. Samsung Mitigation: @capawesome-team/capacitor-android-battery-optimization
# Samsung and Xiaomi devices have "Phantom Process Killers" that ignore standard Android rules.
# This plugin allows us to request the user to whitelist Versicle from these aggressive optimizations.
npm install @capawesome-team/capacitor-android-battery-optimization

# Apply these plugins to the Android project
npx cap sync

```

**Phase 3: Android Manifest Configuration (Critical)**
------------------------------------------------------

The `AndroidManifest.xml` is the contract between your application and the Operating System. For Android 14, this contract must be explicit. If you attempt to start a Foreground Service without declaring its *type* in the manifest, the OS will throw a `SecurityException` and crash the app immediately.

**File:** `android/app/src/main/AndroidManifest.xml`

**Action:** Open this file and rigorously update the `<manifest>` and `<application>` blocks. Do not skip any permission tags.

```
<manifest xmlns:android="[http://schemas.android.com/apk/res/android](http://schemas.android.com/apk/res/android)" package="com.vrwarp.versicle">

    <!-- PERMISSIONS -->

    <!-- 1. Basic Internet Access -->
    <!-- Required to fetch Cloud TTS audio and book data. -->
    <uses-permission android:name="android.permission.INTERNET" />

    <!-- 2. Keep CPU Awake -->
    <!-- Critical. Even with a Foreground Service, the CPU attempts to sleep to save power.
         This permission allows us to hold a partial WakeLock, keeping the JS engine running. -->
    <uses-permission android:name="android.permission.WAKE_LOCK" />

    <!-- 3. Foreground Service Permission -->
    <!-- The foundational permission to run a service that isn't killed instantly. -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />

    <!-- 4. Android 14 Specific Media Mandate -->
    <!-- WITHOUT THIS, YOUR APP WILL CRASH ON ANDROID 14 DEVICES.
         It explicitly grants the ability to run a 'mediaPlayback' type service. -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />

    <!-- 5. Notification Visibility (Android 13+) -->
    <!-- Required to show the persistent "Now Playing" notification.
         If denied, the service runs "silently," which Android restricts heavily. -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">

        <!-- MAIN ACTIVITY -->
        <!-- This is the container for your Capacitor WebView -->
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:name="com.vrwarp.versicle.MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>

        <!-- SERVICE DECLARATION (CRITICAL) -->
        <!-- We are registering the service provided by the plugin.
             Crucially, we define 'foregroundServiceType="mediaPlayback"'.
             This tells the OS: "This service plays audio. Treat it like Spotify." -->
        <service
            android:name="io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService"
            android:foregroundServiceType="mediaPlayback"
            android:exported="false" />

        <!-- RECEIVER -->
        <!-- Used to intercept button clicks (Play/Pause) on the notification itself. -->
        <receiver android:name="io.capawesome.capacitorjs.plugins.foregroundservice.NotificationActionBroadcastReceiver" />

    </application>
</manifest>

```

### **Critical Asset Requirement: The Notification Icon**

One common source of immediate runtime crashes is a missing notification icon. The Foreground Service API requires a valid drawable resource to build the notification.

1.  **Design:** Create a simple, monochrome (white), transparent PNG of the Versicle logo.

2.  **Naming:** You **must** name it `ic_stat_versicle.png`.

3.  **Placement:** Place this file in `android/app/src/main/res/drawable/`. If the `drawable` folder does not exist, create it inside `res/`.

4.  **Verification:** Ensure the file is not empty and is a valid PNG.

**Phase 4: Code Implementation (The Hybrid Bridge)**
----------------------------------------------------

We will now modify the TypeScript application layer to be "environment-aware," intelligently switching between Web APIs and Native Plugins.

### **Step 4.1: Native TTS Provider**

We need a class that implements your `ITTSProvider` interface but delegates the actual work to the Android system engine.

**File:** `src/lib/tts/providers/CapacitorTTSProvider.ts`

```
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import type { ITTSProvider, SpeechSegment, TTSVoice } from './types';

export class CapacitorTTSProvider implements ITTSProvider {
  // We use the ID 'local' so this provider naturally replaces the WebSpeechProvider
  // in the selection logic when running on a device.
  id = 'local';

  async init(): Promise<void> {
    // Native plugins generally initialize lazily, but we could check
    // for specific engine availability here if needed.
  }

  async getVoices(): Promise<TTSVoice[]> {
    try {
      const { voices } = await TextToSpeech.getSupportedVoices();
      // Map the native voice objects to our internal TTSVoice interface
      return voices.map(v => ({
        id: v.voiceURI, // Native URI is robust for ID
        name: v.name,
        lang: v.lang,
        provider: 'local'
      }));
    } catch (e) {
      console.warn('Failed to load native voices', e);
      return [];
    }
  }

  async synthesize(text: string, voiceId: string, speed: number, signal?: AbortSignal): Promise<SpeechSegment> {
    // Native operations can't easily be aborted mid-flight by a signal,
    // but we can check before we start.
    if (signal?.aborted) throw new Error('Aborted');

    // The plugin handles the audio output directly.
    // This Promise resolves only when the speech finishes (onEnd event).
    await TextToSpeech.speak({
      text,
      lang: 'en-US', // TODO: Implement robust mapping from voiceId to locale
      rate: speed,
      category: 'playback', // Important iOS hint, good practice for Android
      queueStrategy: 1 // 1 = Add to queue (smoother), 0 = Flush (interrupt)
    });

    // We return a marker indicating native playback occurred.
    // This tells the Service NOT to try and play an audio blob.
    return { isNative: true };
  }

  async stop(): Promise<void> {
    await TextToSpeech.stop();
  }

  async pause(): Promise<void> {
    // Native TTS pause support varies wildly by Android version and Engine.
    // A hard stop is the safest way to ensure silence.
    await TextToSpeech.stop();
  }

  async resume(): Promise<void> {
    // Not reliably supported by the native bridge.
  }
}

```

### **Step 4.2: Hybrid Media Session Manager**

This component is the "Compliance Token." It abstracts the Lock Screen controls so your app works correctly on both Chrome (PWA) and Android (Native).

**File:** `src/lib/tts/MediaSessionManager.ts`

```
import { Capacitor } from '@capacitor/core';
import { MediaSession } from '@jofr/capacitor-media-session';

export interface MediaMetadata {
    title: string;
    artist: string;
    album?: string;
    artwork?: { src: string; sizes?: string; type?: string }[];
}

export interface PlaybackState {
    playbackState: 'playing' | 'paused' | 'none';
    playbackSpeed?: number;
    position?: number;
    duration?: number;
}

export class MediaSessionManager {
    private isNative = Capacitor.isNativePlatform();

    constructor(private handlers: {
        onPlay: () => void;
        onPause: () => void;
        onStop: () => void;
        onNext: () => void;
        onPrev: () => void;
        onSeekBackward: () => void;
        onSeekForward: () => void;
    }) {
        this.initActionHandlers();
    }

    private async initActionHandlers() {
        if (this.isNative) {
            // NATIVE MODE:
            // Bridge events from the Android System UI back to JavaScript.
            await MediaSession.setActionHandler({ action: 'play', handler: this.handlers.onPlay });
            await MediaSession.setActionHandler({ action: 'pause', handler: this.handlers.onPause });
            await MediaSession.setActionHandler({ action: 'stop', handler: this.handlers.onStop });
            await MediaSession.setActionHandler({ action: 'next', handler: this.handlers.onNext });
            await MediaSession.setActionHandler({ action: 'previous', handler: this.handlers.onPrev });
            await MediaSession.setActionHandler({ action: 'seekbackward', handler: this.handlers.onSeekBackward });
            await MediaSession.setActionHandler({ action: 'seekforward', handler: this.handlers.onSeekForward });
        } else if ('mediaSession' in navigator) {
            // WEB MODE:
            // Use the standard W3C Media Session API.
            navigator.mediaSession.setActionHandler('play', this.handlers.onPlay);
            navigator.mediaSession.setActionHandler('pause', this.handlers.onPause);
            navigator.mediaSession.setActionHandler('stop', this.handlers.onStop);
            navigator.mediaSession.setActionHandler('nexttrack', this.handlers.onNext);
            navigator.mediaSession.setActionHandler('previoustrack', this.handlers.onPrev);
            navigator.mediaSession.setActionHandler('seekbackward', this.handlers.onSeekBackward);
            navigator.mediaSession.setActionHandler('seekforward', this.handlers.onSeekForward);
        }
    }

    async setMetadata(metadata: MediaMetadata) {
        if (this.isNative) {
            // This updates the Lock Screen display (Title, Album Art).
            await MediaSession.setMetadata({
                title: metadata.title,
                artist: metadata.artist,
                album: metadata.album,
                artwork: metadata.artwork
            });
        } else if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new window.MediaMetadata(metadata as any);
        }
    }

    async setPlaybackState(state: PlaybackState) {
        if (this.isNative) {
            // CRITICAL FOR ANDROID 14 COMPLIANCE:
            // This call signals to the OS that "Yes, we are actually playing audio."
            // Without this, the 'mediaPlayback' service may be flagged as abusive and killed.
            await MediaSession.setPlaybackState({
                playbackState: state.playbackState,
                playbackSpeed: state.playbackSpeed || 1.0,
            });
        } else if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = state.playbackState;
            if (state.position !== undefined && state.duration !== undefined) {
                navigator.mediaSession.setPositionState({
                    duration: state.duration,
                    playbackRate: state.playbackSpeed || 1.0,
                    position: state.position
                });
            }
        }
    }
}

```

### **Step 4.3: The Orchestrator (AudioPlayerService)**

This serves as the central brain. We must modify it to execute the "Atomic Start Sequence."

**The Golden Rule:** You must start the Foreground Service **before** or **simultaneously** with the audio. If you wait, the app might be suspended before the service starts.

**File:** `src/lib/tts/AudioPlayerService.ts`

*(Step 4.3 Completed: Implemented orchestrator logic with Foreground Service and Media Session Manager)*

```typescript
import { Capacitor } from '@capacitor/core';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { BatteryOptimization } from '@capawesome-team/capacitor-android-battery-optimization';
import { CapacitorTTSProvider } from './providers/CapacitorTTSProvider';
import { MediaSessionManager } from './MediaSessionManager';
// ... existing imports

export class AudioPlayerService {
    // ... existing properties

    private constructor() {
        // 1. Platform Detection
        // Automatically switch providers based on the environment.
        if (Capacitor.isNativePlatform()) {
            this.provider = new CapacitorTTSProvider();
        } else {
            this.provider = new WebSpeechProvider(this.localProviderConfig);
        }

        // ... rest of init
    }

    /**
     * ATOMIC START SEQUENCE
     * Raises the "Shield" preventing process death.
     */
    private async engageBackgroundMode(item: TTSQueueItem) {
        // Only run this logic on Android devices.
        if (Capacitor.getPlatform() !== 'android') return;

        try {
            // Ensure channel exists (idempotent)
            await ForegroundService.createNotificationChannel({
                id: 'versicle_tts_channel',
                name: 'Versicle Playback',
                description: 'Controls for background reading',
                importance: 3,
                visibility: 1
            });

            // Step A: Start Foreground Service (The Shield)
            // This MUST happen first. It promotes the app process priority.
            await ForegroundService.startForegroundService({
                id: 1001, // Arbitrary but unique ID
                title: 'Versicle',
                body: `Reading: ${item.title || 'Chapter'}`,
                smallIcon: 'ic_stat_versicle', // This MUST match the drawable resource name
                notificationChannelId: 'versicle_tts_channel',
                buttons: [
                    { id: 101, title: 'Pause' } // We will listen for this ID in App.tsx
                ]
            });

            // Step B: Register Media Session (The Proof)
            // Immediately satisfy the 'mediaPlayback' requirement by registering session data.
            await this.mediaSessionManager.setMetadata({
                title: item.title || 'Chapter Text',
                artist: 'Versicle',
                album: item.bookTitle || '',
                artwork: item.coverUrl ? [{ src: item.coverUrl }] : []
            });

            // Signal "Playing" to the OS.
            await this.mediaSessionManager.setPlaybackState({
                playbackState: 'playing',
                playbackSpeed: this.speed
            });

        } catch (e) {
            console.error('Background engagement failed', e);
        }
    }

    /**
     * PLAY INTERNALS
     */
    private async playInternal(signal: AbortSignal): Promise<void> {
        const item = this.queue[this.currentIndex];

        // 2. Engage Shield if transitioning from a Stopped state.
        // If we are already playing (e.g., just moving to the next sentence),
        // the shield is already up, so we skip this to avoid notification flicker.
        if (this.status !== 'playing') {
            await this.engageBackgroundMode(item);
        }

        // ... existing playback logic ...

        // IMPORTANT:
        // Because the Shield (Foreground Service) is now active,
        // the WebView is not restricted by Doze mode.
        // This means calls to fetch() for Cloud TTS will succeed
        // even if the screen is off and the phone is in the user's pocket.
    }

    /**
     * STOP INTERNALS
     */
    private async stopInternal() {
        // ... stop audio logic ...

        // 3. Disengage Shield
        // Crucial cleanup. If we don't stop the service, the notification
        // will become "stuck" and un-dismissible, annoying the user.
        if (Capacitor.isNativePlatform()) {
            try {
                await ForegroundService.stopForegroundService();
                // Tell the OS we are done with media.
                await this.mediaSessionManager.setPlaybackState({ playbackState: 'none' });
            } catch (e) { console.warn(e); }
        }

        this.setStatus('stopped');
    }

    /**
     * OPTIONAL: Samsung Mitigation
     * Checks if the app is restricted and prompts the user.
     */
    public async checkBatteryOptimization() {
        if (Capacitor.getPlatform() === 'android') {
            const isEnabled = await BatteryOptimization.isBatteryOptimizationEnabled();
            if (isEnabled.enabled) {
                // Logic to show a UI prompt to the user explaining why they should disable it.
                // Then call BatteryOptimization.openBatteryOptimizationSettings();
            }
        }
    }
}

```

### **Step 4.4: App Initialization**

We need to initialize the Notification Channel (categories) once when the app launches.

**File:** `src/App.tsx` (or `src/main.tsx`)

```
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { AudioPlayerService } from './lib/tts/AudioPlayerService';

const App = () => {
  useEffect(() => {
    const initAndroid = async () => {
      if (Capacitor.getPlatform() === 'android') {
        // 1. Setup Notification Channel
        // This defines how the notification behaves (sound, vibration, visibility).
        // 'importance: 3' means it shows up but doesn't make a noise (good for media).
        await ForegroundService.createNotificationChannel({
            id: 'versicle_tts_channel',
            name: 'Versicle Playback',
            description: 'Controls for background reading',
            importance: 3,
            visibility: 1
        });

        // 2. Listen for "Pause" button clicks on the notification itself
        const listener = await ForegroundService.addListener('buttonClicked', async (event) => {
            if (event.buttonId === 101) {
                // Map the notification button to our Service logic
                AudioPlayerService.getInstance().pause();
            }
        });
      }
    };

    initAndroid();
  }, []);

  // ... render
};

```

**Phase 5: Verification Checklist**
-----------------------------------

Perform this rigorous testing sequence to ensure full compliance.

1.  **Build Web Assets:**

    -   Run `npm run build`.

    -   Verify the `dist` folder is populated.

2.  **Sync Native:**

    -   Run `npx cap sync`.

    -   This copies the `dist` folder into the Android project structure.

3.  **Run Android:**

    -   Run `npx cap run android`.

    -   Select your connected device or Emulator (ensure Emulator is Android 14 / API 34+).

4.  **Test 1 (Native Voice):**

    -   Go to Settings -> Select "Local" provider.

    -   Start playback.

    -   **Action:** Lock the screen immediately.

    -   **Verification:** Audio should continue. Wake the screen---you should see the Versicle Media Controls on the Lock Screen.

5.  **Test 2 (Cloud Voice):**

    -   Go to Settings -> Select "OpenAI" or "Google" provider.

    -   Start playback.

    -   **Action:** Lock the screen.

    -   **Verification:** Audio continues. Wait for at least 30 seconds to ensure the app successfully fetches the *next* sentence from the network while the screen is off.

6.  **Test 3 (Compliance & Endurance):**

    -   Leave the app playing for > 2 minutes with the screen off.

    -   **Verification:** The app is not killed. This confirms that the Foreground Service + Media Session handshake was successful and the OS recognizes the app as a valid media player.

7.  **Troubleshooting:**

    -   *Crash on Start:* Check `ic_stat_versicle` exists.

    -   *Silent Stop:* Check Logcat for `MissingForegroundServiceTypeException` (Manifest issue) or `ForegroundServiceStartNotAllowedException` (started from background).
