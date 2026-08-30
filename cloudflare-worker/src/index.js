import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    if (url.pathname === "/health") {
      return Response.json(
        {
          ok: true,
          service: "lightning-wind-pong-multiplayer",
          netcode: "v6-host-authoritative-relay"
        },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const match = url.pathname.match(/^\/room\/([A-Z0-9]{6})$/i);
    if (!match) {
      return new Response("Lightning vs Wind Pong V6 low-latency relay", { status: 200 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const roomCode = match[1].toUpperCase();
    const id = env.GAME_ROOMS.idFromName(roomCode);
    return env.GAME_ROOMS.get(id).fetch(request);
  }
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.matchId = 0;
    this.rematchVotes = new Set();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket only", { status: 426 });
    }

    const usedRoles = new Set(
      this.ctx.getWebSockets()
        .map(ws => ws.deserializeAttachment()?.role)
        .filter(Boolean)
    );

    let role = null;
    if (!usedRoles.has("lightning")) role = "lightning";
    else if (!usedRoles.has("wind")) role = "wind";

    if (!role) {
      return new Response("Room full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role, joinedAt: Date.now() });

    server.send(JSON.stringify({
      type: "welcome",
      role,
      netcode: "v6-low-latency"
    }));

    this.broadcastPlayers();

    if (this.playerCount() === 2) {
      this.beginMatch();
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, rawMessage) {
    let msg;
    try {
      const text = typeof rawMessage === "string"
        ? rawMessage
        : new TextDecoder().decode(rawMessage);
      msg = JSON.parse(text);
    } catch {
      return;
    }

    const role = ws.deserializeAttachment()?.role;
    if (!role) return;

    if (msg.type === "ping") {
      try {
        ws.send(JSON.stringify({
          type: "pong",
          id: msg.id,
          serverTime: Date.now()
        }));
      } catch {}
      return;
    }

    if (msg.type === "input") {
      // Wind invia soltanto i cambi di direzione. Cloudflare li inoltra
      // immediatamente a Lightning, che simula la fisica a 60 fps.
      if (role === "wind") {
        this.sendToRole("lightning", {
          type: "peer_input",
          role: "wind",
          dir: Number(msg.dir) || 0,
          y: Number(msg.y),
          sentAt: Number(msg.sentAt || Date.now()),
          serverTime: Date.now()
        });
      }
      return;
    }

    if (msg.type === "snapshot") {
      // Solo Lightning può pubblicare lo stato autorevole.
      if (role !== "lightning") return;
      this.sendToRole("wind", {
        type: "snapshot",
        seq: Number(msg.seq || 0),
        sentAt: Number(msg.sentAt || Date.now()),
        relayTime: Date.now(),
        state: msg.state || {}
      });
      return;
    }

    if (msg.type === "impact") {
      if (role === "lightning") {
        this.sendToRole("wind", {
          type: "impact",
          side: msg.side,
          x: Number(msg.x),
          y: Number(msg.y)
        });
      }
      return;
    }

    if (msg.type === "pause") {
      // Se Wind chiede pausa, inoltriamo la richiesta all'host.
      if (role === "wind") {
        this.sendToRole("lightning", { type: "pause_request", role: "wind" });
      }
      return;
    }

    if (msg.type === "rematch") {
      this.rematchVotes.add(role);
      if (this.rematchVotes.size >= 2 && this.playerCount() === 2) {
        this.beginMatch();
      }
      return;
    }
  }

  async webSocketClose(ws) {
    const role = ws.deserializeAttachment()?.role;
    queueMicrotask(() => {
      this.broadcastPlayers();
      this.sendAll({ type: "peer_left", role });
      this.rematchVotes.clear();
    });
  }

  async webSocketError(ws) {
    try { ws.close(1011, "WebSocket error"); } catch {}
  }

  playerCount() {
    return this.ctx.getWebSockets().length;
  }

  rolesPresent() {
    const roles = { lightning: false, wind: false };
    for (const ws of this.ctx.getWebSockets()) {
      const role = ws.deserializeAttachment()?.role;
      if (role) roles[role] = true;
    }
    return roles;
  }

  beginMatch() {
    this.matchId += 1;
    this.rematchVotes.clear();
    this.sendAll({
      type: "start",
      matchId: this.matchId,
      startAt: Date.now() + 1100,
      serverTime: Date.now()
    });
  }

  sendToRole(role, obj) {
    const payload = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.deserializeAttachment()?.role !== role) continue;
      try { ws.send(payload); } catch {}
    }
  }

  sendAll(obj) {
    const payload = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch {}
    }
  }

  broadcastPlayers() {
    this.sendAll({
      type: "players",
      players: this.rolesPresent()
    });
  }
}
