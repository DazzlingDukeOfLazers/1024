/**
 * Native-SVG ruler grid.
 *
 * A pure renderer: it receives ticks that were positioned by exact camera math
 * and draws them. It performs no physical arithmetic of its own
 * (docs/ARCHITECTURE.md — features and renderers hold no authoritative
 * numerical logic).
 */

import { type GridTick } from '../../camera/grid';
import { estimateTextWidth, keepNonOverlapping } from '../../camera/labels';

export interface RulerGridProps {
  ticks: readonly GridTick[];
  unitSymbol: string;
  width: number;
  height: number;
  /** Vertical position of the ruler baseline. */
  baseline: number;
}

const MAJOR_TICK = 14;
const MINOR_TICK = 6;
const LABEL_FONT_SIZE = 10;
const UNIT_FONT_SIZE = 11;

export function RulerGrid({ ticks, unitSymbol, width, height, baseline }: RulerGridProps) {
  /**
   * Which major ticks get to keep their label.
   *
   * The unit symbol used to share this line and win the collision, which cost
   * the rightmost tick label — on a 420 px screen the ruler showed "-200" and
   * "0" and nothing else. Of the two the tick label is the more useful, so the
   * symbol has moved below the baseline, where nothing else is drawn. It stays
   * beside the axis and no longer competes with it.
   */
  const labelled = new Set(
    keepNonOverlapping(
      ticks.filter((tick) => tick.major),
      (tick) => ({
        x: tick.x + 3,
        width: estimateTextWidth(tick.label ?? '', LABEL_FONT_SIZE),
        anchor: 'start' as const,
      }),
    ).map((tick) => tick.x),
  );

  return (
    <g className="ruler-grid">
      {ticks.map((tick) =>
        tick.major ? (
          <g key={`${tick.meters.numerator}/${tick.meters.denominator}`}>
            <line
              className="gridline"
              x1={tick.x}
              y1={0}
              x2={tick.x}
              y2={height}
              stroke="currentColor"
              strokeOpacity={0.12}
            />
            <line
              className="tick major"
              x1={tick.x}
              y1={baseline - MAJOR_TICK}
              x2={tick.x}
              y2={baseline}
              stroke="currentColor"
              strokeOpacity={0.7}
            />
            {labelled.has(tick.x) && (
              <text
                x={tick.x + 3}
                y={baseline - MAJOR_TICK - 4}
                fontSize={LABEL_FONT_SIZE}
                fill="currentColor"
                fillOpacity={0.75}
              >
                {tick.label}
              </text>
            )}
          </g>
        ) : (
          <line
            key={`${tick.meters.numerator}/${tick.meters.denominator}`}
            className="tick minor"
            x1={tick.x}
            y1={baseline - MINOR_TICK}
            x2={tick.x}
            y2={baseline}
            stroke="currentColor"
            strokeOpacity={0.35}
          />
        ),
      )}

      <line
        x1={0}
        y1={baseline}
        x2={width}
        y2={baseline}
        stroke="currentColor"
        strokeOpacity={0.6}
      />
      <text
        x={width - 4}
        y={baseline + 16}
        fontSize={UNIT_FONT_SIZE}
        fill="currentColor"
        textAnchor="end"
      >
        {unitSymbol}
      </text>
    </g>
  );
}
