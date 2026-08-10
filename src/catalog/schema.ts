/**
 * Catalog schema and runtime validation.
 *
 * docs/DATA_MODEL.md. Two principles the types enforce rather than suggest:
 *
 * - **Identity is separate from visuals.** `red-blood-cell` is the same object
 *   whatever draws it, so `visuals` is optional and never part of the key.
 * - **Representative size is separate from exact conversion.** A millimetre is
 *   exactly defined; a red blood cell's diameter is a measurement with a range.
 *   Every quantity carries an `approximation` so the UI can never present the
 *   two with the same certainty.
 */

import { type Rational } from '../core/rational/rational';
import { type RationalJSON, fromJSON as rationalFromJSON } from '../core/rational/json';
import { parseRationalExact } from '../core/rational/parse';
import { type DimensionKind, isDimensionKind } from '../core/units/dimensions';
import { requireUnit } from '../core/units/units';
import { type Quantity, fromUnit } from '../core/quantities/quantity';

export const APPROXIMATION_KINDS = ['exact', 'measured', 'representative', 'estimated'] as const;
export type ApproximationKind = (typeof APPROXIMATION_KINDS)[number];

/**
 * Strings that describe a value's provenance *status* rather than name a source.
 * The fixtures used to carry `source: "demonstration value"`, which reads like a
 * citation in every list and table it appears in and is not one.
 */
const UNSOURCED_PLACEHOLDERS = new Set([
  'demonstration value',
  'demonstration',
  'placeholder',
  'tbd',
  'unknown',
  'n/a',
]);

/**
 * Phrases that describe a *consensus* rather than name a source.
 *
 * The whole-string set above catches `source: "TBD"`. It does not catch
 * `"typical of structural biology texts; Arnott & Hukins 1972…"`, where a real
 * citation is wearing a vague qualifier — and TASKS names that exact shape as
 * the thing to reject, because "typical of the literature" is a claim nobody
 * can go and check. Matched anywhere in the string, since the padding can sit
 * on either side of a genuine reference.
 */
const VAGUE_ATTRIBUTIONS = [
  'typical of',
  'commonly cited',
  'commonly quoted',
  'widely cited',
  'widely quoted',
  'generally accepted',
  'textbook value',
  'common knowledge',
  'various sources',
];

export const VISUAL_PROVIDERS = [
  'bundled',
  'noun-project',
  'openmoji',
  'wikimedia',
  'custom',
] as const;
export type VisualProvider = (typeof VISUAL_PROVIDERS)[number];

export interface VisualAsset {
  readonly provider: VisualProvider;
  readonly id?: string;
  readonly path?: string;
  readonly attribution?: string;
}

export interface QuantityRange {
  readonly min: Quantity;
  readonly max: Quantity;
}

export interface CatalogQuantity {
  /** Semantic name, e.g. `diameter`, `height`. */
  readonly key: string;
  readonly dimension: DimensionKind;
  /** Representative value, exact, in canonical SI units. */
  readonly value: Quantity;
  /** Natural variation or measurement spread, where the source has one. */
  readonly range?: QuantityRange;
  readonly approximation: ApproximationKind;
  /** Unit the fixture author wrote, kept for display. */
  readonly declaredUnit: string;
  readonly note?: string;
  readonly source?: string;
  /**
   * The one this object *is*, when it has more than one length.
   *
   * The Atlas positions an object by a single number, the Ruler draws it to
   * scale, and the Comparator compares it. With one length there is nothing to
   * choose. With two there is, and the choice was being made by JSON key order
   * — the first `length` `Object.values` happened to return — which is a
   * decision nobody made about a number three lenses present as the size of the
   * thing. `createCatalog` refuses the ambiguity rather than resolving it.
   */
  readonly primary?: boolean;
}

export interface ObjectRelation {
  readonly type: string;
  readonly targetId: string;
}

export interface ScaleObject {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly quantities: Readonly<Record<string, CatalogQuantity>>;
  readonly categories: readonly string[];
  readonly relations: readonly ObjectRelation[];
  readonly visuals: readonly VisualAsset[];
  /**
   * The band of sizes this object should be offered in, overriding the couple
   * of decades either side of its own size that `bandFor` derives.
   *
   * In metres, and **not** metres per pixel, which is what this field was
   * originally declared as. A `ScaleBand` is a window of object *sizes* — the
   * Atlas builds one from its visible extent, and everything compared against
   * it is an object's own magnitude. A camera resolution is a different
   * quantity, and putting one where a size belongs is wrong by a factor of the
   * viewport width. No fixture ever set it, so nothing ever exercised the
   * mistake.
   */
  readonly semanticDetail?: {
    readonly minMeters?: Rational;
    readonly maxMeters?: Rational;
  };
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

/* -------------------------------------------------------------------------- */
/* Value parsing                                                               */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Accepts either the `{numerator, denominator}` form from docs/DATA_MODEL.md or
 * a plain string such as `"7.5"` or `"3/20"`.
 *
 * The string form is an addition: hand-authoring `7.5 µm` as a fraction of
 * metres is a transcription bug waiting to happen, and the value stays exactly
 * as exact either way.
 */
function parseValue(raw: unknown, context: string): Rational {
  if (typeof raw === 'string') {
    try {
      return parseRationalExact(raw);
    } catch (error) {
      throw new CatalogError(
        `${context}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (isRecord(raw) && typeof raw.numerator === 'string' && typeof raw.denominator === 'string') {
    return rationalFromJSON(raw as unknown as RationalJSON);
  }
  throw new CatalogError(`${context}: expected an exact value, got ${JSON.stringify(raw)}`);
}

function parseQuantity(key: string, raw: unknown, objectId: string): CatalogQuantity {
  const context = `${objectId}.${key}`;
  if (!isRecord(raw)) {
    throw new CatalogError(`${context}: expected an object`);
  }
  if (typeof raw.dimension !== 'string' || !isDimensionKind(raw.dimension)) {
    throw new CatalogError(`${context}: unknown dimension ${String(raw.dimension)}`);
  }
  if (typeof raw.unit !== 'string') {
    throw new CatalogError(`${context}: missing unit`);
  }
  const unit = requireUnit(raw.unit);
  if (unit.dimension !== raw.dimension) {
    throw new CatalogError(
      `${context}: unit ${unit.symbol} is a ${unit.dimension}, not a ${raw.dimension}`,
    );
  }
  if (
    typeof raw.approximation !== 'string' ||
    !(APPROXIMATION_KINDS as readonly string[]).includes(raw.approximation)
  ) {
    throw new CatalogError(
      `${context}: approximation must be one of ${APPROXIMATION_KINDS.join(', ')}`,
    );
  }

  const approximation = raw.approximation as ApproximationKind;
  const source = typeof raw.source === 'string' ? raw.source.trim() : undefined;

  // `exact` and `measured` are claims about the world that a reader could go and
  // check, so they have to say what against. `representative` and `estimated`
  // make no such claim, and an absent source is the honest way to say so — which
  // is why a placeholder in the source field is rejected rather than tolerated:
  // it reads like provenance and is not.
  if (source !== undefined && UNSOURCED_PLACEHOLDERS.has(source.toLowerCase())) {
    throw new CatalogError(
      `${context}: "${source}" is a provenance status, not a source. Leave source out; ` +
        `the approximation kind already says the value is not traceable to a citation.`,
    );
  }
  if (source !== undefined) {
    const vague = VAGUE_ATTRIBUTIONS.find((phrase) => source.toLowerCase().includes(phrase));
    if (vague !== undefined) {
      throw new CatalogError(
        `${context}: "${vague}" describes a consensus, not a source. Name the reference on ` +
          `its own, or leave source out — a reader cannot go and check "${vague}".`,
      );
    }
  }
  if ((approximation === 'exact' || approximation === 'measured') && source === undefined) {
    throw new CatalogError(
      `${context}: ${approximation === 'exact' ? 'an exact' : 'a measured'} value needs a ` +
        `source. Cite it, or call it representative or estimated, which claim less.`,
    );
  }

  const value = fromUnit(parseValue(raw.representative, `${context}.representative`), raw.unit);

  let range: QuantityRange | undefined;
  if (raw.range !== undefined) {
    if (!isRecord(raw.range)) throw new CatalogError(`${context}.range: expected an object`);
    const min = fromUnit(parseValue(raw.range.min, `${context}.range.min`), raw.unit);
    const max = fromUnit(parseValue(raw.range.max, `${context}.range.max`), raw.unit);
    if (min.value.numerator * max.value.denominator > max.value.numerator * min.value.denominator) {
      throw new CatalogError(`${context}.range: min is greater than max`);
    }
    range = { min, max };
  }

  const quantity: CatalogQuantity = {
    key,
    dimension: raw.dimension,
    value,
    approximation,
    declaredUnit: raw.unit,
    ...(range === undefined ? {} : { range }),
    ...(typeof raw.note === 'string' ? { note: raw.note } : {}),
    ...(source === undefined ? {} : { source }),
    ...(raw.primary === true ? { primary: true } : {}),
  };
  return Object.freeze(quantity);
}

function parseVisual(raw: unknown, objectId: string): VisualAsset {
  if (!isRecord(raw) || typeof raw.provider !== 'string') {
    throw new CatalogError(`${objectId}.visuals: expected a provider`);
  }
  if (!(VISUAL_PROVIDERS as readonly string[]).includes(raw.provider)) {
    throw new CatalogError(`${objectId}.visuals: unknown provider ${raw.provider}`);
  }
  return Object.freeze({
    provider: raw.provider as VisualProvider,
    ...(typeof raw.id === 'string' ? { id: raw.id } : {}),
    ...(typeof raw.path === 'string' ? { path: raw.path } : {}),
    ...(typeof raw.attribution === 'string' ? { attribution: raw.attribution } : {}),
  });
}

export function parseScaleObject(raw: unknown): ScaleObject {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    throw new CatalogError(`Object needs an id and a name: ${JSON.stringify(raw)}`);
  }
  // Bind the narrowed id; narrowing a property of a Record does not survive
  // into the callbacks below.
  const id = raw.id;

  if (!isRecord(raw.quantities)) {
    throw new CatalogError(`${id}: expected a quantities map`);
  }

  const quantities: Record<string, CatalogQuantity> = {};
  for (const [key, value] of Object.entries(raw.quantities)) {
    quantities[key] = parseQuantity(key, value, id);
  }
  if (Object.keys(quantities).length === 0) {
    throw new CatalogError(`${id}: an object with no quantities cannot be compared`);
  }

  const semanticDetail = isRecord(raw.semanticDetail)
    ? {
        ...(raw.semanticDetail.minMeters === undefined
          ? {}
          : {
              minMeters: parseValue(raw.semanticDetail.minMeters, `${id}.semanticDetail.minMeters`),
            }),
        ...(raw.semanticDetail.maxMeters === undefined
          ? {}
          : {
              maxMeters: parseValue(raw.semanticDetail.maxMeters, `${id}.semanticDetail.maxMeters`),
            }),
      }
    : undefined;

  return Object.freeze({
    id,
    name: raw.name,
    aliases: Object.freeze(Array.isArray(raw.aliases) ? (raw.aliases as string[]) : []),
    quantities: Object.freeze(quantities),
    categories: Object.freeze(Array.isArray(raw.categories) ? (raw.categories as string[]) : []),
    relations: Object.freeze(
      Array.isArray(raw.relations) ? (raw.relations as ObjectRelation[]) : [],
    ),
    visuals: Object.freeze(
      Array.isArray(raw.visuals) ? raw.visuals.map((visual) => parseVisual(visual, id)) : [],
    ),
    ...(semanticDetail === undefined ? {} : { semanticDetail }),
  });
}

/** True when the value is exactly defined rather than measured or representative. */
export function isExactQuantity(quantity: CatalogQuantity): boolean {
  return quantity.approximation === 'exact' && quantity.range === undefined;
}

/**
 * What backs a number, in one sentence, for anywhere the number is shown.
 *
 * The schema comment above promises the UI can never present an exact value and
 * a plausible one with the same certainty. That promise is only kept if every
 * view actually says which it is, so the sentence lives here rather than being
 * written out again per lens. It takes the two fields it needs rather than a
 * `CatalogQuantity`, so a comparator subject built from a unit literal gets the
 * same sentence from the same code.
 */
export function provenanceSummary(quantity: {
  readonly approximation: ApproximationKind;
  readonly source?: string | undefined;
}): string {
  const kind = {
    exact: 'Exactly defined.',
    measured: 'Measured.',
    representative: 'A representative figure.',
    estimated: 'An estimate.',
  }[quantity.approximation];

  if (quantity.source !== undefined) return `${kind} ${quantity.source}.`;
  // A definition needs no citation beyond being one — "1 mm" is not a plausible
  // round number someone chose. Everything else without a source is.
  if (quantity.approximation === 'exact') return kind;
  return (
    `${kind} No source recorded — a plausible figure chosen to make the scale legible, ` +
    `not traceable to a citation.`
  );
}

/**
 * The object's single length quantity, or `undefined` if it has none.
 *
 * Objects in the v0 catalog carry exactly one length. When that stops being
 * true this needs an explicit `primary` field rather than a guess.
 */
export function primaryLength(object: ScaleObject): CatalogQuantity | undefined {
  const lengths = Object.values(object.quantities).filter(
    (quantity) => quantity.dimension === 'length',
  );
  if (lengths.length <= 1) return lengths[0];
  // With several, only a declared one will do. `createCatalog` refuses an
  // object that has several and declares none, so this cannot silently fall
  // back to whichever key came first — which is what it used to do.
  return lengths.find((quantity) => quantity.primary === true);
}

/** Every length an object carries, primary first. For views that show them all. */
export function allLengths(object: ScaleObject): CatalogQuantity[] {
  const lengths = Object.values(object.quantities).filter(
    (quantity) => quantity.dimension === 'length',
  );
  const primary = primaryLength(object);
  return primary === undefined ? lengths : [primary, ...lengths.filter((one) => one !== primary)];
}
