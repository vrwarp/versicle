/**
 * KeyboardShortcutService unit matrix (Phase 8 §E): scope stack,
 * when()-fall-through, built-in guards (repeat / typing / Space-on-control
 * / Escape-overlay ordering), dev collision error, unregister.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KeyboardShortcutService } from './KeyboardShortcutService';

function makeKeyEvent(key: string, init: Partial<KeyboardEventInit> & { target?: Element | null } = {}): KeyboardEvent {
  const { target, ...eventInit } = init;
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...eventInit });
  if (target !== undefined) {
    Object.defineProperty(event, 'target', { value: target, configurable: true });
  }
  return event;
}

describe('KeyboardShortcutService', () => {
  let service: KeyboardShortcutService;

  beforeEach(() => {
    service = new KeyboardShortcutService();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('dispatches to the matching registration and stops (one action per keypress)', () => {
    const global = vi.fn();
    const reader = vi.fn();
    service.register({ id: 'g.x', key: 'x', scope: 'global', handler: global });
    service.register({ id: 'r.x', key: 'x', scope: 'reader', handler: reader });

    service.handleKeyEvent(makeKeyEvent('x'));

    expect(reader).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
  });

  it('scope stack: tts-active beats reader beats global; a false when() falls through', () => {
    const calls: string[] = [];
    let ttsActive = true;
    service.register({ id: 'g', key: 'ArrowRight', scope: 'global', handler: () => calls.push('global') });
    service.register({ id: 'r', key: 'ArrowRight', scope: 'reader', handler: () => calls.push('reader') });
    service.register({ id: 't', key: 'ArrowRight', scope: 'tts-active', when: () => ttsActive, handler: () => calls.push('tts') });

    service.handleKeyEvent(makeKeyEvent('ArrowRight'));
    expect(calls).toEqual(['tts']);

    ttsActive = false;
    service.handleKeyEvent(makeKeyEvent('ArrowRight'));
    expect(calls).toEqual(['tts', 'reader']);
  });

  it('preventDefault is per-registration', () => {
    service.register({ id: 'pd', key: 'ArrowLeft', scope: 'reader', preventDefault: true, handler: () => {} });
    service.register({ id: 'no-pd', key: 'ArrowRight', scope: 'reader', handler: () => {} });

    const left = makeKeyEvent('ArrowLeft');
    const right = makeKeyEvent('ArrowRight');
    service.handleKeyEvent(left);
    service.handleKeyEvent(right);

    expect(left.defaultPrevented).toBe(true);
    expect(right.defaultPrevented).toBe(false);
  });

  it('unregister removes the registration', () => {
    const handler = vi.fn();
    const unregister = service.register({ id: 'u', key: 'u', scope: 'global', handler });
    unregister();
    service.handleKeyEvent(makeKeyEvent('u'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('DEV collision: duplicate (key, scope) throws', () => {
    service.register({ id: 'one', key: 'k', scope: 'reader', handler: () => {} });
    expect(() =>
      service.register({ id: 'two', key: 'k', scope: 'reader', handler: () => {} }),
    ).toThrowError(/duplicate registration/);
    // Same key in a DIFFERENT scope is the designed coexistence.
    expect(() =>
      service.register({ id: 'three', key: 'k', scope: 'tts-active', handler: () => {} }),
    ).not.toThrow();
  });

  describe('built-in policies (absorbed from the two deleted registries)', () => {
    it('ignores key auto-repeat', () => {
      const handler = vi.fn();
      service.register({ id: 'rep', key: 'ArrowRight', scope: 'reader', handler });
      service.handleKeyEvent(makeKeyEvent('ArrowRight', { repeat: true }));
      expect(handler).not.toHaveBeenCalled();
    });

    it('ignores keys while typing in an input / textarea / contenteditable', () => {
      const handler = vi.fn();
      service.register({ id: 'typing', key: 'ArrowRight', scope: 'reader', handler });

      const input = document.createElement('input');
      const textarea = document.createElement('textarea');
      const editable = document.createElement('div');
      Object.defineProperty(editable, 'isContentEditable', { value: true });
      document.body.append(input, textarea, editable);

      for (const target of [input, textarea, editable]) {
        service.handleKeyEvent(makeKeyEvent('ArrowRight', { target }));
      }
      expect(handler).not.toHaveBeenCalled();

      service.handleKeyEvent(makeKeyEvent('ArrowRight', { target: document.body }));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('Space never fires when a focusable interactive control has focus', () => {
      const handler = vi.fn();
      service.register({ id: 'space', key: ' ', scope: 'tts-active', handler });

      const button = document.createElement('button');
      document.body.appendChild(button);

      const onButton = makeKeyEvent(' ', { target: button });
      service.handleKeyEvent(onButton);
      expect(handler).not.toHaveBeenCalled();
      // The control keeps its own Space activation (no preventDefault).
      expect(onButton.defaultPrevented).toBe(false);

      service.handleKeyEvent(makeKeyEvent(' ', { target: document.body }));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('Escape resolves the top-most OPEN overlay before tts-active may act', () => {
      const stop = vi.fn();
      service.register({ id: 'esc', key: 'Escape', scope: 'tts-active', handler: stop });

      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('data-state', 'open');
      document.body.appendChild(dialog);

      service.handleKeyEvent(makeKeyEvent('Escape', { target: document.body }));
      expect(stop).not.toHaveBeenCalled();

      // A closing (animating-out) overlay no longer owns Escape.
      dialog.setAttribute('data-state', 'closed');
      service.handleKeyEvent(makeKeyEvent('Escape', { target: document.body }));
      expect(stop).toHaveBeenCalledTimes(1);
    });

    it('Escape with an open Radix popper content honors the popper, closed content does not', () => {
      const stop = vi.fn();
      service.register({ id: 'esc2', key: 'Escape', scope: 'tts-active', handler: stop });

      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-radix-popper-content-wrapper', '');
      const content = document.createElement('div');
      content.setAttribute('data-state', 'open');
      wrapper.appendChild(content);
      document.body.appendChild(wrapper);

      service.handleKeyEvent(makeKeyEvent('Escape', { target: document.body }));
      expect(stop).not.toHaveBeenCalled();

      content.setAttribute('data-state', 'closed');
      service.handleKeyEvent(makeKeyEvent('Escape', { target: document.body }));
      expect(stop).toHaveBeenCalledTimes(1);
    });

    it('non-Escape keys are NOT blocked by an open overlay (arrows keep working over dialogs)', () => {
      const handler = vi.fn();
      service.register({ id: 'arrows', key: 'ArrowRight', scope: 'tts-active', handler });

      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('data-state', 'open');
      document.body.appendChild(dialog);

      service.handleKeyEvent(makeKeyEvent('ArrowRight', { target: document.body }));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  it('help-sheet surface: getRegistrations snapshot is stable and subscription fires on change', () => {
    const listener = vi.fn();
    service.subscribe(listener);

    const before = service.getRegistrations();
    expect(service.getRegistrations()).toBe(before); // referential stability

    const unregister = service.register({ id: 'h', key: 'h', scope: 'global', handler: () => {}, descriptionKey: 'shortcuts.help.open' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(service.getRegistrations().map((r) => r.id)).toContain('h');

    unregister();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
