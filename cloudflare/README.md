# Editor++ Cloudflare backend

This folder contains the first deployable API foundation for Editor++.

## Architecture

- **GitHub** stores the mod and backend source and runs the Geode Android32/Android64 builds.
- **Cloudflare Worker** exposes the room-directory API.
- **D1** stores online room listings.
- **Durable Objects** coordinate each online room's live WebSocket connections, player presence, and edit-event relay. The first WebSocket layer is implemented; editor-specific object operations and conflict resolution are still pending.
- **Admin panel** is served separately and its API endpoints validate Cloudflare Access JWTs.

## Room rules

1. A player needs a Geometry Dash account to use Host or Join. No Editor++ account is part of the design.
2. The mod supplies the player's GD account ID and player name to the API.
3. The mod reads the player's GD friends who also use Editor++ and supplies their GD account IDs to the friends-room endpoint.
4. Open rooms hosted by those friends appear automatically.
5. Rooms hosted by non-friends are not shown in the automatic friends list; those rooms are joined with their six-character code.
6. Each online room has a maximum of four players.
7. LAN rooms stay local and are not listed by this API.

The initial API accepts the GD account ID supplied by the mod. A real client integration and account-presence check in the game are still required; this API foundation does not independently prove that an arbitrary submitted ID belongs to a logged-in player. Never request or store a Geometry Dash password.

## API routes

- `GET /api/health` — service status.
- `GET /api/rooms/friends?playerId=...&friends=id1,id2` — open rooms hosted by the supplied GD friends.
- `POST /api/rooms` — create an online room. JSON: `{"gdAccountId":"...","playerName":"..."}`.
- `POST /api/rooms/:code/join` — validate that a code is joinable. JSON: `{"gdAccountId":"...","playerName":"..."}`.
- `GET /api/rooms/:code/connect?gdAccountId=...&playerName=...` — upgrade to the room WebSocket for live presence and `edit`/`cursor` event relay.
- `GET /api/admin/rooms` — administrator room overview; requires a valid Cloudflare Access JWT.
- `POST /api/admin/rooms/:code/close` — administrator closes a room; requires a valid Cloudflare Access JWT.

## Cloudflare setup

1. Create a D1 database named `editor-plus-plus`.
2. Put its database ID in `wrangler.toml`.
3. Configure `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` for the Cloudflare Access application protecting the admin panel.
4. Run `wrangler d1 migrations apply editor-plus-plus`.
5. Deploy the Worker with Wrangler.

The values in `wrangler.toml` are placeholders; the Worker is not deployed until a real D1 database and Cloudflare account settings are supplied.

## Current implementation limits

This is the room-directory/API foundation, not the finished multiplayer system. The next engineering stages are the actual Geometry Dash editor hooks and edit-operation format, conflict resolution, reliable GD friend-list integration, client-side account-state gating, and the in-game Host/Join UI. The current API accepts account IDs supplied by the mod; it does not prove account ownership independently. The room WebSocket prevents duplicate simultaneous connections and enforces four live connections, but the client must call the connect route after checking/joining a room.
