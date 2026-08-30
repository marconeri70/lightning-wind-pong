(() => {
"use strict";

const $ = (id) => document.getElementById(id);
const canvas = $("gameCanvas");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height, WIN_SCORE = 10;

const ui = {
  leftScore:$("leftScore"), rightScore:$("rightScore"), matchLabel:$("matchLabel"),
  connectionBadge:$("connectionBadge"), roleBadge:$("roleBadge"),
  menuOverlay:$("menuOverlay"), onlineOverlay:$("onlineOverlay"),
  pauseOverlay:$("pauseOverlay"), gameOverOverlay:$("gameOverOverlay"),
  winnerText:$("winnerText"), finalScoreText:$("finalScoreText"),
  countdown:$("countdown"), impactFlash:$("impactFlash"),
  roomCodeInput:$("roomCodeInput"), onlineConfigHint:$("onlineConfigHint"),
  onlineSetup:$("onlineSetup"), onlineLobby:$("onlineLobby"),
  roomCodeDisplay:$("roomCodeDisplay"), roleMessage:$("roleMessage"),
  lobbyMessage:$("lobbyMessage"), lightningStatus:$("lightningStatus"), windStatus:$("windStatus"),
  installBtn:$("installBtn"), soundBtn:$("soundBtn")
};

const CONFIG = window.LWP_CONFIG || {};
const WORKER_URL = String(CONFIG.workerUrl || "").replace(/\/+$/,"");
const WORKER_CONFIGURED = /^https:\/\/.+\.workers\.dev$/.test(WORKER_URL) && !WORKER_URL.includes("REPLACE-WITH");

let mode = "menu"; // cpu | local | online
let difficulty = "normal";
let running = false, paused = false, gameOver = false;
let lastTime = performance.now();
let leftScore = 0, rightScore = 0;
let shake = 0, flashSide = null, scorePulse = 0;

const keys = {w:false,s:false,up:false,down:false};
let buttonDirection = 0;

const left = {x:30,y:H/2-90,w:16,h:180,speed:620};
const right = {x:W-46,y:H/2-90,w:16,h:180,speed:620};
const ball = {x:W/2,y:H/2,r:11,vx:0,vy:0,speed:470,maxSpeed:1080};

const trail = [], particles = [], stars = [], windLines = [];
for(let i=0;i<78;i++) stars.push({x:Math.random()*W,y:Math.random()*H,r:.5+Math.random()*1.7,a:.14+Math.random()*.55,t:Math.random()*6.28});
for(let i=0;i<16;i++) windLines.push({x:W*.55+Math.random()*W*.42,y:Math.random()*H,len:30+Math.random()*90,speed:20+Math.random()*40,a:.04+Math.random()*.09});

let audioCtx = null, soundOn = true, musicTimer = null, musicStep = 0;
let deferredInstallPrompt = null;

// ONLINE
let ws = null;
let roomCode = "";
let onlineRole = null;
let onlinePlayers = {lightning:false, wind:false};
let onlineState = null;
let onlineInput = 0;
let reconnectTimer = null;
let manualDisconnect = false;
let shareUrl = "";

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function randomCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s=""; for(let i=0;i<6;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}
function normalizeCode(v){ return String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6); }
function workerWsUrl(code){
  const u = new URL(WORKER_URL);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = `/room/${encodeURIComponent(code)}`;
  u.search = "";
  return u.toString();
}
function resetLocalObjects(){
  left.y=H/2-left.h/2; right.y=H/2-right.h/2;
  leftScore=rightScore=0; updateScore();
  resetBall(Math.random()>.5?1:-1);
}
function resetBall(dir=1){
  ball.x=W/2; ball.y=H/2; ball.speed=470;
  const a=(Math.random()*.78-.39);
  ball.vx=Math.cos(a)*ball.speed*dir; ball.vy=Math.sin(a)*ball.speed;
  trail.length=0;
}
function updateScore(){
  ui.leftScore.textContent=leftScore;
  ui.rightScore.textContent=rightScore;
}
function setBadge(text,state="local"){
  ui.connectionBadge.textContent=text;
  ui.connectionBadge.className=`connection-badge ${state}`;
}
function showOnly(overlay){
  [ui.menuOverlay,ui.onlineOverlay,ui.pauseOverlay,ui.gameOverOverlay].forEach(o=>o.classList.remove("show"));
  if(overlay) overlay.classList.add("show");
}
function triggerImpact(side){
  shake=8; flashSide=side;
  ui.impactFlash.classList.remove("flash");
  void ui.impactFlash.offsetWidth;
  ui.impactFlash.classList.add("flash");
  if(navigator.vibrate) navigator.vibrate(18);
}
function burst(x,y,side,count=30){
  for(let i=0;i<count;i++){
    const a=Math.random()*Math.PI*2, sp=50+Math.random()*270;
    particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:.2+Math.random()*.65,max:.85,r:1+Math.random()*3.8,side});
  }
}

// AUDIO
function unlockAudio(){
  if(!audioCtx){
    const AC=window.AudioContext||window.webkitAudioContext;
    if(AC) audioCtx=new AC();
  }
  if(audioCtx?.state==="suspended") audioCtx.resume();
}
function tone(freq,d=.05,type="sine",vol=.03,delay=0){
  if(!soundOn) return;
  unlockAudio(); if(!audioCtx) return;
  const t=audioCtx.currentTime+delay, o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.type=type; o.frequency.setValueAtTime(freq,t);
  g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(vol,t+.008); g.gain.exponentialRampToValueAtTime(.0001,t+d);
  o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t+d+.03);
}
function startMusic(){
  if(!soundOn||musicTimer) return;
  const notes=[146.83,174.61,220,196,174.61,146.83,130.81,146.83];
  musicTimer=setInterval(()=>{
    if(!running||paused||!soundOn) return;
    const f=notes[musicStep++%notes.length];
    tone(f,.16,"triangle",.009);
  },300);
}
function stopMusic(){ if(musicTimer){clearInterval(musicTimer);musicTimer=null;} }

// LOCAL GAME
function startLocal(selectedMode){
  disconnectOnline(true);
  mode=selectedMode; running=true; paused=false; gameOver=false;
  resetLocalObjects();
  showOnly(null);
  ui.matchLabel.textContent = selectedMode==="cpu" ? `CPU ${difficulty.toUpperCase()} · FIRST TO 10` : "2 PLAYERS · FIRST TO 10";
  ui.roleBadge.textContent = selectedMode==="cpu" ? "⚡ TU SEI LIGHTNING" : "👥 2 GIOCATORI LOCALI";
  setBadge("LOCAL","local");
  unlockAudio(); startMusic(); tone(220,.08,"sine",.04);
  requestGameFullscreen();
}
function reflect(p,side){
  const center=p.y+p.h/2, off=(ball.y-center)/(p.h/2), a=clamp(off,-1,1)*1.04;
  ball.speed=Math.min(ball.speed+36,ball.maxSpeed);
  const dir=side==="lightning"?1:-1;
  ball.vx=Math.cos(a)*ball.speed*dir; ball.vy=Math.sin(a)*ball.speed;
  burst(ball.x,ball.y,side,34); triggerImpact(side);
  tone(side==="lightning"?760:610,.045,side==="lightning"?"square":"sine",.035);
}
function collision(p,side){
  if(ball.y+ball.r<p.y||ball.y-ball.r>p.y+p.h) return;
  if(side==="lightning"&&ball.vx<0&&ball.x-ball.r<=p.x+p.w&&ball.x+ball.r>=p.x){
    ball.x=p.x+p.w+ball.r; reflect(p,side);
  }
  if(side==="wind"&&ball.vx>0&&ball.x+ball.r>=p.x&&ball.x-ball.r<=p.x+p.w){
    ball.x=p.x-ball.r; reflect(p,side);
  }
}
let cpuTimer=0,cpuTarget=H/2;
function updateCpu(dt){
  const cfg={easy:[390,.22,100],normal:[520,.11,52],hard:[635,.055,20]}[difficulty];
  cpuTimer-=dt;
  if(cpuTimer<=0){
    cpuTimer=cfg[1];
    let target=ball.vx>0 ? ball.y + ball.vy*((right.x-ball.x)/ball.vx) : H/2;
    const top=30,bottom=H-30;
    while(target<top||target>bottom){
      if(target<top)target=top+(top-target);
      if(target>bottom)target=bottom-(target-bottom);
    }
    cpuTarget=target+(Math.random()*2-1)*cfg[2];
  }
  const delta=cpuTarget-(right.y+right.h/2), max=cfg[0]*dt;
  if(Math.abs(delta)>6) right.y+=clamp(delta,-max,max);
}
function localScore(side){
  if(side==="lightning"){leftScore++;burst(W*.72,H/2,"lightning",65);}
  else{rightScore++;burst(W*.28,H/2,"wind",65);}
  updateScore(); scorePulse=1;
  tone(side==="lightning"?560:430,.08,"triangle",.04);
  if(leftScore>=WIN_SCORE||rightScore>=WIN_SCORE){
    finishLocal(); return;
  }
  resetBall(side==="lightning"?-1:1);
}
function finishLocal(){
  running=false;gameOver=true;stopMusic();
  const l=leftScore>rightScore;
  ui.winnerText.textContent=l?"⚡ LIGHTNING VINCE!":"🌪 WIND VINCE!";
  ui.finalScoreText.textContent=`${leftScore} — ${rightScore}`;
  ui.gameOverOverlay.classList.add("show");
  [1,1.25,1.5,2].forEach((m,i)=>tone((l?440:350)*m,.15,l?"square":"sine",.03,i*.12));
}
function updateLocal(dt){
  const ownDir = buttonDirection || (keys.w?-1:0) || (keys.s?1:0);
  left.y += ownDir*left.speed*dt;

  if(mode==="local"){
    const rdir=(keys.up?-1:0)||(keys.down?1:0);
    right.y+=rdir*right.speed*dt;
  }else updateCpu(dt);

  left.y=clamp(left.y,18,H-left.h-18); right.y=clamp(right.y,18,H-right.h-18);

  const steps=clamp(Math.ceil(Math.max(Math.abs(ball.vx),Math.abs(ball.vy))*dt/10),1,8);
  const sub=dt/steps;
  for(let i=0;i<steps;i++){
    ball.x+=ball.vx*sub; ball.y+=ball.vy*sub;
    if(ball.y<=30&&ball.vy<0){ball.y=30;ball.vy*=-1;tone(500,.03,"triangle",.018);}
    if(ball.y>=H-30&&ball.vy>0){ball.y=H-30;ball.vy*=-1;tone(500,.03,"triangle",.018);}
    collision(left,"lightning"); collision(right,"wind");
    if(ball.x<-45){localScore("wind");break;}
    if(ball.x>W+45){localScore("lightning");break;}
  }
}

// ONLINE
function openOnlineMenu(){
  mode="online-menu"; running=false;paused=false;gameOver=false;stopMusic();
  showOnly(ui.onlineOverlay);
  ui.onlineSetup.classList.remove("hidden");
  ui.onlineLobby.classList.add("hidden");
  ui.onlineConfigHint.textContent = WORKER_CONFIGURED
    ? "Cloudflare pronto. Crea una stanza o inserisci il codice dell'altro telefono."
    : "Prima configura multiplayer-config.js con l'URL del Worker Cloudflare.";
  setBadge("ONLINE","waiting");
}
function connectRoom(code){
  code=normalizeCode(code);
  if(!WORKER_CONFIGURED){
    ui.onlineConfigHint.textContent="Worker Cloudflare non configurato: inserisci l'URL in multiplayer-config.js.";
    return;
  }
  if(code.length!==6){
    ui.onlineConfigHint.textContent="Il codice stanza deve avere 6 caratteri.";
    return;
  }
  disconnectOnline(true);
  manualDisconnect=false; roomCode=code; onlineRole=null; onlineState=null;
  onlinePlayers={lightning:false,wind:false};
  ui.roomCodeDisplay.textContent=code;
  ui.onlineSetup.classList.add("hidden"); ui.onlineLobby.classList.remove("hidden");
  updateLobby();
  shareUrl=`${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
  try{
    ws=new WebSocket(workerWsUrl(code));
  }catch(err){
    ui.lobbyMessage.textContent="Impossibile aprire la connessione WebSocket.";
    return;
  }

  ws.addEventListener("open",()=>{
    setBadge(`ROOM ${code}`,"online");
    ui.lobbyMessage.textContent="Connesso. In attesa dell'altro giocatore...";
  });
  ws.addEventListener("message",(event)=>{
    let msg; try{msg=JSON.parse(event.data);}catch{return;}
    handleOnlineMessage(msg);
  });
  ws.addEventListener("close",()=>{
    if(manualDisconnect) return;
    running=false; stopMusic();
    setBadge("DISCONNESSO","waiting");
    ui.lobbyMessage.textContent="Connessione persa. Riprovo...";
    clearTimeout(reconnectTimer);
    reconnectTimer=setTimeout(()=>connectRoom(roomCode),1400);
  });
  ws.addEventListener("error",()=>{});
}
function handleOnlineMessage(msg){
  if(msg.type==="welcome"){
    onlineRole=msg.role;
    ui.roleMessage.textContent=onlineRole==="lightning"?"⚡ TU SEI LIGHTNING":"🌪 TU SEI WIND";
    ui.roleBadge.textContent=ui.roleMessage.textContent;
    updateLobby();
    return;
  }
  if(msg.type==="players"){
    onlinePlayers=msg.players||onlinePlayers; updateLobby();
    return;
  }
  if(msg.type==="state"){
    onlineState=msg.state;
    leftScore=onlineState.score?.lightning||0; rightScore=onlineState.score?.wind||0; updateScore();
    if(onlineState.status==="playing"||onlineState.status==="countdown"){
      if(!running){
        running=true;paused=false;gameOver=false;
        showOnly(null); startMusic(); requestGameFullscreen();
        ui.matchLabel.textContent=`ROOM ${roomCode} · FIRST TO 10`;
      }
      updateCountdownFromState();
    }else if(onlineState.status==="gameover"){
      if(!gameOver){
        gameOver=true;running=false;stopMusic();
        const win=onlineState.winner==="lightning";
        ui.winnerText.textContent=win?"⚡ LIGHTNING VINCE!":"🌪 WIND VINCE!";
        ui.finalScoreText.textContent=`${leftScore} — ${rightScore}`;
        ui.gameOverOverlay.classList.add("show");
      }
    }else if(onlineState.status==="waiting"){
      running=false;
      if(!ui.onlineOverlay.classList.contains("show")) showOnly(ui.onlineOverlay);
      ui.onlineSetup.classList.add("hidden");ui.onlineLobby.classList.remove("hidden");
      ui.lobbyMessage.textContent="In attesa del secondo telefono.";
    }
    return;
  }
  if(msg.type==="impact"){
    triggerImpact(msg.side); burst(msg.x||W/2,msg.y||H/2,msg.side||"lightning",30);
    tone(msg.side==="lightning"?760:610,.04,"sine",.025);
    return;
  }
  if(msg.type==="error"){
    ui.lobbyMessage.textContent=msg.message||"Errore multiplayer.";
  }
}
function updateLobby(){
  const ls=!!onlinePlayers.lightning, rs=!!onlinePlayers.wind;
  ui.lightningStatus.textContent=ls?"CONNESSO":"IN ATTESA";
  ui.windStatus.textContent=rs?"CONNESSO":"IN ATTESA";
  ui.lightningStatus.classList.toggle("connected",ls);
  ui.windStatus.classList.toggle("connected",rs);
  if(onlineRole) ui.roleMessage.textContent=onlineRole==="lightning"?"⚡ TU SEI LIGHTNING":"🌪 TU SEI WIND";
  if(ls&&rs) ui.lobbyMessage.textContent="Entrambi connessi. La partita sta iniziando...";
}
function updateCountdownFromState(){
  const startAt=Number(onlineState?.startAt||0);
  if(onlineState?.status==="countdown"&&startAt>Date.now()){
    const n=Math.max(1,Math.ceil((startAt-Date.now())/1000));
    ui.countdown.textContent=n; ui.countdown.classList.remove("hidden");
  }else ui.countdown.classList.add("hidden");
}
function sendOnline(obj){
  if(ws?.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function setOnlineInput(dir){
  if(mode!=="online"||!onlineRole) return;
  dir=clamp(Number(dir)||0,-1,1);
  if(dir===onlineInput) return;
  onlineInput=dir; sendOnline({type:"input",dir});
}
function disconnectOnline(manual=false){
  manualDisconnect=manual;
  clearTimeout(reconnectTimer); reconnectTimer=null;
  if(ws){try{ws.close(1000,"leave");}catch{} ws=null;}
  onlineRole=null;onlineState=null;onlinePlayers={lightning:false,wind:false};onlineInput=0;
}
function requestOnlineRematch(){ sendOnline({type:"rematch"}); ui.gameOverOverlay.classList.remove("show"); }
function drawOnlineState(){
  if(!onlineState) return;
  if(onlineState.paddles){
    left.y=onlineState.paddles.lightningY??left.y;
    right.y=onlineState.paddles.windY??right.y;
  }
  if(onlineState.ball){
    const bx=Number(onlineState.ball.x), by=Number(onlineState.ball.y);
    if(Number.isFinite(bx)&&Number.isFinite(by)){
      trail.unshift({x:ball.x,y:ball.y,side:onlineState.ball.vx>=0?"wind":"lightning"});
      if(trail.length>18)trail.pop();
      ball.x=bx;ball.y=by;ball.vx=onlineState.ball.vx||0;ball.vy=onlineState.ball.vy||0;
    }
  }
}

// DRAW
function drawBackground(now){
  const g=ctx.createLinearGradient(0,0,W,0);
  g.addColorStop(0,"#021a2b");g.addColorStop(.47,"#04111f");g.addColorStop(.53,"#07101d");g.addColorStop(1,"#171b28");
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

  // subtle grid
  ctx.save();ctx.strokeStyle="rgba(87,168,205,.045)";ctx.lineWidth=1;
  for(let y=60;y<H;y+=70){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  for(let x=70;x<W;x+=70){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  ctx.restore();

  // side energy
  let lg=ctx.createRadialGradient(65,H*.5,10,65,H*.5,390);
  lg.addColorStop(0,"rgba(0,213,255,.22)");lg.addColorStop(1,"rgba(0,213,255,0)");
  ctx.fillStyle=lg;ctx.fillRect(0,0,W*.55,H);
  let rg=ctx.createRadialGradient(W-55,H*.5,10,W-55,H*.5,360);
  rg.addColorStop(0,"rgba(255,255,255,.12)");rg.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=rg;ctx.fillRect(W*.45,0,W*.55,H);

  for(const s of stars){
    const a=clamp(s.a+Math.sin(now*.001+s.t)*.1,.03,.7);
    ctx.fillStyle=`rgba(184,231,255,${a})`;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();
  }
  for(const l of windLines){
    l.x+=l.speed*.016;if(l.x>W+100)l.x=W*.53-100;
    const grad=ctx.createLinearGradient(l.x,l.y,l.x+l.len,l.y);
    grad.addColorStop(0,"rgba(255,255,255,0)");grad.addColorStop(1,`rgba(235,247,255,${l.a})`);
    ctx.strokeStyle=grad;ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(l.x,l.y);ctx.quadraticCurveTo(l.x+l.len*.5,l.y-10,l.x+l.len,l.y);ctx.stroke();
  }

  ctx.save();ctx.strokeStyle="rgba(157,218,247,.11)";ctx.setLineDash([10,16]);ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(W/2,24);ctx.lineTo(W/2,H-24);ctx.stroke();ctx.restore();

  // random lightning veins on left
  if(Math.floor(now/130)%7===0){
    ctx.save();ctx.strokeStyle="rgba(65,228,255,.14)";ctx.lineWidth=1;
    let x=70,y=0;ctx.beginPath();ctx.moveTo(x,y);
    for(let i=0;i<8;i++){x+=Math.random()*30-15;y+=H/8;ctx.lineTo(x,y);}
    ctx.stroke();ctx.restore();
  }
}
function drawPaddle(p,side){
  ctx.save();
  const own = mode==="online" && onlineRole===side;
  ctx.shadowBlur=own?38:27;ctx.shadowColor=side==="lightning"?"#22ddff":"#ffffff";
  const g=ctx.createLinearGradient(p.x,p.y,p.x+p.w,p.y+p.h);
  if(side==="lightning"){g.addColorStop(0,"#e8ffff");g.addColorStop(.28,"#27e5ff");g.addColorStop(1,"#008ee8");}
  else{g.addColorStop(0,"#ffffff");g.addColorStop(.55,"#e8f5ff");g.addColorStop(1,"#a5b6c7");}
  ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(p.x,p.y,p.w,p.h,8);ctx.fill();
  if(own){
    ctx.strokeStyle=side==="lightning"?"rgba(34,221,255,.9)":"rgba(255,255,255,.9)";
    ctx.lineWidth=2;ctx.strokeRect(p.x-5,p.y-5,p.w+10,p.h+10);
  }
  ctx.restore();
}
function drawBall(){
  ctx.save();ctx.shadowBlur=34;ctx.shadowColor=ball.vx>=0?"#fff":"#22ddff";
  const g=ctx.createRadialGradient(ball.x-3,ball.y-3,1,ball.x,ball.y,ball.r*1.4);
  g.addColorStop(0,"#fff");g.addColorStop(.5,"#e9fbff");g.addColorStop(1,ball.vx>=0?"#9eafbf":"#17cdea");
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(ball.x,ball.y,ball.r,0,Math.PI*2);ctx.fill();ctx.restore();
}
function drawTrail(){
  for(let i=trail.length-1;i>=0;i--){
    const t=trail[i], a=(1-i/trail.length)*.28, r=ball.r*(1-i/trail.length);
    ctx.fillStyle=t.side==="lightning"?`rgba(34,221,255,${a})`:`rgba(255,255,255,${a})`;
    ctx.beginPath();ctx.arc(t.x,t.y,Math.max(1,r),0,Math.PI*2);ctx.fill();
  }
}
function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.97;p.vy*=.97;
    if(p.life<=0)particles.splice(i,1);
  }
}
function drawParticles(){
  for(const p of particles){
    const a=clamp(p.life/p.max,0,1);
    ctx.fillStyle=p.side==="lightning"?`rgba(34,221,255,${a})`:`rgba(245,251,255,${a})`;
    ctx.beginPath();ctx.arc(p.x,p.y,p.r*a,0,Math.PI*2);ctx.fill();
  }
}
function draw(now){
  ctx.clearRect(0,0,W,H);
  ctx.save();
  if(shake>0){ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake*=.78;if(shake<.3)shake=0;}
  drawBackground(now);drawTrail();drawParticles();drawPaddle(left,"lightning");drawPaddle(right,"wind");drawBall();
  ctx.restore();
}
function loop(now){
  const dt=Math.min((now-lastTime)/1000,.025);lastTime=now;
  if(running&&!paused&&!gameOver){
    if(mode==="cpu"||mode==="local") updateLocal(dt);
    else if(mode==="online"){drawOnlineState();updateCountdownFromState();}
  }
  updateParticles(dt);draw(now);requestAnimationFrame(loop);
}

// CONTROLS
function pressMove(dir){
  unlockAudio();
  buttonDirection=dir;
  if(mode==="online") setOnlineInput(dir);
  if(navigator.vibrate) navigator.vibrate(10);
}
function releaseMove(){
  buttonDirection=0;
  if(mode==="online") setOnlineInput(0);
}
function bindHold(btn,dir){
  btn.addEventListener("pointerdown",e=>{e.preventDefault();btn.setPointerCapture?.(e.pointerId);btn.classList.add("pressed");pressMove(dir);});
  ["pointerup","pointercancel","lostpointercapture"].forEach(ev=>btn.addEventListener(ev,()=>{btn.classList.remove("pressed");releaseMove();}));
}
bindHold($("downBtn"),1);bindHold($("upBtn"),-1);

window.addEventListener("keydown",e=>{
  const k=e.key.toLowerCase();
  if(["arrowup","arrowdown"," "].includes(k))e.preventDefault();
  if(k==="w"){keys.w=true;if(mode==="online")setOnlineInput(-1);}
  if(k==="s"){keys.s=true;if(mode==="online")setOnlineInput(1);}
  if(k==="arrowup")keys.up=true;if(k==="arrowdown")keys.down=true;
  if(k==="p"&&!e.repeat)togglePause();
});
window.addEventListener("keyup",e=>{
  const k=e.key.toLowerCase();
  if(k==="w"){keys.w=false;if(mode==="online")setOnlineInput(0);}
  if(k==="s"){keys.s=false;if(mode==="online")setOnlineInput(0);}
  if(k==="arrowup")keys.up=false;if(k==="arrowdown")keys.down=false;
});

// UI
$("cpuModeBtn").addEventListener("click",()=>startLocal("cpu"));
$("localModeBtn").addEventListener("click",()=>startLocal("local"));
$("onlineModeBtn").addEventListener("click",openOnlineMenu);
$("onlineBackBtn").addEventListener("click",()=>{disconnectOnline(true);mode="menu";showOnly(ui.menuOverlay);setBadge("LOCAL","local");});
$("createRoomBtn").addEventListener("click",()=>connectRoom(randomCode()));
$("joinRoomBtn").addEventListener("click",()=>connectRoom(ui.roomCodeInput.value));
ui.roomCodeInput.addEventListener("input",()=>ui.roomCodeInput.value=normalizeCode(ui.roomCodeInput.value));
ui.roomCodeInput.addEventListener("keydown",e=>{if(e.key==="Enter")connectRoom(ui.roomCodeInput.value);});
$("leaveRoomBtn").addEventListener("click",()=>{disconnectOnline(true);openOnlineMenu();});
$("shareRoomBtn").addEventListener("click",async()=>{
  const text=`Lightning vs Wind Pong — stanza ${roomCode}`;
  if(navigator.share){try{await navigator.share({title:"Lightning vs Wind Pong",text,url:shareUrl});return;}catch{}}
  ui.lobbyMessage.textContent=`Codice da comunicare all'altro giocatore: ${roomCode}`;
});

document.querySelectorAll("[data-difficulty]").forEach(btn=>btn.addEventListener("click",()=>{
  difficulty=btn.dataset.difficulty;
  document.querySelectorAll("[data-difficulty]").forEach(b=>b.classList.toggle("active",b===btn));
}));

function togglePause(force){
  if(mode==="online"){
    // Nel multiplayer la pausa locale non deve fermare il server: invia richiesta condivisa.
    if(running) sendOnline({type:"pause"});
    return;
  }
  if(!running||gameOver)return;
  paused=typeof force==="boolean"?force:!paused;
  ui.pauseOverlay.classList.toggle("show",paused);
  if(paused)stopMusic();else{lastTime=performance.now();startMusic();}
}
$("pauseBtn").addEventListener("click",togglePause);
$("resumeBtn").addEventListener("click",()=>togglePause(false));
$("restartBtn").addEventListener("click",()=>{if(mode==="cpu"||mode==="local")startLocal(mode);});
$("pauseMenuBtn").addEventListener("click",goMenu);
$("gameOverMenuBtn").addEventListener("click",goMenu);
$("rematchBtn").addEventListener("click",()=>{if(mode==="online")requestOnlineRematch();else startLocal(mode);});
function goMenu(){
  disconnectOnline(true);stopMusic();running=false;paused=false;gameOver=false;mode="menu";
  leftScore=rightScore=0;updateScore();showOnly(ui.menuOverlay);setBadge("LOCAL","local");ui.roleBadge.textContent="MODALITÀ LOCALE";
}

ui.soundBtn.addEventListener("click",()=>{
  soundOn=!soundOn;ui.soundBtn.textContent=soundOn?"🔊":"🔇";
  if(soundOn){unlockAudio();startMusic();tone(680,.05,"sine",.025);}else stopMusic();
});

async function requestGameFullscreen(){
  if(window.matchMedia("(display-mode: fullscreen)").matches||window.matchMedia("(display-mode: standalone)").matches)return;
  if(innerWidth>900)return;
  try{
    if(!document.fullscreenElement)await document.documentElement.requestFullscreen?.();
    try{await screen.orientation?.lock?.("portrait-primary");}catch{}
  }catch{}
}
$("fullscreenBtn").addEventListener("click",async()=>{
  try{
    if(document.fullscreenElement)await document.exitFullscreen?.();
    else await requestGameFullscreen();
  }catch{}
});

window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;ui.installBtn.classList.remove("install-hidden");});
ui.installBtn.addEventListener("click",async()=>{
  if(!deferredInstallPrompt)return;
  deferredInstallPrompt.prompt();try{await deferredInstallPrompt.userChoice;}catch{}
  deferredInstallPrompt=null;ui.installBtn.classList.add("install-hidden");
});
window.addEventListener("appinstalled",()=>ui.installBtn.classList.add("install-hidden"));

document.addEventListener("visibilitychange",()=>{
  if(document.hidden&&mode!=="online"&&running&&!paused)togglePause(true);
});

if("serviceWorker"in navigator)addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));

// room from shared link
const roomFromUrl=normalizeCode(new URLSearchParams(location.search).get("room"));
if(roomFromUrl){
  ui.roomCodeInput.value=roomFromUrl;
  openOnlineMenu();
  if(WORKER_CONFIGURED) connectRoom(roomFromUrl);
}

resetLocalObjects();ball.vx=ball.vy=0;draw(performance.now());requestAnimationFrame(loop);
})();