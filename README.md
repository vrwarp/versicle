# Versicle

A local-first, web-based EPUB manager and reader.

## Project Overview

Versicle is a Progressive Web App (PWA) designed to ingest, manage, and render EPUB files directly in the browser. It leverages `epub.js` for rendering and IndexedDB for storing large files and metadata locally.

## Features

- **Local-First:** All data is stored locally in the browser using IndexedDB.
- **Library Management:** Import and organize your EPUB collection.
- **Reader Interface:** Read books with pagination, chapter navigation, and Table of Contents.
- **Customization:** Adjustable font size and themes (Light, Dark, Sepia).
- **Text-to-Speech (TTS):** Synchronized reading with sentence highlighting (In Progress).
- **Annotations:** Highlight text and add notes (In Progress).

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
- **Step 2: Ingestion & Library** - Completed
- **Step 3: The Reader Interface** - Completed
  - `ReaderView` component implemented.
  - `epub.js` integration for rendering.
  - Navigation (Next/Prev/TOC) and Progress tracking.
  - Theming and Font Size controls.
  - Unit and Integration tests added.
