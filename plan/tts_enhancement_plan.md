# **Design Document: Versicle TTS Architecture V2**

## **1\. Executive Summary**

This document outlines the architectural overhaul required to transform Versicle into a "Text-to-Speech Forward" application. The current implementation relies solely on the browser's SpeechSynthesis API, which restricts voice quality, synchronization accuracy, and background playback capabilities.

The new architecture introduces an **Abstract Provider Layer** to seamlessly switch between native and cloud TTS engines, a **Unified Audio Manager** for consistent playback control, and a **Hybrid Synchronization Engine** to map various time-update events to EPUB locations.

## **2\. Goals & User Experience Principles**

* **Engine Agnostic:** The user can switch between "Device Voices" (Free, Offline) and "Cloud Voices" (High Quality, Cost) without the UI changing.  
* **High Fidelity Sync:** Sentence-level highlighting must work robustly. Word-level highlighting should be supported where data permits (e.g., Cloud timestamps).  
* **Background Play:** Audio must continue when the screen is off or the tab is in the background. This requires decoupling audio playback from the visual epub.js rendering loop.  
* **Persistence:** Expensive cloud-generated audio must be cached to IndexedDB to prevent re-billing for the same chapter.

## **3\. System Architecture**

The core shift is from a direct dependency on window.speechSynthesis to an interface-driven design.

graph TD  
    User\[User / UI\] \--\> Player\[Audio Player Component\]  
      
    subgraph "Core Logic"  
        Player \--\> AudioMgr\[Audio Manager\]  
        AudioMgr \--\> Cache\[TTS Cache (IndexedDB)\]  
        AudioMgr \--\> Factory\[Provider Factory\]  
    end  
      
    subgraph "Provider Layer"  
        Factory \--\> |Local| WebSpeech\[WebSpeech Adapter\]  
        Factory \--\> |Cloud| GCloud\[Google Cloud Adapter\]  
        Factory \--\> |Cloud| OpenAI\[OpenAI Adapter\]  
    end  
      
    subgraph "Playback"  
        WebSpeech \--\> |Native API| BrowserSynth\[window.speechSynthesis\]  
        GCloud \--\> |Audio Blob| AudioElem\[HTML5 Audio Element\]  
        OpenAI \--\> |Audio Blob| AudioElem  
    end  
      
    subgraph "Synchronization"  
        BrowserSynth \-- "onboundary (charIndex)" \--\> SyncEngine  
        AudioElem \-- "ontimeupdate (seconds)" \--\> SyncEngine  
        SyncEngine \-- "Map to CFI" \--\> Epub\[epub.js Rendition\]  
    end

## **4\. Key Components**

### **4.1 The ITTSProvider Interface**

We define a contract that all TTS engines must fulfill. This isolates the app from the quirks of specific APIs.

export interface TTSVoice {  
  id: string;  
  name: string;  
  lang: string;  
  provider: 'local' | 'google' | 'openai' | 'amazon';  
  quality?: 'standard' | 'neural';  
}

export interface SpeechSegment {  
  audio?: Blob;           // Cloud engines return audio  
  alignment?: Timepoint\[\]; // Cloud engines return \[{time: 0.5s, charIndex: 12}, ...\]  
  isNative: boolean;      // If true, audio is handled by browser internally  
}

export interface ITTSProvider {  
  id: string;  
    
  /\*\* Initialize the provider (load voices, check API keys) \*/  
  init(): Promise\<void\>;  
    
  /\*\* Get available voices \*/  
  getVoices(): Promise\<TTSVoice\[\]\>;  
    
  /\*\* \* Synthesize text.   
   \* \- Cloud providers return a Blob and Alignment data.  
   \* \- Local providers return a specialized flag or stream.  
   \*/  
  synthesize(text: string, voiceId: string, speed: number): Promise\<SpeechSegment\>;  
}

### **4.2 The Audio Manager (AudioPlayerService)**

Since we cannot rely on SpeechSynthesis for background play (it pauses when the screen locks on many mobile devices), we must use the standard HTML5 \<audio\> element for cloud voices.

* **Responsibility:** Maintains the playlist (queue of sentences/paragraphs).  
* **Media Session API:** Integrates with navigator.mediaSession to provide lock-screen controls (Play/Pause/Next/Prev) and display Book Title/Cover.  
* **State Machine:** Handles LOADING \-\> PLAYING \-\> PAUSED \-\> ENDED states across different providers.

### **4.3 The Synchronization Engine (SyncManager)**

This component solves the hardest problem: telling epub.js what to highlight. It effectively "normalizes" time.

* **Input 1 (Web Speech):** Receives onboundary event with event.charIndex.  
* **Input 2 (Cloud Audio):** Receives audio.currentTime. Lookups up the charIndex from the Timepoint\[\] JSON returned by the API.  
* **Process:**  
  1. Get current charIndex relative to the current text block.  
  2. Map charIndex \-\> DOM Range (via TreeWalker).  
  3. Map DOM Range \-\> EPUB CFI (Canonical Fragment Identifier).  
  4. Call rendition.annotations.add('highlight', cfi).

## **5\. Data Model Updates**

### **5.1 TTS Cache Store (IndexedDB)**

To save bandwidth and costs, we cache generated audio.

**Store:** tts\_cache

* **Key:** SHA256(text \+ voiceId \+ speed \+ pitch)
* **Value:**  
  * audioBlob: Blob (mp3/wav)  
  * alignment: Array\<{ time: number, type: 'word'|'sentence', textOffset: number }\>  
  * created: number (timestamp for LRU eviction)

### **5.2 Settings Store**

New fields in useTTSStore:

* provider: 'local' | 'google' | 'openai'  
* apiKey: string (stored securely in localStorage, not synced)  
* voiceId: string  
* highlightMode: 'sentence' | 'word'

## **6\. Implementation Strategy**

### **Phase 1: Architecture Refactor (Completed)**

1. **Extract src/lib/tts.ts**: Refactor the current functional code into a WebSpeechProvider class implementing ITTSProvider.  
2. **Update Store**: Modify useTTSStore to use the provider pattern.  
3. **Basic Sync**: Ensure the existing highlighting logic works through the new interface.

### **Phase 2: Cloud Foundation (Completed)**

1. **Generic Cloud Provider**: Create a base class for HTTP-based TTS.  
2. **Audio Player**: Implement the HTML5 Audio player logic, separating it from SpeechSynthesis.  
3. **Media Session**: Add lock-screen control support.

### **Phase 3: Google Cloud / OpenAI Integration (Completed)**

1. **Google Adapter**: Implement the adapter for Google Cloud Text-to-Speech API (requires API Key).  
   * *Status:* Implemented with sentence-level sync (word-level requires SSML marking).
2. **OpenAI Adapter**: Implement the adapter for OpenAI Audio API.
   * *Status:* Implemented (no native timestamp support).
3. **Caching**: Implement the IndexedDB cache to store the returned audio blobs.
   * *Status:* Implemented `TTSCache` and integrated into `AudioPlayerService`.
4. **UI**: Settings added to allow provider selection and key entry.

### **Phase 4: Advanced Sync & Polish**

1. **Refined Segmentation**: Use Intl.Segmenter (browser native) instead of regex for better sentence detection. [Completed]
2. **Playlist UI**: Add a visual "queue" or "playlist" view so users can see upcoming sentences. [Completed]
3. **Cost Controls**: Add UI warnings for large book synthesis when using paid keys. [Completed]

## **7\. UX Considerations for "TTS Forward"**

* **Floating Player:** A persistent "Mini Player" bar at the bottom of the screen (even in Library view) allows continuous listening while browsing.  
* **Pre-fetching:** When playing Sentence N, the system should silently synthesize/fetch Sentence N+1 to ensure zero-latency transitions.  
* **Error Handling:** If a Cloud API fails (network/quota), gracefully fallback to the Local Web Speech API. [Implemented]
