/**
 * Composition holder for the GoogleAuthClient singleton. The REAL instance
 * (with platform options, login-hint provider, and store-backed connection
 * hooks) is constructed by src/app/google/wireGoogle.ts at composition time
 * (README §2 rule 8: only app/ constructs singletons); the lazy fallback
 * here is hook-free and exists so stray imports in unit tests cannot crash —
 * it never updates connection hints.
 */
import { Capacitor } from '@capacitor/core';
import { GoogleAuthClient } from './GoogleAuthClient';

let instance: GoogleAuthClient | null = null;

export function defaultPlatformOptions(): { style?: 'bottom'; autoSelectEnabled?: boolean } {
  return Capacitor.getPlatform() === 'android'
    ? { style: 'bottom', autoSelectEnabled: true }
    : {};
}

/** Install the composed client (app/ only). */
export function setGoogleAuthClient(client: GoogleAuthClient): void {
  instance = client;
}

export function getGoogleAuthClient(): GoogleAuthClient {
  if (!instance) {
    instance = new GoogleAuthClient({ platform: defaultPlatformOptions() });
  }
  return instance;
}

/** Test-only: drop the singleton so suites can re-wire. */
export function resetGoogleAuthClientForTesting(): void {
  instance = null;
}
