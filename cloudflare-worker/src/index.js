import { DurableObject } from "cloudflare:workers";

const GAME_W = 720;
const GAME_H = 960;
const WIN_SCORE = 10;
const PADDLE_H = 180;
const PADDLE_W = 16;
const LEFT_X = 30;
const RIGHT_X = GAME_W - 46;
const PADDLE_SPEED = 620;
const BALL_RADIUS = 11;
const START_SPEED = 470;
const MAX_SPEED = 1080;
const TICK_MS = 20; // 50 Hz server simulation / snapshots

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function defaultGame() {
  return {
    status: "waiting",
    startAt: 0,
    paddles: {
      lightningY: GAME_H / 2 - PADDLE_H / 2,
      windY: GAME_H / 2 - PADDLE_H / 2
    },
    ball: { x: GAME_W / 2, y: GAME_H / 2, vx: 0, vy: 0 },
    score: { lightning: 0, wind: 0 },
    winner: null,
    paused: false,
    serveAt: 0
  };
}

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
        { ok: true, service: "lightning-wind-pong-multiplayer" },
        { headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const match = url.pathname.match(/^\/room\/([A-Z0-9]{6})$/i);
    if (!match) {
      return new Response("Lightning vs Wind Pong multiplayer server", { status: 200 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const roomCode = match[1].toUpperCase();
    const id = env.GAME_ROOMS.idFromName(roomCode);
    const stub = env.GAME_ROOMS.get(id);
    return stub.fetch(request);
  }
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.game = defaultGame();
    this.inputs = { lightning: 0, wind: 0 };
    this.rematchVotes = new Set();
    this.loop = null;
    this.lastTick = Date.now();

    this.ctx.blockConcurrencyWhile(async () => {
      this.game = (await this.ctx.storage.get("game")) || defaultGame();
      // Se il DO si riattiva senza loop, il gioco verrà riavviato quando entrambi sono connessi.
      this.reconcilePlayers();
    });
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket only", { status: 426 });
    }

    const sockets = this.ctx.getWebSockets();
    const used = new Set(
      sockets
        .map((ws) => ws.deserializeAttachment()?.role)
        .filter(Boolean)
    );

    let role = null;
    if (!used.has("lightning")) role = "lightning";
    else if (!used.has("wind")) role = "wind";

    if (!role) {
      return new Response("Room full", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role, joinedAt: Date.now() });

    server.send(JSON.stringify({ type: "welcome", role }));
    this.broadcastPlayers();

    if (this.playerCount() === 2) {
      this.startNewMatch();
    } else {
      this.game.status = "waiting";
      this.game.ball.vx = 0;
      this.game.ball.vy = 0;
      await this.persist();
      this.broadcastState();
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, rawMessage) {
    let msg;
    try {
      const text = typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage);
      msg = JSON.parse(text);
    } catch {
      return;
    }

    const role = ws.deserializeAttachment()?.role;
    if (!role) return;

    if (msg.type === "input") {
      this.inputs[role] = clamp(Number(msg.dir) || 0, -1, 1);
      return;
    }

    if (msg.type === "pause") {
      if (this.game.status === "playing") {
        this.game.paused = !this.game.paused;
        this.broadcastState();
        await this.persist();
      }
      return;
    }

    if (msg.type === "rematch") {
      this.rematchVotes.add(role);
      if (this.rematchVotes.size >= 2 && this.playerCount() === 2) {
        this.startNewMatch();
      } else {
        this.sendAll({ type: "rematch_waiting", votes: this.rematchVotes.size });
      }
    }
  }

  async webSocketClose(ws) {
    const role = ws.deserializeAttachment()?.role;
    if (role) this.inputs[role] = 0;

    // Lascia al runtime il tempo di rimuovere il socket prima del conteggio.
    queueMicrotask(async () => {
      this.broadcastPlayers();

      if (this.playerCount() < 2) {
        this.stopLoop();
        this.game.status = "waiting";
        this.game.paused = false;
        this.game.ball.vx = 0;
        this.game.ball.vy = 0;
        this.rematchVotes.clear();
        await this.persist();
        this.broadcastState();
      }
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

  reconcilePlayers() {
    if (this.playerCount() === 2 && (this.game.status === "playing" || this.game.status === "countdown")) {
      this.ensureLoop();
    }
  }

  sendAll(obj) {
    const payload = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch {}
    }
  }

  broadcastPlayers() {
    this.sendAll({ type: "players", players: this.rolesPresent() });
  }

  broadcastState() {
    this.sendAll({ type: "state", serverTime: Date.now(), state: this.game });
  }

  async persist() {
    await this.ctx.storage.put("game", this.game);
  }

  startNewMatch() {
    this.game = defaultGame();
    this.game.status = "countdown";
    this.game.startAt = Date.now() + 3200;
    this.game.serveAt = this.game.startAt;
    this.game.ball = this.newBall(Math.random() > 0.5 ? 1 : -1);
    this.game.ball.vx = 0;
    this.game.ball.vy = 0;
    this.pendingServeDirection = Math.random() > 0.5 ? 1 : -1;
    this.inputs.lightning = 0;
    this.inputs.wind = 0;
    this.rematchVotes.clear();
    this.lastTick = Date.now();
    this.ensureLoop();
    this.persist();
    this.broadcastState();
  }

  ensureLoop() {
    if (this.loop) return;
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  stopLoop() {
    if (this.loop) {
      clearInterval(this.loop);
      this.loop = null;
    }
  }

  newBall(direction) {
    const speed = START_SPEED;
    const angle = Math.random() * 0.78 - 0.39;
    return {
      x: GAME_W / 2,
      y: GAME_H / 2,
      vx: Math.cos(angle) * speed * direction,
      vy: Math.sin(angle) * speed
    };
  }

  resetServe(direction) {
    const b = this.newBall(direction);
    this.game.ball = { x: GAME_W / 2, y: GAME_H / 2, vx: 0, vy: 0 };
    this.pendingBall = b;
    this.game.serveAt = Date.now() + 650;
  }

  async tick() {
    try {
      if (this.playerCount() < 2) return;

      const now = Date.now();
      let dt = Math.min((now - this.lastTick) / 1000, 0.04);
      this.lastTick = now;

      if (this.game.status === "countdown") {
        if (now >= this.game.startAt) {
          const b = this.newBall(this.pendingServeDirection || 1);
          this.game.ball = b;
          this.game.status = "playing";
          this.game.serveAt = 0;
        }
        this.broadcastState();
        return;
      }

      if (this.game.status !== "playing" || this.game.paused) {
        this.broadcastState();
        return;
      }

      const p = this.game.paddles;
      p.lightningY = clamp(p.lightningY + this.inputs.lightning * PADDLE_SPEED * dt, 18, GAME_H - PADDLE_H - 18);
      p.windY = clamp(p.windY + this.inputs.wind * PADDLE_SPEED * dt, 18, GAME_H - PADDLE_H - 18);

      if (this.game.serveAt && now < this.game.serveAt) {
        this.broadcastState();
        return;
      }
      if (this.game.serveAt && now >= this.game.serveAt && this.pendingBall) {
        this.game.ball = this.pendingBall;
        this.pendingBall = null;
        this.game.serveAt = 0;
      }

      const b = this.game.ball;
      const speed = Math.max(Math.abs(b.vx), Math.abs(b.vy));
      const steps = clamp(Math.ceil(speed * dt / 10), 1, 8);
      const sub = dt / steps;

      for (let i = 0; i < steps; i++) {
        b.x += b.vx * sub;
        b.y += b.vy * sub;

        if (b.y <= 30 && b.vy < 0) {
          b.y = 30; b.vy *= -1;
        }
        if (b.y >= GAME_H - 30 && b.vy > 0) {
          b.y = GAME_H - 30; b.vy *= -1;
        }

        this.checkPaddle("lightning", LEFT_X, p.lightningY);
        this.checkPaddle("wind", RIGHT_X, p.windY);

        if (b.x < -45) {
          this.scorePoint("wind");
          break;
        }
        if (b.x > GAME_W + 45) {
          this.scorePoint("lightning");
          break;
        }
      }

      if (Math.random() < 0.02) this.persist();
      this.broadcastState();
    } catch (err) {
      console.error("tick error", err);
    }
  }

  checkPaddle(side, x, y) {
    const b = this.game.ball;
    if (b.y + BALL_RADIUS < y || b.y - BALL_RADIUS > y + PADDLE_H) return;

    const isLeft = side === "lightning";
    const hit =
      isLeft
        ? b.vx < 0 && b.x - BALL_RADIUS <= x + PADDLE_W && b.x + BALL_RADIUS >= x
        : b.vx > 0 && b.x + BALL_RADIUS >= x && b.x - BALL_RADIUS <= x + PADDLE_W;

    if (!hit) return;

    b.x = isLeft ? x + PADDLE_W + BALL_RADIUS : x - BALL_RADIUS;
    const center = y + PADDLE_H / 2;
    const offset = clamp((b.y - center) / (PADDLE_H / 2), -1, 1);
    const angle = offset * 1.04;
    const currentSpeed = Math.min(Math.hypot(b.vx, b.vy) + 36, MAX_SPEED);
    const dir = isLeft ? 1 : -1;
    b.vx = Math.cos(angle) * currentSpeed * dir;
    b.vy = Math.sin(angle) * currentSpeed;

    this.sendAll({ type: "impact", side, x: b.x, y: b.y });
  }

  scorePoint(side) {
    this.game.score[side] += 1;

    if (this.game.score[side] >= WIN_SCORE) {
      this.game.status = "gameover";
      this.game.winner = side;
      this.game.ball.vx = 0;
      this.game.ball.vy = 0;
      this.stopLoop();
      this.persist();
      this.broadcastState();
      return;
    }

    this.resetServe(side === "lightning" ? -1 : 1);
  }
}