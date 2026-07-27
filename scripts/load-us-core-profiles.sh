#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
# SPDX-License-Identifier: Apache-2.0
#
# Fixes task 39: editing a Patient fails with
#   "StructureDefinition profile with URL
#    http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient not found"
#
# ROOT CAUSE (confirmed against Medplum's own docs, not guessed): a fresh
# Medplum Project ships with base FHIR only. US Core is a separate
# Implementation Guide, and per Medplum's docs "the corresponding
# StructureDefinition resource for the profile must be present in your
# Project" — you have to upload it yourself. RUNNING-LIVE-TESTS.md's setup
# flow (self-register -> brand-new Project) never does this, so every fresh
# environment hits this the first time anyone opens Patient/:id/edit.
#
# This is an ops/data-loading step against a live Project, not an
# application-code fix — do NOT "fix" this by editing
# src/pages/patient/EditTab.tsx or src/components/ResourceFormWithRequiredProfile.tsx.
# Those already do the right thing (request the profile, show a clear error
# if it's missing); the project just needs the profile loaded once.
#
# WHAT THIS LOADS: only the three StructureDefinitions this codebase
# actually references for Patient — us-core-patient itself, plus the
# us-core-race / us-core-ethnicity extensions AdmissionHealthScreeningWizard.tsx
# writes (see RESOURCE_PROFILE_URLS / ETHNICITY_EXT_URL / RACE_EXT_URL).
# Deliberately NOT the whole ~150-profile US Core package: this is a
# prototype-evaluation project, and loading everything the codebase doesn't
# use is unnecessary surface for no benefit. The codebase references several
# OTHER US Core profiles too (AllergyIntolerance, CareTeam, Coverage,
# Immunization, MedicationRequest, Device, Condition,
# ObservationSexualOrientation, ObservationSmokingStatus — see
# src/utils/intake-utils.ts and src/pages/resource/utils.ts). Those will hit
# this exact same "not found" error the first time each of THOSE edit pages
# is used. Add their StructureDefinition file names to PROFILE_FILES below
# if/when that happens, rather than re-diagnosing the same root cause twice.
#
# SOURCE: the official HL7 FHIR package registry (packages.fhir.org), not a
# hand-copied JSON blob — this codebase's convention is to fetch/verify
# clinical and standards content from its authoritative source rather than
# reproduce it from memory. US_CORE_PACKAGE_URL below was the "latest"
# tarball at the time this script was written (2026-07-26); check
# https://packages.fhir.org/hl7.fhir.us.core for a newer stable release
# before assuming this one is current. The canonical StructureDefinition
# URLs Medplum looks up by (http://hl7.org/fhir/us/core/StructureDefinition/...)
# do not change between US Core versions, so any reasonably recent stable
# release satisfies the lookup.
#
# Idempotent: checks whether each StructureDefinition already exists
# (by its canonical `url`) before creating it, so re-running this after a
# partial failure — or against an environment that already has some of
# these loaded — does not duplicate anything.
#
# Usage (same env-var convention as `npm run test:live` — see
# RUNNING-LIVE-TESTS.md):
#   export MEDPLUM_LIVE_CLIENT_ID=...
#   export MEDPLUM_LIVE_CLIENT_SECRET=...
#   export MEDPLUM_LIVE_BASE_URL=http://localhost:8103/   # optional, this is the default
#   ./scripts/load-us-core-profiles.sh

set -euo pipefail

BASE_URL="${MEDPLUM_LIVE_BASE_URL:-http://localhost:8103/}"
CLIENT_ID="${MEDPLUM_LIVE_CLIENT_ID:-}"
CLIENT_SECRET="${MEDPLUM_LIVE_CLIENT_SECRET:-}"
US_CORE_PACKAGE_URL="${US_CORE_PACKAGE_URL:-https://packages.simplifier.net/hl7.fhir.us.core/9.0.0}"

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "MEDPLUM_LIVE_CLIENT_ID / MEDPLUM_LIVE_CLIENT_SECRET are not set in this shell." >&2
  echo "Same two variables npm run test:live needs — see RUNNING-LIVE-TESTS.md section 2." >&2
  exit 1
fi

# The FHIR package .tgz format is a standard npm-style tarball containing
# package/<ResourceType>-<id>.json files (plus a package/package.json
# manifest we don't need) — this is not something specific to this script,
# it's how every published FHIR Implementation Guide is distributed.
PROFILE_FILES=(
  "StructureDefinition-us-core-patient.json"
  "StructureDefinition-us-core-race.json"
  "StructureDefinition-us-core-ethnicity.json"
)

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "Downloading $US_CORE_PACKAGE_URL ..."
curl -sSL "$US_CORE_PACKAGE_URL" -o "$WORKDIR/us-core.tgz"

echo "Extracting ..."
tar -xzf "$WORKDIR/us-core.tgz" -C "$WORKDIR"

echo "Requesting an access token from $BASE_URL ..."
TOKEN_RESPONSE="$(curl -sS -X POST "${BASE_URL}oauth2/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET")"
ACCESS_TOKEN="$(echo "$TOKEN_RESPONSE" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)"

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Failed to get an access token. Server said:" >&2
  echo "$TOKEN_RESPONSE" >&2
  exit 1
fi

for file in "${PROFILE_FILES[@]}"; do
  path="$WORKDIR/package/$file"
  if [[ ! -f "$path" ]]; then
    echo "SKIP: $file not found in the downloaded package — check PROFILE_FILES against what this US Core version actually ships (file names have shifted between releases before)." >&2
    continue
  fi

  url="$(grep -o '"url"[[:space:]]*:[[:space:]]*"[^"]*"' "$path" | head -1 | cut -d'"' -f4)"
  if [[ -z "$url" ]]; then
    echo "SKIP: $file has no top-level \"url\" field — not the StructureDefinition we expected." >&2
    continue
  fi

  existing="$(curl -sS -G "${BASE_URL}fhir/R4/StructureDefinition" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    --data-urlencode "url=$url" \
    --data-urlencode "_count=1")"

  if echo "$existing" | grep -q '"resourceType":"StructureDefinition"'; then
    echo "ALREADY LOADED: $url"
    continue
  fi

  echo "Creating: $url"
  result="$(curl -sS -X POST "${BASE_URL}fhir/R4/StructureDefinition" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/fhir+json" \
    --data-binary "@$path")"

  if echo "$result" | grep -q '"resourceType":"OperationOutcome"'; then
    echo "FAILED to create $url — server said:" >&2
    echo "$result" >&2
    exit 1
  fi
done

echo
echo "Done. Reload the app in your browser before retesting Patient/:id/edit —"
echo "requestProfileSchema caches its result client-side per session."
