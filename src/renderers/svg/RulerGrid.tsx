/**
 * Native-SVG ruler grid.
 *
 * A pure renderer: it receives ticks that were positioned by exact camera math
 * and draws them. It performs no physical arithmetic of its own
 * (docs/ARCHITECTURE.md — features and renderers hold no authoritative
 * numerical logic).
 */

import { type GridTick } from '../../camera/grid';

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

export function RulerGrid({ ticks, unitSymbol, width, height, baseline }: RulerGridProps) {
  return (
    <g className="ruler-grid">
      {ticks.map((tick) =>
        tick.major ? (
          <g key={`${tick.meters.numerator}/${tick.meters.denominator}`}>
            <line
              x1={tick.x}
              y1={0}
              x2={tick.x}
              y2={height}
              stroke="currentColor"
              strokeOpacity={0.12}
            />
            <line
              x1={tick.x}
              y1={baseline - MAJOR_TICK}
              x2={tick.x}
              y2={baseline}
              stroke="currentColor"
              strokeOpacity={0.7}
            />
            <text
              x={tick.x + 3}
              y={baseline - MAJOR_TICK - 4}
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.75}
            >
              {tick.label}
            </text>
          </g>
        ) : (
          <line
            key={`${tick.meters.numerator}/${tick.meters.denominator}`}
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
        y={baseline - MAJOR_TICK - 4}
        fontSize={11}
        fill="currentColor"
        textAnchor="end"
      >
        {unitSymbol}
      </text>
    </g>
  );
}
