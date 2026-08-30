(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const WIN_SCORE = 10;

  const ui = {
    leftScore: $("leftScore"), rightScore: $("rightScore"), matchLabel: $("matchLabel"),
    connectionBadge: $("connectionBadge"), roleBadge: $("roleBadge"),
    menuOverlay: $("menuOverlay"), onlineOverlay: $("onlineOverlay"),
    pauseOverlay: $("pauseOverlay"), gameOverOverlay: $("gameOverOverlay"),
    winnerText: $("winnerText"), finalScoreText: $("finalScoreText"),
    countdown: $("countdown"), impactFlash: $("impactFlash"),
    roomCodeInput: $("roomCodeInput"), onlineConfigHint: $("onlineConfigHint"),
    onlineSetup: $("onlineSetup"), onlineLobby: $("onlineLobby"),
    roomCodeDisplay: $("roomCodeDisplay"), roleMessage: $("roleMessage"), lobbyMessage: $("lobbyMessage"),
    lightningStatus: $("lightningStatus"), windStatus: $("windStatus"),
    installBtn: $("installBtn"), soundBtn: $("soundBtn")
  };

  const CONFIG = window.LWP_CONFIG || {};
  const WORKER_URL = String(CONFIG.workerUrl || "").replace(/\/+$/, "");
  const WORKER_CONFIGURED = /^https:\/\/.+\.workers\.dev$/.test(WORKER_URL) && !WORKER_URL.includes("REPLACE-WITH");

  let mode = "menu"; // menu | cpu | local | online-menu | online
  let difficulty = "normal";
  let running = false;
  let paused = false;
  let gameOver = false;
  let lastTime = performance.now();
  let leftScore = 0;
  let rightScore = 0;
  let shake = 0;

  const left = { x: 30, y: H / 2 - 90, w: 16, h: 180, speed: 620 };
  const right = { x: W - 46, y: H / 2 - 90, w: 16, h: 180, speed: 620 };
  const ball = { x: W / 2, y: H / 2, r: 11, vx: 0, vy: 0, speed: 470, maxSpeed: 1080 };
  const keys = { w: false, s: false, up: false, down: false };
  let buttonDirection = 0;

  const trail = [];
  const particles = [];
  const stars = Array.from({ length: 78 }, () => ({
    x: Math.random() * W, y: Math.random() * H, r: 0.5 + Math.random() * 1.7,
    a: 0.14 + Math.random() * 0.55, t: Math.random() * Math.PI * 2
  }));
  const windLines = Array.from({ length: 16 }, () => ({
    x: W * 0.55 + Math.random() * W * 0.42, y: Math.random() * H,
    len: 30 + Math.random() * 90, speed: 20 + Math.random() * 40, a: 0.04 + Math.random() * 0.09
  }));

  let audioCtx = null;
  let soundOn = true;
  let musicTimer = null;
  let musicStep = 0;
  let deferredInstallPrompt = null;

  // Multiplayer state
  let ws = null;
  let roomCode = "";
  let onlineRole = null;
  let onlinePlayers = { lightning: false, wind: false };
  let onlineState = null;
  let onlineInput = 0;
  let manualDisconnect = false;
  let reconnectTimer = null;
  let shareUrl = "";
  const remote = {
    leftY: left.y, rightY: right.y,
    ballX: ball.x, ballY: ball.y, ballVx: 0, ballVy: 0,
    hasState: false
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const normalizeCode = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  function randomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
  function workerWsUrl(code) {
    const u = new URL(WORKER_URL);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = `/room/${encodeURIComponent(code)}`;
    u.search = "";
    return u.toString();
  }
  function updateScore() {
    ui.leftScore.textContent = leftScore;
    ui.rightScore.textContent = rightScore;
  }
  function setBadge(text, state = "local") {
    ui.connectionBadge.textContent = text;
    ui.connectionBadge.className = `connection-badge ${state}`;
  }
  function showOnly(overlay) {
    [ui.menuOverlay, ui.onlineOverlay, ui.pauseOverlay, ui.gameOverOverlay].forEach((o) => o.classList.remove("show"));
    if (overlay) overlay.classList.add("show");
  }
  function resetPaddles() {
    left.y = H / 2 - left.h / 2;
    right.y = H / 2 - right.h / 2;
  }
  function resetBall(dir = Math.random() > 0.5 ? 1 : -1) {
    ball.x = W / 2; ball.y = H / 2; ball.speed = 470;
    const a = Math.random() * 0.78 - 0.39;
    ball.vx = Math.cos(a) * ball.speed * dir;
    ball.vy = Math.sin(a) * ball.speed;
    trail.length = 0;
  }
  function burst(x, y, side, count = 28) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 50 + Math.random() * 260;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.2 + Math.random() * 0.65, max: 0.85, r: 1 + Math.random() * 3.6, side });
    }
  }
  function impact(side, x = W / 2, y = H / 2) {
    shake = 7;
    burst(x, y, side, 30);
    ui.impactFlash.classList.remove("flash");
    void ui.impactFlash.offsetWidth;
    ui.impactFlash.classList.add("flash");
    navigator.vibrate?.(15);
  }

  // Audio
  function unlockAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx?.state === "suspended") audioCtx.resume();
  }
  function tone(freq, duration = 0.05, type = "sine", volume = 0.03, delay = 0) {
    if (!soundOn) return;
    unlockAudio();
    if (!audioCtx) return;
    const t = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(t); osc.stop(t + duration + 0.03);
  }
  function startMusic() {
    if (!soundOn || musicTimer) return;
    const notes = [146.83, 174.61, 220, 196, 174.61, 146.83, 130.81, 146.83];
    musicTimer = setInterval(() => {
      if (!running || paused || !soundOn) return;
      tone(notes[musicStep++ % notes.length], 0.16, "triangle", 0.009);
    }, 300);
  }
  function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

  // Local game
  function startLocal(selectedMode) {
    disconnectOnline(true);
    mode = selectedMode; running = true; paused = false; gameOver = false;
    leftScore = rightScore = 0; updateScore(); resetPaddles(); resetBall();
    showOnly(null);
    ui.matchLabel.textContent = selectedMode === "cpu" ? `CPU ${difficulty.toUpperCase()} · FIRST TO 10` : "2 PLAYERS · FIRST TO 10";
    ui.roleBadge.textContent = selectedMode === "cpu" ? "⚡ TU SEI LIGHTNING" : "👥 2 GIOCATORI LOCALI";
    setBadge("LOCAL", "local");
    unlockAudio(); startMusic(); tone(220, 0.08, "sine", 0.04); requestGameFullscreen();
  }
  let cpuTimer = 0, cpuTarget = H / 2;
  function updateCpu(dt) {
    const cfg = { easy: [390, .22, 100], normal: [520, .11, 52], hard: [635, .055, 20] }[difficulty];
    cpuTimer -= dt;
    if (cpuTimer <= 0) {
      cpuTimer = cfg[1];
      let target = ball.vx > 0 ? ball.y + ball.vy * ((right.x - ball.x) / ball.vx) : H / 2;
      while (target < 30 || target > H - 30) {
        if (target < 30) target = 30 + (30 - target);
        if (target > H - 30) target = H - 30 - (target - (H - 30));
      }
      cpuTarget = target + (Math.random() * 2 - 1) * cfg[2];
    }
    const d = cpuTarget - (right.y + right.h / 2);
    right.y += clamp(d, -cfg[0] * dt, cfg[0] * dt);
  }
  function reflect(p, side) {
    const center = p.y + p.h / 2;
    const off = clamp((ball.y - center) / (p.h / 2), -1, 1);
    ball.speed = Math.min(ball.speed + 36, ball.maxSpeed);
    const dir = side === "lightning" ? 1 : -1;
    ball.vx = Math.cos(off * 1.04) * ball.speed * dir;
    ball.vy = Math.sin(off * 1.04) * ball.speed;
    impact(side, ball.x, ball.y);
    tone(side === "lightning" ? 760 : 610, 0.045, "sine", 0.03);
  }
  function hit(p, side) {
    if (ball.y + ball.r < p.y || ball.y - ball.r > p.y + p.h) return;
    if (side === "lightning" && ball.vx < 0 && ball.x - ball.r <= p.x + p.w && ball.x + ball.r >= p.x) {
      ball.x = p.x + p.w + ball.r; reflect(p, side);
    }
    if (side === "wind" && ball.vx > 0 && ball.x + ball.r >= p.x && ball.x - ball.r <= p.x + p.w) {
      ball.x = p.x - ball.r; reflect(p, side);
    }
  }
  function localPoint(side) {
    if (side === "lightning") leftScore++; else rightScore++;
    updateScore();
    if (leftScore >= WIN_SCORE || rightScore >= WIN_SCORE) {
      running = false; gameOver = true; stopMusic();
      const lightningWon = leftScore > rightScore;
      ui.winnerText.textContent = lightningWon ? "⚡ LIGHTNING VINCE!" : "🌪 WIND VINCE!";
      ui.finalScoreText.textContent = `${leftScore} — ${rightScore}`;
      ui.gameOverOverlay.classList.add("show");
      return;
    }
    resetBall(side === "lightning" ? -1 : 1);
  }
  function updateLocal(dt) {
    left.y += ((buttonDirection || (keys.w ? -1 : 0) || (keys.s ? 1 : 0)) * left.speed * dt);
    if (mode === "local") right.y += (((keys.up ? -1 : 0) || (keys.down ? 1 : 0)) * right.speed * dt);
    else updateCpu(dt);
    left.y = clamp(left.y, 18, H - left.h - 18);
    right.y = clamp(right.y, 18, H - right.h - 18);
    const steps = clamp(Math.ceil(Math.max(Math.abs(ball.vx), Math.abs(ball.vy)) * dt / 10), 1, 8);
    const sub = dt / steps;
    for (let i = 0; i < steps; i++) {
      ball.x += ball.vx * sub; ball.y += ball.vy * sub;
      if (ball.y <= 30 && ball.vy < 0) { ball.y = 30; ball.vy *= -1; }
      if (ball.y >= H - 30 && ball.vy > 0) { ball.y = H - 30; ball.vy *= -1; }
      hit(left, "lightning"); hit(right, "wind");
      if (ball.x < -45) { localPoint("wind"); break; }
      if (ball.x > W + 45) { localPoint("lightning"); break; }
    }
  }

  // Multiplayer
  function openOnlineMenu() {
    mode = "online-menu"; running = false; paused = false; gameOver = false; stopMusic();
    showOnly(ui.onlineOverlay);
    ui.onlineSetup.classList.remove("hidden"); ui.onlineLobby.classList.add("hidden");
    ui.onlineConfigHint.textContent = WORKER_CONFIGURED
      ? "Cloudflare pronto. Crea una stanza o inserisci il codice dell'altro telefono."
      : "Worker Cloudflare non configurato.";
    setBadge("ONLINE", "waiting");
  }
  function connectRoom(code) {
    code = normalizeCode(code);
    if (!WORKER_CONFIGURED) { ui.onlineConfigHint.textContent = "Worker Cloudflare non configurato."; return; }
    if (code.length !== 6) { ui.onlineConfigHint.textContent = "Il codice stanza deve avere 6 caratteri."; return; }

    // FIX V5.2: da questo momento siamo davvero in modalità online.
    mode = "online";
    disconnectOnline(true);
    mode = "online";
    manualDisconnect = false;
    roomCode = code; onlineRole = null; onlineState = null; onlinePlayers = { lightning: false, wind: false };
    remote.hasState = false; onlineInput = 0;
    ui.roomCodeDisplay.textContent = code;
    ui.onlineSetup.classList.add("hidden"); ui.onlineLobby.classList.remove("hidden");
    updateLobby();
    shareUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;

    try { ws = new WebSocket(workerWsUrl(code)); }
    catch { ui.lobbyMessage.textContent = "Impossibile aprire il WebSocket."; return; }

    ws.addEventListener("open", () => {
      mode = "online";
      setBadge(`ROOM ${code}`, "online");
      ui.lobbyMessage.textContent = "Connesso. In attesa dell'altro giocatore...";
    });
    ws.addEventListener("message", (event) => {
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      handleOnlineMessage(msg);
    });
    ws.addEventListener("close", () => {
      if (manualDisconnect) return;
      running = false; stopMusic(); setBadge("DISCONNESSO", "waiting");
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => connectRoom(roomCode), 1400);
    });
  }
  function handleOnlineMessage(msg) {
    if (msg.type === "welcome") {
      mode = "online";
      onlineRole = msg.role;
      ui.roleMessage.textContent = onlineRole === "lightning" ? "⚡ TU SEI LIGHTNING" : "🌪 TU SEI WIND";
      ui.roleBadge.textContent = ui.roleMessage.textContent;
      updateLobby(); return;
    }
    if (msg.type === "players") { onlinePlayers = msg.players || onlinePlayers; updateLobby(); return; }
    if (msg.type === "impact") { impact(msg.side, msg.x, msg.y); return; }
    if (msg.type !== "state") return;

    mode = "online";
    onlineState = msg.state || {};
    leftScore = Number(onlineState.score?.lightning || 0);
    rightScore = Number(onlineState.score?.wind || 0);
    updateScore();

    if (onlineState.paddles) {
      remote.leftY = Number(onlineState.paddles.lightningY ?? remote.leftY);
      remote.rightY = Number(onlineState.paddles.windY ?? remote.rightY);
    }
    if (onlineState.ball) {
      remote.ballX = Number(onlineState.ball.x ?? remote.ballX);
      remote.ballY = Number(onlineState.ball.y ?? remote.ballY);
      remote.ballVx = Number(onlineState.ball.vx || 0);
      remote.ballVy = Number(onlineState.ball.vy || 0);
      remote.hasState = true;
    }

    if (onlineState.status === "playing" || onlineState.status === "countdown") {
      gameOver = false; paused = !!onlineState.paused;
      if (!running) {
        running = true; showOnly(null); startMusic(); requestGameFullscreen();
      }
      ui.matchLabel.textContent = `ROOM ${roomCode} · FIRST TO 10`;
      updateCountdown();
    } else if (onlineState.status === "gameover") {
      running = false; gameOver = true; stopMusic();
      const l = onlineState.winner === "lightning";
      ui.winnerText.textContent = l ? "⚡ LIGHTNING VINCE!" : "🌪 WIND VINCE!";
      ui.finalScoreText.textContent = `${leftScore} — ${rightScore}`;
      ui.gameOverOverlay.classList.add("show");
    } else if (onlineState.status === "waiting") {
      running = false; showOnly(ui.onlineOverlay);
      ui.onlineSetup.classList.add("hidden"); ui.onlineLobby.classList.remove("hidden");
      ui.lobbyMessage.textContent = "In attesa del secondo telefono.";
    }
  }
  function updateLobby() {
    const l = !!onlinePlayers.lightning, w = !!onlinePlayers.wind;
    ui.lightningStatus.textContent = l ? "CONNESSO" : "IN ATTESA";
    ui.windStatus.textContent = w ? "CONNESSO" : "IN ATTESA";
    ui.lightningStatus.classList.toggle("connected", l);
    ui.windStatus.classList.toggle("connected", w);
    if (onlineRole) ui.roleMessage.textContent = onlineRole === "lightning" ? "⚡ TU SEI LIGHTNING" : "🌪 TU SEI WIND";
    if (l && w) ui.lobbyMessage.textContent = "Entrambi connessi. La partita sta iniziando...";
  }
  function updateCountdown() {
    const startAt = Number(onlineState?.startAt || 0);
    if (onlineState?.status === "countdown" && startAt > Date.now()) {
      ui.countdown.textContent = Math.max(1, Math.ceil((startAt - Date.now()) / 1000));
      ui.countdown.classList.remove("hidden");
    } else ui.countdown.classList.add("hidden");
  }
  function sendOnline(payload) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }
  function setOnlineInput(dir) {
    if (mode !== "online" || !onlineRole) return;
    dir = clamp(Number(dir) || 0, -1, 1);
    if (dir === onlineInput) return;
    onlineInput = dir;
    sendOnline({ type: "input", dir });
  }
  function disconnectOnline(manual = false) {
    manualDisconnect = manual;
    clearTimeout(reconnectTimer); reconnectTimer = null;
    if (ws) { try { ws.close(1000, "leave"); } catch {} ws = null; }
    onlineRole = null; onlineState = null; onlinePlayers = { lightning: false, wind: false }; onlineInput = 0;
  }
  function updateOnlineVisuals(dt) {
    if (!remote.hasState) return;
    // Interpolazione: riduce gli scatti fra i pacchetti server (~30 Hz).
    const paddleLerp = Math.min(1, 18 * dt);
    const ballLerp = Math.min(1, 22 * dt);
    left.y += (remote.leftY - left.y) * paddleLerp;
    right.y += (remote.rightY - right.y) * paddleLerp;
    trail.unshift({ x: ball.x, y: ball.y, side: remote.ballVx >= 0 ? "wind" : "lightning" });
    if (trail.length > 18) trail.pop();
    ball.x += (remote.ballX - ball.x) * ballLerp;
    ball.y += (remote.ballY - ball.y) * ballLerp;
    ball.vx = remote.ballVx; ball.vy = remote.ballVy;
  }

  // Drawing
  function drawBackground(now) {
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "#021a2b"); g.addColorStop(.47, "#04111f"); g.addColorStop(.53, "#07101d"); g.addColorStop(1, "#171b28");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(87,168,205,.045)"; ctx.lineWidth = 1;
    for (let y = 60; y < H; y += 70) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    for (let x = 70; x < W; x += 70) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    const lg = ctx.createRadialGradient(65, H * .5, 10, 65, H * .5, 390);
    lg.addColorStop(0, "rgba(0,213,255,.22)"); lg.addColorStop(1, "rgba(0,213,255,0)"); ctx.fillStyle = lg; ctx.fillRect(0, 0, W * .55, H);
    const rg = ctx.createRadialGradient(W - 55, H * .5, 10, W - 55, H * .5, 360);
    rg.addColorStop(0, "rgba(255,255,255,.12)"); rg.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = rg; ctx.fillRect(W * .45, 0, W * .55, H);
    for (const s of stars) {
      ctx.fillStyle = `rgba(184,231,255,${clamp(s.a + Math.sin(now * .001 + s.t) * .1, .03, .7)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    for (const l of windLines) {
      l.x += l.speed * .016; if (l.x > W + 100) l.x = W * .53 - 100;
      const gr = ctx.createLinearGradient(l.x, l.y, l.x + l.len, l.y);
      gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(1, `rgba(235,247,255,${l.a})`);
      ctx.strokeStyle = gr; ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.quadraticCurveTo(l.x + l.len * .5, l.y - 10, l.x + l.len, l.y); ctx.stroke();
    }
    ctx.save(); ctx.strokeStyle = "rgba(157,218,247,.11)"; ctx.setLineDash([10, 16]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2, 24); ctx.lineTo(W / 2, H - 24); ctx.stroke(); ctx.restore();
  }
  function drawPaddle(p, side) {
    ctx.save();
    const own = mode === "online" && onlineRole === side;
    ctx.shadowBlur = own ? 38 : 27; ctx.shadowColor = side === "lightning" ? "#22ddff" : "#ffffff";
    ctx.fillStyle = side === "lightning" ? "#25d8ff" : "#eef7ff";
    ctx.beginPath(); ctx.roundRect(p.x, p.y, p.w, p.h, 8); ctx.fill();
    if (own) { ctx.strokeStyle = side === "lightning" ? "#5ff2ff" : "#ffffff"; ctx.lineWidth = 2; ctx.strokeRect(p.x - 5, p.y - 5, p.w + 10, p.h + 10); }
    ctx.restore();
  }
  function drawBall() {
    ctx.save(); ctx.shadowBlur = 34; ctx.shadowColor = ball.vx >= 0 ? "#fff" : "#22ddff"; ctx.fillStyle = "#f7fdff";
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function drawTrail() {
    for (let i = trail.length - 1; i >= 0; i--) {
      const t = trail[i], a = (1 - i / trail.length) * .25;
      ctx.fillStyle = t.side === "lightning" ? `rgba(34,221,255,${a})` : `rgba(255,255,255,${a})`;
      ctx.beginPath(); ctx.arc(t.x, t.y, Math.max(1, ball.r * (1 - i / trail.length)), 0, Math.PI * 2); ctx.fill();
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .97; p.vy *= .97;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function drawParticles() {
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.side === "lightning" ? `rgba(34,221,255,${a})` : `rgba(245,251,255,${a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * a, 0, Math.PI * 2); ctx.fill();
    }
  }
  function draw(now) {
    ctx.clearRect(0, 0, W, H); ctx.save();
    if (shake > 0) { ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake); shake *= .78; if (shake < .3) shake = 0; }
    drawBackground(now); drawTrail(); drawParticles(); drawPaddle(left, "lightning"); drawPaddle(right, "wind"); drawBall(); ctx.restore();
  }
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, .025); lastTime = now;
    if (running && !gameOver) {
      if (mode === "cpu" || mode === "local") { if (!paused) updateLocal(dt); }
      else if (mode === "online") { updateOnlineVisuals(dt); updateCountdown(); }
    }
    updateParticles(dt); draw(now); requestAnimationFrame(loop);
  }

  // Controls
  function pressMove(dir) {
    unlockAudio(); buttonDirection = dir;
    if (mode === "online") setOnlineInput(dir);
    navigator.vibrate?.(10);
  }
  function releaseMove() {
    buttonDirection = 0;
    if (mode === "online") setOnlineInput(0);
  }
  function bindHold(btn, dir) {
    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); btn.classList.add("pressed"); pressMove(dir); });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => btn.addEventListener(ev, () => { btn.classList.remove("pressed"); releaseMove(); }));
  }
  bindHold($("downBtn"), 1); bindHold($("upBtn"), -1);
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", " "].includes(k)) e.preventDefault();
    if (k === "w") { keys.w = true; if (mode === "online") setOnlineInput(-1); }
    if (k === "s") { keys.s = true; if (mode === "online") setOnlineInput(1); }
    if (k === "arrowup") keys.up = true; if (k === "arrowdown") keys.down = true;
    if (k === "p" && !e.repeat) togglePause();
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "w") { keys.w = false; if (mode === "online") setOnlineInput(0); }
    if (k === "s") { keys.s = false; if (mode === "online") setOnlineInput(0); }
    if (k === "arrowup") keys.up = false; if (k === "arrowdown") keys.down = false;
  });

  // UI wiring
  $("cpuModeBtn").addEventListener("click", () => startLocal("cpu"));
  $("localModeBtn").addEventListener("click", () => startLocal("local"));
  $("onlineModeBtn").addEventListener("click", openOnlineMenu);
  $("onlineBackBtn").addEventListener("click", () => { disconnectOnline(true); mode = "menu"; showOnly(ui.menuOverlay); setBadge("LOCAL", "local"); });
  $("createRoomBtn").addEventListener("click", () => connectRoom(randomCode()));
  $("joinRoomBtn").addEventListener("click", () => connectRoom(ui.roomCodeInput.value));
  ui.roomCodeInput.addEventListener("input", () => ui.roomCodeInput.value = normalizeCode(ui.roomCodeInput.value));
  ui.roomCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") connectRoom(ui.roomCodeInput.value); });
  $("leaveRoomBtn").addEventListener("click", () => { disconnectOnline(true); openOnlineMenu(); });
  $("shareRoomBtn").addEventListener("click", async () => {
    const text = `Lightning vs Wind Pong — stanza ${roomCode}`;
    if (navigator.share) { try { await navigator.share({ title: "Lightning vs Wind Pong", text, url: shareUrl }); return; } catch {} }
    ui.lobbyMessage.textContent = `Codice da comunicare: ${roomCode}`;
  });
  document.querySelectorAll("[data-difficulty]").forEach((btn) => btn.addEventListener("click", () => {
    difficulty = btn.dataset.difficulty;
    document.querySelectorAll("[data-difficulty]").forEach((b) => b.classList.toggle("active", b === btn));
  }));

  function togglePause(force) {
    if (mode === "online") { if (running) sendOnline({ type: "pause" }); return; }
    if (!running || gameOver) return;
    paused = typeof force === "boolean" ? force : !paused;
    ui.pauseOverlay.classList.toggle("show", paused);
    if (paused) stopMusic(); else { lastTime = performance.now(); startMusic(); }
  }
  $("pauseBtn").addEventListener("click", togglePause);
  $("resumeBtn").addEventListener("click", () => togglePause(false));
  $("restartBtn").addEventListener("click", () => { if (mode === "cpu" || mode === "local") startLocal(mode); });
  $("pauseMenuBtn").addEventListener("click", goMenu);
  $("gameOverMenuBtn").addEventListener("click", goMenu);
  $("rematchBtn").addEventListener("click", () => {
    if (mode === "online") { sendOnline({ type: "rematch" }); ui.gameOverOverlay.classList.remove("show"); }
    else startLocal(mode);
  });
  function goMenu() {
    disconnectOnline(true); stopMusic(); running = false; paused = false; gameOver = false; mode = "menu";
    leftScore = rightScore = 0; updateScore(); showOnly(ui.menuOverlay); setBadge("LOCAL", "local"); ui.roleBadge.textContent = "MODALITÀ LOCALE";
  }

  ui.soundBtn.addEventListener("click", () => {
    soundOn = !soundOn; ui.soundBtn.textContent = soundOn ? "🔊" : "🔇";
    if (soundOn) { unlockAudio(); startMusic(); tone(680, .05, "sine", .025); } else stopMusic();
  });
  async function requestGameFullscreen() {
    if (matchMedia("(display-mode: fullscreen)").matches || matchMedia("(display-mode: standalone)").matches || innerWidth > 900) return;
    try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.(); try { await screen.orientation?.lock?.("portrait-primary"); } catch {} } catch {}
  }
  $("fullscreenBtn").addEventListener("click", async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen?.(); else await requestGameFullscreen(); } catch {}
  });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstallPrompt = e; ui.installBtn.classList.remove("install-hidden"); });
  ui.installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt(); try { await deferredInstallPrompt.userChoice; } catch {}
    deferredInstallPrompt = null; ui.installBtn.classList.add("install-hidden");
  });
  window.addEventListener("appinstalled", () => ui.installBtn.classList.add("install-hidden"));
  document.addEventListener("visibilitychange", () => { if (document.hidden && mode !== "online" && running && !paused) togglePause(true); });
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));

  const roomFromUrl = normalizeCode(new URLSearchParams(location.search).get("room"));
  if (roomFromUrl) {
    ui.roomCodeInput.value = roomFromUrl; openOnlineMenu(); if (WORKER_CONFIGURED) connectRoom(roomFromUrl);
  }

  resetPaddles(); ball.x = W / 2; ball.y = H / 2; ball.vx = ball.vy = 0; updateScore();
  draw(performance.now()); requestAnimationFrame(loop);
})();
