// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Identifier system for DJS facilities, mirroring `SCREENING_ID_SYSTEM`'s
 * convention. A facility's `code` under this system is its permanent identity.
 */
export const DJS_FACILITY_SYSTEM = 'http://maryland.gov/djs/facility';

export interface DjsFacility {
  /**
   * Permanent, machine-readable identity. **Never change a code once it has
   * been used** — `Location` resources are upserted on it and `Encounter`s
   * reference the resulting Location, so editing a code would orphan every
   * prior admission from its facility rather than renaming it.
   */
  code: string;
  /**
   * Display label shown to staff. **Safe to change at any time.** These are
   * deliberately the short names as they appear on the current paper form,
   * because that is what intake staff recognize — not the official long-form
   * names. Because identity hangs on `code`, swapping in official names for a
   * production version is a pure display change: no stored data moves, and no
   * existing Encounter is affected.
   */
  name: string;
}

/**
 * The canonical DJS facility list, from the current paper form.
 *
 * A closed set on purpose: the facility field is a dropdown with no free-text
 * escape. Standing up a new DJS facility takes significant organizational
 * investment, so the list changes rarely and adding to it is cheap — whereas a
 * free-text fallback would silently reintroduce the duplicate-facility problem
 * this list exists to prevent. A facility that isn't here is either a data
 * entry error or a real organizational change; both should route to updating
 * this list, not to minting an ad-hoc Location mid-admission.
 *
 * Codes are constrained to lowercase/hyphen slugs, which also keeps them clear
 * of the FHIR search-token metacharacters (`,` `|` `$` `\`) that caused the
 * duplication bug fixed alongside task 19 — another reason identity hangs on
 * the code rather than the human-readable name.
 *
 * The last four (`backbone`, `green-ridge`, `meadow-mountain`,
 * `savage-mountain`) are the Allegany County Youth Centers — a distinct class
 * from the detention facilities above them, expanded here because the paper
 * form lists them individually. That grouping is not yet modeled; see the
 * `Location.partOf` follow-on task, which can be added later without touching
 * a single code.
 */
export const DJS_FACILITIES: DjsFacility[] = [
  { code: 'noyes', name: 'Alfred D Noyes' },
  { code: 'bcjjc', name: 'Baltimore City Juvenile Justice Center' },
  { code: 'carter', name: 'Carter' },
  { code: 'cheltenham', name: 'Cheltenham' },
  { code: 'hickey', name: 'Hickey' },
  { code: 'lower-eastern-shore', name: 'Lower Eastern Shore' },
  { code: 'victor-cullen', name: 'Victor Cullen' },
  { code: 'waxter', name: 'Waxter' },
  { code: 'western-maryland', name: 'Western Maryland' },
  { code: 'backbone', name: 'Backbone' },
  { code: 'green-ridge', name: 'Green Ridge' },
  { code: 'meadow-mountain', name: 'Meadow Mountain' },
  { code: 'savage-mountain', name: 'Savage Mountain' },
];

/** The facility with this code, or undefined if the code isn't in the canonical list. */
export function facilityByCode(code: string | undefined): DjsFacility | undefined {
  return code ? DJS_FACILITIES.find((f) => f.code === code) : undefined;
}
