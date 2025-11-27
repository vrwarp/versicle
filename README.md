# Versicle

A local-first, web-based EPUB manager and reader.

## Project Overview

Versicle is a Progressive Web App (PWA) designed to ingest, manage, and render EPUB files directly in the browser. It leverages `epub.js` for rendering and IndexedDB for storing large files and metadata locally.

## Features

- **Local-First:** All data is stored locally in the browser using IndexedDB.
- **Library Management:** Import and organize your EPUB collection.
- **Reader Interface:** Read books with pagination and chapter navigation.
- **Text-to-Speech (TTS):** Synchronized reading with sentence highlighting.
- **Annotations:** Highlight text and add notes.

## Tech Stack

- **Frontend:** React, TypeScript, Vite
- **State Management:** Zustand
- **Database:** IndexedDB (via `idb`)
- **Rendering:** epub.js
- **Routing:** react-router-dom

## Getting Started

1.  **Install Dependencies:**
    ```bash
    npm install
    ```

2.  **Run Development Server:**
    ```bash
    npm run dev
    ```

3.  **Build for Production:**
    ```bash
    npm run build
    ```

## Development Status

- **Step 1: Skeleton & Database** - Completed
  - Project initialized with Vite/React/TS.
  - Dependencies installed (`idb`, `zustand`, `epubjs`, etc.).
  - Directory structure created.
  - IndexedDB schema implemented (`EpubLibraryDB`).
  - Zustand stores created (`useLibraryStore`, `useReaderStore`, `useTTSStore`).
  - Basic routing setup with `react-router-dom`.
