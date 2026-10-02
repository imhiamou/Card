/*
 * Carts map editor.
 * Skeleton tools edit the route graph. Decoration tools edit tiles and objects.
 * Those two sets of data are saved together and are not allowed to rewrite each other.
 */
(function(){
const CM=window.CartsMap;
if(!CM)return;

const STORAGE_KEY="carts.maps.v1";
const SKELETON_TOOLS=["select","path","spawn","destination","intersection","connect","split","delete"];
const DECOR_TOOLS=["select","pencil","rect","bucket","eraser","eyedropper","place","area","pan"];

let screen=null;
let canvas=null;
let ctx=null;
let map=null;
let mode="skeleton";
let tool="select";
let assets=[];
let extraAssets=[];
let assetQuery="";
let assetCategory="all";
let selectedAsset=null;
let brush=1;
let randomOn=false;
let selection=[];
let undoStack=[];
let redoStack=[];
let gesture=false;
let draft=null;
let connectFirst=null;
let area=null;
let clipboard=null;
let pasteArmed=false;
let camera={cx:360,cy:320,zoom:1};
let active=false;
let space=false;
let drag=null;
let statusText="";
let validation=null;
let images={};
let dirty=true;

function readStore(){
try{
const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}");
return parsed.maps&&typeof parsed.maps==="object"?parsed.maps:{};
}catch(err){return {};}
}
function writeStore(maps){
localStorage.setItem(STORAGE_KEY,JSON.stringify({maps:maps}));
}

function el(html){
const wrap=document.createElement("div");
wrap.innerHTML=html.trim();
return wrap.firstChild;
}

function mount(){
screen=document.getElementById("cartsEditorScreen");
if(!screen){
screen=document.createElement("div");
screen.id="cartsEditorScreen";
screen.className="hidden";
document.body.appendChild(screen);
}
screen.innerHTML=[
'<div class="ceTop" id="ceTop"></div>',
'<div class="ceBanner skeleton" id="ceBanner">Skeleton mode. Decorations are locked. Build the routes first.</div>',
'<div class="ceBody">',
'<aside class="ceLeft" id="ceLeft"></aside>',
'<div class="ceCanvasWrap"><canvas id="cartsEditorCanvas"></canvas><div class="ceStatus" id="ceStatus"></div></div>',
'<aside class="ceRight" id="ceRight"></aside>',
'</div>',
'<div class="ceDialog hidden" id="ceDialog"></div>'
].join("");
canvas=document.getElementById("cartsEditorCanvas");
ctx=canvas.getContext("2d");
buildChrome();
canvas.addEventListener("pointerdown",onPointerDown);
canvas.addEventListener("pointermove",onPointerMove);
canvas.addEventListener("pointerup",onPointerUp);
canvas.addEventListener("pointercancel",onPointerUp);
canvas.addEventListener("wheel",onWheel,{passive:false});
canvas.addEventListener("contextmenu",function(event){event.preventDefault();});
window.addEventListener("keydown",onKey);
window.addEventListener("keyup",function(event){if(event.code==="Space")space=false;});
window.addEventListener("resize",function(){if(active){fitCanvas();dirty=true;draw();}});
}

function button(label,attrs,fn){
const node=document.createElement("button");
node.type="button";
node.textContent=label;
if(attrs)Object.keys(attrs).forEach(function(key){node.setAttribute(key,attrs[key]);});
node.addEventListener("click",function(event){event.preventDefault();fn();});
return node;
}

function buildChrome(){
const top=document.getElementById("ceTop");
const specs=[
["New Map",newMap],["Save",saveMap],["Save As",saveAs],["Load",loadDialog],
["Rename",renameMap],["Delete Map",deleteMap],
null,
["Undo",undo],["Redo",redo],
null,
["Grid",toggleGrid],["Snap",toggleSnap],
["Zoom +",function(){zoomBy(1.2);}],["Zoom -",function(){zoomBy(1/1.2);}],["Fit Map",fitMap],
null,
["Validate",runValidate],["Test Map",testMap],["Lobby",close]
];
specs.forEach(function(spec){
if(!spec){const sep=document.createElement("span");sep.className="ceSep";top.appendChild(sep);return;}
const node=button(spec[0],null,spec[1]);
node.dataset.ce=spec[0];
top.appendChild(node);
});
const left=document.getElementById("ceLeft");
left.innerHTML='<h3>MODE</h3><div class="ceModes" id="ceModes"></div><h3>TOOLS</h3><div class="ceTools" id="ceTools"></div><div class="ceAssetBar" id="ceAssets"></div>';
const modes=document.getElementById("ceModes");
modes.appendChild(button("Skeleton","data-mode",function(){setMode("skeleton");}));
modes.firstChild.dataset.mode="skeleton";
const deco=button("Decoration",null,function(){setMode("decoration");});
deco.dataset.mode="decoration";
modes.appendChild(deco);
const tools=document.getElementById("ceTools");
[
["select","Select"],["path","Path"],["spawn","Spawn"],["destination","Destination"],
["intersection","Intersection"],["connect","Connect"],["split","Split"],["delete","Delete"],
["pencil","Pencil"],["rect","Rectangle"],["bucket","Bucket"],["eraser","Eraser"],
["eyedropper","Eyedropper"],["place","Place"],["area","Area"],["pan","Pan"]
].forEach(function(pair){
const node=button(pair[1],null,function(){setTool(pair[0]);});
node.dataset.tool=pair[0];
tools.appendChild(node);
});
renderSide();
}

function setMode(next){
mode=next;
if(mode==="skeleton"&&DECOR_TOOLS.indexOf(tool)!==-1&&tool!=="select"&&tool!=="pan")tool="select";
if(mode==="decoration"&&SKELETON_TOOLS.indexOf(tool)!==-1&&tool!=="select")tool="pencil";
draft=null;
connectFirst=null;
const banner=document.getElementById("ceBanner");
if(mode==="skeleton"){
banner.className="ceBanner skeleton";
banner.textContent="Skeleton mode. Painting is locked. Paths, spawns, intersections, and destinations define how carts move.";
}else{
banner.className="ceBanner decoration";
banner.textContent="Decoration mode. The skeleton is locked. Tiles and objects do not change cart routes.";
}
highlightTools();
renderSide();
dirty=true;draw();
}

function setTool(next){
if(mode==="skeleton"&&SKELETON_TOOLS.indexOf(next)===-1&&next!=="pan")return;
if(mode==="decoration"&&DECOR_TOOLS.indexOf(next)===-1)return;
tool=next;
if(tool!=="path")draft=null;
if(tool!=="connect")connectFirst=null;
highlightTools();
setStatus(toolLabel(next));
}

function toolLabel(name){
const labels={select:"Select and drag",path:"Click to add path points. Double-click or Enter to finish.",spawn:"Click to place a spawn",destination:"Click to place a destination",intersection:"Click to place an intersection, or click a path to split one in",connect:"Click two endpoints to join them",split:"Select a middle path point, then Split",delete:"Click an item to delete it",pencil:"Paint the active tile layer",rect:"Drag a rectangle to fill it",bucket:"Fill a connected tile area",eraser:"Erase tiles",eyedropper:"Pick a tile",place:"Click to place the selected asset as an object",area:"Drag an area to copy, paste, or erase",pan:"Drag to pan"};
return labels[name]||name;
}

function highlightTools(){
document.querySelectorAll("#ceTools button").forEach(function(node){
const name=node.dataset.tool;
const allowed=mode==="skeleton"?SKELETON_TOOLS.indexOf(name)!==-1||name==="pan":DECOR_TOOLS.indexOf(name)!==-1;
node.hidden=!allowed;
node.disabled=!allowed;
node.classList.toggle("active",name===tool);
});
document.querySelectorAll("#ceModes button").forEach(function(node){
node.classList.toggle("active",node.dataset.mode===mode);
});
}

function renderSide(){
const right=document.getElementById("ceRight");
if(!right||!map)return;
right.innerHTML="";
right.appendChild(el("<h3>MAP</h3>"));
right.appendChild(field("Name",input("text",map.name,function(value){mutate(function(){map.name=value.slice(0,48)||"Untitled map";});})));
right.appendChild(field("Width",input("number",map.width,function(value){mutate(function(){map.width=clamp(Number(value)||map.width,320,8000);});})));
right.appendChild(field("Height",input("number",map.height,function(value){mutate(function(){map.height=clamp(Number(value)||map.height,320,8000);});})));
right.appendChild(field("Road width",input("number",map.roadWidth,function(value){mutate(function(){map.roadWidth=clamp(Number(value)||64,8,256);});})));
right.appendChild(field("Grid size",input("number",map.grid.size,function(value){mutate(function(){map.grid.size=clamp(Number(value)||32,8,256);});})));
const apply=button("Apply road width to all paths",null,function(){
mutate(function(){map.skeleton.paths.forEach(function(path){path.width=map.roadWidth;});});
});
right.appendChild(apply);
right.appendChild(el("<h3>LAYERS</h3>"));
const layers=document.createElement("div");
layers.className="ceLayers";
["skeleton","ground","roads","buildings","decorations","objects"].forEach(function(name){
const row=document.createElement("div");
row.className="ceLayer";
const label=document.createElement("span");
label.textContent=name;
row.appendChild(label);
row.appendChild(button(map.layerState[name].visible?"Hide":"Show",null,function(){
map.layerState[name].visible=!map.layerState[name].visible;renderSide();dirty=true;draw();
}));
row.appendChild(button(map.layerState[name].locked?"Unlock":"Lock",null,function(){
map.layerState[name].locked=!map.layerState[name].locked;renderSide();
}));
if(name!=="skeleton"&&name!=="objects"){
label.style.cursor="pointer";
label.addEventListener("click",function(){if(mode!=="decoration")setMode("decoration");activeLayer=name;renderSide();});
if(activeLayer===name)label.style.fontWeight="bold";
}
layers.appendChild(row);
});
right.appendChild(layers);
right.appendChild(el("<h3>SELECTION</h3>"));
right.appendChild(selectionFields());
right.appendChild(el("<h3>VALIDATION</h3>"));
const list=document.createElement("ul");
list.className="ceChecks";
(validation&&validation.items||[{ok:true,message:"Not validated yet"}]).forEach(function(item){
const li=document.createElement("li");
li.className=item.ok?"good":"bad";
li.textContent=(item.ok?"✓ ":"✗ ")+item.message;
list.appendChild(li);
});
right.appendChild(list);
renderPalette();
}

let activeLayer="ground";

function field(labelText,control){
const wrap=document.createElement("label");
wrap.className="ceField";
wrap.appendChild(document.createTextNode(labelText));
wrap.appendChild(control);
return wrap;
}
function input(type,value,onChange){
const node=document.createElement("input");
node.type=type;
node.value=value;
node.addEventListener("change",function(){onChange(node.value);});
return node;
}
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}

function selectionFields(){
const wrap=document.createElement("div");
if(selection.length!==1){
wrap.appendChild(el("<p class='ceEmpty'>"+(selection.length?selection.length+" selected":"Nothing selected")+"</p>"));
wrap.appendChild(button("Duplicate",null,duplicateSelection));
wrap.appendChild(document.createTextNode(" "));
wrap.appendChild(button("Delete",null,deleteSelection));
return wrap;
}
const sel=selection[0];
if(sel.kind==="spawn"||sel.kind==="destination"||sel.kind==="intersection"){
const obj=objectOf(sel);
if(!obj)return wrap;
wrap.appendChild(field("Id",input("text",obj.id,function(value){mutate(function(){renameId(obj,value);});})));
wrap.appendChild(field("X",input("number",Math.round(obj.x),function(value){mutate(function(){obj.x=Number(value)||0;CM.syncLinkedPoint(map,sel.kind,obj.id);});})));
wrap.appendChild(field("Y",input("number",Math.round(obj.y),function(value){mutate(function(){obj.y=Number(value)||0;CM.syncLinkedPoint(map,sel.kind,obj.id);});})));
if(sel.kind==="spawn"){
wrap.appendChild(field("Enabled",input("text",obj.enabled?"yes":"no",function(value){mutate(function(){obj.enabled=value!=="no"&&value!=="false";});})));
}
if(sel.kind==="destination"){
wrap.appendChild(field("Label",input("text",obj.label,function(value){mutate(function(){obj.label=value.slice(0,16);syncBranchForDest(obj);});})));
wrap.appendChild(field("Accepts cart",input("text",obj.accepts,function(value){mutate(function(){obj.accepts=value.slice(0,16);syncBranchForDest(obj);});})));
}
if(sel.kind==="intersection"){
const graph=CM.compile(map).intersections.filter(function(item){return item.id===obj.id;})[0];
const options=(graph&&graph.outgoing||[]).map(function(branch){return branch.id;});
wrap.appendChild(field("Default branch",input("text",obj.defaultDirection||"",function(value){mutate(function(){obj.defaultDirection=value.slice(0,32);});})));
wrap.appendChild(el("<p class='ceEmpty'>Branches: "+(options.join(", ")||"none")+"</p>"));
}
}
if(sel.kind==="path"){
const path=CM.byId(map.skeleton.paths,sel.id);
if(!path)return wrap;
wrap.appendChild(field("Path",input("text",path.id,function(){})));
wrap.appendChild(field("Width",input("number",path.width,function(value){mutate(function(){path.width=clamp(Number(value)||64,8,256);});})));
wrap.appendChild(field("Branch id",input("text",path.branchId||"",function(value){mutate(function(){path.branchId=value.slice(0,32);});})));
}
if(sel.kind==="point"){
const path=CM.byId(map.skeleton.paths,sel.id);
const point=path&&path.points[sel.index];
if(!point)return wrap;
wrap.appendChild(field("Point X",input("number",Math.round(point.x),function(value){mutate(function(){movePoint(path,sel.index,Number(value)||0,point.y);});})));
wrap.appendChild(field("Point Y",input("number",Math.round(point.y),function(value){mutate(function(){movePoint(path,sel.index,point.x,Number(value)||0);});})));
if(sel.index>0&&sel.index<path.points.length-1)wrap.appendChild(button("Split here",null,function(){splitAt(path,sel.index);}));
}
if(sel.kind==="object"){
const obj=CM.byId(map.objects,sel.id);
if(!obj)return wrap;
wrap.appendChild(field("X",input("number",Math.round(obj.x),function(value){mutate(function(){obj.x=Number(value)||0;});})));
wrap.appendChild(field("Y",input("number",Math.round(obj.y),function(value){mutate(function(){obj.y=Number(value)||0;});})));
wrap.appendChild(field("Rotation",input("number",obj.rotation,function(value){mutate(function(){obj.rotation=Number(value)||0;});})));
wrap.appendChild(field("Scale",input("number",obj.scale,function(value){mutate(function(){obj.scale=clamp(Number(value)||1,0.1,8);});})));
wrap.appendChild(button("Rotate 15°",null,function(){mutate(function(){obj.rotation=(obj.rotation||0)+15;});}));
}
wrap.appendChild(document.createElement("div"));
wrap.appendChild(button("Duplicate",null,duplicateSelection));
wrap.appendChild(document.createTextNode(" "));
wrap.appendChild(button("Delete",null,deleteSelection));
return wrap;
}

function objectOf(sel){
if(sel.kind==="spawn")return CM.byId(map.skeleton.spawns,sel.id);
if(sel.kind==="destination")return CM.byId(map.skeleton.destinations,sel.id);
if(sel.kind==="intersection")return CM.byId(map.skeleton.intersections,sel.id);
return null;
}

function renameId(){}

function syncBranchForDest(dest){
map.skeleton.paths.forEach(function(path){
if(path.to&&path.to.kind==="destination"&&path.to.id===dest.id&&path.from&&path.from.kind==="intersection"){
path.branchId=dest.accepts||dest.label||path.id;
}
});
}

function renderPalette(){
const host=document.getElementById("ceAssets");
if(!host)return;
host.innerHTML="";
if(mode!=="decoration"){
host.appendChild(el("<p class='ceEmpty'>Switch to Decoration to paint tiles and place objects.</p>"));
return;
}
host.appendChild(el("<h3>ASSETS</h3>"));
const search=input("text",assetQuery,function(value){assetQuery=value;renderPalette();});
search.placeholder="Search assets";
host.appendChild(field("Search",search));
host.appendChild(field("Brush",selectBrush()));
const random=document.createElement("label");
random.className="ceField";
const box=document.createElement("input");
box.type="checkbox";
box.checked=randomOn;
box.addEventListener("change",function(){randomOn=box.checked;});
random.appendChild(box);
random.appendChild(document.createTextNode(" Random variation"));
host.appendChild(random);
const cats=document.createElement("div");
cats.className="ceCats";
const names=["all"].concat(categories());
names.forEach(function(name){
const node=button(name,null,function(){assetCategory=name;renderPalette();});
if(name===assetCategory)node.classList.add("active");
cats.appendChild(node);
});
host.appendChild(cats);
const grid=document.createElement("div");
grid.className="ceGrid";
filteredAssets().forEach(function(asset){
const node=document.createElement("button");
node.type="button";
node.title=asset.category+" / "+asset.name;
if(selectedAsset&&selectedAsset.src===asset.src)node.classList.add("active");
const img=document.createElement("img");
img.src=asset.src;
img.alt=asset.name;
node.appendChild(img);
node.addEventListener("click",function(){selectedAsset=asset;renderPalette();setStatus(asset.name);});
grid.appendChild(node);
});
host.appendChild(grid);
host.appendChild(el("<p class='ceEmpty'>Farm tiles are 128px. Set the grid to 128 to paint them full size.</p>"));
if(!filteredAssets().length){
host.appendChild(el("<p class='ceEmpty'>No images under assets/carts yet. Add category folders and reload.</p>"));
}
if(selectedAsset)host.appendChild(el("<p class='ceEmpty'>Selected: "+selectedAsset.name+"</p>"));
}

function selectBrush(){
const node=document.createElement("select");
[1,2,3,5,10].forEach(function(size){
const opt=document.createElement("option");
opt.value=String(size);
opt.textContent=size+"x"+size;
if(size===brush)opt.selected=true;
node.appendChild(opt);
});
node.addEventListener("change",function(){brush=Number(node.value)||1;});
return node;
}
function categories(){
const found={};
assets.forEach(function(asset){found[asset.category||"uncategorized"]=true;});
return Object.keys(found).sort();
}
function filteredAssets(){
return assets.filter(function(asset){
if(assetCategory!=="all"&&asset.category!==assetCategory)return false;
if(!assetQuery)return true;
const hay=(asset.name+" "+asset.category+" "+asset.src).toLowerCase();
return hay.indexOf(assetQuery.toLowerCase())!==-1;
});
}

function setStatus(text){
statusText=text;
const node=document.getElementById("ceStatus");
if(node)node.textContent=text;
}

function mutate(fn){
gestureEnd();
checkpoint();
fn();
map.updated=Date.now();
renderSide();
dirty=true;draw();
}

function checkpoint(){
undoStack.push(JSON.stringify(map));
if(undoStack.length>80)undoStack.shift();
redoStack=[];
}
function gestureStart(){
if(gesture)return;
checkpoint();
gesture=true;
}
function gestureEnd(){gesture=false;}

function undo(){
gestureEnd();
if(!undoStack.length)return;
redoStack.push(JSON.stringify(map));
map=JSON.parse(undoStack.pop());
draft=null;
selection=[];
renderSide();dirty=true;draw();
}
function redo(){
gestureEnd();
if(!redoStack.length)return;
undoStack.push(JSON.stringify(map));
map=JSON.parse(redoStack.pop());
draft=null;
selection=[];
renderSide();dirty=true;draw();
}

function worldFromEvent(event){
const rect=canvas.getBoundingClientRect();
const sx=event.clientX-rect.left;
const sy=event.clientY-rect.top;
return {
x:camera.cx+(sx-rect.width/2)/camera.zoom,
y:camera.cy+(sy-rect.height/2)/camera.zoom,
sx:sx,sy:sy
};
}
function cssSize(){
const rect=canvas.getBoundingClientRect();
return {w:rect.width,h:rect.height};
}

function fitCanvas(){
const rect=canvas.getBoundingClientRect();
if(rect.width<2||rect.height<2)return;
const dpr=Math.min(window.devicePixelRatio||1,2);
canvas.width=Math.max(1,Math.round(rect.width*dpr));
canvas.height=Math.max(1,Math.round(rect.height*dpr));
dirty=true;
}
function fitMap(){
const size=cssSize();
if(!map||size.w<2)return;
camera.zoom=Math.min(size.w/map.width,size.h/map.height)*0.92;
camera.cx=map.width/2;
camera.cy=map.height/2;
dirty=true;draw();
}
function zoomBy(factor){
camera.zoom=clamp(camera.zoom*factor,0.15,8);
dirty=true;draw();
}
function toggleGrid(){map.grid.visible=!map.grid.visible;setStatus(map.grid.visible?"Grid on":"Grid off");dirty=true;draw();}
function toggleSnap(){map.grid.snap=!map.grid.snap;setStatus(map.grid.snap?"Snap on":"Snap off");}

function onWheel(event){
if(!active)return;
event.preventDefault();
const before=worldFromEvent(event);
const factor=event.deltaY<0?1.1:0.9;
camera.zoom=clamp(camera.zoom*factor,0.15,8);
const after=worldFromEvent(event);
camera.cx+=before.x-after.x;
camera.cy+=before.y-after.y;
dirty=true;draw();
}

function onKey(event){
if(!active)return;
if(event.code==="Space"){space=true;event.preventDefault();}
const typing=event.target&&(event.target.tagName==="INPUT"||event.target.tagName==="SELECT"||event.target.tagName==="TEXTAREA");
if(typing)return;
if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="z"){event.preventDefault();if(event.shiftKey)redo();else undo();return;}
if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="y"){event.preventDefault();redo();return;}
if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="d"){event.preventDefault();duplicateSelection();return;}
if(event.key==="Delete"||event.key==="Backspace"){event.preventDefault();deleteSelection();return;}
if(event.key==="Enter"&&draft){finishDraft(null);return;}
if(event.key==="Escape"){draft=null;connectFirst=null;pasteArmed=false;dirty=true;draw();}
if(event.key==="["||event.key==="]")rotateSelection(event.key==="]"?15:-15);
}

function onPointerDown(event){
if(!active)return;
try{canvas.setPointerCapture(event.pointerId);}catch(err){}
const world=worldFromEvent(event);
if(space||event.button===1||event.button===2||tool==="pan"){
drag={kind:"pan",x:world.sx,y:world.sy,cx:camera.cx,cy:camera.cy};
return;
}
if(mode==="skeleton")skeletonDown(event,world);
else decorDown(event,world);
}
function straighten(path){
function swap(){
const from=path.from;
path.from=path.to;
path.to=from;
path.points=path.points.slice().reverse();
}
if(path.to&&path.to.kind==="spawn"&&(!path.from||path.from.kind!=="spawn"))swap();
else if(path.from&&path.from.kind==="destination"&&path.to&&(path.to.kind==="intersection"||path.to.kind==="spawn"))swap();
if(path.from&&path.from.kind==="intersection"&&path.to&&path.to.kind==="destination"){
const dest=CM.byId(map.skeleton.destinations,path.to.id);
path.branchId=dest&&(dest.accepts||dest.label)?(dest.accepts||dest.label):path.id;
const inter=CM.byId(map.skeleton.intersections,path.from.id);
if(inter&&!inter.defaultDirection)inter.defaultDirection=path.branchId;
}
}

function onPointerMove(event){
if(!active)return;
const world=worldFromEvent(event);
if(!drag)return;
if(drag.kind==="pan"){
camera.cx=drag.cx-(world.sx-drag.x)/camera.zoom;
camera.cy=drag.cy-(world.sy-drag.y)/camera.zoom;
dirty=true;draw();
return;
}
if(drag.kind==="move"){
const snapped=CM.snapPoint(map,world.x,world.y);
const dx=snapped.x-drag.origin.x;
const dy=snapped.y-drag.origin.y;
drag.items.forEach(function(item){applyMove(item,dx,dy);});
dirty=true;draw();
return;
}
if(drag.kind==="rect"||drag.kind==="area"||drag.kind==="marquee"){
drag.current=world;
dirty=true;draw();
return;
}
if(drag.kind==="pencil")paintAt(world,drag.erase);
}
function onPointerUp(event){
if(!drag)return;
const world=worldFromEvent(event);
if(drag.kind==="rect")fillRect(drag.start,world,drag.erase);
if(drag.kind==="area")area={a:CM.cellOf(map,drag.start.x,drag.start.y),b:CM.cellOf(map,world.x,world.y)};
if(drag.kind==="marquee")selectMarquee(drag.start,world,event.shiftKey);
if(drag.kind==="pencil"||drag.kind==="move"){map.updated=Date.now();renderSide();}
drag=null;
gestureEnd();
dirty=true;draw();
}

function skeletonLocked(){return map.layerState.skeleton.locked;}
function layerLocked(name){return map.layerState[name]&&map.layerState[name].locked;}

function skeletonDown(event,world){
if(tool!=="select"&&tool!=="pan"&&skeletonLocked()){setStatus("Skeleton layer is locked");return;}
if(tool==="select")return selectDown(event,world,true);
if(tool==="path")return pathDown(event,world);
if(tool==="spawn")return placeNode("spawn",world);
if(tool==="destination")return placeNode("destination",world);
if(tool==="intersection")return placeIntersection(world);
if(tool==="connect")return connectDown(world);
if(tool==="split")return splitSelected();
if(tool==="delete")return deleteAt(world);
}

function decorDown(event,world){
if(pasteArmed&&clipboard&&tool!=="select"){pasteAt(world);return;}
if(tool==="select")return selectDown(event,world,false);
if(tool==="area"){gestureStart();drag={kind:"area",start:world,current:world};return;}
const layerName=activeLayer;
if(tool!=="place"&&tool!=="eyedropper"&&layerLocked(layerName)&&tool!=="select"){setStatus(layerName+" is locked");return;}
if(tool==="eyedropper")return pickTile(world);
if(tool==="bucket")return doFlood(world);
if(tool==="place")return placeObject(world);
if(tool==="pencil"||tool==="eraser"){
gestureStart();
drag={kind:"pencil",erase:tool==="eraser"};
paintAt(world,tool==="eraser");
return;
}
if(tool==="rect"){
gestureStart();
drag={kind:"rect",start:world,current:world,erase:false};
}
}

function placeNode(kind,world){
const point=CM.snapPoint(map,world.x,world.y);
mutate(function(){
if(kind==="spawn"){
const spawn={id:CM.newId(map,"s"),x:point.x,y:point.y,pathId:"",enabled:true};
map.skeleton.spawns.push(spawn);
selection=[{kind:"spawn",id:spawn.id}];
}else{
const dest={id:CM.newId(map,"d"),x:point.x,y:point.y,pathId:"",accepts:"",label:""};
map.skeleton.destinations.push(dest);
selection=[{kind:"destination",id:dest.id}];
}
});
}

function placeIntersection(world){
const hit=nearestSegment(world.x,world.y,18);
if(hit){insertIntersection(hit);return;}
const point=CM.snapPoint(map,world.x,world.y);
mutate(function(){
const inter={id:CM.newId(map,"i"),x:point.x,y:point.y,defaultDirection:""};
map.skeleton.intersections.push(inter);
selection=[{kind:"intersection",id:inter.id}];
});
}

function insertIntersection(hit){
mutate(function(){
const path=hit.path;
const point={x:hit.x,y:hit.y};
const inter={id:CM.newId(map,"i"),x:point.x,y:point.y,defaultDirection:""};
const after=[{x:point.x,y:point.y}].concat(path.points.slice(hit.index+1));
const before=path.points.slice(0,hit.index+1);
before.push({x:point.x,y:point.y});
const neu={
id:CM.newId(map,"p"),
width:path.width,
branchId:path.branchId||"",
points:after,
from:{kind:"intersection",id:inter.id},
to:path.to
};
path.points=before;
path.to={kind:"intersection",id:inter.id};
path.branchId="";
map.skeleton.paths.push(neu);
map.skeleton.intersections.push(inter);
if(neu.to&&neu.to.kind==="destination"){
const dest=CM.byId(map.skeleton.destinations,neu.to.id);
if(dest){dest.pathId=neu.id;neu.branchId=dest.accepts||dest.label||neu.id;}
}
inter.defaultDirection=neu.branchId||"";
selection=[{kind:"intersection",id:inter.id}];
});
}

function pathDown(event,world){
if(event.detail>=2&&draft){
if(draft.points.length>=2){
const last=draft.points[draft.points.length-1];
const prev=draft.points[draft.points.length-2];
if(Math.hypot(last.x-prev.x,last.y-prev.y)<4)draft.points.pop();
}
finishDraft(null);
return;
}
const link=CM.nearestLink(map,world.x,world.y,16);
let point=CM.snapPoint(map,world.x,world.y);
let attached=null;
if(link){point={x:link.x,y:link.y};attached=link;}
if(!draft){
const extend=selectedOpenEnd();
if(extend){
draft={extend:extend,points:[point],from:null};
return;
}
draft={points:[point],from:attached,extend:null};
dirty=true;draw();
return;
}
draft.points.push(point);
if(attached)finishDraft(attached);
else {dirty=true;draw();}
}

function selectedOpenEnd(){
if(selection.length!==1||selection[0].kind!=="point")return null;
const sel=selection[0];
const path=CM.byId(map.skeleton.paths,sel.id);
if(!path)return null;
if(sel.index===0&&path.from&&path.from.kind==="open")return {path:path,end:"from"};
if(sel.index===path.points.length-1&&path.to&&path.to.kind==="open")return {path:path,end:"to"};
return null;
}

function finishDraft(attach){
if(!draft)return;
const points=draft.points.map(function(p){return {x:p.x,y:p.y};});
if(draft.extend){
if(!points.length){draft=null;return;}
mutate(function(){
const path=draft.extend.path;
if(draft.extend.end==="to")path.points=path.points.concat(points);
else path.points=points.reverse().concat(path.points);
if(attach)CM.linkPath(map,path,draft.extend.end,asTarget(attach));
});
draft=null;
return;
}
if(points.length<2){draft=null;dirty=true;draw();return;}
mutate(function(){
const path={
id:CM.newId(map,"p"),
width:map.roadWidth||64,
branchId:"",
points:points,
from:{kind:"open",id:""},
to:{kind:"open",id:""}
};
map.skeleton.paths.push(path);
if(draft.from)CM.linkPath(map,path,"from",asTarget(draft.from));
if(attach)CM.linkPath(map,path,"to",asTarget(attach));
straighten(path);
selection=[{kind:"path",id:path.id}];
});
draft=null;
}

function asTarget(link){
if(!link)return null;
if(link.kind==="path")return {kind:"path",id:link.id};
return {kind:link.kind,id:link.id};
}

function connectDown(world){
const link=CM.nearestLink(map,world.x,world.y,18);
if(!link){setStatus("Click an endpoint, spawn, intersection, or destination");return;}
if(!connectFirst){connectFirst=link;setStatus("Now click the second endpoint");dirty=true;draw();return;}
const first=connectFirst;
connectFirst=null;
if(first.kind==="path"&&link.kind==="path"){
mutate(function(){
const path={
id:CM.newId(map,"p"),
width:map.roadWidth||64,
branchId:"",
points:[{x:first.x,y:first.y},{x:link.x,y:link.y}],
from:{kind:"path",id:first.id},
to:{kind:"path",id:link.id}
};
map.skeleton.paths.push(path);
const a=CM.byId(map.skeleton.paths,first.id);
const b=CM.byId(map.skeleton.paths,link.id);
if(a&&first.end)a[first.end]={kind:"path",id:path.id};
if(b&&link.end)b[link.end]={kind:"path",id:path.id};
});
return;
}
if(first.kind==="path"&&link.kind!=="path"){
mutate(function(){
const path=CM.byId(map.skeleton.paths,first.id);
if(!path||!first.end)return;
CM.linkPath(map,path,first.end,{kind:link.kind,id:link.id});
});
return;
}
if(link.kind==="path"&&first.kind!=="path"){
mutate(function(){
const path=CM.byId(map.skeleton.paths,link.id);
if(!path||!link.end)return;
CM.linkPath(map,path,link.end,{kind:first.kind,id:first.id});
});
return;
}
mutate(function(){
const path={
id:CM.newId(map,"p"),
width:map.roadWidth||64,
branchId:"",
points:[{x:first.x,y:first.y},{x:link.x,y:link.y}],
from:{kind:"open",id:""},
to:{kind:"open",id:""}
};
map.skeleton.paths.push(path);
CM.linkPath(map,path,"from",{kind:first.kind,id:first.id});
CM.linkPath(map,path,"to",{kind:link.kind,id:link.id});
straighten(path);
});
}

function selectDown(event,world,skeletonMode){
const hit=hitTest(world.x,world.y,skeletonMode);
if(!hit){
drag={kind:"marquee",start:world,current:world};
if(!event.shiftKey)selection=[];
dirty=true;draw();
return;
}
if(event.shiftKey){
const index=selection.findIndex(function(item){return item.kind===hit.kind&&item.id===hit.id&&item.index===hit.index;});
if(index>=0)selection.splice(index,1);
else selection.push(hit);
}else if(!selection.some(function(item){return item.kind===hit.kind&&item.id===hit.id&&item.index===hit.index;})){
selection=[hit];
}
gestureStart();
drag={
kind:"move",
origin:CM.snapPoint(map,world.x,world.y),
items:selection.map(capture)
};
renderSide();dirty=true;draw();
}

function capture(sel){
if(sel.kind==="point"){
const path=CM.byId(map.skeleton.paths,sel.id);
const point=path.points[sel.index];
return {kind:"point",id:sel.id,index:sel.index,x:point.x,y:point.y};
}
if(sel.kind==="object"){
const obj=CM.byId(map.objects,sel.id);
return {kind:"object",id:sel.id,x:obj.x,y:obj.y};
}
const obj=objectOf(sel);
return {kind:sel.kind,id:sel.id,x:obj.x,y:obj.y};
}
function applyMove(item,dx,dy){
if(item.kind==="point"){
const path=CM.byId(map.skeleton.paths,item.id);
if(!path)return;
movePoint(path,item.index,item.x+dx,item.y+dy);
return;
}
if(item.kind==="object"){
const obj=CM.byId(map.objects,item.id);
if(obj){obj.x=item.x+dx;obj.y=item.y+dy;}
return;
}
const obj=objectOf(item);
if(!obj)return;
obj.x=item.x+dx;
obj.y=item.y+dy;
CM.syncLinkedPoint(map,item.kind,item.id);
}
function movePoint(path,index,x,y){
path.points[index]={x:x,y:y};
const endName=index===0?"from":index===path.points.length-1?"to":"";
if(!endName)return;
const end=path[endName];
if(!end||end.kind==="open"||end.kind==="path")return;
const obj=end.kind==="spawn"?CM.byId(map.skeleton.spawns,end.id)
:end.kind==="destination"?CM.byId(map.skeleton.destinations,end.id)
:CM.byId(map.skeleton.intersections,end.id);
if(!obj)return;
obj.x=x;obj.y=y;
CM.syncLinkedPoint(map,end.kind,end.id);
}

function hitTest(x,y,skeletonMode){
const reach=12/camera.zoom;
if(skeletonMode&&map.layerState.skeleton.visible){
let best=null;
let bestDist=reach;
map.skeleton.paths.forEach(function(path){
path.points.forEach(function(point,index){
const dist=Math.hypot(point.x-x,point.y-y);
if(dist<=bestDist){bestDist=dist;best={kind:"point",id:path.id,index:index};}
});
});
if(best)return best;
const link=CM.nearestLink(map,x,y,18/Math.max(camera.zoom,0.4));
if(link&&link.kind!=="path")return {kind:link.kind,id:link.id};
const segment=nearestSegment(x,y,10/Math.max(camera.zoom,0.4));
if(segment)return {kind:"path",id:segment.path.id};
}
if(!skeletonMode&&map.layerState.objects.visible){
for(let i=map.objects.length-1;i>=0;i--){
const obj=map.objects[i];
if(Math.abs(obj.x-x)<=obj.w*obj.scale/2&&Math.abs(obj.y-y)<=obj.h*obj.scale/2)return {kind:"object",id:obj.id};
}
}
return null;
}

function nearestSegment(x,y,reach){
let best=null;
let bestDist=reach;
map.skeleton.paths.forEach(function(path){
for(let i=0;i<path.points.length-1;i++){
const a=path.points[i];
const b=path.points[i+1];
const proj=project(x,y,a,b);
if(proj.dist<bestDist){bestDist=proj.dist;best={path:path,index:i,x:proj.x,y:proj.y};}
}
});
return best;
}
function project(x,y,a,b){
const dx=b.x-a.x;
const dy=b.y-a.y;
const len=dx*dx+dy*dy||1;
let t=((x-a.x)*dx+(y-a.y)*dy)/len;
t=Math.max(0,Math.min(1,t));
const px=a.x+dx*t;
const py=a.y+dy*t;
return {x:px,y:py,dist:Math.hypot(px-x,py-y)};
}

function selectMarquee(a,b,shift){
const minX=Math.min(a.x,b.x);
const maxX=Math.max(a.x,b.x);
const minY=Math.min(a.y,b.y);
const maxY=Math.max(a.y,b.y);
const found=[];
if(mode==="skeleton"){
map.skeleton.spawns.forEach(function(spawn){if(inside(spawn,minX,maxX,minY,maxY))found.push({kind:"spawn",id:spawn.id});});
map.skeleton.destinations.forEach(function(dest){if(inside(dest,minX,maxX,minY,maxY))found.push({kind:"destination",id:dest.id});});
map.skeleton.intersections.forEach(function(inter){if(inside(inter,minX,maxX,minY,maxY))found.push({kind:"intersection",id:inter.id});});
}else{
map.objects.forEach(function(obj){if(inside(obj,minX,maxX,minY,maxY))found.push({kind:"object",id:obj.id});});
}
selection=shift?selection.concat(found):found;
renderSide();
}
function inside(obj,minX,maxX,minY,maxY){return obj.x>=minX&&obj.x<=maxX&&obj.y>=minY&&obj.y<=maxY;}

function deleteAt(world){
const hit=hitTest(world.x,world.y,true);
if(!hit)return;
selection=[hit];
deleteSelection();
}
function deleteSelection(){
if(!selection.length)return;
if(mode==="decoration"&&selection.some(function(sel){return sel.kind!=="object";})){
setStatus("Switch to Skeleton to delete routes");
return;
}
if(mode==="skeleton"&&selection.some(function(sel){return sel.kind==="object";})){
setStatus("Switch to Decoration to delete objects");
return;
}
mutate(function(){
selection.forEach(function(sel){
if(sel.kind==="point"){
const path=CM.byId(map.skeleton.paths,sel.id);
if(!path)return;
path.points.splice(sel.index,1);
if(sel.index===0)path.from={kind:"open",id:""};
if(path.points.length<2)removePath(path.id);
return;
}
if(sel.kind==="path")removePath(sel.id);
if(sel.kind==="spawn")removeNode("spawns","spawn",sel.id);
if(sel.kind==="destination")removeNode("destinations","destination",sel.id);
if(sel.kind==="intersection")removeNode("intersections","intersection",sel.id);
if(sel.kind==="object")map.objects=map.objects.filter(function(obj){return obj.id!==sel.id;});
});
selection=[];
});
}
function removePath(id){
map.skeleton.paths=map.skeleton.paths.filter(function(path){return path.id!==id;});
map.skeleton.paths.forEach(function(path){
if(path.from&&path.from.kind==="path"&&path.from.id===id)path.from={kind:"open",id:""};
if(path.to&&path.to.kind==="path"&&path.to.id===id)path.to={kind:"open",id:""};
});
map.skeleton.spawns.forEach(function(spawn){if(spawn.pathId===id)spawn.pathId="";});
map.skeleton.destinations.forEach(function(dest){if(dest.pathId===id)dest.pathId="";});
}
function removeNode(listName,kind,id){
map.skeleton[listName]=map.skeleton[listName].filter(function(item){return item.id!==id;});
map.skeleton.paths.forEach(function(path){
if(path.from&&path.from.kind===kind&&path.from.id===id)path.from={kind:"open",id:""};
if(path.to&&path.to.kind===kind&&path.to.id===id)path.to={kind:"open",id:""};
});
}

function splitSelected(){
const sel=selection.filter(function(item){return item.kind==="point";})[0];
if(!sel){setStatus("Select a middle path point first");return;}
const path=CM.byId(map.skeleton.paths,sel.id);
if(!path||sel.index<=0||sel.index>=path.points.length-1){setStatus("Choose a point between the ends");return;}
splitAt(path,sel.index);
}
function splitAt(path,index){
mutate(function(){
const neu={
id:CM.newId(map,"p"),
width:path.width,
branchId:"",
points:path.points.slice(index).map(function(p){return {x:p.x,y:p.y};}),
from:{kind:"path",id:path.id},
to:path.to
};
path.points=path.points.slice(0,index+1);
path.to={kind:"path",id:neu.id};
map.skeleton.paths.push(neu);
if(neu.to&&neu.to.kind==="destination"){
const dest=CM.byId(map.skeleton.destinations,neu.to.id);
if(dest)dest.pathId=neu.id;
}
selection=[{kind:"point",id:neu.id,index:0}];
});
}

function duplicateSelection(){
if(!selection.length)return;
mutate(function(){
const offset=map.grid.size||32;
const next=[];
selection.forEach(function(sel){
if(sel.kind==="object"){
const obj=CM.byId(map.objects,sel.id);
if(!obj)return;
const copy=CM.clone(obj);
copy.id=CM.newId(map,"o");
copy.x+=offset;copy.y+=offset;
map.objects.push(copy);
next.push({kind:"object",id:copy.id});
}
if(sel.kind==="spawn"||sel.kind==="destination"||sel.kind==="intersection"){
const obj=objectOf(sel);
if(!obj)return;
const copy=CM.clone(obj);
copy.id=CM.newId(map,sel.kind==="spawn"?"s":sel.kind==="destination"?"d":"i");
copy.x+=offset;copy.y+=offset;
if(copy.pathId)copy.pathId="";
const list=sel.kind==="spawn"?"spawns":sel.kind==="destination"?"destinations":"intersections";
map.skeleton[list].push(copy);
next.push({kind:sel.kind,id:copy.id});
}
});
if(next.length)selection=next;
});
}
function rotateSelection(delta){
const objects=selection.filter(function(sel){return sel.kind==="object";});
if(!objects.length)return;
mutate(function(){
objects.forEach(function(sel){
const obj=CM.byId(map.objects,sel.id);
if(obj)obj.rotation=(obj.rotation||0)+delta;
});
});
}

function assetSrc(){
if(!selectedAsset)return "";
if(!randomOn)return selectedAsset.src;
const group=CM.variationGroup(assets,selectedAsset);
const pick=group[Math.floor(Math.random()*group.length)];
return pick?pick.src:selectedAsset.src;
}
function paintAt(world,erase){
if(layerLocked(activeLayer))return;
const cell=CM.cellOf(map,world.x,world.y);
const cells=CM.brushCells(cell.c,cell.r,brush);
const src=erase?"":assetSrc();
if(!erase&&!src){setStatus("Select a tile first");return;}
CM.paintCells(map.layers[activeLayer],filterCells(cells),src);
dirty=true;draw();
}
function filterCells(cells){
const out={};
Object.keys(cells).forEach(function(key){
const parts=key.split(",");
if(CM.inMapCell(map,Number(parts[0]),Number(parts[1])))out[key]=true;
});
return out;
}
function fillRect(a,b,erase){
if(layerLocked(activeLayer))return;
const ca=CM.cellOf(map,a.x,a.y);
const cb=CM.cellOf(map,b.x,b.y);
const cells=filterCells(CM.rectCells(ca.c,ca.r,cb.c,cb.r));
const src=erase?"":assetSrc();
if(!erase&&!src){setStatus("Select a tile first");gestureEnd();return;}
Object.keys(cells).forEach(function(key){
const value=!erase&&randomOn?assetSrc():src;
if(value)map.layers[activeLayer][key]=value;
else delete map.layers[activeLayer][key];
});
map.updated=Date.now();
renderSide();
}
function doFlood(world){
if(layerLocked(activeLayer))return;
if(!selectedAsset){setStatus("Select a tile first");return;}
const cell=CM.cellOf(map,world.x,world.y);
mutate(function(){
const result=CM.flood(map,activeLayer,cell.c,cell.r,selectedAsset.src);
if(result.capped)setStatus("Fill stopped at "+CM.FLOOD_LIMIT+" tiles");
else setStatus("Filled "+result.filled+" tiles");
});
}
function pickTile(world){
const cell=CM.cellOf(map,world.x,world.y);
const src=map.layers[activeLayer][cell.c+","+cell.r]||"";
if(!src){setStatus("Empty cell");return;}
selectedAsset=assets.filter(function(asset){return asset.src===src;})[0]||{id:src,name:src,category:"picked",src:src};
if(assets.indexOf(selectedAsset)===-1&&selectedAsset.category==="picked")assets.push(selectedAsset);
setStatus("Picked "+selectedAsset.name);
renderPalette();
}
function placeObject(world){
if(!selectedAsset){setStatus("Select an asset first");return;}
if(layerLocked("objects")){setStatus("Objects layer is locked");return;}
const point=CM.snapPoint(map,world.x,world.y);
mutate(function(){
const obj={
id:CM.newId(map,"o"),
asset:selectedAsset.src,
x:point.x,y:point.y,
rotation:0,scale:1,
w:Math.max(map.grid.size,32),
h:Math.max(map.grid.size,32)
};
map.objects.push(obj);
selection=[{kind:"object",id:obj.id}];
});
}

function copyArea(){
if(!area){setStatus("Drag an area first");return;}
const c0=Math.min(area.a.c,area.b.c);
const c1=Math.max(area.a.c,area.b.c);
const r0=Math.min(area.a.r,area.b.r);
const r1=Math.max(area.a.r,area.b.r);
const layers={};
CM.TILE_LAYERS.forEach(function(name){
layers[name]={};
Object.keys(map.layers[name]).forEach(function(key){
const parts=key.split(",");
const c=Number(parts[0]);
const r=Number(parts[1]);
if(c>=c0&&c<=c1&&r>=r0&&r<=r1)layers[name][(c-c0)+","+(r-r0)]=map.layers[name][key];
});
});
const size=map.grid.size;
const objects=[];
map.objects.forEach(function(obj){
const cell=CM.cellOf(map,obj.x,obj.y);
if(cell.c>=c0&&cell.c<=c1&&cell.r>=r0&&cell.r<=r1){
const copy=CM.clone(obj);
copy.x-=c0*size;copy.y-=r0*size;
objects.push(copy);
}
});
clipboard={layers:layers,objects:objects};
pasteArmed=true;
setStatus("Copied. Click the map to paste.");
}
function pasteAt(world){
if(!clipboard)return;
const cell=CM.cellOf(map,world.x,world.y);
const size=map.grid.size;
mutate(function(){
CM.TILE_LAYERS.forEach(function(name){
if(layerLocked(name))return;
Object.keys(clipboard.layers[name]||{}).forEach(function(key){
const parts=key.split(",");
const c=cell.c+Number(parts[0]);
const r=cell.r+Number(parts[1]);
if(CM.inMapCell(map,c,r))map.layers[name][c+","+r]=clipboard.layers[name][key];
});
});
if(!layerLocked("objects")){
clipboard.objects.forEach(function(obj){
const copy=CM.clone(obj);
copy.id=CM.newId(map,"o");
copy.x+=cell.c*size;
copy.y+=cell.r*size;
map.objects.push(copy);
});
}
});
pasteArmed=false;
}
function eraseArea(){
if(!area)return;
const c0=Math.min(area.a.c,area.b.c);
const c1=Math.max(area.a.c,area.b.c);
const r0=Math.min(area.a.r,area.b.r);
const r1=Math.max(area.a.r,area.b.r);
if(layerLocked(activeLayer)){setStatus(activeLayer+" is locked");return;}
mutate(function(){
Object.keys(map.layers[activeLayer]).forEach(function(key){
const parts=key.split(",");
const c=Number(parts[0]);
const r=Number(parts[1]);
if(c>=c0&&c<=c1&&r>=r0&&r<=r1)delete map.layers[activeLayer][key];
});
});
}
function duplicateArea(){
copyArea();
if(!clipboard||!area)return;
const width=Math.abs(area.b.c-area.a.c)+1;
const origin={x:(Math.min(area.a.c,area.b.c)+width)*map.grid.size,y:Math.min(area.a.r,area.b.r)*map.grid.size};
pasteAt(origin);
}

function runValidate(){
validation=CM.validate(map);
renderSide();
setStatus(validation.ok?"Map is valid":"Map has validation errors");
return validation;
}
function testMap(){
const result=runValidate();
if(!result.ok){setStatus("Fix the skeleton before testing");return;}
const doc=CM.normalize(CM.clone(map));
hide();
if(window.Carts)window.Carts.playMap(doc);
}

function newMap(){
openDialog([
"<h3>New map</h3>",
"<label class='ceField'>Name<input id='ceNewName' value='New map'></label>",
"<label class='ceField'>Width<input id='ceNewW' type='number' value='1600'></label>",
"<label class='ceField'>Height<input id='ceNewH' type='number' value='1200'></label>",
"<div class='ceRow'><button type='button' id='ceNewOk'>Create</button><button type='button' id='ceNewCancel'>Cancel</button></div>"
].join(""),function(){
document.getElementById("ceNewCancel").onclick=closeDialog;
document.getElementById("ceNewOk").onclick=function(){
const name=document.getElementById("ceNewName").value;
const w=Number(document.getElementById("ceNewW").value);
const h=Number(document.getElementById("ceNewH").value);
loadDocument(CM.blank(name,w,h));
closeDialog();
};
});
}
function saveAs(){
openDialog([
"<h3>Save map</h3>",
"<label class='ceField'>Name<input id='ceSaveName' value='"+escapeAttr(map.name)+"'></label>",
"<div class='ceRow'><button type='button' id='ceSaveOk'>Save</button><button type='button' id='ceSaveCancel'>Cancel</button></div>"
].join(""),function(){
document.getElementById("ceSaveCancel").onclick=closeDialog;
document.getElementById("ceSaveOk").onclick=function(){
map.name=document.getElementById("ceSaveName").value.slice(0,48)||"Untitled map";
map.id=newMapId();
closeDialog();
persist(false);
};
});
}
function saveMap(){
if(!map.id||map.id==="builtin"){saveAs();return;}
persist(false);
}
function renameMap(){
openDialog([
"<h3>Rename map</h3>",
"<label class='ceField'>Name<input id='ceRename' value='"+escapeAttr(map.name)+"'></label>",
"<div class='ceRow'><button type='button' id='ceRenameOk'>Rename</button><button type='button' id='ceRenameCancel'>Cancel</button></div>"
].join(""),function(){
document.getElementById("ceRenameCancel").onclick=closeDialog;
document.getElementById("ceRenameOk").onclick=function(){
map.name=document.getElementById("ceRename").value.slice(0,48)||"Untitled map";
closeDialog();
if(map.id&&map.id!=="builtin")persist(false);
else renderSide();
};
});
}
function deleteMap(){
if(!map.id||map.id==="builtin"){setStatus("This map is not saved yet");return;}
openDialog("<h3>Delete this map?</h3><p>"+escapeHtml(map.name)+"</p><div class='ceRow'><button type='button' id='ceDelOk'>Delete</button><button type='button' id='ceDelCancel'>Cancel</button></div>",function(){
document.getElementById("ceDelCancel").onclick=closeDialog;
document.getElementById("ceDelOk").onclick=function(){
const id=map.id;
const maps=readStore();
delete maps[id];
writeStore(maps);
fetch("/api/carts-maps/"+encodeURIComponent(id),{method:"DELETE"}).catch(function(){});
closeDialog();
loadDocument(CM.clone(CM.builtin()));
setStatus("Map deleted");
};
});
}

function newMapId(){
const bytes=new Uint8Array(6);
crypto.getRandomValues(bytes);
return "c"+Array.from(bytes).map(function(b){return b.toString(16).padStart(2,"0");}).join("");
}
function escapeAttr(value){return String(value||"").replace(/"/g,"&quot;");}
function escapeHtml(value){return String(value||"").replace(/[&<>]/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[ch];});}

async function persist(){
map.updated=Date.now();
map.type="carts";
map.version=1;
const doc=CM.normalize(map);
map=doc;
const maps=readStore();
maps[doc.id]=doc;
writeStore(maps);
let where="this browser";
try{
const response=await fetch("/api/carts-maps",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({map:doc})
});
if(response.ok){
const body=await response.json();
if(body.map&&body.map.id)map.id=body.map.id;
where=body.persisted==="postgres"?"the database":"the server cache and this browser";
if(body.warning)where+=". "+body.warning;
}else where="this browser. The server did not store it.";
}catch(err){
where="this browser";
}
setStatus("Saved "+map.name+" in "+where);
renderSide();
}

async function loadDialog(){
const local=readStore();
let remote=[];
try{
const response=await fetch("/api/carts-maps");
if(response.ok){
const body=await response.json();
remote=body.maps||[];
}
}catch(err){remote=[];}
const merged={};
Object.keys(local).forEach(function(id){merged[id]={id:id,name:local[id].name,updated:local[id].updated||0,source:"browser"};});
remote.forEach(function(item){
const prev=merged[item.id];
if(!prev||(item.updated||0)>=prev.updated)merged[item.id]={id:item.id,name:item.name,updated:item.updated||0,source:"server"};
});
const ids=Object.keys(merged);
const buttons=ids.map(function(id){
return "<button type='button' data-id='"+id+"'>"+escapeHtml(merged[id].name)+" ("+merged[id].source+")</button>";
}).join("");
openDialog("<h3>Load map</h3><div class='ceMapList'>"+(buttons||"<p>No saved Carts maps.</p>")+"</div><div class='ceRow'><button type='button' id='ceLoadCancel'>Cancel</button></div>",function(){
const cancel=document.getElementById("ceLoadCancel");
if(cancel)cancel.onclick=closeDialog;
document.querySelectorAll(".ceMapList button").forEach(function(node){
node.onclick=function(){loadById(node.dataset.id,local);};
});
});
}
async function loadById(id,local){
let doc=local[id];
try{
const response=await fetch("/api/carts-maps/"+encodeURIComponent(id));
if(response.ok){
const body=await response.json();
if(body.map&&(!doc||(body.map.updated||0)>=(doc.updated||0)))doc=body.map;
}
}catch(err){}
if(!doc){setStatus("Map not found");return;}
loadDocument(doc);
closeDialog();
setStatus("Loaded "+map.name);
}

function loadDocument(doc){
map=CM.normalize(doc);
undoStack=[];
redoStack=[];
selection=[];
draft=null;
validation=null;
mode="skeleton";
tool="select";
active=true;
setMode("skeleton");
fitCanvas();
fitMap();
}

function openDialog(html,bind){
const dialog=document.getElementById("ceDialog");
dialog.innerHTML="<div class='cePanel'>"+html+"</div>";
dialog.classList.remove("hidden");
if(bind)bind();
}
function closeDialog(){
const dialog=document.getElementById("ceDialog");
if(dialog){dialog.classList.add("hidden");dialog.innerHTML="";}
}

function imageOf(src){
if(!src)return null;
if(!images[src]){
const img=new Image();
images[src]={img:img,ready:false};
img.onload=function(){images[src].ready=true;dirty=true;draw();};
img.src=src;
}
return images[src].ready?images[src].img:null;
}

function draw(){
if(!active||!ctx||!map)return;
const rect=canvas.getBoundingClientRect();
if(rect.width<2)return;
const dpr=canvas.width/rect.width||1;
ctx.setTransform(dpr,0,0,dpr,0,0);
ctx.clearRect(0,0,rect.width,rect.height);
ctx.fillStyle="#c5ced8";
ctx.fillRect(0,0,rect.width,rect.height);
ctx.save();
ctx.translate(rect.width/2,rect.height/2);
ctx.scale(camera.zoom,camera.zoom);
ctx.translate(-camera.cx,-camera.cy);
ctx.fillStyle="#f4f7fb";
ctx.fillRect(0,0,map.width,map.height);
ctx.strokeStyle="#111";
ctx.lineWidth=2/camera.zoom;
ctx.strokeRect(0,0,map.width,map.height);
drawTiles();
drawObjects();
if(map.layerState.skeleton.visible)drawSkeleton();
if(draft)drawDraft();
if(drag&&(drag.kind==="rect"||drag.kind==="area"||drag.kind==="marquee"))drawDrag();
ctx.restore();
dirty=false;
}
function visibleWorld(){
const rect=canvas.getBoundingClientRect();
const halfW=rect.width/2/camera.zoom;
const halfH=rect.height/2/camera.zoom;
return {x0:camera.cx-halfW,y0:camera.cy-halfH,x1:camera.cx+halfW,y1:camera.cy+halfH};
}
function drawTiles(){
const view=visibleWorld();
const size=map.grid.size||32;
CM.TILE_LAYERS.forEach(function(name){
if(!map.layerState[name].visible)return;
const layer=map.layers[name];
Object.keys(layer).forEach(function(key){
const parts=key.split(",");
const c=Number(parts[0]);
const r=Number(parts[1]);
const x=c*size;
const y=r*size;
if(x>view.x1||y>view.y1||x+size<view.x0||y+size<view.y0)return;
const img=imageOf(layer[key]);
if(img)ctx.drawImage(img,x,y,size,size);
else{ctx.fillStyle="#d5dbe3";ctx.fillRect(x,y,size,size);}
});
});
if(map.grid.visible){
ctx.strokeStyle="rgba(0,0,0,.18)";
ctx.lineWidth=1/camera.zoom;
const sizeStep=map.grid.size||32;
let step=sizeStep;
const span=(view.x1-view.x0)/step;
if(span>180)step*=Math.ceil(span/180);
const startC=Math.floor(view.x0/step)*step;
const startR=Math.floor(view.y0/step)*step;
ctx.beginPath();
for(let x=startC;x<=view.x1;x+=step){ctx.moveTo(x,view.y0);ctx.lineTo(x,view.y1);}
for(let y=startR;y<=view.y1;y+=step){ctx.moveTo(view.x0,y);ctx.lineTo(view.x1,y);}
ctx.stroke();
}
}
function drawObjects(){
if(!map.layerState.objects.visible)return;
map.objects.forEach(function(obj){
ctx.save();
ctx.translate(obj.x,obj.y);
ctx.rotate((obj.rotation||0)*Math.PI/180);
ctx.scale(obj.scale||1,obj.scale||1);
const img=imageOf(obj.asset);
if(img)ctx.drawImage(img,-obj.w/2,-obj.h/2,obj.w,obj.h);
else{ctx.strokeStyle="#333";ctx.strokeRect(-obj.w/2,-obj.h/2,obj.w,obj.h);}
ctx.restore();
const selected=selection.some(function(sel){return sel.kind==="object"&&sel.id===obj.id;});
if(selected){ctx.strokeStyle="#4f9cff";ctx.lineWidth=2/camera.zoom;ctx.strokeRect(obj.x-obj.w*obj.scale/2,obj.y-obj.h*obj.scale/2,obj.w*obj.scale,obj.h*obj.scale);}
});
}
function drawSkeleton(){
const graph=CM.compile(map);
map.skeleton.paths.forEach(function(path){
if(!path.points||path.points.length<2)return;
const hot=graph.intersections.some(function(inter){
return inter.outgoing.some(function(branch){return branch.pathId===path.id&&branch.id===inter.defaultDirection;});
});
ctx.beginPath();
ctx.moveTo(path.points[0].x,path.points[0].y);
path.points.forEach(function(point){ctx.lineTo(point.x,point.y);});
ctx.lineWidth=(path.width||map.roadWidth||64);
ctx.strokeStyle=mode==="decoration"?"rgba(20,20,20,.25)":"rgba(20,20,20,.45)";
ctx.lineCap="round";
ctx.lineJoin="round";
ctx.stroke();
ctx.lineWidth=mode==="decoration"?3/camera.zoom:5;
ctx.strokeStyle=hot?"#1565c0":"#111";
ctx.stroke();
path.points.forEach(function(point,index){
const selected=selection.some(function(sel){return sel.kind==="point"&&sel.id===path.id&&sel.index===index;});
ctx.beginPath();
ctx.arc(point.x,point.y,selected?7:4,0,Math.PI*2);
ctx.fillStyle=selected?"#f5c542":"#fff";
ctx.fill();
ctx.lineWidth=1.5;
ctx.strokeStyle="#111";
ctx.stroke();
});
});
map.skeleton.spawns.forEach(function(spawn){
ctx.beginPath();
ctx.arc(spawn.x,spawn.y,16,0,Math.PI*2);
ctx.fillStyle=spawn.enabled===false?"#999":"#2e7d32";
ctx.fill();
ctx.fillStyle="#fff";
ctx.font="bold 14px Arial";
ctx.textAlign="center";
ctx.textBaseline="middle";
ctx.fillText("S",spawn.x,spawn.y);
});
map.skeleton.destinations.forEach(function(dest){
ctx.fillStyle="#fff";
ctx.strokeStyle="#111";
ctx.lineWidth=3;
ctx.fillRect(dest.x-36,dest.y-28,72,56);
ctx.strokeRect(dest.x-36,dest.y-28,72,56);
ctx.fillStyle="#111";
ctx.font="bold 18px Arial";
ctx.textAlign="center";
ctx.textBaseline="middle";
ctx.fillText(dest.label||dest.accepts||dest.id,dest.x,dest.y);
});
map.skeleton.intersections.forEach(function(inter){
ctx.beginPath();
ctx.moveTo(inter.x,inter.y-16);
ctx.lineTo(inter.x+16,inter.y);
ctx.lineTo(inter.x,inter.y+16);
ctx.lineTo(inter.x-16,inter.y);
ctx.closePath();
ctx.fillStyle="#e53935";
ctx.fill();
ctx.strokeStyle="#7f1010";
ctx.stroke();
});
}
function drawDraft(){
const pts=draft.points||[];
if(!pts.length)return;
ctx.beginPath();
ctx.moveTo(pts[0].x,pts[0].y);
pts.forEach(function(point){ctx.lineTo(point.x,point.y);});
ctx.strokeStyle="#1565c0";
ctx.lineWidth=4;
ctx.setLineDash([8,6]);
ctx.stroke();
ctx.setLineDash([]);
}
function drawDrag(){
const a=drag.start;
const b=drag.current||drag.start;
ctx.strokeStyle="#1565c0";
ctx.lineWidth=2/camera.zoom;
ctx.strokeRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));
}

function loop(){
if(active&&dirty)draw();
requestAnimationFrame(loop);
}

async function loadAssets(){
let data=null;
try{
const response=await fetch("/api/carts-assets");
if(response.ok)data=await response.json();
}catch(err){data=null;}
if(!data||!Array.isArray(data.assets)){
try{
const response=await fetch("assets/carts/catalog.json");
if(response.ok)data=await response.json();
}catch(err){data=null;}
}
const found=(data&&data.assets)||[];
assets=extraAssets.concat(found);
renderPalette();
}

function open(){
if(!screen)mount();
active=true;
const lobby=document.getElementById("lobbyScreen");
const game=document.getElementById("cartsScreen");
if(lobby)lobby.classList.add("hidden");
if(game)game.classList.add("hidden");
screen.classList.remove("hidden");
if(!map)loadDocument(CM.clone(CM.builtin()));
else{fitCanvas();dirty=true;draw();highlightTools();}
loadAssets();
}
function reveal(){
if(!screen)mount();
active=true;
screen.classList.remove("hidden");
const game=document.getElementById("cartsScreen");
if(game)game.classList.add("hidden");
fitCanvas();dirty=true;draw();
}
function hide(){active=false;if(screen)screen.classList.add("hidden");}
function close(){
hide();
const lobby=document.getElementById("lobbyScreen");
if(lobby)lobby.classList.remove("hidden");
}

mount();
requestAnimationFrame(loop);
const areaRow=document.getElementById("ceLeft");
if(areaRow){
const extra=document.createElement("div");
extra.className="ceRow";
extra.appendChild(button("Copy area",null,copyArea));
extra.appendChild(button("Paste",null,function(){pasteArmed=true;setStatus("Click the map to paste");}));
extra.appendChild(button("Erase area",null,eraseArea));
extra.appendChild(button("Duplicate area",null,duplicateArea));
areaRow.appendChild(extra);
}

window.CartsEditor={
open:open,
reveal:reveal,
close:close,
isActive:function(){return active;},
getDocument:function(){return map?CM.clone(map):null;},
worldToClient:function(x,y){
const rect=canvas.getBoundingClientRect();
return {
x:rect.left+rect.width/2+(x-camera.cx)*camera.zoom,
y:rect.top+rect.height/2+(y-camera.cy)*camera.zoom
};
},
installAssets:function(list){
extraAssets=list||[];
assets=extraAssets.concat(assets.filter(function(asset){return extraAssets.indexOf(asset)===-1;}));
renderPalette();
},
validate:runValidate
};
})();
