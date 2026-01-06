import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { LegacyStorageBridge, SETTINGS_KEY } from '../LegacyStorageBridge';

describe('LegacyStorageBridge', () => {
  let doc: Y.Doc;
  let bridge: LegacyStorageBridge;

  beforeEach(() => {
    doc = new Y.Doc();
    bridge = new LegacyStorageBridge(doc);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should migrate reader settings', () => {
    const readerState = {
      state: {
        currentTheme: 'dark',
        fontSize: 120,
        viewMode: 'scrolled',
      },
      version: 0
    };
    localStorage.setItem('reader-storage', JSON.stringify(readerState));

    bridge.migrateLocalStorageToState();

    const settings = doc.getMap(SETTINGS_KEY);
    expect(settings.get('currentTheme')).toBe('dark');
    expect(settings.get('fontSize')).toBe(120);
    expect(settings.get('viewMode')).toBe('scrolled');
  });

  it('should migrate sync settings', () => {
    const syncState = {
      state: {
        googleClientId: 'test-client-id',
        isSyncEnabled: true,
      },
      version: 0
    };
    localStorage.setItem('sync-storage', JSON.stringify(syncState));

    bridge.migrateLocalStorageToState();

    const settings = doc.getMap(SETTINGS_KEY);
    expect(settings.get('googleClientId')).toBe('test-client-id');
    expect(settings.get('isSyncEnabled')).toBe(true);
  });

  it('should not overwrite existing Yjs data', () => {
    const settings = doc.getMap(SETTINGS_KEY);
    settings.set('currentTheme', 'sepia');

    const readerState = {
      state: {
        currentTheme: 'dark', // Should be ignored
        fontSize: 120,
      },
      version: 0
    };
    localStorage.setItem('reader-storage', JSON.stringify(readerState));

    bridge.migrateLocalStorageToState();

    expect(settings.get('currentTheme')).toBe('sepia');
    expect(settings.get('fontSize')).toBe(120);
  });

  it('should clear legacy storage', () => {
    localStorage.setItem('reader-storage', 'data');
    localStorage.setItem('sync-storage', 'data');

    bridge.clearLegacyStorage();

    expect(localStorage.getItem('reader-storage')).toBeNull();
    expect(localStorage.getItem('sync-storage')).toBeNull();
  });
});
