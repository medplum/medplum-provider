@echo off
rem SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
rem SPDX-License-Identifier: Apache-2.0
rem
rem cmd.exe wrapper for load-us-core-profiles.ps1 -- see that file (and
rem load-us-core-profiles.sh) for what this actually does and why.
rem
rem There is no separate cmd-native implementation on purpose: cmd.exe has
rem no reliable built-in JSON parsing or HTTPS handling, so a "real" cmd
rem version would either be fragile (parsing JSON with findstr/for) or
rem falsely reassuring. PowerShell ships on every Windows box this project
rem targets, so this just calls it -- same env vars, same behavior.
rem
rem Usage:
rem   set MEDPLUM_LIVE_CLIENT_ID=...
rem   set MEDPLUM_LIVE_CLIENT_SECRET=...
rem   scripts\load-us-core-profiles.cmd

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0load-us-core-profiles.ps1"
exit /b %ERRORLEVEL%
