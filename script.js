(()=>{
  'use strict';

  const canvas=document.getElementById('gameCanvas');
  const ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height,WIN=10;
  const $=id=>document.getElementById(id);

  const ui={
    leftScore:$('leftScore'),rightScore:$('rightScore'),matchInfo:$('matchInfo'),
    start:$('startOverlay'),pause:$('pauseOverlay'),over:$('gameOverOverlay'),
    winner:$('winnerText'),final:$('finalScore'),install:$('installBtn'),
    sound:$('soundBtn'),music:$('musicBtn'),sfx:$('sfxBtn'),
    leftWins:$('leftWins'),rightWins:$('rightWins'),down:$('downBtn'),up:$('upBtn')
  };

  const keys={w:false,s:false,up:false,down:false};
  const buttons={up:false,down:false};
  const touch={left:null,right:null};

  const L={x:30,y:H/2-92,w:16,h:184,speed:720};
  const R={x:W-46,y:H/2-92,w:16,h:184,speed:720};
  const B={x:W/2,y:H/2,r:10,vx:0,vy:0,speed:500,max:1180};

  const trail=[],particles=[],stars=[];
  for(let i=0;i<84;i++)stars.push({x:Math.random()*W,y:Math.random()*H,r:.5+Math.random()*1.7,a:.12+Math.random()*.56});

  let leftScore=0,rightScore=0,mode='cpu',difficulty='normal';
  let running=false,paused=false,gameOver=false,waiting=false,last=performance.now();
  let cpuTarget=H/2,cpuTimer=0,installPrompt=null;

  let stats=loadStats();
  renderStats();

  function loadStats(){
    try{return Object.assign({left:0,right:0},JSON.parse(localStorage.getItem('lwp-v3-stats')||'{}'));}
    catch{return{left:0,right:0};}
  }
  function saveStats(){localStorage.setItem('lwp-v3-stats',JSON.stringify(stats));renderStats();}
  function renderStats(){ui.leftWins.textContent=stats.left;ui.rightWins.textContent=stats.right;}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function scoreUI(){ui.leftScore.textContent=leftScore;ui.rightScore.textContent=rightScore;}

  function resetPaddles(){L.y=H/2-L.h/2;R.y=H/2-R.h/2;}
  function resetBall(dir=Math.random()>.5?1:-1){
    B.x=W/2;B.y=H/2;B.speed=500;
    const a=Math.random()*.8-.4;
    B.vx=Math.cos(a)*B.speed*dir;B.vy=Math.sin(a)*B.speed;
    trail.length=0;
  }

  async function requestPortraitFullscreen(){
    try{
      if(!document.fullscreenElement){
        const el=document.documentElement;
        if(el.requestFullscreen)await el.requestFullscreen({navigationUI:'hide'});
        else if(el.webkitRequestFullscreen)el.webkitRequestFullscreen();
      }
      if(screen.orientation?.lock){
        try{await screen.orientation.lock('portrait-primary');}catch{}
      }
    }catch{}
  }

  function startGame(selectedMode){
    unlockAudio();
    mode=selectedMode;leftScore=0;rightScore=0;running=true;paused=false;gameOver=false;waiting=false;
    scoreUI();resetPaddles();resetBall();
    ui.start.classList.remove('show');ui.pause.classList.remove('show');ui.over.classList.remove('show');
    ui.matchInfo.textContent=mode==='cpu'?`CPU ${difficulty.toUpperCase()} · FIRST TO ${WIN}`:`2 PLAYERS · FIRST TO ${WIN}`;
    if(musicOn)startMusic();
    tone(230,.08,'sine',.04);
    if(innerWidth<900)requestPortraitFullscreen();
  }

  function returnMenu(){
    running=false;paused=false;gameOver=false;stopMusic();buttons.up=buttons.down=false;
    leftScore=rightScore=0;scoreUI();resetPaddles();B.x=W/2;B.y=H/2;B.vx=B.vy=0;
    ui.pause.classList.remove('show');ui.over.classList.remove('show');ui.start.classList.add('show');
    ui.matchInfo.textContent='FIRST TO 10';
  }

  function togglePause(force){
    if(!running||gameOver)return;
    paused=typeof force==='boolean'?force:!paused;
    buttons.up=buttons.down=false;clearPressed();
    ui.pause.classList.toggle('show',paused);
    if(paused)stopMusic();else{last=performance.now();if(musicOn)startMusic();}
  }

  function scorePoint(side){
    if(side==='left'){
      leftScore++;burst(W*.72,H*.5,'lightning',70);tone(560,.08,'triangle',.04);tone(760,.1,'sine',.03,.07);
    }else{
      rightScore++;burst(W*.28,H*.5,'wind',70);tone(430,.08,'triangle',.04);tone(580,.1,'sine',.03,.07);
    }
    scoreUI();
    if(leftScore>=WIN||rightScore>=WIN){finishGame();return;}
    waiting=true;B.x=W/2;B.y=H/2;B.vx=B.vy=0;trail.length=0;
    setTimeout(()=>{if(running&&!gameOver){waiting=false;resetBall(side==='left'?-1:1);}},620);
  }

  function finishGame(){
    running=false;gameOver=true;stopMusic();
    const leftWon=leftScore>rightScore;
    if(leftWon){stats.left++;ui.winner.textContent='⚡ LIGHTNING VINCE!';}
    else{stats.right++;ui.winner.textContent='🌪️ WIND VINCE!';}
    saveStats();ui.final.textContent=`${leftScore} - ${rightScore}`;ui.over.classList.add('show');
    [1,1.25,1.5,2].forEach((m,i)=>tone((leftWon?440:350)*m,.16,leftWon?'square':'sine',.035,i*.12));
  }

  function reflect(p,side){
    const center=p.y+p.h/2,offset=(B.y-center)/(p.h/2),angle=clamp(offset,-1,1)*1.02;
    B.speed=Math.min(B.speed+40,B.max);
    const dir=side==='left'?1:-1;
    B.vx=Math.cos(angle)*B.speed*dir;B.vy=Math.sin(angle)*B.speed;
    burst(B.x,B.y,side==='left'?'lightning':'wind',30);
    tone(side==='left'?760:610,.05,side==='left'?'square':'sine',.035);
  }

  function collide(p,side){
    if(B.y+B.r<p.y||B.y-B.r>p.y+p.h)return;
    if(side==='left'&&B.vx<0&&B.x-B.r<=p.x+p.w&&B.x+B.r>=p.x){B.x=p.x+p.w+B.r;reflect(p,'left');}
    if(side==='right'&&B.vx>0&&B.x+B.r>=p.x&&B.x-B.r<=p.x+p.w){B.x=p.x-B.r;reflect(p,'right');}
  }

  function predictBall(){
    if(B.vx<=0)return H/2+(Math.random()-.5)*220;
    const t=(R.x-B.x)/B.vx;let y=B.y+B.vy*t,top=28,bottom=H-28;
    while(y<top||y>bottom){if(y<top)y=top+(top-y);if(y>bottom)y=bottom-(y-bottom);}
    return y;
  }

  function updateCPU(dt){
    const cfg={easy:[430,.22,110],normal:[570,.11,58],hard:[690,.055,22]}[difficulty];
    cpuTimer-=dt;
    if(cpuTimer<=0){cpuTimer=cfg[1];cpuTarget=predictBall()+(Math.random()*2-1)*cfg[2];}
    const delta=cpuTarget-(R.y+R.h/2),maxMove=cfg[0]*dt;
    if(Math.abs(delta)>6)R.y+=clamp(delta,-maxMove,maxMove);
  }

  function update(dt){
    // Pulsanti richiesti: sinistra = GIÙ, destra = SU.
    if(buttons.down||keys.s)L.y+=L.speed*dt;
    if(buttons.up||keys.w)L.y-=L.speed*dt;
    if(touch.left!==null)L.y+=(touch.left-L.h/2-L.y)*Math.min(1,14*dt);

    if(mode==='two'){
      if(keys.down)R.y+=R.speed*dt;if(keys.up)R.y-=R.speed*dt;
      if(touch.right!==null)R.y+=(touch.right-R.h/2-R.y)*Math.min(1,14*dt);
    }else updateCPU(dt);

    L.y=clamp(L.y,18,H-L.h-18);R.y=clamp(R.y,18,H-R.h-18);
    emitAura(L,'lightning',dt);emitAura(R,'wind',dt);
    if(waiting)return;

    trail.unshift({x:B.x,y:B.y,s:B.vx>=0?'wind':'lightning'});if(trail.length>20)trail.pop();
    B.x+=B.vx*dt;B.y+=B.vy*dt;

    if(B.y<=28&&B.vy<0){B.y=28;B.vy*=-1;tone(500,.035,'triangle',.022);}
    if(B.y>=H-28&&B.vy>0){B.y=H-28;B.vy*=-1;tone(500,.035,'triangle',.022);}

    collide(L,'left');collide(R,'right');
    if(B.x<-42)scorePoint('right');
    else if(B.x>W+42)scorePoint('left');
  }

  function burst(x,y,type,count){
    for(let i=0;i<count;i++){
      const a=Math.random()*Math.PI*2,sp=45+Math.random()*260;
      particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:.25+Math.random()*.68,max:.93,size:1+Math.random()*3.5,type});
    }
  }
  function emitAura(p,type,dt){
    if(Math.random()<(type==='lightning'?23:14)*dt){
      particles.push({x:p.x+p.w/2,y:p.y+Math.random()*p.h,vx:(Math.random()-.5)*70,vy:(Math.random()-.5)*70,life:.35,max:.35,size:1+Math.random()*2.5,type});
    }
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    const bg=ctx.createLinearGradient(0,0,W,0);bg.addColorStop(0,'#031b2d');bg.addColorStop(.5,'#051121');bg.addColorStop(1,'#141a28');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);

    const lg=ctx.createRadialGradient(70,H/2,10,70,H/2,360);lg.addColorStop(0,'rgba(0,210,255,.18)');lg.addColorStop(1,'rgba(0,210,255,0)');ctx.fillStyle=lg;ctx.fillRect(0,0,W/2,H);
    const rg=ctx.createRadialGradient(W-70,H/2,10,W-70,H/2,360);rg.addColorStop(0,'rgba(255,255,255,.10)');rg.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=rg;ctx.fillRect(W/2,0,W/2,H);

    for(const s of stars){ctx.fillStyle=`rgba(185,230,255,${s.a})`;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();}
    ctx.strokeStyle='rgba(160,220,255,.11)';ctx.setLineDash([10,16]);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(W/2,22);ctx.lineTo(W/2,H-22);ctx.stroke();ctx.setLineDash([]);

    for(let i=trail.length-1;i>=0;i--){const t=trail[i],alpha=(1-i/trail.length)*.3,r=B.r*(.25+(1-i/trail.length)*.75);ctx.fillStyle=t.s==='lightning'?`rgba(39,220,255,${alpha})`:`rgba(255,255,255,${alpha})`;ctx.beginPath();ctx.arc(t.x,t.y,r,0,Math.PI*2);ctx.fill();}
    for(const p of particles){const a=clamp(p.life/p.max,0,1);ctx.fillStyle=p.type==='lightning'?`rgba(39,220,255,${a})`:`rgba(245,250,255,${a})`;ctx.beginPath();ctx.arc(p.x,p.y,p.size*a,0,Math.PI*2);ctx.fill();}

    drawPaddle(L,'lightning');drawPaddle(R,'wind');
    ctx.save();ctx.shadowBlur=30;ctx.shadowColor=B.vx>=0?'#fff':'#27dcff';ctx.fillStyle='#f8fdff';ctx.beginPath();ctx.arc(B.x,B.y,B.r,0,Math.PI*2);ctx.fill();ctx.restore();
  }

  function drawPaddle(p,type){
    ctx.save();ctx.shadowBlur=28;ctx.shadowColor=type==='lightning'?'#27dcff':'#fff';
    const g=ctx.createLinearGradient(p.x,p.y,p.x+p.w,p.y+p.h);
    if(type==='lightning'){g.addColorStop(0,'#e8ffff');g.addColorStop(.35,'#28e3ff');g.addColorStop(1,'#0a8dff');}
    else{g.addColorStop(0,'#fff');g.addColorStop(.5,'#edf8ff');g.addColorStop(1,'#a9b8c9');}
    ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(p.x,p.y,p.w,p.h,8);ctx.fill();ctx.restore();
  }

  function loop(now){
    const dt=Math.min((now-last)/1000,.025);last=now;
    if(running&&!paused&&!gameOver)update(dt);
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.985;p.vy*=.985;if(p.life<=0)particles.splice(i,1);}
    draw();requestAnimationFrame(loop);
  }

  // AUDIO
  let audioCtx=null,sfxOn=true,musicOn=true,musicTimer=null,musicStep=0;
  function unlockAudio(){if(!audioCtx){const AC=window.AudioContext||window.webkitAudioContext;if(AC)audioCtx=new AC();}if(audioCtx?.state==='suspended')audioCtx.resume();}
  function tone(freq,duration=.05,type='sine',volume=.03,delay=0){
    if(!sfxOn)return;unlockAudio();if(!audioCtx)return;
    const t=audioCtx.currentTime+delay,o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(volume,t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+duration);o.connect(g);g.connect(audioCtx.destination);o.start(t);o.stop(t+duration+.02);
  }
  function musicNote(freq){
    if(!musicOn||!running||paused)return;unlockAudio();if(!audioCtx)return;
    const t=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='triangle';o.frequency.value=freq;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.011,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+.19);o.connect(g);g.connect(audioCtx.destination);o.start(t);o.stop(t+.22);
  }
  function startMusic(){if(!musicOn||musicTimer)return;const notes=[146.83,174.61,220,196,174.61,146.83,130.81,146.83];musicTimer=setInterval(()=>{if(running&&!paused&&musicOn){musicNote(notes[musicStep%notes.length]);musicStep++;}},270);}
  function stopMusic(){if(musicTimer){clearInterval(musicTimer);musicTimer=null;}}

  // TOUCH SUL CAMPO resta disponibile; i due pulsanti sono il controllo principale Lightning.
  function canvasPos(cx,cy){const r=canvas.getBoundingClientRect();return{x:(cx-r.left)*W/r.width,y:(cy-r.top)*H/r.height};}
  canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture?.(e.pointerId);const p=canvasPos(e.clientX,e.clientY);if(p.x<W/2)touch.left=p.y;else if(mode==='two')touch.right=p.y;unlockAudio();});
  canvas.addEventListener('pointermove',e=>{if(e.buttons||e.pointerType==='touch'){const p=canvasPos(e.clientX,e.clientY);if(p.x<W/2)touch.left=p.y;else if(mode==='two')touch.right=p.y;}});
  canvas.addEventListener('pointerup',e=>{const p=canvasPos(e.clientX,e.clientY);if(p.x<W/2)touch.left=null;else touch.right=null;});
  canvas.addEventListener('pointercancel',()=>{touch.left=touch.right=null;});

  function bindHold(button,dir){
    const press=e=>{e.preventDefault();button.setPointerCapture?.(e.pointerId);buttons[dir]=true;button.classList.add('pressed');unlockAudio();if(navigator.vibrate)navigator.vibrate(12);};
    const release=e=>{e?.preventDefault?.();buttons[dir]=false;button.classList.remove('pressed');};
    button.addEventListener('pointerdown',press);button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);button.addEventListener('contextmenu',e=>e.preventDefault());
  }
  function clearPressed(){ui.down.classList.remove('pressed');ui.up.classList.remove('pressed');}
  bindHold(ui.down,'down');bindHold(ui.up,'up');

  window.addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(['arrowup','arrowdown',' '].includes(k))e.preventDefault();if(k==='w')keys.w=true;if(k==='s')keys.s=true;if(k==='arrowup')keys.up=true;if(k==='arrowdown')keys.down=true;if(k==='p'&&!e.repeat)togglePause();});
  window.addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(k==='w')keys.w=false;if(k==='s')keys.s=false;if(k==='arrowup')keys.up=false;if(k==='arrowdown')keys.down=false;});

  $('cpuBtn').addEventListener('click',()=>startGame('cpu'));
  $('twoBtn').addEventListener('click',()=>startGame('two'));
  $('pauseTopBtn').addEventListener('click',()=>togglePause());
  $('resumeBtn').addEventListener('click',()=>togglePause(false));
  $('restartBtn').addEventListener('click',()=>startGame(mode));
  $('menuBtnPause').addEventListener('click',returnMenu);
  $('rematchBtn').addEventListener('click',()=>startGame(mode));
  $('menuBtn').addEventListener('click',returnMenu);
  $('fullBtn').addEventListener('click',requestPortraitFullscreen);

  document.querySelectorAll('[data-difficulty]').forEach(btn=>btn.addEventListener('click',()=>{difficulty=btn.dataset.difficulty;document.querySelectorAll('[data-difficulty]').forEach(b=>b.classList.toggle('active',b===btn));}));

  ui.music.addEventListener('click',()=>{musicOn=!musicOn;ui.music.classList.toggle('active',musicOn);if(musicOn)startMusic();else stopMusic();ui.sound.textContent=(musicOn||sfxOn)?'🔊':'🔇';});
  ui.sfx.addEventListener('click',()=>{sfxOn=!sfxOn;ui.sfx.classList.toggle('active',sfxOn);if(sfxOn)tone(680,.06,'sine',.025);ui.sound.textContent=(musicOn||sfxOn)?'🔊':'🔇';});
  ui.sound.addEventListener('click',()=>{const on=!(musicOn||sfxOn);musicOn=sfxOn=on;ui.music.classList.toggle('active',on);ui.sfx.classList.toggle('active',on);ui.sound.textContent=on?'🔊':'🔇';if(on)startMusic();else stopMusic();});

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;ui.install.classList.remove('hidden');});
  ui.install.addEventListener('click',async()=>{if(!installPrompt)return;installPrompt.prompt();try{await installPrompt.userChoice;}catch{}installPrompt=null;ui.install.classList.add('hidden');});
  window.addEventListener('appinstalled',()=>ui.install.classList.add('hidden'));

  document.addEventListener('visibilitychange',()=>{if(document.hidden&&running&&!paused)togglePause(true);});
  if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

  resetPaddles();draw();requestAnimationFrame(loop);
})();
