/**
 * Whether the digits on screen are the value, or a reading of it.
 *
 * CLAUDE.md rule 2: display formatting may round for humans, but it may not
 * pretend it did not. Every formatter in `core/units/format` already returns an
 * `exact` flag beside its text; this is the one way that flag is shown, so two
 * lenses cannot end up saying different things about the same rounding.
 *
 * It lived inside the Representation Lab until the Comparator was found
 * rendering 400/3 as "133.333333333" under a heading that read "Exact value",
 * with the formatter's own flag thrown away.
 */

export function ExactnessTag({ exact }: { exact: boolean }) {
  return (
    <span className={exact ? 'tag tag-exact' : 'tag tag-rounded'}>
      {exact ? 'exact' : 'rounded'}
    </span>
  );
}
