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
function wantedType(dest){
if(dest.acceptedCart)return dest.acceptedCart;
return dest.accepts||"";
}
function types(){
const found=[];
(doc.skeleton.destinations||[]).forEach(function(dest){
const type=wantedType(dest);
if(type&&found.indexOf(type)===-1)found.push(type);
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
resolved:false,
route:leg.points,
routeIndex:0,
terminal:leg.end,
facing:headingFrom(spawn.x,spawn.y,leg.points),
anim:0,
moving:false
};
state="playing";
}
function headingBetween(ax,ay,bx,by){
return Math.atan2(by-ay,bx-ax)+Math.PI/2;
}
function headingFrom(x,y,points){
const list=points||[];
for(let i=0;i<list.length;i++){
if(Math.hypot(list[i].x-x,list[i].y-y)>1)return headingBetween(x,y,list[i].x,list[i].y);
}
if(list.length>=2)return headingBetween(list[list.length-2].x,list[list.length-2].y,list[list.length-1].x,list[list.length-1].y);
return 0;
}
function angleDelta(from,to){
let d=to-from;
d=(d+Math.PI)%(Math.PI*2);
if(d<0)d+=Math.PI*2;
return d-Math.PI;
}
function desiredHeading(){
if(!cart)return 0;
return headingFrom(cart.x,cart.y,cart.route&&cart.route.slice(cart.routeIndex));
}
function stepFacing(dt,moving){
if(!cart)return;
const want=desiredHeading();
if(!Number.isFinite(cart.facing))cart.facing=want;
const diff=angleDelta(cart.facing,want);
const max=10*Math.max(0,dt);
if(Math.abs(diff)<=max)cart.facing=want;
else cart.facing+=Math.sign(diff)*max;
cart.moving=!!moving;
if(moving)cart.anim=(cart.anim||0)+dt*7;
}
function takeLeg(leg){
cart.route=leg.points;
cart.terminal=leg.end;
cart.phase=leg.end&&leg.end.kind==="intersection"?"toIntersection":"toDestination";
cart.routeIndex=0;
const first=cart.route[0];
if(first&&Math.hypot(first.x-cart.x,first.y-cart.y)<=1)cart.routeIndex=1;
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
if(dest&&cart.type===wantedType(dest)){
score+=1;
playCartSound(cart.type);
}else lives-=1;
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
if(end.kind==="intersection"){
const inter=graph().intersections.filter(function(item){return item.id===end.id;})[0];
const choice=(inter&&(choices[end.id]||inter.defaultDirection))||"";
const branch=inter&&inter.outgoing.filter(function(item){return item.id===choice;})[0];
cart.lockedDirection=branch?branch.id:choice;
if(!branch){failCart();return;}
const leg=CM.legAlong(doc,branch.pathId,"intersection",inter.id);
if(!leg.points||leg.points.length<2){failCart();return;}
takeLeg(leg);
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
if(!target){
arrive();
if(cart&&!cart.resolved)stepFacing(dt,true);
return;
}
const dx=target.x-cart.x;
const dy=target.y-cart.y;
const dist=Math.hypot(dx,dy);
const step=CART_SPEED*dt;
if(dist<=step||dist<=1){
cart.x=target.x;
cart.y=target.y;
cart.routeIndex+=1;
if(cart.routeIndex>=cart.route.length){
arrive();
if(cart&&!cart.resolved)stepFacing(dt,true);
return;
}
stepFacing(dt,true);
return;
}
cart.x+=dx/dist*step;
cart.y+=dy/dist*step;
stepFacing(dt,true);
}

function syncHud(){
const direction=shownDirection();
if(scoreEl)scoreEl.textContent="Score: "+score;
if(livesEl)livesEl.textContent="Lives: "+lives;
if(directionEl)directionEl.textContent="Direction: "+direction;
if(statusEl){
if(state==="gameover")statusEl.textContent="Game Over";
else if(cart){
const spec=CM.cartById(cart.type);
statusEl.textContent="Cart: "+(spec?spec.name:cart.type);
}
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

function layerOn(name){
return !(doc.layerState&&doc.layerState[name]&&doc.layerState[name].visible===false);
}
function drawSprite(visual,x,y,maxSize){
if(!visual||!visual.src)return;
const part=CM.parseSprite(visual.src);
const img=imageOf(part.src);
const scale=visual.scale||1;
let w=part.rect?part.rect.w:maxSize;
let h=part.rect?part.rect.h:maxSize;
if(!part.rect&&img&&img.naturalWidth){
w=img.naturalWidth;
h=img.naturalHeight||maxSize;
const fit=Math.min(1,maxSize/Math.max(w,h));
w*=fit;h*=fit;
}
ctx.save();
ctx.translate(x+(visual.offsetX||0),y+(visual.offsetY||0));
ctx.rotate((visual.rotation||0)*Math.PI/180);
ctx.imageSmoothingEnabled=false;
if(img&&part.rect)ctx.drawImage(img,part.rect.x,part.rect.y,part.rect.w,part.rect.h,-w*scale/2,-h*scale/2,w*scale,h*scale);
else if(img)ctx.drawImage(img,-w*scale/2,-h*scale/2,w*scale,h*scale);
ctx.restore();
}
function drawSpriteRef(ref,x,y,w,h){
const part=CM.parseSprite(ref);
const img=imageOf(part.src);
ctx.imageSmoothingEnabled=false;
if(!img)return;
if(part.rect)ctx.drawImage(img,part.rect.x,part.rect.y,part.rect.w,part.rect.h,x,y,w,h);
else ctx.drawImage(img,x,y,w,h);
}
function drawTileBucket(id){
const size=(doc.grid&&doc.grid.size)||32;
const cols=Math.max(1,Math.round((doc.width||size)/size));
const rows=Math.max(1,Math.round((doc.height||size)/size));
const layer=doc.layers&&doc.layers[id];
if(!layer)return;
Object.keys(layer).forEach(function(key){
const parts=key.split(",");
const c=Number(parts[0]);
const r=Number(parts[1]);
if(c<0||r<0||c>=cols||r>=rows)return;
drawSpriteRef(layer[key],c*size,r*size,size,size);
});
}
function drawRoadStyles(){
const size=(doc.grid&&doc.grid.size)||32;
const cols=Math.max(1,Math.round((doc.width||size)/size));
const rows=Math.max(1,Math.round((doc.height||size)/size));
(doc.skeleton.paths||[]).forEach(function(path){
if(!path.visualStyle||!path.visualStyle.src)return;
CM.roadCells(doc,path).forEach(function(key){
const parts=key.split(",");
const c=Number(parts[0]);
const r=Number(parts[1]);
if(c<0||r<0||c>=cols||r>=rows)return;
drawSpriteRef(path.visualStyle.src,c*size,r*size,size,size);
});
});
}
function drawBuildingVisuals(){
(doc.skeleton.destinations||[]).forEach(function(dest){
if(dest.visual)drawSprite(dest.visual,dest.x,dest.y,128);
});
}
function drawObjectLayer(){
(doc.objects||[]).forEach(function(obj){
ctx.save();
ctx.translate(obj.x,obj.y);
ctx.rotate((obj.rotation||0)*Math.PI/180);
ctx.scale(obj.scale||1,obj.scale||1);
drawSpriteRef(obj.asset,-obj.w/2,-obj.h/2,obj.w,obj.h);
ctx.restore();
});
(doc.skeleton.spawns||[]).forEach(function(spawn){
if(spawn.visual)drawSprite(spawn.visual,spawn.x,spawn.y,72);
});
}
function drawWorld(){
const records=doc.layerRecords||[];
let roads=false;
let buildings=false;
let objects=false;
records.forEach(function(record){
if(record.role==="road"||record.id==="roads")roads=true;
if(record.role==="building"||record.id==="buildings")buildings=true;
if(record.kind==="object")objects=true;
if(record.visible===false||record.kind==="route")return;
if(record.kind==="object"){drawObjectLayer();return;}
drawTileBucket(record.id);
if(record.role==="road"||record.id==="roads")drawRoadStyles();
if(record.role==="building"||record.id==="buildings")drawBuildingVisuals();
});
if(!roads)drawRoadStyles();
if(!buildings)drawBuildingVisuals();
if(!objects)drawObjectLayer();
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
ctx.imageSmoothingEnabled=false;
ctx.clearRect(-fit.ox/fit.s,-fit.oy/fit.s,canvas.width/fit.s,canvas.height/fit.s);
ctx.fillStyle="#ffffff";
ctx.fillRect(0,0,world.width,world.height);
drawWorld();
const compiled=graph();
const highlighted={};
compiled.intersections.forEach(function(inter){
const choice=choices[inter.id]||inter.defaultDirection;
inter.outgoing.forEach(function(branch){if(branch.id===choice)highlighted[branch.pathId]=true;});
});
(doc.skeleton.paths||[]).forEach(function(path){
if(path.visualStyle&&path.visualStyle.src)return;
drawPath(path,!!highlighted[path.id]);
});
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
const styled=dest.visual&&dest.visual.src;
ctx.fillStyle=styled?"#111":"#fff";
ctx.strokeStyle="#111";
ctx.lineWidth=3;
if(!styled){
ctx.fillRect(dest.x-46,dest.y-34,92,68);
ctx.strokeRect(dest.x-46,dest.y-34,92,68);
ctx.fillStyle="#111";
}
ctx.font=styled?"bold 16px Arial":"bold 32px Arial";
ctx.textAlign="center";
ctx.textBaseline="middle";
ctx.fillText(dest.label||dest.accepts||"?",dest.x,dest.y);
});
compiled.intersections.forEach(function(inter){
drawIntersectionArrow(inter);
});
if(cart)drawCartBody();
}

function drawCartBody(){
const spec=CM.cartById(cart.type);
const img=spec&&imageOf(spec.image);
const moving=!!cart.moving;
const bob=moving?Math.sin(cart.anim||0)*2.2:0;
const rock=moving?Math.sin((cart.anim||0)*2)*0.03:0;
ctx.save();
ctx.translate(cart.x,cart.y+bob);
ctx.imageSmoothingEnabled=false;
if(img){
const turn=CM.cartSpriteTransform?CM.cartSpriteTransform(cart.type):{rotation:Math.PI,scale:1,base:56};
ctx.rotate(turn.rotation+(cart.facing||0)+rock);
ctx.imageSmoothingEnabled=true;
const max=turn.base*turn.scale;
const fit=Math.min(max/img.naturalWidth,max/img.naturalHeight);
const w=img.naturalWidth*fit;
const h=img.naturalHeight*fit;
ctx.drawImage(img,-w/2,-h/2,w,h);
}else{
ctx.beginPath();
ctx.arc(0,0,22,0,Math.PI*2);
ctx.fillStyle=cart.type==="A"?"#1d4ed8":cart.type==="B"?"#f59e0b":"#6d28d9";
ctx.fill();
ctx.lineWidth=3;
ctx.strokeStyle="#111";
ctx.stroke();
ctx.fillStyle=cart.type==="A"||cart.type!=="B"?"#fff":"#111";
ctx.font="bold 22px Arial";
ctx.textAlign="center";
ctx.textBaseline="middle";
ctx.fillText(cart.type,0,1);
}
ctx.restore();
}
let audioUnlocked=false;
const cartSounds={};
function unlockAudio(){
audioUnlocked=true;
const Ctx=window.AudioContext||window.webkitAudioContext;
if(Ctx&&!unlockAudio.ctx){
try{unlockAudio.ctx=new Ctx();unlockAudio.ctx.resume();}catch(err){}
}else if(unlockAudio.ctx&&unlockAudio.ctx.state==="suspended"){
unlockAudio.ctx.resume();
}
}
function playCartSound(type){
if(!audioUnlocked)return;
const spec=CM.cartById(type);
if(!spec||!spec.sound)return;
let audio=cartSounds[spec.id];
if(!audio){
audio=new Audio(spec.sound);
cartSounds[spec.id]=audio;
}
audio.pause();
try{audio.currentTime=0;}catch(err){}
const pending=audio.play();
if(pending&&pending.catch)pending.catch(function(){});
}
function liveCompass(inter){
const choice=choices[inter.id]||inter.defaultDirection;
const branch=(inter.outgoing||[]).filter(function(item){return item.id===choice;})[0];
return (branch&&branch.compass)||inter.direction||"up";
}
function drawIntersectionArrow(inter){
const direction=liveCompass(inter);
const angle=((CM.DIRECTION_ANGLE&&CM.DIRECTION_ANGLE[direction])||0)*Math.PI/180;
const img=imageOf(CM.ARROW_SRC);
ctx.save();
ctx.translate(inter.x,inter.y);
ctx.rotate(angle);
ctx.imageSmoothingEnabled=true;
if(img)ctx.drawImage(img,-CM.ARROW_W/2,-CM.ARROW_H/2,CM.ARROW_W,CM.ARROW_H);
else{
ctx.fillStyle="#e53935";
ctx.beginPath();
ctx.moveTo(0,-28);
ctx.lineTo(22,20);
ctx.lineTo(-22,20);
ctx.closePath();
ctx.fill();
}
ctx.restore();
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
unlockAudio();
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

function preloadCarts(){
(CM.CARTS||[]).forEach(function(spec){imageOf(spec.image);});
}
function begin(){
unlockAudio();
preloadCarts();
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
facing:cart.facing,
moving:!!cart.moving,
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
