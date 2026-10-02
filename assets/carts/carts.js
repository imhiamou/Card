/*
 * Carts — local single-player prototype.
 * The player only switches the intersection. Carts move on their own.
 * Track positions live in CARTS_MAP so a map editor can replace them later.
 */
(function(){
const CART_SPAWN_DELAY=1500;
const CART_SPEED=120;

const CARTS_MAP={
world:{width:720,height:640},
spawn:{x:360,y:560},
intersection:{x:360,y:300,hitRadius:72},
destinations:{
A:{id:"A",x:360,y:78,w:92,h:68,label:"A"},
B:{id:"B",x:96,y:300,w:92,h:68,label:"B"}
},
tracks:[
{id:"approach",from:"spawn",to:"intersection"},
{id:"A",from:"intersection",to:"A"},
{id:"B",from:"intersection",to:"B"}
]
};

let state="waiting";
let score=0;
let lives=3;
let direction="A";
let nextIndex=0;
let cart=null;
let waitUntil=0;
let running=false;
let active=false;
let raf=0;
let lastTime=0;

const screen=document.getElementById("cartsScreen");
const canvas=document.getElementById("cartsCanvas");
const scoreEl=document.getElementById("cartsScore");
const livesEl=document.getElementById("cartsLives");
const directionEl=document.getElementById("cartsDirection");
const statusEl=document.getElementById("cartsStatus");
const overlay=document.getElementById("cartsOverlay");
const finalScoreEl=document.getElementById("cartsFinalScore");
const ctx=canvas?canvas.getContext("2d"):null;

function pointOf(ref){
if(ref==="spawn")return CARTS_MAP.spawn;
if(ref==="intersection")return CARTS_MAP.intersection;
return CARTS_MAP.destinations[ref];
}

function resetMatch(){
score=0;
lives=3;
direction="A";
nextIndex=0;
cart=null;
state="waiting";
waitUntil=0;
if(overlay)overlay.classList.add("hidden");
}

function spawnCart(){
if(cart||lives<=0||state==="gameover")return;
const type=nextIndex%2===0?"A":"B";
nextIndex+=1;
const spawn=CARTS_MAP.spawn;
cart={
type:type,
x:spawn.x,
y:spawn.y,
phase:"toIntersection",
lockedDirection:null,
resolved:false
};
state="playing";
}

function resolveCart(){
if(!cart||cart.resolved)return;
cart.resolved=true;
const correct=cart.type===cart.lockedDirection;
if(correct)score+=1;
else lives-=1;
cart=null;
if(lives<=0){
lives=0;
state="gameover";
if(overlay)overlay.classList.remove("hidden");
if(finalScoreEl)finalScoreEl.textContent="Score: "+score;
return;
}
state="waiting";
waitUntil=performance.now()+CART_SPAWN_DELAY;
}

function update(now,dt){
if(state==="gameover")return;
if(state==="waiting"&&!cart&&lives>0&&now>=waitUntil)spawnCart();
if(state!=="playing"||!cart||cart.resolved)return;
const target=cart.phase==="toIntersection"
?CARTS_MAP.intersection
:CARTS_MAP.destinations[cart.lockedDirection];
if(!target)return;
const dx=target.x-cart.x;
const dy=target.y-cart.y;
const dist=Math.hypot(dx,dy);
const step=CART_SPEED*dt;
if(dist<=step||dist<=1){
cart.x=target.x;
cart.y=target.y;
if(cart.phase==="toIntersection"){
cart.lockedDirection=direction;
cart.phase="toDestination";
}else{
resolveCart();
}
return;
}
cart.x+=dx/dist*step;
cart.y+=dy/dist*step;
}

function syncHud(){
if(scoreEl)scoreEl.textContent="Score: "+score;
if(livesEl)livesEl.textContent="Lives: "+lives;
if(directionEl){
directionEl.textContent=direction==="A"?"Direction: A":"Direction: B";
}
if(statusEl){
if(state==="gameover")statusEl.textContent="Game Over";
else if(cart)statusEl.textContent="Cart: "+cart.type;
else statusEl.textContent="Next cart";
}
}

function drawTrack(segment){
const a=pointOf(segment.from);
const b=pointOf(segment.to);
const selected=segment.id===direction;
ctx.beginPath();
ctx.moveTo(a.x,a.y);
ctx.lineTo(b.x,b.y);
ctx.lineWidth=selected?12:7;
ctx.strokeStyle=selected?"#1565c0":"#111";
ctx.lineCap="round";
ctx.stroke();
}

function drawArrow(from,to){
const mx=(from.x+to.x)/2;
const my=(from.y+to.y)/2;
const ang=Math.atan2(to.y-from.y,to.x-from.x);
ctx.save();
ctx.translate(mx,my);
ctx.rotate(ang);
ctx.fillStyle="#1565c0";
ctx.beginPath();
ctx.moveTo(18,0);
ctx.lineTo(-12,10);
ctx.lineTo(-12,-10);
ctx.closePath();
ctx.fill();
ctx.restore();
}

function drawBox(dest){
const x=dest.x-dest.w/2;
const y=dest.y-dest.h/2;
ctx.fillStyle="#fff";
ctx.strokeStyle="#111";
ctx.lineWidth=3;
ctx.fillRect(x,y,dest.w,dest.h);
ctx.strokeRect(x,y,dest.w,dest.h);
ctx.fillStyle="#111";
ctx.font="bold 32px Arial";
ctx.textAlign="center";
ctx.textBaseline="middle";
ctx.fillText(dest.label,dest.x,dest.y);
}

function drawDiamond(x,y,r){
ctx.beginPath();
ctx.moveTo(x,y-r);
ctx.lineTo(x+r,y);
ctx.lineTo(x,y+r);
ctx.lineTo(x-r,y);
ctx.closePath();
ctx.fillStyle="#e53935";
ctx.fill();
ctx.lineWidth=3;
ctx.strokeStyle="#7f1010";
ctx.stroke();
}

function draw(){
if(!ctx)return;
const world=CARTS_MAP.world;
ctx.setTransform(canvas.width/world.width,0,0,canvas.height/world.height,0,0);
ctx.clearRect(0,0,world.width,world.height);
ctx.fillStyle="#ffffff";
ctx.fillRect(0,0,world.width,world.height);

CARTS_MAP.tracks.forEach(drawTrack);
const branch=CARTS_MAP.tracks.find((segment)=>segment.id===direction);
if(branch)drawArrow(pointOf(branch.from),pointOf(branch.to));

const spawn=CARTS_MAP.spawn;
ctx.beginPath();
ctx.arc(spawn.x,spawn.y,16,0,Math.PI*2);
ctx.strokeStyle="#777";
ctx.lineWidth=2;
ctx.stroke();
ctx.fillStyle="#555";
ctx.font="14px Arial";
ctx.textAlign="center";
ctx.textBaseline="top";
ctx.fillText("SPAWN",spawn.x,spawn.y+22);

drawBox(CARTS_MAP.destinations.A);
drawBox(CARTS_MAP.destinations.B);

const hit=CARTS_MAP.intersection;
drawDiamond(hit.x,hit.y,28);

if(cart){
ctx.beginPath();
ctx.arc(cart.x,cart.y,22,0,Math.PI*2);
ctx.fillStyle=cart.type==="A"?"#1d4ed8":"#f59e0b";
ctx.fill();
ctx.lineWidth=3;
ctx.strokeStyle="#111";
ctx.stroke();
ctx.fillStyle=cart.type==="A"?"#fff":"#111";
ctx.font="bold 22px Arial";
ctx.textAlign="center";
ctx.textBaseline="middle";
ctx.fillText(cart.type,cart.x,cart.y+1);
}
}

function fitCanvas(){
if(!canvas)return;
const rect=canvas.getBoundingClientRect();
if(rect.width<2||rect.height<2)return;
const dpr=Math.min(window.devicePixelRatio||1,2);
canvas.width=Math.max(1,Math.round(rect.width*dpr));
canvas.height=Math.max(1,Math.round(rect.height*dpr));
draw();
}

function frame(now){
if(!running)return;
if(!lastTime){
lastTime=now;
raf=requestAnimationFrame(frame);
return;
}
const dt=Math.min(0.05,(now-lastTime)/1000);
lastTime=now;
if(canvas.width<2)fitCanvas();
update(now,dt);
syncHud();
draw();
raf=requestAnimationFrame(frame);
}

function worldFromEvent(event){
const rect=canvas.getBoundingClientRect();
const world=CARTS_MAP.world;
return {
x:(event.clientX-rect.left)/rect.width*world.width,
y:(event.clientY-rect.top)/rect.height*world.height
};
}

function onPointer(event){
if(!running||!canvas||state==="gameover")return;
const p=worldFromEvent(event);
const hit=CARTS_MAP.intersection;
if(Math.hypot(p.x-hit.x,p.y-hit.y)<=hit.hitRadius){
direction=direction==="A"?"B":"A";
syncHud();
draw();
event.preventDefault();
}
}

function showScreen(){
const lobby=document.getElementById("lobbyScreen");
if(lobby)lobby.classList.add("hidden");
if(screen)screen.classList.remove("hidden");
active=true;
}

function start(){
showScreen();
resetMatch();
running=true;
lastTime=0;
if(raf)cancelAnimationFrame(raf);
syncHud();
fitCanvas();
raf=requestAnimationFrame(frame);
}

function restart(){
resetMatch();
running=true;
lastTime=0;
if(!raf)raf=requestAnimationFrame(frame);
syncHud();
draw();
}

function stop(){
running=false;
active=false;
if(raf)cancelAnimationFrame(raf);
raf=0;
lastTime=0;
cart=null;
if(screen)screen.classList.add("hidden");
if(overlay)overlay.classList.add("hidden");
const lobby=document.getElementById("lobbyScreen");
if(lobby)lobby.classList.remove("hidden");
}

function snapshot(){
return {
state:state,
score:score,
lives:lives,
direction:direction,
spawnDelay:CART_SPAWN_DELAY,
nextType:nextIndex%2===0?"A":"B",
cart:cart?{
type:cart.type,
x:cart.x,
y:cart.y,
phase:cart.phase,
lockedDirection:cart.lockedDirection,
resolved:cart.resolved
}:null
};
}

if(canvas)canvas.addEventListener("pointerdown",onPointer);
const lobbyBtn=document.getElementById("cartsLobbyBtn");
const restartBtn=document.getElementById("cartsRestartBtn");
if(lobbyBtn)lobbyBtn.addEventListener("click",stop);
if(restartBtn)restartBtn.addEventListener("click",restart);
window.addEventListener("resize",fitCanvas);
const stage=document.querySelector(".cartsStage");
if(stage&&window.ResizeObserver)new ResizeObserver(fitCanvas).observe(stage);

window.Carts={
start:start,
restart:restart,
stop:stop,
isActive:function(){return active;},
getState:snapshot,
getMap:function(){return CARTS_MAP;}
};
})();
