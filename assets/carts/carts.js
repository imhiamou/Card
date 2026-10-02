/*
 * Carts — local single player.
 * Carts follow the map skeleton. Decoration is drawn underneath and does not
 * affect routing. Score and lives match the first prototype.
 */
(function(){
const CART_SPAWN_DELAY=1500;
const CART_SPEED=120;
const CM=window.CartsMap;

let doc=CM?CM.clone(CM.builtin()):null;
let choices={};
let state="waiting";
let score=0;
let lives=3;
let nextIndex=0;
let cart=null;
let waitUntil=0;
let running=false;
let active=false;
let fromEditor=false;
let raf=0;
let lastTime=0;
const images={};

const screen=document.getElementById("cartsScreen");
const canvas=document.getElementById("cartsCanvas");
const scoreEl=document.getElementById("cartsScore");
const livesEl=document.getElementById("cartsLives");
const directionEl=document.getElementById("cartsDirection");
const statusEl=document.getElementById("cartsStatus");
const overlay=document.getElementById("cartsOverlay");
const finalScoreEl=document.getElementById("cartsFinalScore");
const editorBtn=document.getElementById("cartsEditorReturn");
const ctx=canvas?canvas.getContext("2d"):null;

function view(){
return CM.legacyView(doc);
}
function graph(){
return CM.compile(doc);
}
function types(){
const found=[];
(doc.skeleton.destinations||[]).forEach(function(dest){
if(dest.accepts&&found.indexOf(dest.accepts)===-1)found.push(dest.accepts);
});
if(!found.length)return ["A","B"];
return found;
}
function approachId(){
if(cart&&cart.phase==="toIntersection"&&cart.terminal&&cart.terminal.kind==="intersection")return cart.terminal.id;
const list=graph().intersections;
return list.length?list[0].id:"";
}
function shownDirection(){
const id=approachId();
if(id&&choices[id])return choices[id];
const list=graph().intersections;
return list.length&&list[0].defaultDirection?list[0].defaultDirection:"A";
}

function resetMatch(){
score=0;
lives=3;
nextIndex=0;
cart=null;
state="waiting";
waitUntil=0;
choices=CM.initialChoices(doc);
if(overlay)overlay.classList.add("hidden");
}

function spawnCart(){
if(cart||lives<=0||state==="gameover")return;
const order=types();
const type=order[nextIndex%order.length];
nextIndex+=1;
const spawn=(doc.skeleton.spawns||[]).filter(function(item){return item.enabled!==false;})[0];
if(!spawn){state="gameover";return;}
const paths=CM.pathTouching(doc,"spawn",spawn.id);
if(!paths.length){state="gameover";return;}
const leg=CM.legAlong(doc,paths[0].id,"spawn",spawn.id);
cart={
type:type,
x:spawn.x,
y:spawn.y,
phase:leg.end.kind==="intersection"?"toIntersection":"toDestination",
lockedDirection:null,
lockedAt:{},
resolved:false,
route:leg.points,
routeIndex:0,
terminal:leg.end
};
state="playing";
}

function failCart(){
if(!cart||cart.resolved)return;
cart.resolved=true;
lives-=1;
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

function resolveDestination(id){
if(!cart||cart.resolved)return;
cart.resolved=true;
const dest=CM.byId(doc.skeleton.destinations,id);
if(dest&&cart.type===dest.accepts)score+=1;
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

function arrive(){
if(!cart)return;
const end=cart.terminal||{kind:"open"};
if(end.kind==="intersection"&&!cart.lockedAt[end.id]){
const inter=graph().intersections.filter(function(item){return item.id===end.id;})[0];
const choice=(inter&&(choices[end.id]||inter.defaultDirection))||"";
const branch=inter&&inter.outgoing.filter(function(item){return item.id===choice;})[0]||(inter&&inter.outgoing[0]);
cart.lockedDirection=branch?branch.id:choice;
cart.lockedAt[end.id]=cart.lockedDirection;
cart.phase="toDestination";
if(!branch){failCart();return;}
const leg=CM.legAlong(doc,branch.pathId,"intersection",inter.id);
cart.route=leg.points;
cart.routeIndex=0;
cart.terminal=leg.end;
return;
}
if(end.kind==="destination"){resolveDestination(end.id);return;}
failCart();
}

function update(now,dt){
if(state==="gameover")return;
if(state==="waiting"&&!cart&&lives>0&&now>=waitUntil)spawnCart();
if(state!=="playing"||!cart||cart.resolved)return;
const target=cart.route[cart.routeIndex];
if(!target){arrive();return;}
const dx=target.x-cart.x;
const dy=target.y-cart.y;
const dist=Math.hypot(dx,dy);
const step=CART_SPEED*dt;
if(dist<=step||dist<=1){
cart.x=target.x;
cart.y=target.y;
cart.routeIndex+=1;
if(cart.routeIndex>=cart.route.length)arrive();
return;
}
cart.x+=dx/dist*step;
cart.y+=dy/dist*step;
}

function syncHud(){
const direction=shownDirection();
if(scoreEl)scoreEl.textContent="Score: "+score;
if(livesEl)livesEl.textContent="Lives: "+lives;
if(directionEl)directionEl.textContent="Direction: "+direction;
if(statusEl){
if(state==="gameover")statusEl.textContent="Game Over";
else if(cart)statusEl.textContent="Cart: "+cart.type;
else statusEl.textContent="Next cart";
}
if(editorBtn)editorBtn.classList.toggle("hidden",!fromEditor);
}

function imageOf(src){
if(!src)return null;
if(!images[src]){
const img=new Image();
images[src]={img:img,ready:false};
img.onload=function(){images[src].ready=true;};
img.src=src;
}
return images[src].ready?images[src].img:null;
}

function drawPath(path,selected){
if(!path||!path.points||path.points.length<2)return;
ctx.beginPath();
ctx.moveTo(path.points[0].x,path.points[0].y);
path.points.forEach(function(point){ctx.lineTo(point.x,point.y);});
ctx.lineWidth=selected?12:7;
ctx.strokeStyle=selected?"#1565c0":"#111";
ctx.lineCap="round";
ctx.lineJoin="round";
ctx.stroke();
if(!selected)return;
const a=path.points[0];
const b=path.points[path.points.length-1];
const mx=(a.x+b.x)/2;
const my=(a.y+b.y)/2;
const ang=Math.atan2(b.y-a.y,b.x-a.x);
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

function draw(){
if(!ctx||!doc)return;
const world={width:doc.width,height:doc.height};
const fit=fitTransform();
ctx.setTransform(fit.s,0,0,fit.s,fit.ox,fit.oy);
ctx.clearRect(-fit.ox/fit.s,-fit.oy/fit.s,canvas.width/fit.s,canvas.height/fit.s);
ctx.fillStyle="#ffffff";
ctx.fillRect(0,0,world.width,world.height);
const size=(doc.grid&&doc.grid.size)||32;
CM.TILE_LAYERS.forEach(function(name){
const layer=doc.layers[name]||{};
if(doc.layerState&&doc.layerState[name]&&doc.layerState[name].visible===false)return;
Object.keys(layer).forEach(function(key){
const parts=key.split(",");
const x=Number(parts[0])*size;
const y=Number(parts[1])*size;
const img=imageOf(layer[key]);
if(img)ctx.drawImage(img,x,y,size,size);
});
});
(doc.objects||[]).forEach(function(obj){
ctx.save();
ctx.translate(obj.x,obj.y);
ctx.rotate((obj.rotation||0)*Math.PI/180);
const scale=obj.scale||1;
const img=imageOf(obj.asset);
if(img)ctx.drawImage(img,-obj.w*scale/2,-obj.h*scale/2,obj.w*scale,obj.h*scale);
ctx.restore();
});
const compiled=graph();
const highlighted={};
compiled.intersections.forEach(function(inter){
const choice=choices[inter.id]||inter.defaultDirection;
inter.outgoing.forEach(function(branch){if(branch.id===choice)highlighted[branch.pathId]=true;});
});
(doc.skeleton.paths||[]).forEach(function(path){drawPath(path,!!highlighted[path.id]);});
(doc.skeleton.spawns||[]).forEach(function(spawn){
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
});
(doc.skeleton.destinations||[]).forEach(function(dest){
ctx.fillStyle="#fff";
ctx.strokeStyle="#111";
ctx.lineWidth=3;
ctx.fillRect(dest.x-46,dest.y-34,92,68);
ctx.strokeRect(dest.x-46,dest.y-34,92,68);
ctx.fillStyle="#111";
ctx.font="bold 32px Arial";
ctx.textAlign="center";
ctx.textBaseline="middle";
ctx.fillText(dest.label||dest.accepts||"?",dest.x,dest.y);
});
compiled.intersections.forEach(function(inter){
ctx.beginPath();
ctx.moveTo(inter.x,inter.y-28);
ctx.lineTo(inter.x+28,inter.y);
ctx.lineTo(inter.x,inter.y+28);
ctx.lineTo(inter.x-28,inter.y);
ctx.closePath();
ctx.fillStyle="#e53935";
ctx.fill();
ctx.lineWidth=3;
ctx.strokeStyle="#7f1010";
ctx.stroke();
});
if(cart){
ctx.beginPath();
ctx.arc(cart.x,cart.y,22,0,Math.PI*2);
ctx.fillStyle=cart.type==="A"?"#1d4ed8":cart.type==="B"?"#f59e0b":"#6d28d9";
ctx.fill();
ctx.lineWidth=3;
ctx.strokeStyle="#111";
ctx.stroke();
ctx.fillStyle=cart.type==="A"||cart.type!=="B"?"#fff":"#111";
ctx.font="bold 22px Arial";
ctx.textAlign="center";
ctx.textBaseline="middle";
ctx.fillText(cart.type,cart.x,cart.y+1);
}
}

function fitTransform(){
const worldW=doc.width||1;
const worldH=doc.height||1;
const s=Math.min(canvas.width/worldW,canvas.height/worldH);
return {s:s,ox:(canvas.width-worldW*s)/2,oy:(canvas.height-worldH*s)/2};
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
const sx=(event.clientX-rect.left)/rect.width*canvas.width;
const sy=(event.clientY-rect.top)/rect.height*canvas.height;
const fit=fitTransform();
return {x:(sx-fit.ox)/fit.s,y:(sy-fit.oy)/fit.s};
}

function cycle(id){
const inter=graph().intersections.filter(function(item){return item.id===id;})[0];
if(!inter||!inter.outgoing.length)return;
const ids=inter.outgoing.map(function(branch){return branch.id;});
const index=ids.indexOf(choices[id]);
choices[id]=ids[(index+1)%ids.length];
}

function onPointer(event){
if(!running||!canvas||state==="gameover")return;
const p=worldFromEvent(event);
let hit=null;
let best=72;
graph().intersections.forEach(function(inter){
const dist=Math.hypot(p.x-inter.x,p.y-inter.y);
if(dist<=best){best=dist;hit=inter;}
});
if(!hit)return;
cycle(hit.id);
syncHud();
draw();
event.preventDefault();
}

function showScreen(){
const lobby=document.getElementById("lobbyScreen");
const editor=document.getElementById("cartsEditorScreen");
if(lobby)lobby.classList.add("hidden");
if(editor)editor.classList.add("hidden");
if(screen)screen.classList.remove("hidden");
active=true;
}

function begin(){
showScreen();
resetMatch();
running=true;
lastTime=0;
if(raf)cancelAnimationFrame(raf);
syncHud();
fitCanvas();
raf=requestAnimationFrame(frame);
}

function start(){
fromEditor=false;
doc=CM.clone(CM.builtin());
begin();
}
function playMap(next){
fromEditor=true;
doc=CM.normalize(next||CM.builtin());
begin();
}
function restart(){
resetMatch();
running=true;
lastTime=0;
if(!raf)raf=requestAnimationFrame(frame);
syncHud();
draw();
}
function stop(opts){
running=false;
active=false;
if(raf)cancelAnimationFrame(raf);
raf=0;
lastTime=0;
cart=null;
if(screen)screen.classList.add("hidden");
if(overlay)overlay.classList.add("hidden");
if(opts&&opts.toEditor&&window.CartsEditor){
window.CartsEditor.reveal();
return;
}
fromEditor=false;
const lobby=document.getElementById("lobbyScreen");
if(lobby)lobby.classList.remove("hidden");
}

function snapshot(){
const order=types();
return {
state:state,
score:score,
lives:lives,
direction:shownDirection(),
spawnDelay:CART_SPAWN_DELAY,
nextType:order[nextIndex%order.length],
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
if(lobbyBtn)lobbyBtn.addEventListener("click",function(){stop();});
if(restartBtn)restartBtn.addEventListener("click",restart);
if(editorBtn)editorBtn.addEventListener("click",function(){stop({toEditor:true});});
window.addEventListener("resize",fitCanvas);
const stage=document.querySelector(".cartsStage");
if(stage&&window.ResizeObserver)new ResizeObserver(fitCanvas).observe(stage);

window.Carts={
start:start,
playMap:playMap,
restart:restart,
stop:stop,
isActive:function(){return active;},
getState:snapshot,
getMap:function(){return view();}
};
})();
