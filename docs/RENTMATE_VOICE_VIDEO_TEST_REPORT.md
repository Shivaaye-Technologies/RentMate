# RentMate — Voice, Video and Live Test Report

Date: 2026-11-20 · Commit under test: the head of `feature/rentmate-conversion` (see PR #1) · All runs below were
executed in this session in a Linux container.

**Important distinction.** Everything here is **automated testing**: real Chromium (Playwright 1.56.1) with Chromium's
built-in fake camera and microphone, connecting over loopback to a real LiveKit server 1.13.11 (the same binary CI
downloads). **No real Android or iOS device, no mobile network and no hosted LiveKit project was tested.** Those
checks are listed at the end and remain open.

## 1. Real-media end-to-end (`npm run test:e2e:rtc`, CI job `rtc`): 59/59 passed

What makes these real: audio and video travel through the LiveKit SFU over WebRTC, and the tests read decoded video
frames and audio levels on the receiving side. Webhooks are signed by the real LiveKit server and verified by the real
API code. The page is served with `render.yaml`'s production security headers (CSP included), with only the local test
origins added.

| Area            | Checks (all passed)                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens          | LiveKit accepts a valid server token; rejects an expired token; rejects one signed with another secret                                                                                                                                                                                                                                                                                  |
| Voice lifecycle | Ringing → incoming banner (names caller and type) → connected with running duration → two-way live audio → no camera published → mute stops audio → unmute restores → hang-up closes the room for both → record ended                                                                                                                                                                   |
| Webhooks        | Signed join/leave/room-finished events verified and recorded                                                                                                                                                                                                                                                                                                                            |
| Video lifecycle | Each side decodes the other's camera; local preview; camera off shows "Camera off"; back on restores; 390 px layout without horizontal scroll; network drop shows "Reconnecting…" and recovers; end closes for both                                                                                                                                                                     |
| Failure paths   | Decline tells the caller; an outsider cannot open or join a call; blocked camera/microphone permission shows how to allow it                                                                                                                                                                                                                                                            |
| Broadcast       | Camera preview before going live; nothing live during preview; Go live publishes; stream appears in discovery; viewer watches video and audio; 360 px layout; creator sees the viewer count from the media server                                                                                                                                                                       |
| Interaction     | Chat message reaches the creator; reaction recorded; viewer can report the stream                                                                                                                                                                                                                                                                                                       |
| Guests          | Accepting records consent; guest publishes; viewer sees creator and guest; the media server has the guest's live camera and microphone; a guest cannot mute the host; guest removal disconnects at once                                                                                                                                                                                 |
| Host mutes      | Checked against LiveKit's own state (`GetParticipant`). Camera mute: live track gone and camera no longer allowed; guest told; Camera on refused while muted. Allow again: permission back, nothing turned on remotely; the guest's own Camera on brings a live camera back. Same for the microphone. A muted guest who reloads and rejoins stays muted. Added after CI run 44601328482 |
| Safety          | A viewer suspended mid-stream is removed from the room                                                                                                                                                                                                                                                                                                                                  |
| Ending          | Ending closes the room; viewers see the ended state                                                                                                                                                                                                                                                                                                                                     |
| Hygiene         | No uncaught JavaScript errors; no Content-Security-Policy violation under the production policy; the CSP hash matches the inline theme script                                                                                                                                                                                                                                           |

## 2. Database rules (`npm run test:db`): `calls_and_live_rooms.sql` 57/57

These cover everything that can't be faked in the browser:

- only matched members can call; one call at a time; only the callee answers;
- missed after 45 seconds; clients cannot change call status; outsiders cannot see a call;
- webhook ingest needs the integration secret, and repeated deliveries are ignored;
- billing counts only overlapping connected time; voice is 10 tokens a started minute and video 1 token a second;
- no tokens move while metering is off; one ledger entry per call even when `room_finished` is redelivered;
- with metering on, a call needs a minute of tokens;
- blocking ends a call and empties the room, and blocked people cannot be called;
- suspension removes people from live rooms and re-joins are removed; unmatching ends a call;
- the removal queue needs the secret, and claims are exclusive;
- live chat is screened, rate limited and moderated; blocked people's chat is invisible; suspended people cannot chat;
- reactions come from an allow-list;
- guests: creator-only invitations, approved creators only, at most 4, guests cannot control the room, removal works;
- the viewer cap is 300; BKG-02 blocks booking acceptance and cancels open bookings.

## 3. API (`npm test`, API workspace): 101/101

`calls.test.ts` (23 tests) and `live.test.ts` cover:

- token issuance only after the database allows it, and voice tokens that can publish the microphone only;
- webhook signature, issuer, expiry and body-hash checks, where unsigned, tampered, expired or foreign requests get 401;
- duplicate events, room removal on a refused join, and the kick-queue drain;
- host mute/remove for creators and moderators only, the viewer cap (503), suspended accounts refused everywhere,
  and the config never printing secrets.

## 4. Web unit tests (`npm test`, web workspace): 173/173

`rtc.test.ts` (call state machine, end reasons, durations, viewer count formatting) and `mfa.test.ts`.

## 5. Coverage against the brief's test list

| Brief item                      | Covered by                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| Voice call lifecycle            | e2e-rtc (voice), SQL (state machine)                                                       |
| Video call lifecycle            | e2e-rtc (video)                                                                            |
| Permission failures             | e2e-rtc (blocked camera/microphone)                                                        |
| Unauthorised room access        | e2e-rtc (outsider), SQL (outsider removed), API (refused before signing)                   |
| Expired tokens                  | e2e-rtc (LiveKit rejects), API (`verifyJwt` expiry, webhook expiry)                        |
| Suspended users                 | e2e-rtc (removed mid-stream), SQL, API                                                     |
| Blocked users                   | SQL (call ended, room emptied, cannot call, chat invisible)                                |
| Host and guest permissions      | e2e-rtc (host mutes guest; guest cannot mute host), SQL, API                               |
| Broadcast start/end             | e2e-rtc                                                                                    |
| Viewer join/leave               | e2e-rtc (viewer count), SQL (webhook presence)                                             |
| Chat moderation                 | SQL (screening, rate limit, hide, mute, blocked senders), e2e-rtc (chat)                   |
| Network reconnection            | e2e-rtc (simulated network drop, "Reconnecting…" then recovered)                           |
| Duplicate billing prevention    | SQL (redelivered room_finished = one entry), concurrency suite (replay)                    |
| Concurrent token spending       | `test:db:concurrency` on PostgreSQL 16 (double spend, replayed spend)                      |
| MFA enrolment and recovery      | `test:e2e:mfa` (17 browser checks), SQL `admin_mfa` 28 + `recovery_codes_and_retention` 24 |
| Deletion and suspension history | SQL `recovery_codes_and_retention` (F-20)                                                  |

## 6. Not verified (needs real devices or production services)

1. Real Android phones (Chrome) and iPhones (Safari): camera/microphone prompts, background tab behaviour,
   earpiece vs speaker, Bluetooth headsets, switching front/back camera, screen lock during a call.
2. Mobile networks (4G/5G, Wi-Fi to mobile hand-over), strict NAT needing TURN, packet loss and high latency.
3. A hosted LiveKit Cloud project: webhooks over the internet, regional latency from India, plan limits.
4. Many concurrent viewers (load test). The 300-viewer cap is a configured limit, not a measured one.
5. Battery and heat on long video calls.

Suggested manual script for item 1 (needs a deployed preview with LiveKit configured):

- two phones, matched test accounts, one voice and one video call each way;
- mute and camera-off on both sides; switch camera;
- toggle aeroplane mode for 5 seconds mid-call;
- lock the screen;
- end from each side;
- one broadcast watched by two phones with chat and a guest.
