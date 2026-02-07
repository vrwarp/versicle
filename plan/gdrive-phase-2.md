# Technical Design Doc: Google Drive Integration (Phases 2-4)

## 1. Executive Summary
This document details the implementation of the **"Bring Your Own Storage"** feature, specifically the integration with Google Drive. The goal was to allow users to link a Google Drive folder as a source for their ebook library, enabling seamless synchronization of EPUB files across devices.

Key achievements include:
- **Dual Auth Architecture**: A robust authentication system supporting both Web (Google Identity Services) and Native (Capacitor) platforms without conflicting with the core Firebase Identity.
- **Silent Refresh**: A mechanism to maintain Drive access across page reloads without user intervention, using `login_hint` and silent token acquisition.
- **Native-like Folder Picker**: A polished UI component (`DriveFolderPicker`) that mimics a native file browser with breadcrumbs, skeletons, and specialized states.
- **Smart Scanning**: Logic to detect new files in the linked Drive folder without re-downloading existing ones.

---

## 2. Architecture & Authentication

### 2.1 The "Dual Auth" Strategy
Versicle uses Firebase Authentication for user identity ("App Sync"). However, accessing Google Drive requires additional OAuth 2.0 scopes (`drive.readonly`) which should not be forced upon the core identity.

We implemented a **Service-Based Authentication** layer that sits alongside Firebase Auth:

- **`useGoogleServicesStore`**: Tracks *intent*. Stores which services (e.g., `'drive'`) the user has connected. Persisted in `localStorage`. **Does not store tokens.**
- **`GoogleIntegrationManager`**: A facade that delegates to platform-specific strategies.
    - **Web Strategy (`WebGoogleAuthStrategy`)**: Uses Google Identity Services (GIS) v2. It requests an Access Token via a popup and stores it in memory. It handles token expiration and silent refreshes.
    - **Native Strategy (`NativeGoogleAuthStrategy`)**: Uses `@capacitor-firebase/authentication` to request incremental scopes. It relies on the OS-level session management.

### 2.2 Silent Refresh & Stability
A critical challenge on the Web was maintaining the Drive connection after a page refresh. Since Access Tokens are ephemeral and stored in memory, a refresh clears them.

**Solution:**
1. **Script Loading Guard**: `WebGoogleAuthStrategy` ensures the external GIS script (`accounts.google.com/gsi/client`) is fully loaded before attempting any operations. It polls for `window.google.accounts`.
2. **`login_hint` Optimization**: When requesting a new token silently (via `prompt: ''`), we pass the currently signed-in Firebase user's email as `login_hint`. This guides Google's OAuth server to the correct session, preventing the "Account Chooser" popup from appearing.

---

## 3. Drive API Integration (Service Layer)

### 3.1 `DriveService`
A stateless service responsible for direct communication with the Google Drive REST API v3.

- **`fetchWithAuth(url, options)`**:
    - Centralized fetch wrapper.
    - Automatically retrieves a valid token via `GoogleIntegrationManager`.
    - Handles **401 Unauthorized** responses by attempting a token refresh and retrying the request once.

- **Key Methods**:
    - `listFolders(parentId)`: Returns subfolders for navigation.
    - `listFiles(parentId, mimeType)`: Returns files with metadata (ID, name, size, md5Checksum).
    - `downloadFile(fileId)`: Fetches the file content as a `Blob` (`alt=media`).
    - `getFolderMetadata(folderId)`: Retrieves details for breadcrumb navigation.

### 3.2 `DriveScannerService`
Orchestrates the business logic of finding and importing books.

- **`scanLinkedFolder()`**: Lists all `application/epub+zip` files in the user's selected Drive folder.
- **`checkForNewFiles()`**: Use `Set` comparison to filter Drive files against the local `useBookStore`. Returns only *new* files.
- **`importFile(fileId)`**: Downloads the file blob and passes it to `useLibraryStore` for local indexing and storage.

---

## 4. UI Components & UX

### 4.1 `DriveFolderPicker`
A "Native File Browser" implementation built with React and Tailwind CSS.

- **Layout**: Fixed header (Title + Breadcrumbs), Scrollable body (File List), Fixed footer (Action Bar).
- **Navigation Model**:
    - **Click Row**: "Dive in" (Navigate down).
    - **Click Breadcrumb**: Navigate up/jump.
    - **Click Footer Button**: "Select" the current folder.
- **States**:
    - **Loading**: Displays animated Skeleton rows to prevent layout shift.
    - **Empty**: "No folders here" state with iconography.
    - **Error**: Retryable error state for network/auth failures.
- **Data Fetching**: Powered by a custom hook `useDriveBrowser` which manages the stack of folder IDs and fetches data from `DriveService`.

### 4.2 `SyncSettingsTab` Integration
The entry point for this feature.
- **"Cloud Integrations" Section**: Added to the settings UI.
- **Connection Flow**:
    1. User clicks "Connect Google Drive".
    2. `GoogleIntegrationManager` triggers the auth flow.
    3. On success, the store updates, and the "Link Folder" button becomes active.
- **Link Folder Flow**:
    1. Opens `DriveFolderPicker` in a `Dialog`.
    2. User selects a folder.
    3. Selection is saved to `useDriveStore` as `linkedFolderId`.

---

## 5. Security & Scopes

The integration requests the minimum viable scope:
- **`https://www.googleapis.com/auth/drive.readonly`**: Read-only access to file metadata and content. We do *not* ask for full Drive access.

This scope is requested *incrementally* only when the user explicitly enables the Drive integration, separate from the initial App login.
