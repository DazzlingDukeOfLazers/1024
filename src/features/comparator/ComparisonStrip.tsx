/**
 * A simple native-SVG rendering of a comparison result.
 *
 * CLAUDE.md rule 7: rendering coordinates are not physical coordinates. Nothing
 * here passes a physical magnitude into SVG geometry — the ratio is reduced to
 * a bounded fraction of the viewport first, and the conversion to `number`
 * happens only on that bounded value.
 *
 * docs/ARCHITECTURE.md: when the individual items would collapse below a pixel,
 * draw an aggregate strip instead of thousands of invisible circles.
 */

import { type Rational, div, isZero, lt, mul, rational } from '../../core/rational/rational';
import { toNumberForDisplay } from '../../core/rational/log10';
import { ratio as quantityRatio } from '../../core/quantities/quantity';
import { formatEngineering } from '../../core/units/format';
import { type ComparisonResult } from './compare';

const WIDTH = 640;
const HEIGHT = 96;
const MARGIN = 8;
const TRACK = WIDTH - MARGIN * 2;

/** Below this many pixels an item is drawn as part of a strip, not on its own. */
const MIN_ITEM_PIXELS = 3;
/** Never draw more shapes than this, however many items the answer implies. */
const MAX_DRAWN_ITEMS = 200;

/**
 * Convert an exact fraction of the track into pixels. The rational stays exact
 * until it is already bounded by the viewport, so nothing huge reaches `number`.
 */
function toPixels(fraction: Rational): number {
  return toNumberForDisplay(mul(fraction, rational(BigInt(TRACK))));
}

export function ComparisonStrip({ result }: { result: ComparisonResult }) {
  const { a, b } = result;

  // Everything is drawn relative to the larger of the two subjects.
  const aIsLarger = !lt(a.value.value, b.value.value);
  const larger = aIsLarger ? a : b;
  const smaller = aIsLarger ? b : a;

  if (isZero(larger.value.value)) {
    return <p className="lens-question">Nothing to draw at zero size.</p>;
  }

  const smallFraction = quantityRatio(smaller.value, larger.value);
  const smallPixels = toPixels(smallFraction);
  const itemsAcross = isZero(smallFraction)
    ? 0
    : toNumberForDisplay(div(rational(1n), smallFraction));

  const drawIndividually = smallPixels >= MIN_ITEM_PIXELS && itemsAcross <= MAX_DRAWN_ITEMS;
  const drawnCount = Math.max(1, Math.min(Math.floor(itemsAcross), MAX_DRAWN_ITEMS));

  return (
    <>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`${smaller.label} compared with ${larger.label}`}
      >
        <rect
          x={MARGIN}
          y={16}
          width={TRACK}
          height={20}
          rx={3}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.4}
        />
        <text x={MARGIN} y={12} fontSize={10} fill="currentColor" fillOpacity={0.7}>
          {larger.label} — {formatEngineering(larger.value).text}
        </text>

        {drawIndividually ? (
          Array.from({ length: drawnCount }, (_, index) => (
            <rect
              key={index}
              x={MARGIN + index * smallPixels}
              y={52}
              width={Math.max(smallPixels - 1, 0.5)}
              height={20}
              fill="currentColor"
              fillOpacity={0.55}
            />
          ))
        ) : (
          <>
            <rect
              x={MARGIN}
              y={52}
              width={TRACK}
              height={20}
              fill="currentColor"
              fillOpacity={0.25}
            />
            <text x={MARGIN + 4} y={66} fontSize={10} fill="currentColor">
              {smallPixels < MIN_ITEM_PIXELS
                ? 'individual items are below a pixel here'
                : 'too many to draw individually'}
            </text>
          </>
        )}

        <text x={MARGIN} y={88} fontSize={10} fill="currentColor" fillOpacity={0.7}>
          {smaller.label} — {formatEngineering(smaller.value).text}
        </text>
      </svg>

      <p className="lens-question">
        {drawIndividually
          ? `Drawn to scale: ${drawnCount.toLocaleString()} shown.`
          : 'Drawn as an aggregate strip. The count is unchanged — only the rendering collapsed,' +
            ' because individual items would be smaller than a pixel.'}
      </p>
    </>
  );
}
