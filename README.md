# Donatello Multiplayer Server — prototype v0.1

A working Node.js WebSocket lobby backend for room creation/join/leave, lobby/room chat, private messaging, invitations, spectators, and basic host/moderator actions (kick/ban/mute). Includes a browser test page. This does **not** implement billiards physics, match synchronization, the old RTMP wire protocol, or automatic SWF/Ruffle compatibility.

## Run on a VPS with Node.js 20+

```bash
npm install
export AUTH_SECRET='replace-with-a-long-random-32-plus-character-secret'
npm start
```

Open `http://localhost:8080/` for the test UI. In a production deployment, reverse-proxy through HTTPS to provide WSS, restrict allowed origins, and firewall the Node port.

For two test users, run (same AUTH_SECRET):

```bash
node make-token.js 1 Alice
node make-token.js 2 Bob
```

Open two browser windows and paste each token in its own window. Create a room in one, copy its room ID from the event log, join or spectate in the other, and test chat, private messages and invitations.

## Authentication / integration

The server expects `auth` with a signed HMAC-SHA256 token (`base64url(payload).base64url(signature)`). The JSON payload contains `id`, `name`, `role` and `exp` (Unix seconds). The PHP website must issue this token **only after validating the existing login session**; do not expose AUTH_SECRET to browsers. Test token generator is not a login system.

WebSocket JSON events:
- client: `auth {token}`, `list`, `create {name,capacity}`, `join {roomId}`, `spectate {roomId}`, `leave`
- client: `chat {scope:'lobby'|'room',text}`, `private {to,text}`, `invite {to}`, `accept_invite {code}`
- client: `kick {to}`, `ban {to}`, `mute {to,durationMs}`
- server: `welcome`, `rooms`, `joined`, `left`, `room_updated`, `chat`, `private`, `private_sent`, `invite`, `invite_sent`, `moderated`, `moderation_ok`, `error`

## Limitations before production

Room and ban state is memory-only; no database persistence. Add moderation audit logs, role authorization from the database, origin validation, TLS termination, abuse controls, per-room permissions, disconnect recovery, and shared state for multiple server processes. No end-to-end encryption. Current spectator role receives room messages but not game state. The SWF client must be analyzed and a bridge or new client built; WebSocket is not an RTMP drop-in replacement.
