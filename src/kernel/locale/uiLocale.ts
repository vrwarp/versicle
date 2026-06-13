/**
 * UI-locale resolution (Phase 8 §F; docs/adr/0001-i18n-strategy.md §3/§4).
 *
 * THE two-locale rule: the value resolved here governs CHROME — formatter
 * output (kernel/locale/format.ts), collation, `document.documentElement.lang`.
 * It never governs content: `book.language` keeps driving segmentation,
 * voices, pinyin/OpenCC and content `lang=` attributes, and neither side
 * may substitute for the other.
 *
 * Resolution order: per-device override (localStorage — NOT the CRDT; it
 * must be readable before the Y.Doc loads, for boot-path strings) →
 * `navigator.language` → `'en'`. No UI picker ships yet (English-only per
 * the ADR); the override slot exists so the eventual picker is a write to
 * one key, not a new mechanism.
 *
 * Plain TS module (worker-safe): all browser globals are feature-checked.
 */

/** localStorage key for the per-device UI-locale override. */
export const UI_LOCALE_STORAGE_KEY = 'versicle-ui-locale';

const FALLBACK_LOCALE = 'en';

type LocaleListener = (locale: string) => void;

const listeners = new Set<LocaleListener>();

let cachedLocale: string | null = null;

function readOverride(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const value = localStorage.getItem(UI_LOCALE_STORAGE_KEY);
    return value && value.trim() ? value.trim() : null;
  } catch {
    // Storage access can throw (privacy modes); the fallback chain covers it.
    return null;
  }
}

function isValidLocale(tag: string): boolean {
  try {
    new Intl.Locale(tag);
    return true;
  } catch {
    return false;
  }
}

/**
 * The resolved UI locale (BCP 47 tag). Cached after first resolution;
 * {@link setUILocale} is the only invalidator.
 */
export function getUILocale(): string {
  if (cachedLocale) return cachedLocale;
  const override = readOverride();
  if (override && isValidLocale(override)) {
    cachedLocale = override;
  } else if (typeof navigator !== 'undefined' && navigator.language && isValidLocale(navigator.language)) {
    cachedLocale = navigator.language;
  } else {
    cachedLocale = FALLBACK_LOCALE;
  }
  return cachedLocale;
}

/**
 * Set (or clear, with `null`) the per-device override and notify
 * subscribers (formatter caches, `documentElement.lang`).
 */
export function setUILocale(locale: string | null): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (locale) localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
      else localStorage.removeItem(UI_LOCALE_STORAGE_KEY);
    }
  } catch {
    // Best-effort persistence; the in-memory value still updates.
  }
  cachedLocale = null;
  const resolved = getUILocale();
  for (const listener of listeners) listener(resolved);
}

/** Subscribe to UI-locale changes. Returns the unsubscribe function. */
export function onUILocaleChange(listener: LocaleListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Sets `document.documentElement.lang` from the resolved UI locale and
 * keeps it in sync on change (replacing the static `lang="en"` semantics
 * of index.html — the static attribute remains as the pre-boot default).
 * Composition wiring: called once by `registerAppBootTasks()`.
 */
export function applyDocumentLanguage(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (!doc) return;
  doc.documentElement.lang = getUILocale();
  onUILocaleChange((locale) => {
    doc.documentElement.lang = locale;
  });
}

/** Test seam: drop the cached resolution (does not touch storage). */
export function resetUILocaleCacheForTests(): void {
  cachedLocale = null;
}
