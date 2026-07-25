// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
//
// Static source-text checks for the DJS wizard's two most common bug
// classes (see CLAUDE.md, "Bug classes that have actually happened
// here"). This is a straight port of the field-integrity script and the
// identifier-collision grep documented there — same regexes, same
// intent, now enforced by `npm test` instead of run by hand.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// Resolved from the package root (where `npm test` / `npx vitest run` is
// invoked), not via import.meta.url — Vitest's transform doesn't
// guarantee that resolves to a real file:// URL on every platform, and
// it broke on Windows here.
const WIZARD_PATH = join(process.cwd(), 'src/pages/AdmissionHealthScreeningWizard.tsx');
const wizardSource = readFileSync(WIZARD_PATH, 'utf-8');

function extractKeys(patterns: RegExp[], text: string): Set<string> {
  const keys = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      keys.add(match[1]);
    }
  }
  return keys;
}

// A field is "set" if the JSX writes it into FormState via one of these.
const SET_PATTERNS = [
  /form\.setText\('([\w-]+)'/g,
  /form\.setChip\('([\w-]+)'/g,
  /track="([\w-]+)"/g,
  /grid="([\w-]+)"/g,
  /form\.setRows\('([\w-]+)'/g,
  /form\.checkedItems\('([\w-]+)'\)/g,
];

// A field is "read" if a save handler (or the JSX itself) reads it back
// out of FormState via one of these.
const READ_PATTERNS = [
  /form\.text\('([\w-]+)'\)/g,
  /form\.chip\('([\w-]+)'\)/g,
  /form\.checkedItems\('([\w-]+)'\)/g,
  /form\.checkTextMap\('([\w-]+)'\)/g,
  /form\.rows\('([\w-]+)'\)/g,
];

/**
 * Grid keys read only through a loop variable in `saveReviewOfSystems`
 * (`for (const grid of [...]) { form.checkedItems(grid) }`), so the
 * literal-string regex above can't see the read. This is a permanent
 * blind spot of the *script*, not a bug in the wizard — documented in
 * CLAUDE.md. Do not add a field here unless you've confirmed by hand
 * that it really is read via a loop variable, not actually orphaned.
 */
const KNOWN_SCRIPT_BLIND_SPOTS = ['injuries', 'firearm-safety', 'infectious'];

/**
 * Fields with a *real*, currently-open data-loss bug, tracked in
 * TASKS.md. Unlike the blind spots above, this list should only shrink.
 * If a fix lands and a key here starts being read, this test will fail
 * with "expected list not to contain X" — that's the signal to delete it
 * from this list (and close the matching TASKS.md item), not to add it
 * to KNOWN_SCRIPT_BLIND_SPOTS.
 */
const KNOWN_OPEN_BUGS = [
  'epipen', // TASKS.md #13 — captured via `track="epipen"`, never read back in saveAllergiesChronic.
];

describe('AdmissionHealthScreeningWizard field integrity', () => {
  test('no field is read in a save handler without ever being set — read-but-never-set must be empty', () => {
    // CLAUDE.md: "read but never set is always a bug." This is the
    // stronger of the two checks: there is no allowlist for it.
    const setKeys = extractKeys(SET_PATTERNS, wizardSource);
    const readKeys = extractKeys(READ_PATTERNS, wizardSource);

    const readButNeverSet = [...readKeys].filter((key) => !setKeys.has(key)).sort();

    expect(readButNeverSet).toEqual([]);
  });

  test('every field set in the UI is read somewhere, except the documented exceptions', () => {
    // Exact-match, not subset: if this list grows, a newly-added field is
    // silently discarded (the epipen bug class) — go fix the save
    // handler. If it shrinks because a previously-open bug got fixed,
    // update KNOWN_OPEN_BUGS above in the same change, per CLAUDE.md's
    // "keep docs from drifting" rule.
    const setKeys = extractKeys(SET_PATTERNS, wizardSource);
    const readKeys = extractKeys(READ_PATTERNS, wizardSource);

    const setButNeverRead = [...setKeys].filter((key) => !readKeys.has(key)).sort();
    const expected = [...KNOWN_SCRIPT_BLIND_SPOTS, ...KNOWN_OPEN_BUGS].sort();

    expect(setButNeverRead).toEqual(expected);
  });

  test('no two fields derive the same code.text identifier', () => {
    // Identifiers are derived from `code.text` (see obs() in CLAUDE.md),
    // so two fields sharing a code.text silently overwrite one another
    // in the chart. This mirrors the grep in CLAUDE.md's "Verifying
    // changes" section.
    const codeTextValues = [...wizardSource.matchAll(/code:\s*\{\s*text:\s*'([^']+)'/g)].map((match) => match[1]);

    const seen = new Map<string, number>();
    for (const value of codeTextValues) {
      seen.set(value, (seen.get(value) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([value]) => value);

    expect(duplicates).toEqual([]);
  });
});