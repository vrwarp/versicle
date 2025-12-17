# **Step 1: Skeleton & Database (Completed)**

## **1.1 Overview**
This step focused on initializing the project structure, setting up the development environment, and implementing the core data persistence layer using IndexedDB. We used Vite for tooling, React for the UI, and Zustand for state management.

## **1.2 Tech Stack**
*   **Build Tool:** Vite (React template)
*   **Language:** TypeScript (Strict mode)
*   **State Management:** Zustand
*   **Database:** IndexedDB (via `idb` library)
*   **Styling:** CSS Modules or Tailwind CSS (optional, but standard CSS/Modules preferred for simplicity unless otherwise specified). *Decision: CSS Modules for component isolation.*

## **1.3 Directory Structure**

```
src/
├── assets/
├── components/
│   ├── ui/          # Reusable UI components (Buttons, Modals)
│   ├── library/     # Library view components (Grid, Cover)
│   └── reader/      # Reader view components (Viewer, Controls)
├── db/
│   ├── db.ts        # Database initialization & schema
│   └── index.ts     # Data access layer (DAL) exports
├── hooks/           # Custom React hooks
├── lib/             # Utility functions
│   ├── epub.ts      # epub.js wrappers/helpers
│   └── styles.ts    # Global style helpers
├── store/           # Zustand stores
│   ├── useLibraryStore.ts
│   ├── useReaderStore.ts
│   └── useTTSStore.ts
├── types/           # TS Interfaces
├── App.tsx
└── main.tsx
```

## **1.4 Database Schema (IndexedDB)**

We used the `idb` library to interact with IndexedDB.
**Database Name:** `EpubLibraryDB`
**Version:** 1

### **Object Stores:**

1.  **`books`**
    *   **Key:** `id` (UUID string)
    *   **Value:** `BookMetadata` interface
    *   **Indexes:**
        *   `by_title` (unique: false)
        *   `by_author` (unique: false)
        *   `by_addedAt` (unique: false)

2.  **`files`**
    *   **Key:** `bookId` (UUID string, matches `books.id`)
    *   **Value:** `ArrayBuffer` (The raw EPUB binary)
    *   **Purpose:** Decoupling metadata from large binaries ensures fast library loading.

3.  **`annotations`**
    *   **Key:** `id` (UUID string)
    *   **Value:** `Annotation` interface
    *   **Indexes:**
        *   `by_bookId` (unique: false) -> efficiently query annotations for the current book.

## **1.5 Data Interfaces (`src/types/db.d.ts`)**

```typescript
export interface BookMetadata {
  id: string;
  title: string;
  author: string;
  description?: string;
  coverUrl?: string; // Blob URL (created on load, revoked on unload)
  addedAt: number;
  lastRead?: number;
  progress?: number; // 0-1 percentage
  currentCfi?: string; // Last read position
}

export interface Annotation {
  id: string;
  bookId: string;
  cfiRange: string;
  text: string; // The selected text
  color: string;
  note?: string;
  createdAt: number;
}
```

## **1.6 Implementation Steps (Completed)**

1.  **Initialize Vite Project:**
    *   `npm create vite@latest . -- --template react-ts`
    *   `npm install`
    *   Install dependencies: `npm install idb zustand epubjs uuid clsx`
    *   Install types: `npm install -D @types/uuid @types/epubjs` (Note: epubjs types might be partial or require manual declaration).

2.  **Setup `src/db/db.ts`:**
    *   Implement `initDB()` function using `openDB` from `idb`.
    *   Handle `upgrade` callback to create object stores and indexes.

3.  **Setup Stores:**
    *   Create `useLibraryStore` with actions: `refreshLibrary`, `addBook`, `removeBook`.
    *   Create `useReaderStore` (placeholder for now).

4.  **Basic Layout:**
    *   Clean up `App.tsx`.
    *   Create a basic routing/view switcher (Library vs Reader). Since `react-router` wasn't explicitly requested and the scope is small, conditional rendering based on state is acceptable, but `react-router-dom` is safer for history management. *Decision: Use `react-router-dom` for better UX (back button support).*
    *   `npm install react-router-dom`

5.  **Global Styles:**
    *   Define basic CSS variables for dark/light mode in `index.css`.

## **1.7 Verification (Completed)**
*   App runs (`npm run dev`).
*   IndexedDB is created in DevTools > Application > Storage.
*   Types compile without errors.
