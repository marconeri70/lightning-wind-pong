(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const W = canvas.width;
  const H = canvas.height;
  const WIN_SCORE = 10;

  const ui = {
    leftScore: document.getElementById("leftScore"),
    rightScore: document.getElementById("rightScore"),
    matchInfo: document.getElementById("matchInfo"),
    startOverlay: document.getElementById("startOverlay"),
    pauseOverlay: document.getElementById("pauseOverlay"),
    gameOverOverlay: document.getElementById("gameOverOverlay"),
    winnerText: document.getElementById("winnerText"),
    finalScoreText: document.getElementById("finalScoreText"),
    cpuModeBtn: document.getElementById("cpuModeBtn"),
    twoModeBtn: document.getElementById("twoModeBtn"),
    difficultyBox: document.getElementById("difficultyBox"),
    difficultyButtons: [...document.querySelectorAll("[data-difficulty]")],
    resumeBtn: document.getElementById("resumeBtn"),
    restartBtn: document.getElementById("restartBtn"),
    rematchBtn: document.getElementById("rematchBtn"),
    menuBtn: document.getElementById("menuBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    fullscreenBtn: document.getElementById("fullscreenBtn"),
    soundBtn: document.getElementById("soundBtn"),
    leftWins: document.getElementById("leftWins"),
    rightWins: document.getElementById("rightWins"),
    resetStatsBtn: document.getElementById("resetStatsBtn"),
  };

  const keys = {
    w: false,
    s: false,
    up: false,
    down: false,
  };

  const touchTargets = {
    left: null,
    right: null,
  };

  const leftPaddle = {
    x: 34,
    y: H / 2 - 72,
    w: 16,
    h: 144,
    speed: 510,
  };

  const rightPaddle = {
    x: W - 50,
    y: H / 2 - 72,
    w: 16,
    h: 144,
    speed: 510,
  };

  const ball = {
    x: W / 2,
    y: H / 2,
    r: 10,
    vx: 0,
    vy: 0,
    speed: 410,
    maxSpeed: 980,
  };

  const particles = [];
  const trail = [];
  const ambient = [];

  let leftScore = 0;
  let rightScore = 0;
  let mode = "cpu";
  let difficulty = "normal";
  let running = false;
  let paused = false;
  let gameOver = false;
  let waitingServe = false;
  let lastTime = performance.now();
  let soundEnabled = true;
  let audioCtx = null;
  let cpuTargetY = H / 2;
  let cpuThinkTimer = 0;

  let stats = loadStats();
  renderStats();

  function loadStats() {
    try {
      const parsed = JSON.parse(localStorage.getItem("lwp-stats") || "{}");
      return {
        leftWins: Number(parsed.leftWins) || 0,
        rightWins: Number(parsed.rightWins) || 0,
      };
    } catch {
      return { leftWins: 0, rightWins: 0 };
    }
  }

  function saveStats() {
    localStorage.setItem("lwp-stats", JSON.stringify(stats));
    renderStats();
  }

  function renderStats() {
    ui.leftWins.textContent = stats.leftWins;
    ui.rightWins.textContent = stats.rightWins;
  }

  function initAmbient() {
    ambient.length = 0;
    for (let i = 0; i < 72; i++) {
      ambient.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.5 + Math.random() * 1.8,
        a: 0.15 + Math.random() * 0.55,
        vy: -2 - Math.random() * 6,
        tw: Math.random() * Math.PI * 2,
      });
    }
  }

  function resetPaddles() {
    leftPaddle.y = H / 2 - leftPaddle.h / 2;
    rightPaddle.y = H / 2 - rightPaddle.h / 2;
  }

  function resetBall(direction = Math.random() > 0.5 ? 1 : -1) {
    ball.x = W / 2;
    ball.y = H / 2;
    ball.speed = 410;
    const angle = (Math.random() * 0.9 - 0.45);
    ball.vx = Math.cos(angle) * ball.speed * direction;
    ball.vy = Math.sin(angle) * ball.speed;
    trail.length = 0;
  }

  function startMatch(selectedMode) {
    unlockAudio();
    mode = selectedMode;
    leftScore = 0;
    rightScore = 0;
    gameOver = false;
    paused = false;
    running = true;
    waitingServe = false;
    ui.startOverlay.classList.remove("visible");
    ui.pauseOverlay.classList.remove("visible");
    ui.gameOverOverlay.classList.remove("visible");
    ui.matchInfo.textContent = mode === "cpu"
      ? `CPU ${difficulty.toUpperCase()} · FIRST TO ${WIN_SCORE}`
      : `2 PLAYERS · FIRST TO ${WIN_SCORE}`;
    updateScoreUI();
    resetPaddles();
    resetBall();
    playTone(220, 0.07, "sine", 0.04);
  }

  function restartMatch() {
    startMatch(mode);
  }

  function showMenu() {
    running = false;
    paused = false;
    gameOver = false;
    leftScore = 0;
    rightScore = 0;
    updateScoreUI();
    resetPaddles();
    ball.x = W / 2;
    ball.y = H / 2;
    ball.vx = 0;
    ball.vy = 0;
    trail.length = 0;
    particles.length = 0;
    ui.gameOverOverlay.classList.remove("visible");
    ui.pauseOverlay.classList.remove("visible");
    ui.startOverlay.classList.add("visible");
    ui.matchInfo.textContent = `FIRST TO ${WIN_SCORE}`;
  }

  function togglePause(force) {
    if (!running || gameOver) return;
    paused = typeof force === "boolean" ? force : !paused;
    ui.pauseOverlay.classList.toggle("visible", paused);
    ui.pauseBtn.textContent = paused ? "▶ RIPRENDI" : "⏸ PAUSA";
    if (!paused) lastTime = performance.now();
  }

  function updateScoreUI() {
    ui.leftScore.textContent = leftScore;
    ui.rightScore.textContent = rightScore;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function updatePaddles(dt) {
    if (keys.w) leftPaddle.y -= leftPaddle.speed * dt;
    if (keys.s) leftPaddle.y += leftPaddle.speed * dt;

    if (touchTargets.left !== null) {
      const desired = touchTargets.left - leftPaddle.h / 2;
      leftPaddle.y += (desired - leftPaddle.y) * Math.min(1, 13 * dt);
    }

    if (mode === "two") {
      if (keys.up) rightPaddle.y -= rightPaddle.speed * dt;
      if (keys.down) rightPaddle.y += rightPaddle.speed * dt;

      if (touchTargets.right !== null) {
        const desired = touchTargets.right - rightPaddle.h / 2;
        rightPaddle.y += (desired - rightPaddle.y) * Math.min(1, 13 * dt);
      }
    } else {
      updateCPU(dt);
    }

    leftPaddle.y = clamp(leftPaddle.y, 18, H - leftPaddle.h - 18);
    rightPaddle.y = clamp(rightPaddle.y, 18, H - rightPaddle.h - 18);

    emitPaddleAura(leftPaddle, "lightning", dt);
    emitPaddleAura(rightPaddle, "wind", dt);
  }

  function updateCPU(dt) {
    const cfg = {
      easy: { speed: 315, reaction: 0.22, error: 74 },
      normal: { speed: 430, reaction: 0.11, error: 38 },
      hard: { speed: 535, reaction: 0.055, error: 15 },
    }[difficulty];

    cpuThinkTimer -= dt;
    if (cpuThinkTimer <= 0) {
      cpuThinkTimer = cfg.reaction;
      const predicted = predictBallYAtX(rightPaddle.x);
      const error = (Math.random() * 2 - 1) * cfg.error;
      cpuTargetY = predicted + error;
    }

    const center = rightPaddle.y + rightPaddle.h / 2;
    const delta = cpuTargetY - center;
    const maxMove = cfg.speed * dt;

    if (Math.abs(delta) > 6) {
      rightPaddle.y += clamp(delta, -maxMove, maxMove);
    }
  }

  function predictBallYAtX(targetX) {
    if (ball.vx <= 0) {
      return H / 2 + (Math.random() - 0.5) * 150;
    }

    const time = (targetX - ball.x) / ball.vx;
    if (time <= 0) return ball.y;

    let predicted = ball.y + ball.vy * time;
    const top = 18 + ball.r;
    const bottom = H - 18 - ball.r;
    const span = bottom - top;

    while (predicted < top || predicted > bottom) {
      if (predicted < top) predicted = top + (top - predicted);
      if (predicted > bottom) predicted = bottom - (predicted - bottom);
    }

    return clamp(predicted, top, top + span);
  }

  function updateBall(dt) {
    if (waitingServe) return;

    trail.unshift({
      x: ball.x,
      y: ball.y,
      life: 1,
      side: ball.vx >= 0 ? "wind" : "lightning",
    });

    if (trail.length > 18) trail.pop();
    trail.forEach(t => t.life -= 2.2 * dt);

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    const top = 18 + ball.r;
    const bottom = H - 18 - ball.r;

    if (ball.y <= top && ball.vy < 0) {
      ball.y = top;
      ball.vy *= -1;
      emitImpact(ball.x, ball.y, "wind", 12);
      playTone(510, 0.035, "triangle", 0.025);
    } else if (ball.y >= bottom && ball.vy > 0) {
      ball.y = bottom;
      ball.vy *= -1;
      emitImpact(ball.x, ball.y, "wind", 12);
      playTone(510, 0.035, "triangle", 0.025);
    }

    checkPaddleCollision(leftPaddle, "left");
    checkPaddleCollision(rightPaddle, "right");

    if (ball.x < -40) {
      scorePoint("right");
    } else if (ball.x > W + 40) {
      scorePoint("left");
    }
  }

  function checkPaddleCollision(paddle, side) {
    const withinY =
      ball.y + ball.r >= paddle.y &&
      ball.y - ball.r <= paddle.y + paddle.h;

    if (!withinY) return;

    if (
      side === "left" &&
      ball.vx < 0 &&
      ball.x - ball.r <= paddle.x + paddle.w &&
      ball.x + ball.r >= paddle.x
    ) {
      ball.x = paddle.x + paddle.w + ball.r;
      reflectFromPaddle(paddle, "left");
    }

    if (
      side === "right" &&
      ball.vx > 0 &&
      ball.x + ball.r >= paddle.x &&
      ball.x - ball.r <= paddle.x + paddle.w
    ) {
      ball.x = paddle.x - ball.r;
      reflectFromPaddle(paddle, "right");
    }
  }

  function reflectFromPaddle(paddle, side) {
    const center = paddle.y + paddle.h / 2;
    const offset = (ball.y - center) / (paddle.h / 2);
    const angle = clamp(offset, -1, 1) * 1.02;
    ball.speed = Math.min(ball.speed + 34, ball.maxSpeed);
    const dir = side === "left" ? 1 : -1;
    ball.vx = Math.cos(angle) * ball.speed * dir;
    ball.vy = Math.sin(angle) * ball.speed;

    const type = side === "left" ? "lightning" : "wind";
    emitImpact(ball.x, ball.y, type, 30);
    playTone(side === "left" ? 740 : 590, 0.045, side === "left" ? "square" : "sine", 0.035);
  }

  function scorePoint(side) {
    if (side === "left") {
      leftScore++;
      emitImpact(W * 0.72, H / 2, "lightning", 70);
      playScoreJingle(true);
    } else {
      rightScore++;
      emitImpact(W * 0.28, H / 2, "wind", 70);
      playScoreJingle(false);
    }

    updateScoreUI();

    if (leftScore >= WIN_SCORE || rightScore >= WIN_SCORE) {
      endMatch();
      return;
    }

    waitingServe = true;
    ball.x = W / 2;
    ball.y = H / 2;
    ball.vx = 0;
    ball.vy = 0;
    trail.length = 0;

    window.setTimeout(() => {
      if (!running || gameOver) return;
      waitingServe = false;
      resetBall(side === "left" ? -1 : 1);
    }, 650);
  }

  function endMatch() {
    gameOver = true;
    running = false;

    const leftWon = leftScore > rightScore;
    if (leftWon) {
      stats.leftWins++;
      ui.winnerText.textContent = "⚡ LIGHTNING VINCE!";
      emitImpact(W * 0.33, H / 2, "lightning", 140);
    } else {
      stats.rightWins++;
      ui.winnerText.textContent = "🌪️ WIND VINCE!";
      emitImpact(W * 0.67, H / 2, "wind", 140);
    }

    saveStats();
    ui.finalScoreText.textContent = `${leftScore} - ${rightScore}`;
    ui.gameOverOverlay.classList.add("visible");
    playVictoryJingle(leftWon);
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.97, dt * 60);
      p.vy *= Math.pow(0.97, dt * 60);

      if (p.type === "wind") {
        p.vy -= 8 * dt;
      }

      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function emitPaddleAura(paddle, type, dt) {
    const rate = type === "lightning" ? 22 : 14;
    const count = Math.random() < rate * dt ? 1 : 0;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: paddle.x + paddle.w / 2 + (Math.random() - 0.5) * 16,
        y: paddle.y + Math.random() * paddle.h,
        vx: (Math.random() - 0.5) * 70,
        vy: (Math.random() - 0.5) * 70,
        life: 0.25 + Math.random() * 0.35,
        maxLife: 0.6,
        size: 1 + Math.random() * 3,
        type,
      });
    }
  }

  function emitImpact(x, y, type, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 250;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.2 + Math.random() * 0.75,
        maxLife: 0.95,
        size: 1 + Math.random() * 4,
        type,
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createLinearGradient(0, 0, W, 0);
    bg.addColorStop(0, "#031b2d");
    bg.addColorStop(0.45, "#051121");
    bg.addColorStop(0.55, "#07101e");
    bg.addColorStop(1, "#151a28");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    drawAmbient();
    drawSideGlow();
    drawCenterLine();
    drawArenaBorder();
    drawTrail();
    drawParticles();
    drawPaddle(leftPaddle, "lightning");
    drawPaddle(rightPaddle, "wind");
    drawBall();

    if (waitingServe && running && !gameOver) {
      ctx.save();
      ctx.fillStyle = "rgba(224, 244, 255, 0.86)";
      ctx.font = "800 18px system-ui";
      ctx.textAlign = "center";
      ctx.letterSpacing = "4px";
      ctx.fillText("READY", W / 2, H / 2 - 32);
      ctx.restore();
    }
  }

  function drawAmbient() {
    const now = performance.now() * 0.001;
    for (const a of ambient) {
      const alpha = clamp(a.a + Math.sin(now * 1.5 + a.tw) * 0.12, 0.04, 0.72);
      ctx.fillStyle = `rgba(178, 230, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSideGlow() {
    const leftGlow = ctx.createRadialGradient(90, H / 2, 15, 90, H / 2, 380);
    leftGlow.addColorStop(0, "rgba(0, 210, 255, 0.20)");
    leftGlow.addColorStop(1, "rgba(0, 210, 255, 0)");
    ctx.fillStyle = leftGlow;
    ctx.fillRect(0, 0, W / 2, H);

    const rightGlow = ctx.createRadialGradient(W - 90, H / 2, 15, W - 90, H / 2, 360);
    rightGlow.addColorStop(0, "rgba(255, 255, 255, 0.12)");
    rightGlow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = rightGlow;
    ctx.fillRect(W / 2, 0, W / 2, H);
  }

  function drawCenterLine() {
    ctx.save();
    ctx.strokeStyle = "rgba(170, 220, 255, 0.12)";
    ctx.setLineDash([11, 14]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, 26);
    ctx.lineTo(W / 2, H - 26);
    ctx.stroke();
    ctx.restore();
  }

  function drawArenaBorder() {
    ctx.save();
    ctx.strokeStyle = "rgba(80, 220, 255, 0.18)";
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, W - 36, H - 36);
    ctx.restore();
  }

  function drawPaddle(paddle, type) {
    const isLightning = type === "lightning";
    ctx.save();
    ctx.shadowBlur = isLightning ? 28 : 24;
    ctx.shadowColor = isLightning ? "#20d8ff" : "#ffffff";

    const g = ctx.createLinearGradient(
      paddle.x,
      paddle.y,
      paddle.x + paddle.w,
      paddle.y + paddle.h
    );

    if (isLightning) {
      g.addColorStop(0, "#dfffff");
      g.addColorStop(0.35, "#28e3ff");
      g.addColorStop(1, "#0a8dff");
    } else {
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.5, "#e6f5ff");
      g.addColorStop(1, "#a9b8c9");
    }

    ctx.fillStyle = g;
    roundRect(ctx, paddle.x, paddle.y, paddle.w, paddle.h, 9);
    ctx.fill();

    if (isLightning) {
      ctx.strokeStyle = "rgba(227, 255, 255, 0.9)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const sx = paddle.x + paddle.w / 2;
      const sy = paddle.y + 12 + Math.random() * (paddle.h - 24);
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - 7, sy + 10);
      ctx.lineTo(sx + 5, sy + 17);
      ctx.lineTo(sx - 3, sy + 28);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTrail() {
    ctx.save();
    for (let i = trail.length - 1; i >= 0; i--) {
      const t = trail[i];
      if (t.life <= 0) continue;
      const alpha = t.life * (1 - i / trail.length) * 0.42;
      const radius = ball.r * (0.25 + (1 - i / trail.length) * 0.75);
      ctx.fillStyle = t.side === "lightning"
        ? `rgba(37, 216, 255, ${alpha})`
        : `rgba(240, 250, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBall() {
    ctx.save();
    ctx.shadowBlur = 30;
    ctx.shadowColor = ball.vx >= 0 ? "#ffffff" : "#25d8ff";

    const g = ctx.createRadialGradient(
      ball.x - 3, ball.y - 3, 1,
      ball.x, ball.y, ball.r * 1.3
    );
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.45, "#eafcff");
    g.addColorStop(1, ball.vx >= 0 ? "#9bb0c0" : "#16bfe8");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    for (const p of particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.type === "lightning"
        ? `rgba(37, 220, 255, ${alpha})`
        : `rgba(242, 249, 255, ${alpha * 0.9})`;
      ctx.shadowBlur = p.type === "lightning" ? 12 : 7;
      ctx.shadowColor = p.type === "lightning" ? "#19d6ff" : "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function roundRect(context, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + w, y, x + w, y + h, radius);
    context.arcTo(x + w, y + h, x, y + h, radius);
    context.arcTo(x, y + h, x, y, radius);
    context.arcTo(x, y, x + w, y, radius);
    context.closePath();
  }

  function loop(now) {
    const rawDt = (now - lastTime) / 1000;
    const dt = Math.min(rawDt, 0.025);
    lastTime = now;

    if (running && !paused && !gameOver) {
      updatePaddles(dt);
      updateBall(dt);
    }

    updateParticles(dt);

    for (const a of ambient) {
      a.y += a.vy * dt;
      if (a.y < -3) {
        a.y = H + 3;
        a.x = Math.random() * W;
      }
    }

    draw();
    requestAnimationFrame(loop);
  }

  function unlockAudio() {
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx?.state === "suspended") audioCtx.resume();
  }

  function playTone(freq, duration, type = "sine", volume = 0.03, delay = 0) {
    if (!soundEnabled) return;
    unlockAudio();
    if (!audioCtx) return;

    const start = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function playScoreJingle(lightningScored) {
    const base = lightningScored ? 540 : 420;
    playTone(base, 0.08, "triangle", 0.035, 0);
    playTone(base * 1.35, 0.1, "sine", 0.03, 0.07);
  }

  function playVictoryJingle(lightningWon) {
    const base = lightningWon ? 440 : 350;
    [1, 1.25, 1.5, 2].forEach((m, i) => {
      playTone(base * m, 0.16, lightningWon ? "square" : "sine", 0.035, i * 0.12);
    });
  }

  function canvasPointFromEvent(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (W / rect.width),
      y: (clientY - rect.top) * (H / rect.height),
    };
  }

  function updateTouchTarget(clientX, clientY) {
    const p = canvasPointFromEvent(clientX, clientY);
    if (p.x < W / 2) {
      touchTargets.left = clamp(p.y, 0, H);
    } else if (mode === "two") {
      touchTargets.right = clamp(p.y, 0, H);
    }
  }

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();

    if (["arrowup", "arrowdown", " "].includes(key)) e.preventDefault();

    if (key === "w") keys.w = true;
    if (key === "s") keys.s = true;
    if (key === "arrowup") keys.up = true;
    if (key === "arrowdown") keys.down = true;

    if (key === "p" && !e.repeat) togglePause();
  });

  window.addEventListener("keyup", (e) => {
    const key = e.key.toLowerCase();
    if (key === "w") keys.w = false;
    if (key === "s") keys.s = false;
    if (key === "arrowup") keys.up = false;
    if (key === "arrowdown") keys.down = false;
  });

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    updateTouchTarget(e.clientX, e.clientY);
    unlockAudio();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons || e.pointerType === "touch") {
      updateTouchTarget(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    const p = canvasPointFromEvent(e.clientX, e.clientY);
    if (p.x < W / 2) touchTargets.left = null;
    else touchTargets.right = null;
  });

  canvas.addEventListener("pointercancel", () => {
    touchTargets.left = null;
    touchTargets.right = null;
  });

  ui.cpuModeBtn.addEventListener("click", () => startMatch("cpu"));
  ui.twoModeBtn.addEventListener("click", () => startMatch("two"));
  ui.resumeBtn.addEventListener("click", () => togglePause(false));
  ui.pauseBtn.addEventListener("click", () => togglePause());
  ui.restartBtn.addEventListener("click", restartMatch);
  ui.rematchBtn.addEventListener("click", restartMatch);
  ui.menuBtn.addEventListener("click", showMenu);

  ui.difficultyButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      difficulty = btn.dataset.difficulty;
      ui.difficultyButtons.forEach(b => b.classList.toggle("active", b === btn));
    });
  });

  ui.soundBtn.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    ui.soundBtn.textContent = soundEnabled ? "🔊" : "🔇";
    if (soundEnabled) playTone(660, 0.06, "sine", 0.025);
  });

  ui.fullscreenBtn.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch {
      // Alcuni browser mobili possono bloccare il fullscreen.
    }
  });

  ui.resetStatsBtn.addEventListener("click", () => {
    stats = { leftWins: 0, rightWins: 0 };
    saveStats();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running && !paused) togglePause(true);
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  initAmbient();
  resetPaddles();
  draw();
  requestAnimationFrame(loop);
})();
