/**
 * Versioned, backend-free share state.
 *
 * docs/NUMERICS.md §14 and docs/UI_SPEC.md "Shareability": a discovered
 * numerical failure should be sendable as a link, not as reproduction
 * instructions.
 *
 * Every exact value crosses as a string. The camera centre out at 1e20 m is a
 * rational, and it comes back the identical rational — that is the whole reason
 * this is not `JSON.stringify` with numbers in it.
 *
 * The payload lives in the URL fragment, which browsers never send to a server.
 * Nothing here requires a backend, and nothing here can leak to one.
 */

import { type Rational } from '../core/rational/rational';
import { toCompactString } from '../core/rational/json';
import { parseRationalExact } from '../core/rational/parse';
import { isLensId } from '../ui/lenses';
import {
  COMPARISON_OPERATIONS,
  type ComparisonOperation,
  type SubjectChoice,
} from '../features/comparator/compare';
import { type AppState, defaultAppState, isQ128PresetName } from './appState';
import { DIGIT_WIDTHS, type DigitWidth } from '../core/wide/digits';
import { SCENARIOS, type ScenarioName } from '../core/wide/scenario';
import { DIVISION_ALGORITHMS, type DivisionAlgorithm } from '../core/wide/divide';
import { ShareEncodingError, decodeBase64Url, encodeBase64Url } from './base64url';

function isDigitWidth(value: unknown): value is DigitWidth {
  return typeof value === 'number' && (DIGIT_WIDTHS as readonly number[]).includes(value);
}

function isDivisionAlgorithm(value: unknown): value is DivisionAlgorithm {
  return DIVISION_ALGORITHMS.some((name) => name === value);
}

function isScenarioName(value: unknown): value is ScenarioName {
  return typeof value === 'string' && Object.hasOwn(SCENARIOS, value);
}

export const SHARE_SCHEMA_VERSION = 1;

export class ShareStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareStateError';
  }
}

/* -------------------------------------------------------------------------- */
/* Wire shape                                                                  */
/* -------------------------------------------------------------------------- */

interface SubjectChoiceJSON {
  kind: 'object' | 'unit';
  value: string;
}

interface ShareStateJSON {
  v: number;
  lens: string;
  selected?: string;
  atlas: { centerLog10: number; pixelsPerDecade: number };
  ruler: { presetId: string; centerMeters: string; metersPerPixelLog10: number };
  comparator: {
    a: SubjectChoiceJSON;
    b: SubjectChoiceJSON;
    operation: string;
    countText: string;
  };
  lab: {
    experimentId: string;
    literal: string;
    unit: string;
    displayUnit: string;
    zoomToDisagreement: boolean;
  };
  microscope: { literal: string; unit: string };
  architecture?: {
    aLiteral: string;
    bLiteral: string;
    digitBits: number;
    scenario: string;
    skipZeroDigits: boolean;
    divisionStep?: number;
    divisionAlgorithm?: string;
  };
  representations: { q128Preset: string };
}

function subjectToJSON(choice: SubjectChoice): SubjectChoiceJSON {
  return choice.kind === 'object'
    ? { kind: 'object', value: choice.id }
    : { kind: 'unit', value: choice.symbol };
}

function subjectFromJSON(json: unknown, fallback: SubjectChoice): SubjectChoice {
  if (typeof json !== 'object' || json === null) return fallback;
  const record = json as Partial<SubjectChoiceJSON>;
  if (typeof record.value !== 'string') return fallback;
  return record.kind === 'unit'
    ? { kind: 'unit', symbol: record.value }
    : { kind: 'object', id: record.value };
}

/* -------------------------------------------------------------------------- */
/* Encode                                                                      */
/* -------------------------------------------------------------------------- */

export function stateToJSON(state: AppState): ShareStateJSON {
  const json: ShareStateJSON = {
    v: SHARE_SCHEMA_VERSION,
    lens: state.lens,
    atlas: {
      centerLog10: state.atlas.camera.centerLog10,
      pixelsPerDecade: state.atlas.camera.pixelsPerDecade,
    },
    ruler: {
      presetId: state.ruler.presetId,
      // The exact centre, as a string. This is the field the whole feature
      // exists for: 1e20 m + 1 mm must come back as itself.
      centerMeters: toCompactString(state.ruler.camera.centerMeters),
      metersPerPixelLog10: state.ruler.camera.metersPerPixelLog10,
    },
    comparator: {
      a: subjectToJSON(state.comparator.a),
      b: subjectToJSON(state.comparator.b),
      operation: state.comparator.operation,
      countText: state.comparator.countText,
    },
    lab: { ...state.lab },
    microscope: { ...state.microscope },
    architecture: { ...state.architecture },
    representations: { ...state.representations },
  };
  return state.selectedObjectId === undefined
    ? json
    : { ...json, selected: state.selectedObjectId };
}

export function encodeShareState(state: AppState): string {
  return `${SHARE_SCHEMA_VERSION}.${encodeBase64Url(JSON.stringify(stateToJSON(state)))}`;
}

/** The fragment to append to a page URL, `#` included. */
export function shareFragment(state: AppState): string {
  return `#${encodeShareState(state)}`;
}

export function shareUrl(baseUrl: string, state: AppState): string {
  const withoutFragment = baseUrl.split('#')[0] ?? baseUrl;
  return `${withoutFragment}${shareFragment(state)}`;
}

/* -------------------------------------------------------------------------- */
/* Decode                                                                      */
/* -------------------------------------------------------------------------- */

/** Display-state numbers fall back rather than failing; see `stateFromJSON`. */
function requireFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function requireString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function requireRational(value: unknown, field: string): Rational {
  if (typeof value !== 'string') {
    throw new ShareStateError(`${field} must be an exact value encoded as a string`);
  }
  try {
    return parseRationalExact(value);
  } catch (error) {
    throw new ShareStateError(
      `${field} is not an exact value: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Rebuild state from a payload.
 *
 * Unknown or malformed *optional* fields fall back to the default rather than
 * failing the whole restore — a link that half-works beats a blank page. The
 * exact values are not optional: a corrupt camera centre is an error, because
 * silently substituting a different number is exactly the failure this project
 * is about.
 */
export function stateFromJSON(json: unknown): AppState {
  if (typeof json !== 'object' || json === null) {
    throw new ShareStateError('Share payload is not an object');
  }
  const record = json as Partial<ShareStateJSON>;
  if (record.v !== SHARE_SCHEMA_VERSION) {
    throw new ShareStateError(
      `Unsupported share schema version ${String(record.v)}; this build understands ${SHARE_SCHEMA_VERSION}`,
    );
  }

  const defaults = defaultAppState();
  const lens =
    typeof record.lens === 'string' && isLensId(record.lens) ? record.lens : defaults.lens;
  const operationText = record.comparator?.operation;
  const operation: ComparisonOperation =
    typeof operationText === 'string' &&
    (COMPARISON_OPERATIONS as readonly string[]).includes(operationText)
      ? (operationText as ComparisonOperation)
      : defaults.comparator.operation;
  const q128Preset = record.representations?.q128Preset;

  const state: AppState = {
    lens,
    atlas: {
      camera: {
        centerLog10: requireFiniteNumber(
          record.atlas?.centerLog10,
          defaults.atlas.camera.centerLog10,
        ),
        pixelsPerDecade: requireFiniteNumber(
          record.atlas?.pixelsPerDecade,
          defaults.atlas.camera.pixelsPerDecade,
        ),
      },
    },
    ruler: {
      presetId: requireString(record.ruler?.presetId, defaults.ruler.presetId),
      camera: {
        centerMeters: requireRational(record.ruler?.centerMeters, 'ruler.centerMeters'),
        metersPerPixelLog10: requireFiniteNumber(
          record.ruler?.metersPerPixelLog10,
          defaults.ruler.camera.metersPerPixelLog10,
        ),
      },
    },
    comparator: {
      a: subjectFromJSON(record.comparator?.a, defaults.comparator.a),
      b: subjectFromJSON(record.comparator?.b, defaults.comparator.b),
      operation,
      countText: requireString(record.comparator?.countText, defaults.comparator.countText),
    },
    lab: {
      experimentId: requireString(record.lab?.experimentId, defaults.lab.experimentId),
      literal: requireString(record.lab?.literal, defaults.lab.literal),
      unit: requireString(record.lab?.unit, defaults.lab.unit),
      displayUnit: requireString(record.lab?.displayUnit, defaults.lab.displayUnit),
      zoomToDisagreement:
        typeof record.lab?.zoomToDisagreement === 'boolean'
          ? record.lab.zoomToDisagreement
          : defaults.lab.zoomToDisagreement,
    },
    microscope: {
      literal: requireString(record.microscope?.literal, defaults.microscope.literal),
      unit: requireString(record.microscope?.unit, defaults.microscope.unit),
    },
    // Absent in links written before the architecture lens existed, which is
    // why it decodes to the default rather than refusing: a v1 payload is still
    // a valid v1 payload (docs/NUMERICS.md §14).
    architecture: {
      aLiteral: requireString(record.architecture?.aLiteral, defaults.architecture.aLiteral),
      bLiteral: requireString(record.architecture?.bLiteral, defaults.architecture.bLiteral),
      digitBits: isDigitWidth(record.architecture?.digitBits)
        ? record.architecture.digitBits
        : defaults.architecture.digitBits,
      scenario: isScenarioName(record.architecture?.scenario)
        ? record.architecture.scenario
        : defaults.architecture.scenario,
      skipZeroDigits:
        typeof record.architecture?.skipZeroDigits === 'boolean'
          ? record.architecture.skipZeroDigits
          : defaults.architecture.skipZeroDigits,
      // How many steps exist depends on the operands, so a shared position can
      // be past the end of the division it lands in. The panel clamps; the
      // decoder only guarantees a non-negative whole number.
      divisionStep: Math.max(
        0,
        Math.floor(requireFiniteNumber(record.architecture?.divisionStep, 0)),
      ),
      divisionAlgorithm: isDivisionAlgorithm(record.architecture?.divisionAlgorithm)
        ? record.architecture.divisionAlgorithm
        : defaults.architecture.divisionAlgorithm,
    },
    representations: {
      q128Preset:
        typeof q128Preset === 'string' && isQ128PresetName(q128Preset)
          ? q128Preset
          : defaults.representations.q128Preset,
    },
  };

  return typeof record.selected === 'string'
    ? { ...state, selectedObjectId: record.selected }
    : state;
}

export function decodeShareState(encoded: string): AppState {
  const separator = encoded.indexOf('.');
  if (separator <= 0) {
    throw new ShareStateError('Share payload is missing its version prefix');
  }
  const version = Number(encoded.slice(0, separator));
  if (version !== SHARE_SCHEMA_VERSION) {
    throw new ShareStateError(
      `Unsupported share schema version ${encoded.slice(0, separator)}; this build understands ${SHARE_SCHEMA_VERSION}`,
    );
  }

  const text = decodeBase64Url(encoded.slice(separator + 1));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ShareStateError('Share payload is not valid JSON');
  }
  return stateFromJSON(parsed);
}

/**
 * Read state from a URL fragment, or `undefined` when there is none.
 *
 * A malformed fragment throws: quietly loading a different view than the link
 * described would be worse than saying so.
 */
export function stateFromFragment(fragment: string): AppState | undefined {
  const payload = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (payload.length === 0) return undefined;
  return decodeShareState(payload);
}

export { ShareEncodingError };
