/**
 * Home-screen ("standalone") display hints for the shell CSS.
 *
 * iPadOS home-screen web apps draw the status bar — and, on iPadOS 26+, the
 * window control that sits in that row — over the page, while the reported
 * env(safe-area-inset-top) is not a reliable signal on its own (it can be 0
 * even when the bar overlaps; WebKit bug 301994 family). src/index.css keys a
 * minimum top clearance on `html[data-standalone-platform="ipados"]`; this
 * module decides whether to set that attribute. It runs synchronously from
 * main.tsx before the first render so the first paint already carries the
 * clearance (no layout jump).
 *
 * iPhone is excluded on purpose: with the default (opaque) status-bar style
 * iOS reserves the bar itself and the env() inset is the right amount.
 * Android home-screen apps and plain browser tabs never get the attribute.
 */

export type StandalonePlatform = 'ipados';

export interface StandaloneDisplayEnv {
  userAgent: string;
  /** navigator.maxTouchPoints — iPadOS Safari reports a Macintosh UA but >1 touch points. */
  maxTouchPoints: number;
  /** `(display-mode: standalone)` media query result. */
  displayModeStandalone: boolean;
  /** Legacy iOS-only `navigator.standalone` flag (true when launched from the Home Screen). */
  navigatorStandalone: boolean;
}

/** PURE: which standalone platform (if any) needs extra chrome clearance. */
export function detectStandalonePlatform(env: StandaloneDisplayEnv): StandalonePlatform | null {
  const standalone = env.displayModeStandalone || env.navigatorStandalone;
  if (!standalone) return null;
  const isIpad = /\biPad\b/.test(env.userAgent) || (/\bMacintosh\b/.test(env.userAgent) && env.maxTouchPoints > 1);
  return isIpad ? 'ipados' : null;
}

function readStandaloneDisplayEnv(win: Window = window): StandaloneDisplayEnv {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent ?? '',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    displayModeStandalone: typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches,
    navigatorStandalone: nav.standalone === true,
  };
}

/** Sets (or clears) `data-standalone-platform` on the document root. */
export function markStandalonePlatform(doc: Document = document, env: StandaloneDisplayEnv = readStandaloneDisplayEnv()): void {
  const platform = detectStandalonePlatform(env);
  if (platform) doc.documentElement.setAttribute('data-standalone-platform', platform);
  else doc.documentElement.removeAttribute('data-standalone-platform');
}
