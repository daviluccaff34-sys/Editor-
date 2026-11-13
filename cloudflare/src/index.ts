import { EditorRoom } from "./room";

export interface Env {
  DB: D1Database;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ROOMS: DurableObjectNamespace<EditorRoom>;
}

type RoomRow = {
  room_code: string;
  host_gd_account_id: string;
  host_player_name: string;
  status: "open" | "closed";
  player_count: number;
  created_at: number;
  updated_at: number;
};

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function isCloudflareAccessRequest(request: Request, env: Env): Promise<boolean> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  try {
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
    if (header.alg !== "RS256" || claims.iss !== issuer ||
        !Array.isArray(claims.aud) || !claims.aud.includes(env.ACCESS_AUD) ||
        typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) {
      return false;
    }

    const response = await fetch(`${issuer}/cdn-cgi/access/certs`);
    if (!response.ok) return false;
    const jwks = await response.json() as { keys?: JsonWebKey[] };
    const jwk = jwks.keys?.find(key => key.kid === header.kid);
    if (!jwk) return false;
    const publicKey = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", publicKey,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
  } catch {
    return false;
  }
}

async function adminRooms(request: Request, env: Env): Promise<Response> {
  if (!(await isCloudflareAccessRequest(request, env))) {
    return json({ error: "admin_access_required" }, 403);
  }
  const rows = await env.DB.prepare(
    "SELECT room_code, host_player_name, status, player_count FROM rooms ORDER BY updated_at DESC LIMIT 500"
  ).all<Pick<RoomRow, "room_code" | "host_player_name" | "status" | "player_count">>();
  return json({
    rooms: rows.results.map(room => ({
      code: room.room_code,
      hostName: room.host_player_name,
      status: room.status,
      playerCount: room.player_count
    }))
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400"
      }});
    }

    try {
      if (request.method === "GET" && path === "/api/health") {
        return json({ ok: true, service: "editor-plus-plus-api" });
      }

      if (request.method === "GET" && path === "/api/rooms/friends") {
        const playerId = cleanText(url.searchParams.get("playerId"), 32);
        const friendsRaw = url.searchParams.get("friends") ?? "";
        const friends = [...new Set(friendsRaw.split(",").map(id => id.trim()).filter(id => /^\d{1,32}$/.test(id)))].slice(0, 500);
        if (!playerId || !/^\d{1,32}$/.test(playerId)) return json({ error: "invalid_player_id" }, 400);
        if (!friends.length) return json({ rooms: [] });
        const placeholders = friends.map(() => "?").join(",");
        const result = await env.DB.prepare(
          `SELECT room_code, host_gd_account_id, host_player_name, player_count FROM rooms WHERE status = 'open' AND host_gd_account_id IN (${placeholders}) AND host_gd_account_id != ? ORDER BY updated_at DESC`
        ).bind(...friends, playerId).all<RoomRow>();
        return json({ rooms: result.results.map(room => ({
          code: room.room_code, hostId: room.host_gd_account_id,
          hostName: room.host_player_name, playerCount: room.player_count, maxPlayers: 4
        })) });
      }

      if (request.method === "POST" && path === "/api/rooms") {
        const body = await request.json() as Record<string, unknown>;
        const accountId = cleanText(body.gdAccountId, 32);
        const playerName = cleanText(body.playerName, 32);
        if (!accountId || !/^\d{1,32}$/.test(accountId) || !playerName) {
          return json({ error: "geometry_dash_account_required" }, 400);
        }
        const existing = await env.DB.prepare(
          "SELECT room_code FROM rooms WHERE host_gd_account_id = ? AND status = 'open' LIMIT 1"
        ).bind(accountId).first<{ room_code: string }>();
        if (existing) return json({ error: "host_already_has_open_room", code: existing.room_code }, 409);

        let code = roomCode();
        for (let attempt = 0; attempt < 4; attempt++) {
          const taken = await env.DB.prepare("SELECT room_code FROM rooms WHERE room_code = ?").bind(code).first();
          if (!taken) break;
          code = roomCode();
        }
        const now = Date.now();
        await env.DB.prepare(
          "INSERT INTO rooms (room_code, host_gd_account_id, host_player_name, status, player_count, max_players, created_at, updated_at) VALUES (?, ?, ?, 'open', 1, 4, ?, ?)"
        ).bind(code, accountId, playerName, now, now).run();
        return json({ ok: true, code, playerCount: 1, maxPlayers: 4 }, 201);
      }

      const joinMatch = path.match(/^\/api\/rooms\/([A-Z0-9]{6})\/join$/);
      if (request.method === "POST" && joinMatch) {
        const body = await request.json() as Record<string, unknown>;
        const accountId = cleanText(body.gdAccountId, 32);
        const playerName = cleanText(body.playerName, 32);
        if (!accountId || !/^\d{1,32}$/.test(accountId) || !playerName) {
          return json({ error: "geometry_dash_account_required" }, 400);
        }
        const result = await env.DB.prepare(
          "SELECT room_code, player_count FROM rooms WHERE room_code = ? AND status = 'open' AND host_gd_account_id != ?"
        ).bind(joinMatch[1], accountId).first<{ room_code: string; player_count: number }>();
        if (!result) return json({ error: "room_unavailable" }, 409);
        return json({ ok: true, code: result.room_code, playerCount: result.player_count, maxPlayers: 4 });
      }

      const connectMatch = path.match(/^\/api\/rooms\/([A-Z0-9]{6})\/connect$/);
      if (request.method === "GET" && connectMatch) {
        const accountId = cleanText(url.searchParams.get("gdAccountId"), 32);
        const playerName = cleanText(url.searchParams.get("playerName"), 32);
        if (!accountId || !/^\d{1,32}$/.test(accountId) || !playerName) {
          return json({ error: "geometry_dash_account_required" }, 400);
        }
        const room = await env.DB.prepare(
          "SELECT room_code FROM rooms WHERE room_code = ? AND status = 'open'"
        ).bind(connectMatch[1]).first();
        if (!room) return json({ error: "room_not_found" }, 404);
        const stub = env.ROOMS.getByName(connectMatch[1]);
        const headers = new Headers(request.headers);
        headers.set("X-GD-Account-ID", accountId);
        headers.set("X-GD-Player-Name", playerName);
        headers.set("X-ROOM-CODE", connectMatch[1]);
        return stub.fetch(new Request("https://room.internal/connect", {
          method: "GET", headers
        }));
      }

      if (request.method === "GET" && path === "/api/admin/rooms") {
        return adminRooms(request, env);
      }

      const closeMatch = path.match(/^\/api\/admin\/rooms\/([A-Z0-9]{6})\/close$/);
      if (request.method === "POST" && closeMatch) {
        if (!(await isCloudflareAccessRequest(request, env))) return json({ error: "admin_access_required" }, 403);
        await env.DB.prepare("UPDATE rooms SET status = 'closed', updated_at = ? WHERE room_code = ?")
          .bind(Date.now(), closeMatch[1]).run();
        return json({ ok: true, code: closeMatch[1] });
      }

      return json({ error: "not_found" }, 404);
    } catch {
      return json({ error: "internal_error" }, 500);
    }
  }
};
