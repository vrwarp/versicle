/**
 * Ambient vendor-prefix / nonstandard-platform surface (P9 any-ratchet).
 *
 * The ONE place legacy vendor globals are typed, so call sites read
 * `window.webkitAudioContext` instead of casting through `any`. Append-only;
 * each entry names its consumer.
 */
interface Window {
  /**
   * Safari < 14.1 ships AudioContext under the webkit prefix only
   * (AudioElementPlayer, WebSpeechProvider, CapacitorTTSProvider unlock
   * silent-audio contexts through it).
   */
  webkitAudioContext?: typeof AudioContext;
}
