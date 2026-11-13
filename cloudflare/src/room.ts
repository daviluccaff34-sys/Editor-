import { DurableObject } from "cloudflare:workers";

interface Env {}

type ClientInfo = { gdAccountId: string; playerName: string };
type RoomEvent = { type: "edit" | "cursor" | "presence"; data?: unknown };

export class EditorRoom extends DurableObject<Env> {
  private clients = new Map<WebSocket, ClientInfo>();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const gdAccountId = request.headers.get("X-GD-Account-ID") ?? "";
    const playerName = request.headers.get("X-GD-Player-Name") ?? "";
    if (!/^\d{1,32}$/.test(gdAccountId) || playerName.length < 1 || playerName.length > 32) {
      return new Response("A Geometry Dash account is required", { status: 401 });
    }

    const sockets = this.ctx.getWebSockets();
    const existing = sockets.find(socket => {
      const attachment = socket.deserializeAttachment() as ClientInfo | null;
      return attachment?.gdAccountId === gdAccountId;
    });
    if (existing) return new Response("Player is already connected", { status: 409 });
    if (sockets.length >= 4) return new Response("Room is full", { status: 409 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({ gdAccountId, playerName } satisfies ClientInfo);
    this.ctx.acceptWebSocket(server);
    this.broadcast({ type: "presence", data: { action: "joined", gdAccountId, playerName } }, server);
    server.send(JSON.stringify({
      type: "presence",
      data: {
        action: "snapshot",
        players: this.ctx.getWebSockets().map(socket => socket.deserializeAttachment())
      }
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string"
      ? message
      : new TextDecoder().decode(message);
    if (raw.length > 65536) {
      socket.close(1009, "Message too large");
      return;
    }

    let event: RoomEvent;
    try {
      event = JSON.parse(raw) as RoomEvent;
    } catch {
      socket.send(JSON.stringify({ type: "error", error: "invalid_json" }));
      return;
    }

    if (!event || !["edit", "cursor"].includes(event.type)) {
      socket.send(JSON.stringify({ type: "error", error: "unsupported_event" }));
      return;
    }

    const sender = socket.deserializeAttachment() as ClientInfo | null;
    if (!sender) {
      socket.close(1008, "Invalid session");
      return;
    }

    this.broadcast({
      type: event.type,
      data: { from: sender.gdAccountId, playerName: sender.playerName, payload: event.data }
    }, socket);
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    const client = socket.deserializeAttachment() as ClientInfo | null;
    try { socket.close(code, reason); } catch {}
    if (client) {
      this.broadcast({ type: "presence", data: {
        action: "left", gdAccountId: client.gdAccountId, playerName: client.playerName
      }});
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    try { socket.close(1011, "Connection error"); } catch {}
  }

  private broadcast(event: unknown, except?: WebSocket): void {
    const payload = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try { socket.send(payload); } catch { /* closed socket will be cleaned up by runtime */ }
    }
  }
}
