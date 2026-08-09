import { describe, expect, it } from 'vitest';
import { KEYBOARD_HINT, commandForKey } from './keyboard';

describe('panning', () => {
  it('moves the view the way the arrow points', () => {
    // ArrowRight moves you rightward along the axis, which pans the camera the
    // other way — the same sign convention as dragging.
    expect(commandForKey('ArrowRight')).toEqual({ kind: 'pan', pixels: -40 });
    expect(commandForKey('ArrowLeft')).toEqual({ kind: 'pan', pixels: 40 });
  });

  it('goes further with Page Up and Page Down', () => {
    expect(commandForKey('PageUp')).toEqual({ kind: 'pan', pixels: 400 });
    expect(commandForKey('PageDown')).toEqual({ kind: 'pan', pixels: -400 });
  });

  it('goes faster with Shift', () => {
    expect(commandForKey('ArrowRight', { shiftKey: true })).toEqual({ kind: 'pan', pixels: -200 });
  });
});

describe('zooming', () => {
  it('accepts arrows and the usual symbols', () => {
    for (const key of ['ArrowUp', '+', '=']) {
      expect(commandForKey(key), key).toEqual({ kind: 'zoom', steps: 1 });
    }
    for (const key of ['ArrowDown', '-', '_']) {
      expect(commandForKey(key), key).toEqual({ kind: 'zoom', steps: -1 });
    }
  });

  it('goes faster with Shift', () => {
    expect(commandForKey('ArrowUp', { shiftKey: true })).toEqual({ kind: 'zoom', steps: 5 });
  });
});

describe('keys the view must not take', () => {
  it('leaves Tab alone, so focus is never trapped', () => {
    expect(commandForKey('Tab')).toBeUndefined();
    expect(commandForKey('Escape')).toBeUndefined();
    expect(commandForKey('Enter')).toBeUndefined();
    expect(commandForKey(' ')).toBeUndefined();
  });

  it('leaves ordinary typing alone', () => {
    for (const key of ['a', 'Z', '7', 'F5']) {
      expect(commandForKey(key), key).toBeUndefined();
    }
  });
});

describe('Home', () => {
  it('resets the view', () => {
    expect(commandForKey('Home')).toEqual({ kind: 'reset' });
  });
});

describe('the hint', () => {
  it('names every key the view actually handles', () => {
    for (const word of ['Arrow', 'plus', 'minus', 'Page Up', 'Home', 'Shift']) {
      expect(KEYBOARD_HINT).toContain(word);
    }
  });
});

describe('tuning', () => {
  it('takes a different step size', () => {
    expect(commandForKey('ArrowLeft', {}, { panStep: 10 })).toEqual({ kind: 'pan', pixels: 10 });
    expect(commandForKey('ArrowUp', { shiftKey: true }, { coarseFactor: 2 })).toEqual({
      kind: 'zoom',
      steps: 2,
    });
  });
});
