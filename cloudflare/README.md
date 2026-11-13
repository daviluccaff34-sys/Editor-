# Editor++ Cloudflare backend

This folder defines the first backend contract for Editor++.

## Responsibilities

- **GitHub** stores the source code and runs Android Geode builds.
- **Cloudflare Worker** exposes the public API.
- **D1** stores the searchable directory of online rooms.
- **Durable Objects** coordinate each room's live WebSocket connections and shared editing state.
- **Admin panel** is a separate protected interface. It must be placed behind Cloudflare Access before it is exposed.

## Room discovery rules

1. A player must have a Geometry Dash account to use Host or Join.
2. When a player opens the friends list, Editor++ reads the player's Geometry Dash friends who also use Editor++.
3. The API returns an open room automatically when its host is in that player's GD friends list.
4. A room hosted by a non-friend is not shown in the automatic friends list.
5. A player can still join a non-friend's room by entering its room code.
6. Every room supports at most four players.
7. LAN rooms are local and do not appear in the Cloudflare online-room directory.

The friends-list behavior is a discovery rule, not an extra account system. No Editor++ account or external social account is required.

## Initial API contract

- `GET /api/health` — service status.
- `GET /api/rooms/friends?playerId=...&friends=id1,id2` — open online rooms hosted by the supplied GD friends.
- `POST /api/rooms` — create an online room.
- `POST /api/rooms/:code/join` — request to join by room code.
- `GET /api/admin/rooms` — administrator room overview; must require Cloudflare Access.
- `POST /api/admin/rooms/:code/close` — administrator closes a room; must require Cloudflare Access.

The API contract is a development specification, not a deployed service yet. Host/Join must not be treated as account-verified until the Geometry Dash account check is implemented and validated.

## Security notes

- Never request or store a Geometry Dash password.
- Do not trust a display name as proof of a GD account.
- Do not expose admin endpoints based only on the presence of a request header. Validate Cloudflare Access JWTs server-side.
- Room codes are for joining; friend discovery is filtered by GD player IDs.
- The Worker must validate all inputs and enforce the four-player limit server-side.
