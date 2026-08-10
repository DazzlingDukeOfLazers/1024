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

describe('the keys announced and the keys handled are the same set', () => {
  /**
   * `role="application"` tells assistive technology to stop interpreting keys
   * and hand every one to the view. That is the right call for something you
   * pan and zoom, but it is a strong promise: the user gives up their own
   * reading commands in exchange for the ones the `aria-label` names. If the
   * handler and the announcement drift, an AT user has been told about keys
   * that do nothing, and — worse — keys they were not told about have quietly
   * taken over.
   *
   * So the two are held together here. Neither direction is optional.
   */
  const ANNOUNCED: readonly string[] = [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    '+',
    '-',
    'PageUp',
    'PageDown',
    'Home',
    // The unshifted faces of + and -: the same physical keys, and naming them
    // in the hint would be noise rather than information.
    '=',
    '_',
  ];

  it('handles every key the hint mentions', () => {
    for (const key of ANNOUNCED) {
      expect(commandForKey(key), `${key} is announced but does nothing`).toBeDefined();
    }
  });

  it('mentions every key it handles, in words a listener can act on', () => {
    const hint = KEYBOARD_HINT.toLowerCase();
    for (const [key, phrase] of [
      ['ArrowLeft', 'arrow keys'],
      ['ArrowUp', 'arrow keys'],
      ['+', 'plus'],
      ['-', 'minus'],
      ['PageUp', 'page up'],
      ['PageDown', 'page down'],
      ['Home', 'home'],
    ] as const) {
      expect(commandForKey(key), `${key} unhandled`).toBeDefined();
      expect(hint, `${key} is handled but the hint never says so`).toContain(phrase);
    }
    expect(hint).toContain('shift');
    expect(commandForKey('ArrowLeft', { shiftKey: true })).not.toEqual(commandForKey('ArrowLeft'));
  });

  it('takes no key it did not announce', () => {
    // The direction that actually catches drift: a key added to the handler
    // without being announced silently steals it from the screen reader.
    //
    // The universe is *enumerated*, not hand-picked. The first version of this
    // test listed a dozen letters it thought were interesting, and a mutant
    // binding `r` to reset survived it — because `r` was not on the list. A
    // list of keys-that-should-do-nothing is worth exactly the imagination of
    // whoever wrote it, so this generates every printable ASCII character and
    // the named keys a browser is likely to emit, then subtracts the announced
    // set.
    const printable: string[] = [];
    for (let code = 0x20; code <= 0x7e; code += 1) printable.push(String.fromCharCode(code));
    const named = [
      'Tab',
      'Enter',
      'Escape',
      'Backspace',
      'Delete',
      'Insert',
      'End',
      'Shift',
      'Control',
      'Alt',
      'Meta',
      'CapsLock',
      'ContextMenu',
      'Clear',
      'Copy',
      'Paste',
      'Space',
      ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
    ];
    const universe = [...printable, ...named].filter((key) => !ANNOUNCED.includes(key));

    // Anti-vacuity: subtracting the announced set must leave a real universe.
    expect(universe.length).toBeGreaterThan(90);

    for (const key of universe) {
      expect(commandForKey(key), `${key} is swallowed but never announced`).toBeUndefined();
    }
  });

  it('never swallows Tab, so the application region can always be left', () => {
    // The escape hatch that makes `role="application"` survivable. A view that
    // ate Tab would trap a keyboard user inside it with no way out.
    for (const modifiers of [{}, { shiftKey: true }]) {
      expect(commandForKey('Tab', modifiers)).toBeUndefined();
    }
  });
});
