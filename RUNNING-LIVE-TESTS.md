# Running against a real local Medplum server

Full walkthrough for `npm run test:live` — the suite that talks to an
actual Medplum server instead of `MockClient`. `CLAUDE.md`'s "Running the
live suite" section is the short version; this is the long one, written
from having actually done every step below and hit most of the failure
modes at least once. If the two ever disagree, fix this one — `CLAUDE.md`
should stay short on purpose.

**Who this is for:** whoever's driving a terminal against a real
Medplum stack — an AI coding session or a person — especially after an
environment reset, since every credential below is tied to a specific
Project and doesn't survive one.

---

## 0. Assumptions

This assumes the Medplum Docker stack is already up:

```sh
docker compose ps
```

should show Postgres, Redis, `medplum-server` (port **8103**) and
`medplum-app` (port **3000**) all healthy. If it isn't, that's the
`docker-compose.full-stack.yml` setup (curl it from Medplum's repo, then
`docker compose up -d`) — out of scope for this doc, which starts from
"the stack is running."

Confirm the server itself responds before doing anything else:

```sh
curl http://localhost:8103/healthcheck
```

Expect `{"ok": true, "postgres": true, "redis": true}`. If this fails,
stop here and fix the stack — nothing below will work.

---

## 1. Get a Project and a `ClientApplication`

**There is no seeded default admin account on this compose file.**
`admin@example.com` / `medplum_admin` is a *different* setup's default
(Medplum's monorepo dev-server seed script) — this one doesn't set the
config values that would create it. Don't waste time trying that login;
go straight to registering.

1. Go to `http://localhost:3000`.
2. Use **sign up / register**, not sign in. Any email/password you
   choose — this creates a brand-new Project with you as its admin.
3. **Project Admin → Clients → create a `ClientApplication`.**
4. Copy its **Client ID** and **Client Secret** immediately — the secret
   is shown once, at creation, only.
5. [Note: the root file client-credentials.txt is in .gitignore as a place to store these if needed.]

**After an environment restart:** whether you need to redo this depends
on whether Postgres's data volume survived the restart, not just the
containers. Check first — try the healthcheck above, then try your
*previous* `MEDPLUM_LIVE_CLIENT_ID`/`SECRET` against a live test run (see
§3). If it fails, the volume didn't persist; redo steps 1–4 fresh. There
is no way to recover a lost Client Secret — a fresh `ClientApplication`
is the only path if it's gone.

---

## 2. Set the two environment variables

The live suite reads these from `process.env` at test-run time — **not**
from `.env`, which is Vite's separate build-time mechanism for
`medplum-provider` itself. Set them in the same terminal session you'll
run tests from:

```sh
# PowerShell
$env:MEDPLUM_LIVE_CLIENT_ID = "<client id from step 1>"
$env:MEDPLUM_LIVE_CLIENT_SECRET = "<client secret from step 1>"

# bash/zsh
export MEDPLUM_LIVE_CLIENT_ID=<client id from step 1>
export MEDPLUM_LIVE_CLIENT_SECRET=<client secret from step 1>
```

Optional, only if the server isn't at the default:

```sh
export MEDPLUM_LIVE_BASE_URL=http://localhost:8103/
```

Without the first two set, `AdmissionHealthScreeningWizard.live.test.tsx`
skips itself entirely (`describe.skipIf`) rather than failing — so
`npm run test:live` reporting **0 tests** means "these aren't set," not
"something's broken." Check this before anything else if you see that.

---

## 3. Run it

```sh
npm run test:live
```

This runs `vitest run --project live` — only `*.live.test.*` files, never
the default `npm test` (`--project unit`). See `vite.config.ts`'s
`test.projects` split if you need to touch that wiring.

What it currently proves against the real server (see `TASKS.md` /
`CLAUDE.md` for the full list, which grows as the wizard grows):
idempotent upsert (save twice, no duplicate), FHIR constraint acceptance
(`ait-1`/`con-3`/`ele-1` — things `MockClient` doesn't enforce, so a green
unit run proves nothing here), and the retraction round-trip
(uncheck → `entered-in-error`, not deleted).

Note: There is a test that on first start creates the djS locations. on second
run it just reuses them. Running the tests twice tests both code paths. Its a 
best practice.
---

## 4. If `npm install` fails first

Seen once already this session, unrelated to the live suite itself: an
`ERESOLVE` conflict where npm finds an old cached `@medplum/*` package
version fighting a newer one `package.json` now requires. That's stale
`node_modules` state, not a real conflict — `package.json` itself was
confirmed internally consistent when this happened. Fix:

```sh
rm -rf node_modules package-lock.json   # or Remove-Item -Recurse -Force on Windows
npm install
```

Reach for `--legacy-peer-deps` only if the clean reinstall still fails —
it silences real conflicts rather than fixing them, so it's the fallback,
not the first move.

---

## 5. Troubleshooting

| Symptom | Cause |
|---|---|
| `test:live` reports 0 tests | `MEDPLUM_LIVE_CLIENT_ID`/`SECRET` not set in *this* shell session |
| `admin@example.com` / `medplum_admin` doesn't work | Expected — no default admin on this compose file (§1). Register instead. |
| `curl .../healthcheck` fails or hangs | Stack isn't up, or still doing first-boot setup — `docker compose logs -f medplum-server` |
| `npm install` gives `ERESOLVE` | Stale `node_modules` — see §4 |
| Auth error from `startClientLogin` | `ClientApplication` doesn't allow `client_credentials`, or the id/secret was mistyped |
| A write is rejected (400, constraint error) | Read the actual `OperationOutcome` — see §6 below on how to actually see it, don't guess |
| A resource seems to just... not update | See the retraction/atomicity findings in `CLAUDE.md` → "Platform findings" before assuming it's this codebase's bug — bundle-written resources have had real index-lag issues on this server |

---

## 6. When a live test fails and you can't tell why: the diagnostic technique that actually worked

`runSave()` catches every save error into a silent UI toast — by design,
for the end user, but it means **a live test can fail with only a
changed-state symptom and zero indication of what actually went wrong**.
This happened for real this session (the allergy-retraction bug) and
guessing at the cause wasted several rounds. What actually worked:
spying on the real client methods involved, one layer at a time, until
the failure was forced to reveal itself:

```ts
const updateSpy = vi.spyOn(medplum, 'updateResource'); // calls through — doesn't mock away
// ...run the save...
if (updateSpy.mock.calls.length === 0) {
  throw new Error('updateResource was never called — the bug is upstream of this call, not a rejection');
}
for (const call of updateSpy.mock.results) {
  try {
    await call.value;
  } catch (err) {
    throw new Error(`rejected: ${err instanceof Error ? err.message : JSON.stringify(err)}`, { cause: err });
  }
}
```

If that shows zero calls (not a rejection), the next question is whether
the *search* that should have found something to update actually did —
spy on `medplum.searchResources` the same way and inspect
`mock.calls`/`mock.results` for the specific resource type in question.

If you suspect something threw and got swallowed by `runSave` before
even reaching the call you're spying on, mock the notifications module
at the top of the test file to capture the real error instead of a
silent toast:

```ts
vi.mock('../utils/notifications', () => ({
  showSuccessNotification: vi.fn(),
  showErrorNotification: vi.fn(),
}));
```

then inspect `vi.mocked(showErrorNotification).mock.calls` after the
save. (Confirm nothing else in the same test file asserts on real
notification text before adding this — it's a module-level mock, so it
applies to every test in the file, not just the one under diagnosis.)

**Remove this scaffolding once you have your answer.** It's diagnostic,
not permanent test coverage — leave a real, narrow assertion behind in
its place, not the spy-and-throw machinery.

---

## 7. Housekeeping this doc assumes you already know

- **Don't hand-convert line endings.** `.gitattributes` handles CRLF —
  see `CLAUDE.md` → "Formatting". A whole file showing as changed when
  you touched one line is a signal to investigate, not a reason to run
  `sed` on it.
- **This file, `package-lock.json` is gitignored** (inherited from
  upstream) — `package.json`'s exact pins are the real version control.
