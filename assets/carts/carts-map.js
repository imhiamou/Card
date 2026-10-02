/*
 * Carts map document.
 * Skeleton data is the route graph. Tile layers and objects are decoration
 * and never change how a cart moves.
 */
(function(root, factory){
if(typeof module==="object"&&module.exports)module.exports=factory();
else root.CartsMap=factory();
})(typeof window!=="undefined"?window:globalThis,function(){
const VERSION=1;
const TILE_LAYERS=["ground","roads","buildings","decorations"];
const FLOOD_LIMIT=20000;

function clone(value){
return JSON.parse(JSON.stringify(value));
}

function emptyLayers(){
return {ground:{},roads:{},buildings:{},decorations:{}};
}

function layerState(){
return {
skeleton:{visible:true,locked:false},
ground:{visible:true,locked:false},
roads:{visible:true,locked:false},
buildings:{visible:true,locked:false},
decorations:{visible:true,locked:false},
objects:{visible:true,locked:false}
};
}

function blank(name,width,height){
return {
version:VERSION,
type:"carts",
id:"",
name:name||"Untitled map",
width:width||1600,
height:height||1200,
grid:{size:32,visible:true,snap:true},
roadWidth:64,
skeleton:{paths:[],intersections:[],spawns:[],destinations:[]},
layers:emptyLayers(),
objects:[],
layerState:layerState(),
updated:Date.now()
};
}

function builtin(){
const map=blank("Prototype",720,640);
map.id="builtin";
map.grid.size=32;
map.roadWidth=64;
map.skeleton={
paths:[
{id:"pIn",width:64,branchId:"",points:[{x:360,y:560},{x:360,y:300}],from:{kind:"spawn",id:"s1"},to:{kind:"intersection",id:"i1"}},
{id:"pA",width:64,branchId:"A",points:[{x:360,y:300},{x:360,y:78}],from:{kind:"intersection",id:"i1"},to:{kind:"destination",id:"dA"}},
{id:"pB",width:64,branchId:"B",points:[{x:360,y:300},{x:96,y:300}],from:{kind:"intersection",id:"i1"},to:{kind:"destination",id:"dB"}}
],
intersections:[
{id:"i1",x:360,y:300,defaultDirection:"A"}
],
spawns:[
{id:"s1",x:360,y:560,pathId:"pIn",enabled:true}
],
destinations:[
{id:"dA",x:360,y:78,pathId:"pA",accepts:"A",label:"A"},
{id:"dB",x:96,y:300,pathId:"pB",accepts:"B",label:"B"}
]
};
return map;
}

function byId(list,id){
if(!list)return null;
for(let i=0;i<list.length;i++)if(list[i].id===id)return list[i];
return null;
}

function idsOf(map){
const used={};
function take(id){if(id)used[id]=true;}
(map.skeleton.paths||[]).forEach(function(p){take(p.id);});
(map.skeleton.intersections||[]).forEach(function(p){take(p.id);});
(map.skeleton.spawns||[]).forEach(function(p){take(p.id);});
(map.skeleton.destinations||[]).forEach(function(p){take(p.id);});
(map.objects||[]).forEach(function(p){take(p.id);});
return used;
}

function newId(map,prefix){
const used=idsOf(map);
let n=1;
let id=prefix+n;
while(used[id]){n+=1;id=prefix+n;}
return id;
}

function endMatch(end,kind,id){
return !!(end&&end.kind===kind&&end.id===id);
}

function pathTouching(map,kind,id){
return (map.skeleton.paths||[]).filter(function(path){
return endMatch(path.from,kind,id)||endMatch(path.to,kind,id);
});
}

function orient(path,entryKind,entryId){
const forward=endMatch(path.from,entryKind,entryId);
const points=(path.points||[]).map(function(p){return {x:p.x,y:p.y};});
if(!forward)points.reverse();
const exit=forward?path.to:path.from;
return {points:points,exit:exit||{kind:"open",id:""},forward:forward};
}

function legAlong(map,pathId,entryKind,entryId){
const points=[];
const pathIds=[];
let guard=0;
let current=pathId;
let kind=entryKind;
let id=entryId;
let end={kind:"open",id:""};
const seen={};
while(current&&guard<64){
guard+=1;
const path=byId(map.skeleton.paths,current);
if(!path){end={kind:"missing",id:current};break;}
const mark=current+"|"+kind+"|"+id;
if(seen[mark]){end={kind:"loop",id:current};break;}
seen[mark]=true;
pathIds.push(current);
const step=orient(path,kind,id);
step.points.forEach(function(p){
const last=points[points.length-1];
if(!last||last.x!==p.x||last.y!==p.y)points.push(p);
});
end=step.exit||{kind:"open",id:""};
if(!end.kind||end.kind==="open"||end.kind==="intersection"||end.kind==="destination"||end.kind==="spawn")break;
if(end.kind==="path"){
kind="path";
id=current;
current=end.id;
continue;
}
break;
}
return {points:points,end:end,pathIds:pathIds};
}

function compile(map){
const intersections=(map.skeleton.intersections||[]).map(function(inter){
const incoming=[];
const outgoing=[];
(map.skeleton.paths||[]).forEach(function(path){
const fromHere=endMatch(path.from,"intersection",inter.id);
const toHere=endMatch(path.to,"intersection",inter.id);
if(toHere)incoming.push(path.id);
if(fromHere){
const dest=path.to&&path.to.kind==="destination"?byId(map.skeleton.destinations,path.to.id):null;
const branch=path.branchId||(dest&&(dest.accepts||dest.label))||path.id;
outgoing.push({
id:String(branch),
pathId:path.id,
label:dest&&dest.label?dest.label:String(branch)
});
}
if(fromHere&&!toHere){
/* A path that only leaves this intersection is not incoming. */
}else if(fromHere&&toHere){
incoming.push(path.id);
}
});
let fallback=inter.defaultDirection||(outgoing[0]&&outgoing[0].id)||"";
if(!outgoing.some(function(b){return b.id===fallback;}))fallback=outgoing[0]?outgoing[0].id:"";
return {
id:inter.id,
x:inter.x,
y:inter.y,
incoming:incoming,
outgoing:outgoing,
defaultDirection:fallback
};
});
return {
width:map.width,
height:map.height,
roadWidth:map.roadWidth||64,
paths:map.skeleton.paths||[],
intersections:intersections,
spawns:map.skeleton.spawns||[],
destinations:map.skeleton.destinations||[]
};
}

function initialChoices(map){
const choices={};
compile(map).intersections.forEach(function(inter){
choices[inter.id]=inter.defaultDirection||"";
});
return choices;
}

function legacyView(map){
const graph=compile(map);
const spawn=graph.spawns.filter(function(s){return s.enabled!==false;})[0]||graph.spawns[0]||{x:0,y:0};
const inter=graph.intersections[0]||{x:0,y:0,outgoing:[]};
const destinations={};
graph.destinations.forEach(function(dest){
const key=dest.accepts||dest.label||dest.id;
destinations[key]={id:key,x:dest.x,y:dest.y,w:92,h:68,label:dest.label||key};
});
const tracks=[{id:"approach",from:"spawn",to:"intersection"}];
(inter.outgoing||[]).forEach(function(branch){
tracks.push({id:branch.id,from:"intersection",to:branch.id});
});
return {
world:{width:map.width,height:map.height},
spawn:{x:spawn.x,y:spawn.y},
intersection:{x:inter.x,y:inter.y,hitRadius:72},
destinations:destinations,
tracks:tracks,
document:map
};
}

function samePoint(a,b){
return Math.abs(a.x-b.x)<0.01&&Math.abs(a.y-b.y)<0.01;
}

function snapPoint(map,x,y){
const grid=map.grid||{};
const size=grid.size>0?grid.size:32;
if(!grid.snap)return {x:x,y:y};
return {x:Math.round(x/size)*size,y:Math.round(y/size)*size};
}

function cellOf(map,x,y){
const size=(map.grid&&map.grid.size)||32;
return {c:Math.floor(x/size),r:Math.floor(y/size),size:size};
}

function inMapCell(map,c,r){
const size=(map.grid&&map.grid.size)||32;
const cols=Math.ceil(map.width/size);
const rows=Math.ceil(map.height/size);
return c>=0&&r>=0&&c<cols&&r<rows;
}

function paintCells(layer,cells,asset){
Object.keys(cells).forEach(function(key){
if(asset)layer[key]=asset;
else delete layer[key];
});
}

function rectCells(c0,r0,c1,r1){
const cells={};
const minC=Math.min(c0,c1);
const maxC=Math.max(c0,c1);
const minR=Math.min(r0,r1);
const maxR=Math.max(r0,r1);
for(let c=minC;c<=maxC;c++){
for(let r=minR;r<=maxR;r++)cells[c+","+r]=true;
}
return cells;
}

function brushCells(c,r,size){
const n=Math.max(1,size|0);
const cells={};
for(let x=0;x<n;x++){
for(let y=0;y<n;y++)cells[(c+x)+","+(r+y)]=true;
}
return cells;
}

function flood(map,layerName,c,r,asset){
const layer=map.layers[layerName];
if(!layer)return {filled:0,capped:false};
const size=(map.grid&&map.grid.size)||32;
const cols=Math.ceil(map.width/size);
const rows=Math.ceil(map.height/size);
const target=layer[c+","+r]||"";
const next=asset||"";
if(target===next)return {filled:0,capped:false};
const stack=[[c,r]];
const seen={};
let filled=0;
let capped=false;
while(stack.length){
const cur=stack.pop();
const key=cur[0]+","+cur[1];
if(seen[key])continue;
if(cur[0]<0||cur[1]<0||cur[0]>=cols||cur[1]>=rows)continue;
if((layer[key]||"")!==target)continue;
seen[key]=true;
if(next)layer[key]=next;
else delete layer[key];
filled+=1;
if(filled>=FLOOD_LIMIT){capped=true;break;}
stack.push([cur[0]+1,cur[1]],[cur[0]-1,cur[1]],[cur[0],cur[1]+1],[cur[0],cur[1]-1]);
}
return {filled:filled,capped:capped};
}

function variationGroup(assets,asset){
if(!asset)return [];
const name=String(asset.name||"");
const match=name.match(/^(.*?)[\s_-]*\d+$/);
if(!match)return [asset];
const prefix=match[1].toLowerCase();
const group=(assets||[]).filter(function(item){
if(item.category!==asset.category)return false;
return String(item.name||"").toLowerCase().replace(/[\s_-]*\d+$/,"")===prefix;
});
return group.length?group:[asset];
}

function normalize(raw){
const map=raw&&typeof raw==="object"?raw:{};
const out=blank(map.name,Number(map.width)||1600,Number(map.height)||1200);
out.id=typeof map.id==="string"?map.id:"";
out.name=typeof map.name==="string"&&map.name.trim()?map.name.trim().slice(0,48):"Untitled map";
out.version=VERSION;
out.type="carts";
out.width=clamp(Number(map.width)||1600,320,8000);
out.height=clamp(Number(map.height)||1200,320,8000);
out.roadWidth=clamp(Number(map.roadWidth)||64,8,256);
out.grid.size=clamp(Number(map.grid&&map.grid.size)||32,8,256);
out.grid.visible=!(map.grid&&map.grid.visible===false);
out.grid.snap=!(map.grid&&map.grid.snap===false);
out.updated=Number(map.updated)||Date.now();
out.skeleton.paths=Array.isArray(map.skeleton&&map.skeleton.paths)?map.skeleton.paths.map(cleanPath).filter(Boolean):[];
out.skeleton.intersections=Array.isArray(map.skeleton&&map.skeleton.intersections)?map.skeleton.intersections.map(cleanIntersection).filter(Boolean):[];
out.skeleton.spawns=Array.isArray(map.skeleton&&map.skeleton.spawns)?map.skeleton.spawns.map(cleanSpawn).filter(Boolean):[];
out.skeleton.destinations=Array.isArray(map.skeleton&&map.skeleton.destinations)?map.skeleton.destinations.map(cleanDestination).filter(Boolean):[];
TILE_LAYERS.forEach(function(name){
const src=map.layers&&map.layers[name];
out.layers[name]={};
if(!src||typeof src!=="object")return;
Object.keys(src).forEach(function(key){
if(!/^-?\d+,-?\d+$/.test(key))return;
const value=src[key];
if(typeof value==="string"&&value)out.layers[name][key]=value.slice(0,240);
});
});
out.objects=Array.isArray(map.objects)?map.objects.map(cleanObject).filter(Boolean):[];
if(map.layerState){
Object.keys(out.layerState).forEach(function(name){
const src=map.layerState[name];
if(!src)return;
out.layerState[name].visible=src.visible!==false;
out.layerState[name].locked=!!src.locked;
});
}
return out;
}

function clamp(n,min,max){
if(!Number.isFinite(n))return min;
return Math.max(min,Math.min(max,n));
}

function cleanPoint(p){
if(!p||!Number.isFinite(Number(p.x))||!Number.isFinite(Number(p.y)))return null;
return {x:Number(p.x),y:Number(p.y)};
}

function cleanEnd(end){
if(!end||typeof end.kind!=="string")return {kind:"open",id:""};
const kind=end.kind;
if(["open","spawn","destination","intersection","path"].indexOf(kind)===-1)return {kind:"open",id:""};
return {kind:kind,id:typeof end.id==="string"?end.id.slice(0,32):""};
}

function cleanPath(path){
if(!path||typeof path.id!=="string")return null;
const points=(path.points||[]).map(cleanPoint).filter(Boolean);
return {
id:path.id.slice(0,32),
width:clamp(Number(path.width)||64,8,256),
branchId:typeof path.branchId==="string"?path.branchId.slice(0,32):"",
points:points,
from:cleanEnd(path.from),
to:cleanEnd(path.to)
};
}

function cleanIntersection(inter){
if(!inter||typeof inter.id!=="string")return null;
return {
id:inter.id.slice(0,32),
x:Number(inter.x)||0,
y:Number(inter.y)||0,
defaultDirection:typeof inter.defaultDirection==="string"?inter.defaultDirection.slice(0,32):""
};
}

function cleanSpawn(spawn){
if(!spawn||typeof spawn.id!=="string")return null;
return {
id:spawn.id.slice(0,32),
x:Number(spawn.x)||0,
y:Number(spawn.y)||0,
pathId:typeof spawn.pathId==="string"?spawn.pathId.slice(0,32):"",
enabled:spawn.enabled!==false
};
}

function cleanDestination(dest){
if(!dest||typeof dest.id!=="string")return null;
return {
id:dest.id.slice(0,32),
x:Number(dest.x)||0,
y:Number(dest.y)||0,
pathId:typeof dest.pathId==="string"?dest.pathId.slice(0,32):"",
accepts:typeof dest.accepts==="string"?dest.accepts.slice(0,16):"",
label:typeof dest.label==="string"?dest.label.slice(0,16):""
};
}

function cleanObject(obj){
if(!obj||typeof obj.id!=="string"||typeof obj.asset!=="string")return null;
return {
id:obj.id.slice(0,32),
asset:obj.asset.slice(0,240),
x:Number(obj.x)||0,
y:Number(obj.y)||0,
rotation:Number(obj.rotation)||0,
scale:clamp(Number(obj.scale)||1,0.1,8),
w:clamp(Number(obj.w)||64,8,512),
h:clamp(Number(obj.h)||64,8,512)
};
}

function syncLinkedPoint(map,kind,id){
const obj=kind==="spawn"?byId(map.skeleton.spawns,id)
:kind==="destination"?byId(map.skeleton.destinations,id)
:kind==="intersection"?byId(map.skeleton.intersections,id)
:null;
if(!obj)return;
(map.skeleton.paths||[]).forEach(function(path){
if(endMatch(path.from,kind,id)&&path.points.length)path.points[0]={x:obj.x,y:obj.y};
if(endMatch(path.to,kind,id)&&path.points.length)path.points[path.points.length-1]={x:obj.x,y:obj.y};
});
}

function linkPath(map,path,endName,target){
path[endName]=target?{kind:target.kind,id:target.id}:{kind:"open",id:""};
if(!target)return;
if(target.kind==="spawn"){
const spawn=byId(map.skeleton.spawns,target.id);
if(spawn)spawn.pathId=path.id;
}
if(target.kind==="destination"){
const dest=byId(map.skeleton.destinations,target.id);
if(dest)dest.pathId=path.id;
}
if(target.kind==="intersection"&&endName==="from"){
const dest=path.to&&path.to.kind==="destination"?byId(map.skeleton.destinations,path.to.id):null;
if(!path.branchId)path.branchId=dest&&(dest.accepts||dest.label)?(dest.accepts||dest.label):path.id;
}
syncLinkedPoint(map,target.kind,target.id);
}

function validate(map){
const items=[];
const seen={};
function claim(id,label){
if(!id){items.push({ok:false,message:label+" is missing an id"});return;}
if(seen[id])items.push({ok:false,message:"Duplicate id "+id});
seen[id]=true;
}
const paths=map.skeleton.paths||[];
const spawns=map.skeleton.spawns||[];
const dests=map.skeleton.destinations||[];
const inters=map.skeleton.intersections||[];
paths.forEach(function(path){claim(path.id,"Path");});
spawns.forEach(function(spawn){claim(spawn.id,"Spawn");});
dests.forEach(function(dest){claim(dest.id,"Destination");});
inters.forEach(function(inter){claim(inter.id,"Intersection");});
(map.objects||[]).forEach(function(obj){claim(obj.id,"Object");});

const enabled=spawns.filter(function(spawn){return spawn.enabled!==false;});
if(!enabled.length)items.push({ok:false,message:"Add at least one spawn"});
else items.push({ok:true,message:"Spawn present"});
if(!dests.length)items.push({ok:false,message:"Add at least one destination"});

enabled.forEach(function(spawn){
const linked=pathTouching(map,"spawn",spawn.id);
if(linked.length)items.push({ok:true,message:"Spawn "+spawn.id+" connected"});
else items.push({ok:false,message:"Spawn "+spawn.id+" is not connected to a path"});
});
dests.forEach(function(dest){
const linked=pathTouching(map,"destination",dest.id);
if(linked.length)items.push({ok:true,message:"Destination "+(dest.label||dest.id)+" connected"});
else items.push({ok:false,message:"Destination "+(dest.label||dest.id)+" has no path"});
if(!dest.accepts)items.push({ok:false,message:"Destination "+(dest.label||dest.id)+" needs a cart type"});
});
paths.forEach(function(path){
if(!path.points||path.points.length<2)items.push({ok:false,message:"Path "+path.id+" needs at least two points"});
if(!path.from||path.from.kind==="open"||!path.to||path.to.kind==="open"){
items.push({ok:false,message:"Path "+path.id+" has an open endpoint"});
}
});

const graph=compile(map);
graph.intersections.forEach(function(inter){
if(!inter.incoming.length)items.push({ok:false,message:"Intersection "+inter.id+" has no incoming path"});
else items.push({ok:true,message:"Intersection "+inter.id+" has an incoming path"});
if(!inter.outgoing.length)items.push({ok:false,message:"Intersection "+inter.id+" has an unconnected branch"});
else items.push({ok:true,message:"Intersection "+inter.id+" has "+inter.outgoing.length+" branch"+(inter.outgoing.length===1?"":"es")});
const branchIds={};
inter.outgoing.forEach(function(branch){
if(!byId(paths,branch.pathId))items.push({ok:false,message:"Intersection "+inter.id+" has an unconnected branch"});
if(branchIds[branch.id])items.push({ok:false,message:"Intersection "+inter.id+" reuses branch "+branch.id});
branchIds[branch.id]=true;
});
});

const reached={};
const visited={};
const queue=[];
enabled.forEach(function(spawn){
pathTouching(map,"spawn",spawn.id).forEach(function(path){
queue.push({pathId:path.id,kind:"spawn",id:spawn.id});
});
});
let guard=0;
while(queue.length&&guard<500){
guard+=1;
const job=queue.shift();
const mark=job.pathId+"|"+job.kind+"|"+job.id;
if(visited[mark])continue;
visited[mark]=true;
const walked=legAlong(map,job.pathId,job.kind,job.id);
walked.pathIds.forEach(function(id){visited[id]=true;});
if(walked.end.kind==="destination")reached[walked.end.id]=true;
if(walked.end.kind==="intersection"){
const inter=graph.intersections.filter(function(item){return item.id===walked.end.id;})[0];
if(inter){
inter.outgoing.forEach(function(branch){
queue.push({pathId:branch.pathId,kind:"intersection",id:inter.id});
});
}
}
if(walked.end.kind==="path")queue.push({pathId:walked.end.id,kind:"path",id:job.pathId});
}
dests.forEach(function(dest){
if(!reached[dest.id])items.push({ok:false,message:"Destination "+(dest.label||dest.id)+" is unreachable"});
});
paths.forEach(function(path){
if(!visited[path.id])items.push({ok:false,message:"Path "+path.id+" is disconnected"});
});
return {ok:items.every(function(item){return item.ok;}),items:items};
}

function nearestLink(map,x,y,reach){
let best=null;
let bestDist=reach;
let bestRank=9;
function consider(kind,id,px,py,end){
const dist=Math.hypot(px-x,py-y);
const rank=kind==="path"?2:1;
if(dist>reach)return;
if(!best||dist<bestDist-0.01||(dist<=bestDist+0.01&&rank<bestRank)){
bestDist=dist;
bestRank=rank;
best={kind:kind,id:id,end:end||"",x:px,y:py};
}
}
(map.skeleton.spawns||[]).forEach(function(spawn){consider("spawn",spawn.id,spawn.x,spawn.y);});
(map.skeleton.destinations||[]).forEach(function(dest){consider("destination",dest.id,dest.x,dest.y);});
(map.skeleton.intersections||[]).forEach(function(inter){consider("intersection",inter.id,inter.x,inter.y);});
(map.skeleton.paths||[]).forEach(function(path){
if(!path.points||path.points.length<2)return;
const a=path.points[0];
const b=path.points[path.points.length-1];
consider("path",path.id,a.x,a.y,"from");
consider("path",path.id,b.x,b.y,"to");
});
return best;
}

return {
VERSION:VERSION,
TILE_LAYERS:TILE_LAYERS,
FLOOD_LIMIT:FLOOD_LIMIT,
clone:clone,
blank:blank,
builtin:builtin,
normalize:normalize,
newId:newId,
byId:byId,
compile:compile,
initialChoices:initialChoices,
legacyView:legacyView,
legAlong:legAlong,
pathTouching:pathTouching,
snapPoint:snapPoint,
cellOf:cellOf,
inMapCell:inMapCell,
rectCells:rectCells,
brushCells:brushCells,
paintCells:paintCells,
flood:flood,
variationGroup:variationGroup,
syncLinkedPoint:syncLinkedPoint,
linkPath:linkPath,
validate:validate,
nearestLink:nearestLink,
samePoint:samePoint
};
});
