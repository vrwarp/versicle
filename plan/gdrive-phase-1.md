# Google Drive Integration - Phase 1 Technical Design
**Status**: Implemented
**Date**: 2026-02-06
**Author**: Antigravity

## 1. Executive Summary
This document details the technical implementation of the "Bring Your Own Storage" (BYOS) feature, specifically valid for Google Drive. The implementation uses a "Dual Auth" strategy to separate Identity Authentication (Firebase) from Service Authorization (Google Drive), ensuring a robust and secure user experience across both Web and Native (mobile) platforms.

## 2. Architecture: "Dual Auth" & Platform Fork

### 2.1 Core Concept
The system distinguishes between two types of Google connections:
1.  **Identity (App Sync)**: Used to sign in to Versicle and sync user data via Firebase.
2.  **Services (Cloud Integrations)**: Used to access external resources like Google Drive.

### 2.2 Platform Fork Strategy
To provide the best experience on each platform, we fork the implementation behind a unified facade:

| Feature | Web / PWA | Native (iOS/Android) |
| :--- | :--- | :--- |
| **Identity Auth** | **Google Identity Services (GIS)** + Firebase | **Native Google Sign-In** (`@capacitor-firebase`) |
| **Service Auth** | **GIS Token Client** (Popup/Redirect) | **Native Google Sign-In** (Scopes) |
| **Token Storage** | In-Memory (Ephemeral) | OS Keychain (Persistent) |
| **Strategy** | `WebGoogleAuthStrategy` | `NativeGoogleAuthStrategy` |

## 3. Core Components

### 3.1 GoogleIntegrationManager (`src/lib/google/GoogleIntegrationManager.ts`)
A singleton facade that abstracts platform differences.
-   **Role**: Entry point for UI components.
-   **Methods**:
    -   `connectService(serviceId)`: Initiates auth flow for specific scopes.
    -   `disconnectService(serviceId)`: Revokes or clears local connection state.
    -   `getValidToken(serviceId)`: Returns a valid access token, refreshing if necessary.

### 3.2 Authentication Strategies
Polymorphic implementations of the auth logic.

#### WebGoogleAuthStrategy (`src/lib/google/WebGoogleAuthStrategy.ts`)
-   Uses the modern **Google Identity Services (GIS)** library.
-   **Flow**:
    1.  Dynamically loads the GIS script (`accounts.google.com/gsi/client`).
    2.  Initializes a `TokenClient`.
    3.  Requests an Access Token via popup for requested scopes (`drive.readonly` or `email/profile`).
    4.  Stores tokens in memory for security.
    5.  Handles silent refreshes transparently.
-   **Configuration**: Supports dynamic `Google Client ID` input from user settings.

#### NativeGoogleAuthStrategy (`src/lib/google/NativeGoogleAuthStrategy.ts`)
-   Uses **@capacitor-firebase/authentication**.
-   **Flow**:
    1.  Delegates to the native plugin to request scopes.
    2.  Relies on the OS to manage persistent refresh tokens.
    3.  Returns tokens directly from the native bridge.

### 3.3 State Management (`src/store/useGoogleServicesStore.ts`)
A granular methods-based Zustand store for UI state.
-   **Persisted State**:
    -   `connectedServices`: List of connected service IDs (e.g., `['drive']`).
    -   `googleClientId`: Optional user-provided Client ID.
-   **Security Note**: **No access tokens or refresh tokens are stored in this store.** It only tracks *intent* and *status*.

## 4. Authentication Flows

### 4.1 Web Identity Flow (GIS-First)
We implemented the "Best Practice" GIS-First flow to avoid third-party cookie issues and popup blockers:
1.  User clicks "Sign in with Google".
2.  `GoogleIntegrationManager` requests `identity` scopes (`email`, `profile`, `openid`).
3.  Google Popup opens -> User consents -> **Google Access Token** returned.
4.  App creates a Firebase Credential using `GoogleAuthProvider.credential(null, accessToken)`.
5.  `signInWithCredential` authenticates the user with Firebase.

### 4.2 Service Connection Flow (Drive)
1.  User clicks "Connect" in `SyncSettingsTab`.
2.  `GoogleIntegrationManager` requests `drive` scopes (`drive.readonly`).
3.  **Web**: GIS Popup requests *incremental* consent.
4.  **Native**: Native bridge requests permissions.
5.  On success, `useGoogleServicesStore` marks 'drive' as connected.

## 5. Security Model

### 5.1 Scopes (`src/lib/google/config.ts`)
We strictly adhere to the Principle of Least Privilege.
-   **Identity**: `email`, `profile`, `openid`.
-   **Drive**: `https://www.googleapis.com/auth/drive.readonly` (Read-only access to files).

### 5.2 Token Storage
-   **Web**: Access tokens are kept in volatile memory within the `WebGoogleAuthStrategy` instance. They are lost on page refresh (design choice for security), but the "Connected" status persists, prompting a silent refresh or re-consent on next use.
-   **Native**: Tokens are securely managed by the Android/iOS OS-level account manager.

### 5.3 Client ID Configuration
-   To support custom deployments or rigorous testing, the `SyncSettingsTab` exposes a "Google Client ID" input.
-   This value overrides the build-time `VITE_GOOGLE_CLIENT_ID`.

## 6. UI Integration

### 6.1 SyncSettingsTab
-   Split into **App Sync** (Firebase) and **Cloud Integrations** (Drive).
-   Provides visual feedback for connection status.
-   Helper text encourages using the same Google account for both Identity and Drive to reduce confusion.

### 6.2 FileUploader
-   State-aware buttons: "Connect Google Drive" vs "Browse Google Drive".
-   (Pending Phase 2) Will trigger the Picker interface.

## 7. Future Work (Phase 2)
-   **Google Drive Picker**: Implement the visual file picker for Web using the Google Picker API.
-   **Native File Browser**: Implement a native file picker or custom UI for browsing Drive files on mobile.
-   **Error Handling**: Enhance UI for scenarios like token revocation or quota limits.
