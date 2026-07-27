# SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
# SPDX-License-Identifier: Apache-2.0
#
# PowerShell equivalent of load-us-core-profiles.sh — see that file for the
# full explanation of WHY this is needed (task 39: a fresh Medplum Project
# has no US Core StructureDefinitions loaded, so Patient/:id/edit fails with
# "StructureDefinition profile ... not found"). This is a data-loading step
# against a live Project, not an application-code fix — do not "fix" task 39
# by editing src/pages/patient/EditTab.tsx or
# src/components/ResourceFormWithRequiredProfile.tsx.
#
# Loads only the three StructureDefinitions this codebase references for
# Patient (us-core-patient, us-core-race, us-core-ethnicity), from the
# official HL7 FHIR package registry — not a hand-copied JSON blob. See the
# .sh version's header for which OTHER US Core profiles this codebase
# references and will hit the same error once those pages are used.
#
# Idempotent — checks each StructureDefinition's canonical `url` before
# creating it, safe to re-run.
#
# Requires PowerShell's built-in `tar` (ships with Windows 10 1803+ / 11 —
# this is Windows' own bsdtar, nothing extra to install). If it's missing,
# use Git Bash's `tar` via load-us-core-profiles.sh instead, or extract
# US_CORE_PACKAGE_URL's .tgz by hand with 7-Zip.
#
# Usage (same two env vars `npm run test:live` needs — see
# RUNNING-LIVE-TESTS.md section 2):
#   $env:MEDPLUM_LIVE_CLIENT_ID = "..."
#   $env:MEDPLUM_LIVE_CLIENT_SECRET = "..."
#   .\scripts\load-us-core-profiles.ps1
#
# If PowerShell blocks running it (execution policy), run once instead:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\load-us-core-profiles.ps1

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest's default progress bar can corrupt output when the
# console is redirected to a file (the "Downloading ... Extracting ..."
# running together on one line, seen 2026-07-28, is this) — suppress it so
# any captured log is actually readable.
$ProgressPreference = 'SilentlyContinue'

$BaseUrl = if ($env:MEDPLUM_LIVE_BASE_URL) { $env:MEDPLUM_LIVE_BASE_URL } else { 'http://localhost:8103/' }
$ClientId = $env:MEDPLUM_LIVE_CLIENT_ID
$ClientSecret = $env:MEDPLUM_LIVE_CLIENT_SECRET
# "Latest" as of 2026-07-26 — check https://packages.fhir.org/hl7.fhir.us.core
# for a newer stable release before assuming this one is current. The
# canonical StructureDefinition URLs Medplum looks up by don't change
# between US Core versions, so any reasonably recent stable release works.
$PackageUrl = if ($env:US_CORE_PACKAGE_URL) { $env:US_CORE_PACKAGE_URL } else { 'https://packages.simplifier.net/hl7.fhir.us.core/9.0.0' }

if (-not $ClientId -or -not $ClientSecret) {
    Write-Error "MEDPLUM_LIVE_CLIENT_ID / MEDPLUM_LIVE_CLIENT_SECRET are not set in this shell. Same two variables npm run test:live needs — see RUNNING-LIVE-TESTS.md section 2."
    exit 1
}

if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    Write-Error "No 'tar' command found. This ships with Windows 10 1803+ / 11 by default — if it's genuinely missing, use load-us-core-profiles.sh in Git Bash instead."
    exit 1
}

# Only the profiles this codebase actually references for Patient — see the
# .sh version's header comment for the reasoning and for what to add if a
# different resource type's edit page hits this same error later.
$ProfileFiles = @(
    'StructureDefinition-us-core-patient.json',
    'StructureDefinition-us-core-race.json',
    'StructureDefinition-us-core-ethnicity.json'
)

$WorkDir = Join-Path $env:TEMP ("us-core-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
try {
    $TgzPath = Join-Path $WorkDir 'us-core.tgz'
    Write-Host "Downloading $PackageUrl ..."
    Invoke-WebRequest -Uri $PackageUrl -OutFile $TgzPath

    Write-Host "Extracting ..."
    tar -xzf $TgzPath -C $WorkDir
    if ($LASTEXITCODE -ne 0) {
        Write-Error "tar extraction failed (exit code $LASTEXITCODE)."
        exit 1
    }

    Write-Host "Requesting an access token from $BaseUrl ..."
    $tokenUrl = "${BaseUrl}oauth2/token"
    $tokenResponse = Invoke-RestMethod -Method Post -Uri $tokenUrl -Body @{
        grant_type    = 'client_credentials'
        client_id     = $ClientId
        client_secret = $ClientSecret
    }
    $accessToken = $tokenResponse.access_token
    if (-not $accessToken) {
        Write-Error "Failed to get an access token. Server response: $($tokenResponse | ConvertTo-Json -Compress)"
        exit 1
    }
    $authHeader = @{ Authorization = "Bearer $accessToken" }

    foreach ($file in $ProfileFiles) {
        $path = Join-Path $WorkDir "package\$file"
        if (-not (Test-Path $path)) {
            Write-Warning "$file not found in the downloaded package — check `$ProfileFiles against what this US Core version actually ships (file names have shifted between releases before)."
            continue
        }

        $raw = Get-Content $path -Raw
        try {
            $parsed = $raw | ConvertFrom-Json
        }
        catch {
            Write-Warning "$file did not parse as JSON: $($_.Exception.Message)"
            Write-Warning "First 300 chars of the file: $($raw.Substring(0, [Math]::Min(300, $raw.Length)))"
            continue
        }

        # Seen 2026-07-28 against a Docker-hosted server: the file extracted
        # without error but wasn't a usable FHIR resource, and the resulting
        # failure gave no clue why. Check explicitly and dump enough of the
        # actual content to diagnose it next time, instead of a blank error.
        if ($parsed.resourceType -ne 'StructureDefinition' -or -not $parsed.url) {
            Write-Warning "$file didn't contain a usable StructureDefinition."
            Write-Warning "  resourceType found: '$($parsed.resourceType)'  url found: '$($parsed.url)'"
            Write-Warning "  First 300 chars: $($raw.Substring(0, [Math]::Min(300, $raw.Length)))"
            continue
        }
        $url = $parsed.url

        $searchUrl = "${BaseUrl}fhir/R4/StructureDefinition?url=$([uri]::EscapeDataString($url))&_count=1"
        $existing = Invoke-RestMethod -Method Get -Uri $searchUrl -Headers $authHeader

        if ($existing.entry -and $existing.entry.Count -gt 0) {
            Write-Host "ALREADY LOADED: $url"
            continue
        }

        Write-Host "Creating: $url"
        try {
            Invoke-RestMethod -Method Post -Uri "${BaseUrl}fhir/R4/StructureDefinition" `
                -Headers $authHeader -ContentType 'application/fhir+json' -Body $raw | Out-Null
        }
        catch {
            $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
            Write-Error "FAILED to create $url -- server said: $detail"
            exit 1
        }
    }

    Write-Host ""
    Write-Host "Done. Reload the app in your browser before retesting Patient/:id/edit --"
    Write-Host "requestProfileSchema caches its result client-side per session."
}
finally {
    Remove-Item -Recurse -Force $WorkDir -ErrorAction SilentlyContinue
}
