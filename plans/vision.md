# Versicle Product Vision

## Executive Summary
**Versicle** is a radical re-imagining of the digital reading experience. It rejects the modern trend of "Software as a Service" in favor of "Software as a Tool." It is a **Local-First**, **Privacy-Sovereign**, **Hybrid-Intelligence** platform that gives users complete ownership of their library while leveraging the latest in AI to enhance—not replace—the act of reading.

We are building the definitive reading environment for the "Post-Cloud" era: where data lives on the edge, privacy is the default, and intelligence is a utility you control.

## Core Values

### 1. Sovereignty (Data Ownership)
In an age of DRM and disappearing libraries, Versicle stands for ownership.
*   **Local-First**: The source of truth is always the device in your hand.
*   **No Lock-in**: Data is stored in open formats (EPUB, JSON) and can be exported at any time.
*   **Privacy**: We track nothing. Analytics are non-existent. Your reading habits are yours alone.

### 2. Continuity (Seamless Flow)
Reading is a fragmented activity that happens in the interstices of life—on the subway, in bed, at the desk.
*   **Dual Sync**: A robust "Hot/Cold" sync architecture ensures that whether you are online (Firestore) or strictly offline (Android Backup), your progress is preserved.
*   **Device Agnostic**: The experience adapts fluidly from a 6-inch phone to a 30-inch monitor.

### 3. Intelligence (AI as Bicycle)
We use AI to amplify human capability, not to replace it.
*   **Hybrid Model**: We combine the speed and privacy of on-device models (Piper TTS, RegExp Search) with the power of cloud models (Gemini) for complex tasks.
*   **Accessibility**: AI is used to break down barriers—turning visual tables into spoken narratives (Table Teleprompter) and adapting UI contrast for visual impairments.

### 4. Resilience (The "Long Now")
Software should be durable.
*   **Offline by Default**: The app works perfectly without an internet connection.
*   **Battery Guard**: We respect the hardware constraints, ensuring background audio plays reliably without draining the battery.
*   **Smart Offloading**: We respect storage constraints, allowing users to keep their library metadata while offloading heavy files.

## Strategic Pillars

### The "Store-First" Architecture
Versicle is built on a "Store-First" architecture using Yjs CRDTs. This means every interaction is instant, offline-capable, and conflict-free. The cloud is merely a peer, not the master. This architecture enables:
*   **Zero-Latency UI**: No spinners while waiting for a server.
*   **Collaborative Foundation**: Prepared for future features like shared libraries or collaborative annotation.

### The "Listening Room" (Audio First)
We treat audio as a first-class citizen, not an afterthought.
*   **Optimistic Playback**: Audio starts instantly while AI processes the content in the background.
*   **Neural TTS**: Studio-quality voices that rival human narration.
*   **Context Awareness**: Smart segmentation and content filtering (skipping footnotes/citations) create a seamless listening flow.

### The "Reading Room" (Focus First)
A sanctuary for deep reading.
*   **Adaptive Contrast**: The interface dissolves into the background, taking cues from the book cover to create an immersive atmosphere.
*   **Deep Search**: Full-text search that runs entirely in the browser, respecting the user's privacy while delivering instant results.

## Target Audience

*   **The Privacy Sovereign**: Users who reject cloud lock-in and demand control over their data.
*   **The Polymath**: Researchers, students, and lifelong learners who need to manage large libraries, annotate heavily, and consume complex content (tables, charts).
*   **The Hybrid Reader**: Commuters and busy professionals who switch seamlessly between reading text and listening to audio.
*   **The Accessibility Advocate**: Users who rely on robust accessibility features like high-contrast modes, TTS, and screen reader compatibility.

## Future Direction (Roadmap)

1.  **Deep Knowledge Management**: Evolving from a "Reader" to a "Thinker." Integrating Zettelkasten-style linking between books and notes.
2.  **Conversational Library**: Using LLMs to allow users to "chat" with their entire library—asking questions that synthesize answers from multiple books.
3.  **Cross-Platform Expansion**: Native desktop apps (Electron/Tauri) and iOS support to complete the ecosystem.
4.  **Social (P2P)**: Enabling direct, peer-to-peer sharing of annotations and reading lists without a central intermediary.
