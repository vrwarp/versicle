# Versicle

> "Versicle is an experimental project implemented almost entirely with Google Jules."

Versicle is a **local-first**, **privacy-centric** EPUB reader and audiobook player. It runs entirely in your browser (or as a native app via Capacitor) without sending your library data to any server.

**Core Philosophy**:
1.  **Ownership**: Your books live on your device.
2.  **Privacy**: No tracking, no reading analytics.
3.  **Hybrid**: Seamlessly switch between Reading (visual) and Listening (TTS).

---

## 🚀 Features

### 📚 Library & Reading
*   **Local-First Storage**: Books are stored in IndexedDB. Works 100% offline.
*   **EPUB Support**: Robust parsing via `epub.js`.
*   **Customization**: Fonts, themes (Light/Dark/Sepia), line height, and margins.
*   **Annotations**: Highlight text and add notes.
*   **Search**: Full-text search (runs in a Web Worker for speed).
*   **Smart Offloading**: Save space by removing book files while keeping your metadata, highlights, and reading progress.

### 🎧 Text-to-Speech (Audiobook Mode)
*   **Hybrid Engines**:
    *   **Local**: Use standard OS voices or **Piper** (WASM) for high-quality offline speech.
    *   **Cloud**: Integrate with **Google Gemini**, **OpenAI**, or **LemonFox** for neural voices.
*   **Pronunciation Lexicon**: Fix mispronounced names or terms with custom regex/replacement rules.
*   **Smart Content Skipping**: Automatically skip tables, citations, and footnotes using heuristics or GenAI classification.
*   **Background Playback**: Keeps playing even when the screen is locked (Android/iOS).
*   **Media Controls**: Control playback from your headphones or lock screen.

### 🧠 GenAI Integration (Optional)
*   **Smart TOC**: Generate a structured Table of Contents for books that lack one.
*   **Content Classification**: Identify and filter out non-narrative content like tables and indices.
*   **Note**: Requires a Google Gemini API Key.

---

## 🛠️ Tech Stack

*   **Framework**: React 19 + Vite 6
*   **Language**: TypeScript
*   **State**: Zustand + IDB (IndexedDB)
*   **UI**: Tailwind CSS v4 + Lucide React
*   **Mobile**: Capacitor 7 (Android/iOS)
*   **TTS**: Piper (WASM) + Web Speech API + Google/OpenAI APIs

---

## 🏃‍♂️ Getting Started

### Prerequisites
*   Node.js 20+
*   npm

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/vrwarp/versicle.git
    cd versicle
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Start the development server:
    ```bash
    npm run dev
    ```

4.  Open `http://localhost:5173` in your browser.

### Building for Production

```bash
npm run build
```

The output will be in the `dist/` directory.

### Mobile Development (Android)

1.  Sync Capacitor:
    ```bash
    npx cap sync
    ```

2.  Open Android Studio:
    ```bash
    npx cap open android
    ```

---

## 🧪 Testing

Versicle uses **Vitest** for unit tests and **Playwright** for end-to-end verification.

*   **Unit Tests**: `npm run test`
*   **Verification (Headless)**: `npm run verify`
*   **UI Verification**: `npm run verify:ui`

---

## 📄 License

MIT
