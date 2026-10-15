/**
 * standaloneChrome: the iPad home-screen detection behind the CSS top-clearance
 * floor (src/index.css `html[data-standalone-platform="ipados"]`).
 */
import { describe, it, expect } from 'vitest';
import { detectStandalonePlatform, markStandalonePlatform, type StandaloneDisplayEnv } from './standaloneChrome';

const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IPAD_LEGACY_UA = 'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

function env(overrides: Partial<StandaloneDisplayEnv>): StandaloneDisplayEnv {
  return {
    userAgent: IPAD_UA,
    maxTouchPoints: 5,
    displayModeStandalone: true,
    navigatorStandalone: false,
    ...overrides,
  };
}

describe('detectStandalonePlatform', () => {
  it('flags an iPad home-screen app (desktop-class Macintosh UA + touch points)', () => {
    expect(detectStandalonePlatform(env({}))).toBe('ipados');
  });

  it('accepts the legacy iPad UA and the navigator.standalone launch flag', () => {
    expect(detectStandalonePlatform(env({ userAgent: IPAD_LEGACY_UA, maxTouchPoints: 0 }))).toBe('ipados');
    expect(detectStandalonePlatform(env({ displayModeStandalone: false, navigatorStandalone: true }))).toBe('ipados');
  });

  it('is null in a browser tab (not standalone), even on iPad', () => {
    expect(detectStandalonePlatform(env({ displayModeStandalone: false }))).toBeNull();
  });

  it('is null for iPhone, macOS Safari (no touch), and Android standalone apps', () => {
    expect(detectStandalonePlatform(env({ userAgent: IPHONE_UA }))).toBeNull();
    expect(detectStandalonePlatform(env({ userAgent: MAC_UA, maxTouchPoints: 0 }))).toBeNull();
    expect(detectStandalonePlatform(env({ userAgent: ANDROID_UA }))).toBeNull();
  });
});

describe('markStandalonePlatform', () => {
  it('sets the attribute for iPad standalone and clears it otherwise', () => {
    markStandalonePlatform(document, env({}));
    expect(document.documentElement.getAttribute('data-standalone-platform')).toBe('ipados');

    markStandalonePlatform(document, env({ displayModeStandalone: false }));
    expect(document.documentElement.hasAttribute('data-standalone-platform')).toBe(false);
  });
});
