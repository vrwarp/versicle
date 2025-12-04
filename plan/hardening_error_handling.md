# Global Error Handling Design

## 1. Current Architecture & Weaknesses

### Current Implementation
- **Global:** `App.tsx` handles DB init errors but nothing else.
- **UI:** `Toast.tsx` exists and is now managed by a centralized store.
- **Logging:** `console.error` is scattered.
- **Types:** `AppError`, `DatabaseError` exist.

### Vulnerabilities
- **Silent Failures:** Async errors in promises (like TTS fetching or Search) might only be logged to console.
- **Crash Experience:** If a component throws (e.g. `ReaderView`), the whole React tree unmounts (White Screen of Death).
- **User Feedback:** Users don't know *why* something failed (e.g. "Network Error" vs "Format Error").

## 2. Hardening Strategy

### 2.1. React Error Boundaries (Completed)
- **Action:** Create `src/components/ErrorBoundary.tsx`. (Done)
  - Catches render errors.
  - Displays a friendly "Something went wrong" UI with a "Reload" button.
  - Logs the stack trace.
- **Action:** Wrap `ReaderView` and `LibraryView` in this boundary in `App.tsx` or their respective parent containers. (Done)

### 2.2. Centralized Toast System (Implemented)
- **Status:** Complete
- **Components:** `src/store/useToastStore.ts`, `src/components/ui/ToastContainer.tsx`, `src/components/ui/Toast.tsx`
- **Actions:** `showToast(message, type: 'info'|'error'|'success')`, `hideToast()`.
- **Integration:** `App.tsx` includes `<ToastContainer />`. `ReaderView` uses `useToastStore` for error feedback.

### 2.3. Unhandled Promise Rejection Handler (Implemented)
- **Status:** Complete
- **Action:** Add a global event listener for `unhandledrejection` in `App.tsx` (or `main.tsx`).
  - Log the error.
  - If it's a critical known error (e.g. `StorageFull`), trigger a global Toast.

### 2.4. Error Reporting Service (Logger)
- **Action:** Create `src/lib/logger.ts`.
  - `Logger.error(context, message, error)`
  - `Logger.info(...)`
  - Initially just wraps `console`, but allows future expansion (e.g. sending to a backend or saving to file for debug export).

## 3. Implementation Plan

1.  **Create `logger.ts`** and `useToastStore.ts` (Toast Store Complete).
2.  **Create `ErrorBoundary.tsx`**.
3.  **Update `App.tsx`**:
    - Wrap routes.
    - Add global toast container (Complete).
    - Add window error listeners (Complete).
4.  **Refactor Components**:
    - `ReaderView` to use `useToastStore` (Complete).
    - `DBService` to use `Logger`.
