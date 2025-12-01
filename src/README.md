# Source Code

This directory contains the entire source code for the Versicle application.

## Directory Structure

*   **`assets/`**: Static assets imported within the code (images, icons).
*   **`components/`**: React components, organized by domain (`library`, `reader`, `ui`).
*   **`db/`**: IndexedDB database configuration and connection logic.
*   **`hooks/`**: Custom React hooks for shared logic (e.g., `useTTS`, `useLocalStorage`).
*   **`lib/`**: Core business logic and libraries, independent of the UI where possible (e.g., TTS engine, Search engine, Ingestion).
*   **`store/`**: Global state management using Zustand.
*   **`test/`**: Test utilities, setup files, and fixtures.
*   **`types/`**: Global TypeScript type definitions.
*   **`workers/`**: Web Workers for off-main-thread processing (e.g., Search).

## Root Files

*   **`App.tsx`**: The main application component, handling routing and global layout.
*   **`App.css`**: Styles specific to the App component.
*   **`index.css`**: Global stylesheets, including Tailwind CSS directives and theme variable definitions.
*   **`main.tsx`**: The application entry point. It mounts the React app into the DOM.
*   **`integration.test.ts`**: High-level integration tests validating the interaction between stores and services.
