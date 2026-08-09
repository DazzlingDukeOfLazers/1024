import { describe, expect, it } from 'vitest';
import {
  SHARE_SCHEMA_VERSION,
  ShareStateError,
  decodeShareState,
  encodeShareState,
  shareFragment,
  shareUrl,
  stateFromFragment,
  stateFromJSON,
  stateToJSON,
} from './url';
import { decodeBase64Url, encodeBase64Url } from './base64url';
import { type AppState, defaultAppState } from './appState';
import { ONE, add, equals, mul, pow10, rational } from '../core/rational/rational';
import { parseDecimalExact } from '../core/rational/parse';
import { createCamera } from '../camera/camera';

const r = rational;

function roundTrip(state: AppState): AppState {
  return decodeShareState(encodeShareState(state));
}

describe('base64url', () => {
  it('round-trips ordinary text', () => {
    expect(decodeBase64Url(encodeBase64Url('hello'))).toBe('hello');
  });

  it('survives the characters this app actually uses', () => {
    // µm and × appear all over the UI; latin1-only btoa would mangle them.
    const text = '7.5 µm × 10^-6 — 1/3';
    expect(decodeBase64Url(encodeBase64Url(text))).toBe(text);
  });

  it('produces URL-safe output', () => {
    for (let i = 0; i < 200; i += 1) {
      const encoded = encodeBase64Url(`payload-${i}-µ${'x'.repeat(i % 7)}`);
      expect(encoded).not.toMatch(/[+/=]/);
    }
  });

  it('rejects a payload that is not base64 at all', () => {
    expect(() => decodeBase64Url('!!!!')).toThrow();
  });
});

describe('the default state round-trips', () => {
  it('comes back identical', () => {
    const state = defaultAppState();
    expect(roundTrip(state)).toEqual(state);
  });

  it('carries a version prefix a future build could refuse', () => {
    expect(encodeShareState(defaultAppState()).startsWith(`${SHARE_SCHEMA_VERSION}.`)).toBe(true);
    expect(stateToJSON(defaultAppState()).v).toBe(SHARE_SCHEMA_VERSION);
  });
});

describe('the large-offset disagreement view', () => {
  // The acceptance criterion from docs/IMPLEMENTATION_PLAN.md.
  const centerMeters = add(pow10(20), parseDecimalExact('0.001'));
  const state: AppState = {
    ...defaultAppState(),
    lens: 'lab',
    lab: { ...defaultAppState().lab, experimentId: 'large-offset' },
    ruler: { presetId: 'far-origin', camera: createCamera(centerMeters, -5) },
  };

  it('restores without numerical loss', () => {
    const restored = roundTrip(state);
    expect(restored.ruler.camera.centerMeters).toEqual(centerMeters);
    expect(equals(restored.ruler.camera.centerMeters, centerMeters)).toBe(true);
    expect(restored.lens).toBe('lab');
    expect(restored.lab.experimentId).toBe('large-offset');
  });

  it('keeps the millimetre that made the view interesting', () => {
    const restored = roundTrip(state);
    // Subtracting the origin from the restored centre still finds the mm.
    const millimetre = parseDecimalExact('0.001');
    expect(equals(restored.ruler.camera.centerMeters, add(pow10(20), millimetre))).toBe(true);
    expect(restored.ruler.camera.centerMeters.denominator).toBe(1000n);
  });

  it('would have lost it through a JSON number', () => {
    // Why the centre is a string on the wire: the same value as a double is
    // exactly 1e20, and the millimetre is gone before it reaches the URL.
    const asNumber = JSON.parse(JSON.stringify({ centre: 1e20 + 0.001 })) as { centre: number };
    expect(asNumber.centre).toBe(1e20);
  });

  it('encodes the centre as a string, not a number', () => {
    const json = stateToJSON(state) as unknown as { ruler: { centerMeters: unknown } };
    expect(typeof json.ruler.centerMeters).toBe('string');
    expect(json.ruler.centerMeters).toBe('100000000000000000000001/1000');
  });
});

describe('exact values of every awkward shape', () => {
  const centres = [
    r(0n),
    ONE,
    r(-1n, 3n),
    parseDecimalExact('0.1'),
    pow10(-40),
    pow10(60),
    mul(pow10(200), r(7n, 9n)),
    r(2n ** 300n, 3n ** 40n),
  ];

  it('survives the trip unchanged', () => {
    for (const centerMeters of centres) {
      const state: AppState = {
        ...defaultAppState(),
        ruler: { presetId: 'custom', camera: createCamera(centerMeters, -3) },
      };
      expect(roundTrip(state).ruler.camera.centerMeters).toEqual(centerMeters);
    }
  });

  it('keeps negative and fractional centres exact', () => {
    const state: AppState = {
      ...defaultAppState(),
      ruler: { presetId: 'custom', camera: createCamera(r(-22n, 7n), 0) },
    };
    expect(roundTrip(state).ruler.camera.centerMeters).toEqual(r(-22n, 7n));
  });
});

describe('everything else in the view', () => {
  const state: AppState = {
    lens: 'comparator',
    selectedObjectId: 'coconut',
    atlas: { camera: { centerLog10: -6.25, pixelsPerDecade: 37.5 } },
    ruler: { presetId: 'human-scale', camera: createCamera(r(3n, 2n), -1.5) },
    comparator: {
      a: { kind: 'object', id: 'coconut' },
      b: { kind: 'unit', symbol: 'µm' },
      operation: 'end-to-end',
      countText: '123',
    },
    lab: { experimentId: 'thirds', literal: '1/7', unit: 'km', displayUnit: 'nm' },
    representations: { q128Preset: 'mm' },
  };

  it('round-trips every field', () => {
    expect(roundTrip(state)).toEqual(state);
  });

  it('carries the selection', () => {
    expect(roundTrip(state).selectedObjectId).toBe('coconut');
    expect(roundTrip({ ...state, selectedObjectId: undefined }).selectedObjectId).toBeUndefined();
  });

  it('carries the Q128.128 machine base unit, which is not a display setting', () => {
    // docs/NUMERICS.md §5: changing this changes the machine.
    expect(roundTrip(state).representations.q128Preset).toBe('mm');
  });

  it('carries a unit subject as a symbol and an object subject as an id', () => {
    const restored = roundTrip(state);
    expect(restored.comparator.b).toEqual({ kind: 'unit', symbol: 'µm' });
    expect(restored.comparator.a).toEqual({ kind: 'object', id: 'coconut' });
  });
});

describe('the fragment', () => {
  it('is a fragment, so no server ever sees it', () => {
    const fragment = shareFragment(defaultAppState());
    expect(fragment.startsWith('#')).toBe(true);
    expect(fragment).not.toContain('?');
  });

  it('replaces any fragment already on the URL', () => {
    const url = shareUrl('https://example.test/app#stale', defaultAppState());
    expect(url.startsWith('https://example.test/app#')).toBe(true);
    expect(url).not.toContain('#stale');
    expect(url.split('#').length).toBe(2);
  });

  it('reads back from a fragment with or without the hash', () => {
    const state = defaultAppState();
    const encoded = encodeShareState(state);
    expect(stateFromFragment(`#${encoded}`)).toEqual(state);
    expect(stateFromFragment(encoded)).toEqual(state);
  });

  it('reports no state for an empty fragment', () => {
    expect(stateFromFragment('')).toBeUndefined();
    expect(stateFromFragment('#')).toBeUndefined();
  });
});

describe('refusals', () => {
  it('refuses a payload from a future schema', () => {
    const encoded = encodeShareState(defaultAppState());
    const future = `99.${encoded.split('.')[1]}`;
    expect(() => decodeShareState(future)).toThrow(/Unsupported share schema version 99/);
  });

  it('refuses a payload with no version prefix', () => {
    expect(() => decodeShareState('abcdef')).toThrow(ShareStateError);
  });

  it('refuses a payload that is not JSON', () => {
    expect(() => decodeShareState(`1.${encodeBase64Url('not json')}`)).toThrow(/not valid JSON/);
  });

  it('refuses a camera centre that is not an exact value', () => {
    // Silently substituting a different number is the one failure this whole
    // project exists to prevent, so a corrupt exact value is fatal.
    const json = stateToJSON(defaultAppState()) as unknown as Record<string, unknown>;
    const broken = { ...json, ruler: { ...(json.ruler as object), centerMeters: 1e20 } };
    expect(() => stateFromJSON(broken)).toThrow(/must be an exact value/);

    const unparseable = { ...json, ruler: { ...(json.ruler as object), centerMeters: 'zzz' } };
    expect(() => stateFromJSON(unparseable)).toThrow(/not an exact value/);
  });

  it('falls back rather than failing on an unknown lens or operation', () => {
    // A half-working link beats a blank page, for fields where a default is
    // harmless. Exact values are the exception above.
    const json = stateToJSON(defaultAppState()) as unknown as Record<string, unknown>;
    const odd = {
      ...json,
      lens: 'holodeck',
      comparator: { ...(json.comparator as object), operation: 'vibes' },
      representations: { q128Preset: 'furlongs' },
    };
    const restored = stateFromJSON(odd);
    expect(restored.lens).toBe('atlas');
    expect(restored.comparator.operation).toBe('how-many-fit');
    expect(restored.representations.q128Preset).toBe('m');
  });
});

describe('payload size', () => {
  it('stays comfortably inside what a URL can carry', () => {
    const state: AppState = {
      ...defaultAppState(),
      ruler: {
        presetId: 'far-origin',
        camera: createCamera(add(pow10(20), parseDecimalExact('0.001')), -5),
      },
    };
    expect(encodeShareState(state).length).toBeLessThan(1000);
  });
});
