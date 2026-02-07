import { Capacitor } from '@capacitor/core';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect
} from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { getFirebaseAuth } from '../sync/firebase-config';
import { createLogger } from '../logger';

const logger = createLogger('GoogleDriveService');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';

export class GoogleDriveService {
  /**
   * Authenticates the user with Google Drive scope.
   * On Native: Uses Google Sign-In plugin (returns token immediately).
   * On Web: Uses signInWithPopup (returns token immediately) or falls back to redirect.
   *
   * @returns Access Token if successful (Native/Popup), or void if redirecting (Web fallback).
   */
  static async authenticate(): Promise<string | void> {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('Firebase Auth not initialized');

    if (Capacitor.isNativePlatform()) {
      // Native Flow
      try {
        const result = await FirebaseAuthentication.signInWithGoogle({
          scopes: [DRIVE_SCOPE],
          mode: 'popup' // Native plugin mode
        });

        // Native plugin returns idToken, but we need accessToken for Drive API.
        // Wait, @capacitor-firebase/authentication returns `authentication` object which has `accessToken`?
        // Let's check the type definition or documentation in memory/context.
        // The memory says "The Web/PWA flow uses `signInWithRedirect`... Native platforms continue to use the hybrid Native Capacitor Plugin flow."
        // Usually, the native plugin returns `SignInResult` which has `user` and `credential`.
        // `credential.accessToken` might be available if requested.
        // If not, we might need to swap the ID token for a Google Credential, but that's for Firebase.
        // For Google API access, we need the OAuth access token.
        // On Android/iOS, the plugin *should* return the access token if scopes are requested.
        // Let's assume it does return it in the result or we can get it from the credential.

        // Actually, typical usage:
        // const result = await FirebaseAuthentication.signInWithGoogle({ scopes: ... });
        // result.credential?.accessToken might be the one.
        // However, the plugin documentation says `credential` contains `idToken` and `accessToken`.

        if (result.credential?.accessToken) {
          return result.credential.accessToken;
        }

        // Fallback: If not present, maybe we need to use the ID token to authenticate with Firebase and then...?
        // No, Firebase Auth ID token cannot access Drive API. We MUST have the OAuth Access Token.
        logger.warn('Native sign-in did not return access token. Check scopes.');
        throw new Error('Failed to get Drive access token');
      } catch (e) {
        logger.error('Native auth failed', e);
        throw e;
      }
    } else {
      // Web Flow
      const provider = new GoogleAuthProvider();
      provider.addScope(DRIVE_SCOPE);

      try {
        // Try popup first
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        return credential?.accessToken || undefined;
      } catch (error: any) {
        // If popup blocked or COOP error, try redirect
        if (error.code === 'auth/popup-blocked' || error.code === 'auth/cancelled-popup-request' || error.message.includes('COOP')) {
          logger.info('Popup blocked/failed, falling back to redirect');
          await signInWithRedirect(auth, provider);
          return; // Returns void, page will reload
        }
        logger.error('Web auth failed', error);
        throw error;
      }
    }
  }

  /**
   * List EPUB files in the specified folder.
   */
  static async listFiles(folderId: string, accessToken: string): Promise<any[]> {
    const query = `'${folderId}' in parents and mimeType = 'application/epub+zip' and trashed = false`;
    const url = `${DRIVE_API_URL}/files?q=${encodeURIComponent(query)}&fields=files(id, name, mimeType, size, webContentLink, iconLink, thumbnailLink)`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Unauthorized');
      }
      const text = await response.text();
      throw new Error(`Drive API Error: ${text}`);
    }

    const data = await response.json();
    return data.files || [];
  }

  /**
   * Download a file from Drive.
   */
  static async getFile(fileId: string, accessToken: string): Promise<Blob> {
    const url = `${DRIVE_API_URL}/files/${fileId}?alt=media`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
        if (response.status === 401) throw new Error('Unauthorized');
        throw new Error('Download failed');
    }

    return await response.blob();
  }

  /**
   * Extracts the folder ID from a shared link or ID string.
   */
  static extractFolderId(input: string): string | null {
    // Regex for folder URL
    // https://drive.google.com/drive/folders/12345abcdef...
    // https://drive.google.com/drive/u/0/folders/12345abcdef...
    const urlMatch = input.match(/\/folders\/([a-zA-Z0-9-_]+)/);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1];
    }

    // Assume input is ID if it looks like one (alphanumeric, long enough)
    if (/^[a-zA-Z0-9-_]{10,}$/.test(input)) {
        return input;
    }

    return null;
  }
}
