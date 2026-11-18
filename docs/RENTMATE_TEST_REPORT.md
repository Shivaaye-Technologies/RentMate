# RentMate — Test Report

Session: 2026-11-18 · Branch `rentmate-migration` · Commits `e97a367` (integration) and `2abd05c` (Phase 1 brand).
All results below were produced by commands run in this session. Nothing was run against production.

## Automated suites

| Suite                                   | Command                | Result                                                                                                                            |
| --------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Format                                  | `npm run format:check` | pass                                                                                                                              |
| Lint                                    | `npm run lint`         | pass                                                                                                                              |
| Typecheck                               | `npm run typecheck`    | pass                                                                                                                              |
| API unit/integration (vitest+supertest) | `npm test`             | 79 / 79 passed                                                                                                                    |
| Web unit (vitest)                       | `npm test`             | 138 / 138 passed (incl. 4 new RentMate brand tests)                                                                               |
| Build                                   | `npm run build`        | pass                                                                                                                              |
| DB (PGlite, RLS)                        | `npm run test:db`      | rls_flow 53/53 · demo_isolation 21/21 · demo_mode 13/13 · discover_activity 10/10 · profile_details 29/29 · live_foundation 49/49 |
| Hook guards                             | `npm run test:hooks`   | 21 / 21                                                                                                                           |
| aihub                                   | `npm run test:aihub`   | 32 passed, 0 failed                                                                                                               |
| Browser smoke (Playwright)              | `npm run test:e2e`     | pass, 0 failures (title check updated to "RentMate — Meet. Connect. Experience.")                                                 |

## Browser checks (local build + fake backend, fictional data)

| Flow                                                                                  | Result                                                                 |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Landing, sign-up/sign-in errors, reset, expired link                                  | pass, no page errors                                                   |
| App: crush, discover, likes, chats, chat retry, profile, prompts, hide, block/unblock | pass, no page errors                                                   |
| Widths 320 / 360 / 390 / 430 / 768 / 1024 / 1280                                      | no horizontal overflow on any screen                                   |
| Creator studio (apply, agreement, consent, availability, support)                     | pass; adult category disabled for India and before a country is chosen |
| Admin console (reports, emergency stop drill, verification, provider terms gate)      | pass; provider stays disabled without signed terms                     |

## Not tested this session (and why)

| Area                                    | Reason                                                         |
| --------------------------------------- | -------------------------------------------------------------- |
| Real Android/iOS devices, slow networks | No device access from this environment                         |
| Production health (`/health`)           | Render URL not reachable from this session's network allowlist |
| Live video with a real LiveKit server   | No LiveKit credentials configured (by design)                  |
| CI on GitHub                            | GitHub account suspended                                       |
| Modules E, F, G, I (calls UI), J        | Not built yet                                                  |

## Known bugs

None found in the converted screens. Cosmetic: full-page screenshots show sticky headers mid-page (capture artefact).
