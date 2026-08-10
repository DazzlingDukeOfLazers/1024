/**
 * Characters that are in the source and cannot be seen.
 *
 * Three arrived in a single day, all from writing a file rather than typing it,
 * and every one survived the whole gate:
 *
 * - a **NUL** in the middle of a string literal, where a space was meant. It
 *   typechecked, linted, formatted and passed every test, because a NUL is a
 *   perfectly good separator. Only ripgrep refusing to search the file as text
 *   gave it away.
 * - a **U+2028 LINE SEPARATOR** inside JSX, again where a space was meant. Also
 *   clean through every gate; found because a string replacement that should
 *   have matched did not, three times in a row.
 * - a second NUL, in the script written to fix the first two.
 *
 * None of these is a typo a person makes. They are the kind of damage that gets
 * committed, sits there, and surfaces later as "why does this line break" —
 * U+2028 is a line terminator to some parsers and invisible to the eye.
 *
 * Hence a test. It is cheap, it runs over every file the project ships, and it
 * is the only thing in the suite that would have caught any of them.
 *
 * **The characters are built from their codes, never written.** Spelling them
 * out — even as escapes — is how the third one got in: the escape was typed and
 * a literal control character was what landed. `String.fromCharCode` keeps this
 * file to printable ASCII, so it cannot fail its own rule by existing.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url);

/** Characters with no business in this project's source. */
const FORBIDDEN: ReadonlyArray<readonly [string, string]> = [
  [String.fromCharCode(0), 'NUL'],
  [String.fromCharCode(0x2028), 'U+2028 LINE SEPARATOR'],
  [String.fromCharCode(0x2029), 'U+2029 PARAGRAPH SEPARATOR'],
  [String.fromCharCode(0x200b), 'U+200B ZERO WIDTH SPACE'],
  // Not U+00A0. A non-breaking space is occasionally deliberate in prose, and a
  // rule that cried wolf would be the rule someone turns off.
];

const EXTENSIONS = ['.ts', '.tsx', '.css', '.json', '.md', '.py', '.yml', '.html'];
const SKIP = new Set(['node_modules', 'dist', 'shots', 'test-results', 'playwright-report']);

/**
 * URLs rather than strings, and read as URLs.
 *
 * `URL.pathname` is `/C:/Users/...` on Windows, and handing that to
 * `readFileSync` produces `C:\C:\Users\...` — the file is not found and the
 * test fails as an error rather than a finding, which is a very confusing way
 * for a scanner to report a clean tree. `node:fs` takes a `URL` directly.
 */
function sourceFiles(directory: URL, into: URL[] = []): URL[] {
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry) || entry.startsWith('.')) continue;
    const path = new URL(entry, directory);
    if (statSync(path).isDirectory()) {
      sourceFiles(new URL(`${entry}/`, directory), into);
    } else if (EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      into.push(path);
    }
  }
  return into;
}

describe('the source contains nothing invisible', () => {
  const files = sourceFiles(ROOT);

  it('is actually reading the tree rather than an empty list', () => {
    // The guard this whole file is about: a scan that walked nothing would
    // report a clean repository for ever.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((path) => path.pathname.endsWith('.tsx'))).toBe(true);
    expect(files.some((path) => path.pathname.endsWith('.py'))).toBe(true);
  });

  it('has no character a reader cannot see', () => {
    const found: string[] = [];
    for (const path of files) {
      const text = readFileSync(path, 'utf8');
      for (const [character, name] of FORBIDDEN) {
        const index = text.indexOf(character);
        if (index !== -1) {
          const line = text.slice(0, index).split('\n').length;
          const where = path.pathname.split('/').slice(-2).join('/');
          found.push(`${where}:${line} contains ${name}`);
        }
      }
    }
    expect(found, found.join('\n')).toEqual([]);
  });

  it('would notice one if it were there', () => {
    // Falsified without mutating the tree: the same detection run against a
    // string that has the problem, and one that does not.
    const planted = `const gap = '${String.fromCharCode(0x2028)}';`;
    expect(FORBIDDEN.some(([character]) => planted.includes(character))).toBe(true);
    expect(FORBIDDEN.some(([character]) => `const gap = ' ';`.includes(character))).toBe(false);
  });
});
