/**
 * A formatted value, carrying the formatter's own verdict on whether the digits
 * shown are all of it.
 *
 * Every formatter in `core/units/format` returns `{ text, exact }`. Using
 * `.text` alone is the easy path and drops the verdict, which is how the
 * Comparator came to print `133.333333333` under a heading that read **Exact
 * value**, and the Representation Lab to print `3.333 × 10^-1 m` under a column
 * headed **Exact**. Both were found by eye, one panel at a time, months apart in
 * effort if not in date.
 *
 * `data-exact` is the fix for that: it makes the verdict *structurally present*
 * in the DOM. `e2e/conformance.spec.ts` asserts that every cell under a label
 * claiming exactness carries it, so dropping the flag in a new panel is a test
 * failure rather than something to notice later. The attribute is for the test;
 * the tag beside it is for the reader.
 *
 * docs/NUMERICS.md §15: marked only when rounded. An "exact" tag would collide
 * with the Comparator's headline "approximate", which is about the inputs rather
 * than the digits — the same two words on two different axes, inches apart.
 */

import { ExactnessTag } from './ExactnessTag';

/** What every formatter returns: the digits, and whether they are all of it. */
export interface RenderedValue {
  readonly text: string;
  readonly exact: boolean;
}

export function Rendered({ value }: { value: RenderedValue }) {
  return (
    <span data-exact={value.exact ? 'true' : 'false'}>
      {value.text}
      {!value.exact && <ExactnessTag exact={false} />}
    </span>
  );
}
