/**
 * Every relative import must name its file in the case the file actually has.
 *
 * Windows and macOS resolve `./exactnessTag` to `ExactnessTag.tsx` without
 * complaint. Linux does not, and CI runs on Linux — so this is a class of
 * breakage that cannot be reproduced on the machine that writes it, and appears
 * only as a red build after a push. `forceConsistentCasingInFileNames` catches a
 * file imported two different ways; it does not catch one imported the wrong way
 * once.
 *
 * `readdirSync` reports the on-disk name in its true case even on a
 * case-insensitive filesystem, which is what makes this checkable from here.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../', import.meta.url);
/**
 * Where imports may point. `fixtures` is here because the catalog and the
 * experiment definitions are imported as JSON from `src`, and leaving it out
 * made the first run report three false failures — the checker has to know the
 * whole of what it is checking against.
 */
const SOURCE_DIRECTORIES = ['src', 'e2e', 'fixtures'];
const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.json', '.css', '/index.ts', '/index.tsx'];
const IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;

function walk(directory: string): string[] {
  return readdirSync(new URL(directory, ROOT), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** Resolve `../a/b` against the importing file, without touching the filesystem. */
function resolveSpecifier(fromFile: string, specifier: string): string {
  const stack: string[] = [];
  for (const part of [...fromFile.split('/').slice(0, -1), ...specifier.split('/')]) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

const ALL_PATHS = new Set(SOURCE_DIRECTORIES.flatMap(walk));
const SOURCES = [...ALL_PATHS].filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'));

const checked: string[] = [];
const unresolved: string[] = [];
for (const source of SOURCES) {
  const contents = readFileSync(new URL(source, ROOT), 'utf8');
  for (const match of contents.matchAll(IMPORT)) {
    const specifier = match[1]!;
    checked.push(`${source} -> ${specifier}`);
    const target = resolveSpecifier(source, specifier);
    if (!CANDIDATE_SUFFIXES.some((suffix) => ALL_PATHS.has(target + suffix))) {
      unresolved.push(`${source} imports '${specifier}', which is no file under that exact name`);
    }
  }
}

describe('relative imports name their files in the right case', () => {
  it('found imports to check, rather than passing on an empty scan', () => {
    expect(SOURCES.length, 'no source files found').toBeGreaterThan(50);
    expect(checked.length, 'no relative imports found').toBeGreaterThan(200);
  });

  it('resolves every one of them', () => {
    expect(unresolved).toEqual([]);
  });

  it('would notice a file that differs only in case', () => {
    // The guard above proves it looked; this proves it can see. `useMeasuredWidth`
    // exists, `usemeasuredwidth` does not, and on this filesystem `require` would
    // happily load either.
    expect(ALL_PATHS.has('src/ui/useMeasuredWidth.ts')).toBe(true);
    expect(ALL_PATHS.has('src/ui/usemeasuredwidth.ts')).toBe(false);
    expect(
      CANDIDATE_SUFFIXES.some((suffix) => ALL_PATHS.has('src/ui/usemeasuredwidth' + suffix)),
    ).toBe(false);
  });
});
