# RentMate — Broadcast Architecture

Date: 2026-11-20. The brief asks for large audiences without assuming that one-to-one rooms scale. This is the
decision record.

## 1. What is built (Tested)

Every stream is one LiveKit room:

- the creator (plus up to 4 accepted guests) publish over WebRTC;
- viewers join with subscribe-only tokens (`canPublish: false`, no data publishing).

The LiveKit SFU forwards each publisher's tracks to every subscriber. With simulcast (on by default in
`livekit-client`), each viewer receives the quality layer their connection can take.

- **Latency:** sub-second, which suits live chat, reactions and guests.
- **Viewer cap:** `live_settings.max_webrtc_viewers` (default **300**, enforced in the database before a token is
  issued, 503 "stream full").
- **Viewer count:** comes from the media server (`ListParticipants`), not from client claims.

## 2. Why WebRTC alone is not "unlimited"

A single SFU node forwards a copy of each track to each subscriber, so its outbound bandwidth grows linearly:

- one 720p simulcast layer is about 1.5 Mbps;
- 300 viewers are about 450 Mbps for one stream.

LiveKit Cloud can spread one room across nodes, which raises that ceiling, but each viewer is still a WebRTC peer
that costs per participant-minute. Above a few thousand viewers, HLS through a CDN is cheaper and more robust.

The 300 default is a conservative, configurable limit. It has not been load-tested (see the test report). Raise it
only after a load test on the chosen LiveKit plan.

## 3. Options evaluated

| Option                                                           | Latency                      | Scale                                         | Cost driver                    | Fits RentMate when                        |
| ---------------------------------------------------------------- | ---------------------------- | --------------------------------------------- | ------------------------------ | ----------------------------------------- |
| WebRTC SFU room (built)                                          | < 1 s                        | Hundreds per node; more with Cloud multi-node | Participant-minutes, bandwidth | Interactive streams, guests, chat (today) |
| LiveKit Egress → HLS → CDN                                       | 6–20 s                       | Effectively unlimited                         | Egress minutes + CDN + storage | Very large audiences, view-only           |
| LiveKit Ingress (RTMP/WHIP from OBS)                             | as source                    | Same as the room                              | Ingress minutes                | Creators streaming from desktop tools     |
| Hybrid: SFU for creator + guests + first N viewers, HLS overflow | < 1 s for N; 6–20 s overflow | Unlimited                                     | Both                           | Recommended next step                     |

## 4. Recommended path (not built; needs approvals)

1. Keep the SFU room for creator, guests and the first N viewers (N = the cap).
2. When a stream reaches N, start a LiveKit **room-composite egress to HLS** (segments to object storage, served
   through a CDN). Overflow viewers watch the HLS URL with a standard player and keep chat and reactions (database,
   not media).
3. HLS segments are a **recording in the legal sense**: they are stored, even if briefly. That needs founder
   approval F-14 (recording policy), creator consent, a short segment retention (for example 2 minutes, live window
   only), and no VOD/replay unless separately approved. That is why it is not built.
4. Ingress (RTMP/WHIP) for desktop creators is optional and independent.

## 5. Safety in every mode

- **Moderators and creators:** the existing terminate / emergency stop closes the room. With HLS, stopping the egress
  ends the HLS stream too.
- **Blocked or suspended viewers:** removed from the SFU room by the kick queue. An HLS viewer has no identity on the
  media server, so blocking at the HLS layer would need signed, per-viewer playlist URLs (planned with step 2).
- **Content:** no adult content or sexual services. The prohibited-content screening applies to titles and chat, and
  reports reach the moderation queue.
