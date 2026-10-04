/*
 * Carts map editor.
 * Skeleton tools edit the route graph. Paint and Objects edit how the map looks.
 * A path style and a destination building stay linked to those skeleton objects.
 */
(function(){
const CM=window.CartsMap;
if(!CM)return;

const STORAGE_KEY="carts.maps.v1";
const CARTS_API_BASE="https://cardb-2uys.onrender.com";
const SKELETON_TOOLS=["select","path","intersection","spawn","destination","connect","delete"];
const PAINT_TOOLS=["select","pencil","rect","bucket","eraser","eyedropper"];
const OBJECT_TOOLS=["select","place","rotate","scale","delete"];
const LAYER_LABELS={ground:"Ground",roads:"Road",skeleton:"Skeleton",buildings:"Buildings",decorations:"Decorations",objects:"Objects"};

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
let hover=null;
let hoverKey="";
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
function cartsApi(path){
return CARTS_API_BASE+path;
}
function cacheMap(doc){
const maps=readStore();
maps[doc.id]=doc;
writeStore(maps);
}
function uncacheMap(id){
const maps=readStore();
delete maps[id];
writeStore(maps);
}
async function serverError(response){
let message="The server returned "+response.status+".";
try{
const body=await response.json();
if(body&&body.error)message=String(body.error);
}catch(err){}
return message;
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
canvas.addEventListener("pointerleave",function(){hover=null;hoverKey="";dirty=true;});
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
[["Skeleton","skeleton"],["Paint","paint"],["Objects","objects"]].forEach(function(pair){
const node=button(pair[0],null,function(){setMode(pair[1]);});
node.dataset.mode=pair[1];
modes.appendChild(node);
});
const tools=document.getElementById("ceTools");
[
["select","Select"],["path","Path"],["intersection","Intersection"],["spawn","Spawn"],
["destination","Destination"],["connect","Connect"],["delete","Delete"],
["pencil","Pencil"],["rect","Rectangle"],["bucket","Fill"],["eraser","Eraser"],
["eyedropper","Eyedropper"],["place","Place"],["rotate","Rotate"],["scale","Scale"]
].forEach(function(pair){
const node=button(pair[1],null,function(){setTool(pair[0]);});
node.dataset.tool=pair[0];
tools.appendChild(node);
});
renderSide();
}

function toolsForMode(which){
if(which==="paint")return PAINT_TOOLS;
if(which==="objects")return OBJECT_TOOLS;
return SKELETON_TOOLS;
}

function setMode(next){
const prev=mode;
mode=next;
if(prev!==next&&next==="paint"&&tool==="select")tool="pencil";
if(toolsForMode(mode).indexOf(tool)===-1)tool=mode==="paint"?"pencil":"select";
draft=null;
connectFirst=null;
const banner=document.getElementById("ceBanner");
if(mode==="skeleton"){
banner.className="ceBanner skeleton";
banner.textContent="Skeleton mode. Build the routes first. Styles and buildings stay attached to them.";
}else if(mode==="paint"){
banner.className="ceBanner decoration";
banner.textContent="Paint mode. Fill the ground. Painting does not change cart routes.";
}else{
banner.className="ceBanner decoration";
banner.textContent="Objects mode. Place trees, props, and other decorations.";
}
highlightTools();
renderSide();
dirty=true;draw();
}

function setTool(next){
if(toolsForMode(mode).indexOf(next)===-1)return;
tool=next;
if(tool!=="path")draft=null;
if(tool!=="connect")connectFirst=null;
highlightTools();
setStatus(toolLabel(next));
}

function toolLabel(name){
const labels={select:"Select and drag",path:"Click to add path points. Double-click or Enter to finish.",spawn:"Click to place a spawn",destination:"Click to place a destination",intersection:"Click to place an intersection",connect:"Click two endpoints to join them",delete:"Click an item to delete it",pencil:"Paint the active tile layer",rect:"Drag a rectangle to fill it",bucket:"Fill a connected tile area",eraser:"Erase tiles",eyedropper:"Pick a tile",place:"Click to place the selected asset",rotate:"Click an object to rotate it",scale:"Click an object to scale it. Shift-click scales down."};
return labels[name]||name;
}

function highlightTools(){
document.querySelectorAll("#ceTools button").forEach(function(node){
const name=node.dataset.tool;
const allowed=toolsForMode(mode).indexOf(name)!==-1;
node.hidden=!allowed;
node.disabled=!allowed;
node.classList.toggle("active",name===tool);
});
document.querySelectorAll("#ceModes button").forEach(function(node){
node.classList.toggle("active",node.dataset.mode===mode);
});
const areaRow=document.querySelector(".ceLeft > .ceRow");
if(areaRow)areaRow.hidden=mode!=="paint";
}

function renderSide(){
const right=document.getElementById("ceRight");
if(!right||!map)return;
right.innerHTML="";
right.appendChild(el("<h3>MAP</h3>"));
right.appendChild(field("Name",input("text",map.name,function(value){mutate(function(){map.name=value.slice(0,48)||"Untitled map";});})));
right.appendChild(field("Road width",input("number",map.roadWidth,function(value){mutate(function(){map.roadWidth=clamp(Number(value)||64,8,256);});})));
const counts=CM.tileCounts(map);
right.appendChild(el("<h3>MAP GRID</h3>"));
right.appendChild(el("<p class='ceEmpty'>Each square is one tile. Width and height count tiles.</p>"));
right.appendChild(field("Tile size",input("number",counts.size,function(value){mutate(function(){CM.setCellSize(map,Number(value)||counts.size);});})));
right.appendChild(field("Width",input("number",counts.cols,function(value){mutate(function(){CM.setTileCounts(map,Number(value)||counts.cols,counts.rows);});})));
right.appendChild(field("Height",input("number",counts.rows,function(value){mutate(function(){CM.setTileCounts(map,counts.cols,Number(value)||counts.rows);});})));
const apply=button("Apply road width to all paths",null,function(){
mutate(function(){map.skeleton.paths.forEach(function(path){path.width=map.roadWidth;});});
});
right.appendChild(apply);
right.appendChild(el("<h3>SELECTION</h3>"));
right.appendChild(selectionFields());
right.appendChild(el("<h3>LAYERS</h3>"));
right.appendChild(el("<p class='ceEmpty'>Top is behind. Bottom is in front. A new map starts with none.</p>"));
right.appendChild(button("+ Add layer",null,addLayerDialog));
right.appendChild(renderLayers());
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

let activeLayer="";
let libraryContext="tile";
let roadChoice={pathId:"",src:"",id:"",name:""};

function renderLayers(){
const layers=document.createElement("div");
layers.className="ceLayers";
const records=map.layerRecords||[];
if(!records.length)layers.appendChild(el("<p class='ceEmpty'>No layers yet.</p>"));
records.forEach(function(record,index){
const row=document.createElement("div");
row.className="ceLayer"+(activeLayer===record.id?" active":"");
const eye=button(record.visible!==false?"On":"Off",null,function(){
mutate(function(){record.visible=record.visible===false;CM.syncLayerMirrors(map);});
});
eye.title=record.visible!==false?"Hide layer":"Show layer";
const lock=button(record.locked?"Lock":"Open",null,function(){
mutate(function(){record.locked=!record.locked;CM.syncLayerMirrors(map);});
});
lock.title=record.locked?"Unlock layer":"Lock layer";
const label=document.createElement("button");
label.type="button";
label.className="ceLayerName";
label.textContent=record.name;
label.title=record.kind==="object"?"Objects":record.kind==="route"?"Route":"Tiles";
label.addEventListener("click",function(){selectLayer(record);});
const up=button("↑",null,function(){moveLayer(index,-1);});
const down=button("↓",null,function(){moveLayer(index,1);});
up.title="Move up";
down.title="Move down";
up.disabled=index===0;
down.disabled=index===records.length-1;
row.appendChild(eye);
row.appendChild(lock);
row.appendChild(label);
row.appendChild(up);
row.appendChild(down);
if(activeLayer===record.id){
row.appendChild(button("Rename",null,function(){renameLayerDialog(record);}));
row.appendChild(button("Delete",null,function(){deleteLayer(record);}));
}
layers.appendChild(row);
});
return layers;
}

function selectLayer(record){
activeLayer=record.id;
if(record.kind==="object")setMode("objects");
else if(record.kind==="route")setMode("skeleton");
else setMode("paint");
renderSide();
}

function moveLayer(index,dir){
const records=map.layerRecords||[];
const next=index+dir;
if(index<0||next<0||next>=records.length)return;
mutate(function(){
const swap=records[index];
records[index]=records[next];
records[next]=swap;
CM.syncLayerMirrors(map);
});
}

function addLayerDialog(){
openDialog([
"<h3>Add layer</h3>",
"<label class='ceField'>Layer name<input id='ceLayerName' value='Layer'></label>",
"<label class='ceField'>Type<select id='ceLayerKind'><option value='tile'>Tiles</option><option value='object'>Objects</option><option value='route'>Route</option></select></label>",
"<div class='ceRow'><button type='button' id='ceLayerOk'>Add</button><button type='button' id='ceLayerCancel'>Cancel</button></div>"
].join(""),function(){
document.getElementById("ceLayerCancel").onclick=closeDialog;
document.getElementById("ceLayerOk").onclick=function(){
const name=document.getElementById("ceLayerName").value;
const kind=document.getElementById("ceLayerKind").value;
mutate(function(){
const record=CM.addLayer(map,name,kind);
activeLayer=record.id;
});
closeDialog();
if(kind==="object")setMode("objects");
else if(kind==="route")setMode("skeleton");
else setMode("paint");
};
});
}

function renameLayerDialog(record){
openDialog([
"<h3>Rename layer</h3>",
"<label class='ceField'>Layer name<input id='ceRenameLayer' value='"+escapeAttr(record.name)+"'></label>",
"<div class='ceRow'><button type='button' id='ceRenameLayerOk'>Rename</button><button type='button' id='ceRenameLayerCancel'>Cancel</button></div>"
].join(""),function(){
document.getElementById("ceRenameLayerCancel").onclick=closeDialog;
document.getElementById("ceRenameLayerOk").onclick=function(){
mutate(function(){
record.name=document.getElementById("ceRenameLayer").value.trim().slice(0,32)||record.name;
if(record.kind==="tile"&&/road|path/i.test(record.name))record.role="road";
else if(record.kind==="tile"&&/build/i.test(record.name))record.role="building";
});
closeDialog();
};
});
}

function deleteLayer(record){
openDialog("<h3>Delete "+escapeHtml(record.name)+"?</h3><p class='ceEmpty'>Tiles on this layer are removed. The route graph stays.</p><div class='ceRow'><button type='button' id='ceLayerDel'>Delete</button><button type='button' id='ceLayerDelCancel'>Cancel</button></div>",function(){
document.getElementById("ceLayerDelCancel").onclick=closeDialog;
document.getElementById("ceLayerDel").onclick=function(){
mutate(function(){
map.layerRecords=map.layerRecords.filter(function(item){return item.id!==record.id;});
if(map.layers)delete map.layers[record.id];
CM.syncLayerMirrors(map);
if(activeLayer===record.id){
const tile=(map.layerRecords||[]).filter(function(item){return item.kind==="tile";})[0];
activeLayer=tile?tile.id:"";
}
});
closeDialog();
};
});
}

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
const heading=sel.kind==="destination"?"DESTINATION "+(obj.label||obj.accepts||obj.id):sel.kind==="spawn"?"Spawn "+obj.id:"Intersection "+obj.id;
wrap.appendChild(el("<p class='ceEmpty'>"+heading+"</p>"));
wrap.appendChild(field("X",input("number",Math.round(obj.x),function(value){mutate(function(){obj.x=Number(value)||0;CM.syncLinkedPoint(map,sel.kind,obj.id);});})));
wrap.appendChild(field("Y",input("number",Math.round(obj.y),function(value){mutate(function(){obj.y=Number(value)||0;CM.syncLinkedPoint(map,sel.kind,obj.id);});})));
if(sel.kind==="spawn"){
wrap.appendChild(field("Enabled",input("text",obj.enabled?"yes":"no",function(value){mutate(function(){obj.enabled=value!=="no"&&value!=="false";});})));
wrap.appendChild(el("<p class='ceEmpty'>Visual</p>"));
wrap.appendChild(stylePicker("object",obj.visual&&obj.visual.src,function(asset){
if(objectRecord()&&objectRecord().locked){setStatus("Objects layer is locked");return;}
mutate(function(){obj.visual=visualFrom(asset,obj.visual);});
}));
if(obj.visual)wrap.appendChild(button("Remove visual",null,function(){mutate(function(){obj.visual=null;});}));
}
if(sel.kind==="destination"){
wrap.appendChild(el("<p class='ceEmpty'>Label: "+(obj.label||"")+"</p>"));
wrap.appendChild(el("<p class='ceEmpty'>Accepted cart</p>"));
wrap.appendChild(cartPicker(obj));
wrap.appendChild(el("<p class='ceEmpty'>Building</p>"));
wrap.appendChild(stylePicker("building",obj.visual&&obj.visual.src,function(asset){
const buildingRecord=(map.layerRecords||[]).filter(function(record){return record.role==="building"||record.id==="buildings";})[0];
if(buildingRecord&&buildingRecord.locked){setStatus("Buildings layer is locked");return;}
mutate(function(){obj.visual=visualFrom(asset,obj.visual);});
}));
if(obj.visual){
wrap.appendChild(button("Remove building",null,function(){mutate(function(){obj.visual=null;});}));
wrap.appendChild(field("Offset X",input("number",obj.visual.offsetX||0,function(value){mutate(function(){obj.visual.offsetX=clamp(Number(value)||0,-2000,2000);});})));
wrap.appendChild(field("Offset Y",input("number",obj.visual.offsetY||0,function(value){mutate(function(){obj.visual.offsetY=clamp(Number(value)||0,-2000,2000);});})));
wrap.appendChild(field("Scale",input("number",obj.visual.scale||1,function(value){mutate(function(){obj.visual.scale=clamp(Number(value)||1,0.1,8);});})));
wrap.appendChild(field("Rotation",input("number",obj.visual.rotation||0,function(value){mutate(function(){obj.visual.rotation=clamp(Number(value)||0,-360,360);});})));
}
}
if(sel.kind==="intersection"){
const graph=CM.compile(map).intersections.filter(function(item){return item.id===obj.id;})[0];
const options=graph&&graph.outgoing||[];
wrap.appendChild(el("<p class='ceEmpty'>Direction</p>"));
const dirs=document.createElement("div");
dirs.className="ceRow";
[["up","↑"],["right","→"],["down","↓"],["left","←"]].forEach(function(pair){
const node=button(pair[1],null,function(){mutate(function(){CM.setIntersectionDirection(map,obj,pair[0]);});});
node.title=pair[0];
if((obj.direction||"up")===pair[0])node.classList.add("active");
dirs.appendChild(node);
});
wrap.appendChild(dirs);
wrap.appendChild(el("<p class='ceEmpty'>Connections: "+(options.map(branchLabel).join(", ")||"none")+"</p>"));
const aimed=options.filter(function(branch){return branch.compass===obj.direction;})[0];
wrap.appendChild(el("<p class='ceEmpty'>"+(aimed?"Sends carts "+obj.direction+" on "+aimed.id:"No path "+(obj.direction||"up")+" yet")+"</p>"));
}
}
if(sel.kind==="path"||sel.kind==="point")appendPathFields(wrap,sel);
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

function appendPathFields(wrap,sel){
const path=CM.byId(map.skeleton.paths,sel.id);
if(!path)return;
if(sel.kind==="point"){
const point=path.points[sel.index];
if(!point)return;
wrap.appendChild(field("Point X",input("number",Math.round(point.x),function(value){mutate(function(){movePoint(path,sel.index,Number(value)||0,point.y);});})));
wrap.appendChild(field("Point Y",input("number",Math.round(point.y),function(value){mutate(function(){movePoint(path,sel.index,point.x,Number(value)||0);});})));
if(sel.index>0&&sel.index<path.points.length-1)wrap.appendChild(button("Split here",null,function(){splitAt(path,sel.index);}));
}
wrap.appendChild(el("<p class='ceEmpty'>Path "+path.id+" · "+pathLength(path)+" px</p>"));
wrap.appendChild(el("<p class='ceEmpty'>"+endName(path.from)+" → "+endName(path.to)+"</p>"));
wrap.appendChild(field("Path width",input("number",path.width,function(value){mutate(function(){path.width=clamp(Number(value)||64,8,256);});})));
wrap.appendChild(el("<p class='ceEmpty'>Road style</p>"));
const picked=roadChoice.pathId===path.id?roadChoice:null;
wrap.appendChild(stylePicker("road",(picked&&picked.src)||(path.visualStyle&&path.visualStyle.src),function(asset){
roadChoice={pathId:path.id,src:CM.spriteRef(asset),id:asset.id||asset.src,name:asset.name||""};
renderSide();
setStatus("Chosen "+(asset.name||"tile")+". Click Apply.");
},function(asset){
const road=(map.layerRecords||[]).filter(function(record){return record.role==="road"||record.id==="roads";})[0];
if(road&&road.locked){setStatus("Road layer is locked");return;}
const src=CM.spriteRef(asset);
const assetId=asset.id||src;
mutate(function(){path.visualStyle={src:src,assetId:assetId};});
roadChoice={pathId:path.id,src:src,id:assetId,name:asset.name||""};
setStatus("Road style applied to "+path.id);
}));
wrap.appendChild(button("Apply",null,function(){
if(roadChoice.pathId!==path.id||!roadChoice.src){setStatus("Choose a road tile first");return;}
const road=(map.layerRecords||[]).filter(function(record){return record.role==="road"||record.id==="roads";})[0];
if(road&&road.locked){setStatus("Road layer is locked");return;}
const choice=roadChoice;
mutate(function(){path.visualStyle={src:choice.src,assetId:choice.id||choice.src};});
setStatus("Road style applied to "+path.id);
}));
if(path.visualStyle)wrap.appendChild(button("Remove style",null,function(){
const road=(map.layerRecords||[]).filter(function(record){return record.role==="road"||record.id==="roads";})[0];
if(road&&road.locked){setStatus("Road layer is locked");return;}
mutate(function(){path.visualStyle=null;});
}));
}

function pathLength(path){
let total=0;
for(let i=1;i<path.points.length;i++)total+=Math.hypot(path.points[i].x-path.points[i-1].x,path.points[i].y-path.points[i-1].y);
return Math.round(total);
}
function endName(end){
if(!end||!end.kind||end.kind==="open")return "open";
return end.kind+" "+end.id;
}
function branchLabel(branch){
const path=CM.byId(map.skeleton.paths,branch.pathId);
return compass(path)+" "+branch.id;
}
function compass(path){
if(!path||!path.points||path.points.length<2)return "Branch";
const a=path.points[0];
const b=path.points[1];
const dx=b.x-a.x;
const dy=b.y-a.y;
if(Math.abs(dx)>Math.abs(dy))return dx>=0?"East":"West";
return dy>=0?"South":"North";
}
function branchSelect(inter,options){
const node=document.createElement("select");
if(!options.length){
const empty=document.createElement("option");
empty.textContent="None yet";
node.appendChild(empty);
node.disabled=true;
return node;
}
options.forEach(function(branch){
const opt=document.createElement("option");
opt.value=branch.id;
opt.textContent=branchLabel(branch);
if(branch.id===inter.defaultDirection)opt.selected=true;
node.appendChild(opt);
});
node.addEventListener("change",function(){mutate(function(){inter.defaultDirection=node.value;});});
return node;
}
function copyStyle(style){
if(!style||!style.src)return null;
const out={src:style.src};
if(style.assetId)out.assetId=style.assetId;
return out;
}
function visualFrom(asset,previous){
return {
src:CM.spriteRef(asset),
assetId:asset&&asset.id||"",
offsetX:previous&&previous.offsetX||0,
offsetY:previous&&previous.offsetY||0,
scale:previous&&previous.scale||1,
rotation:previous&&previous.rotation||0
};
}
function assetRole(asset){
if(asset.role)return asset.role;
const cat=String(asset.category||"").toLowerCase();
const name=String(asset.name||"").toLowerCase();
if(cat.indexOf("building")>=0||cat.indexOf("village")>=0)return "building";
if(name.indexOf("path")===0||name.indexOf("road")>=0||cat.indexOf("path")>=0)return "road";
if(cat.indexOf("grass")>=0||name.indexOf("grass")>=0)return "tile";
if(cat.indexOf("tree")>=0||cat.indexOf("plant")>=0)return "nature";
if(cat.indexOf("character")>=0||cat.indexOf("animal")>=0)return "character";
return asset.kind==="object"?"decoration":"tile";
}
function stylePicker(context,current,onPick,onLibrary){
const wrap=document.createElement("div");
const match=assets.filter(function(asset){return (asset.ref||asset.src)===current||asset.src===current;})[0];
if(match)wrap.appendChild(thumb(match,48));
else if(current)wrap.appendChild(el("<p class='ceEmpty'>Using a saved image.</p>"));
const grid=document.createElement("div");
grid.className="cePick";
ranked(assets.filter(function(asset){return assetFits(asset,context);}),36).forEach(function(asset){
const node=document.createElement("button");
node.type="button";
node.title=asset.name;
if((asset.ref||asset.src)===current||asset.src===current)node.classList.add("active");
node.appendChild(thumb(asset,32));
node.addEventListener("click",function(){onPick(asset);});
grid.appendChild(node);
});
wrap.appendChild(grid);
wrap.appendChild(button("Choose",{"data-library":context},function(){openLibrary(context,onLibrary||onPick);}));
return wrap;
}
function cartFrame(cart){
const frame=document.createElement("div");
frame.className="ceCartFrame";
const img=document.createElement("img");
img.className="cePreview ceCartSpin";
img.alt=cart.name;
img.src=cart.image;
frame.appendChild(img);
function fit(){
img.style.transform="rotate(180deg) scale("+CM.cartVisualScale(cart.id)+")";
}
fit();
frame.fit=fit;
return frame;
}
function sizeSlider(label,value,onInput){
const wrap=document.createElement("label");
wrap.className="ceField";
const title=document.createElement("span");
title.textContent=label;
const row=document.createElement("span");
row.className="ceSizeRow";
const range=document.createElement("input");
range.type="range";
range.min=String(Math.round((CM.CART_SCALE_MIN||0.5)*100));
range.max=String(Math.round((CM.CART_SCALE_MAX||4)*100));
range.step="5";
range.value=String(Math.round(value*100));
const pct=document.createElement("span");
pct.className="ceSizePct";
pct.textContent=Math.round(value*100)+"%";
range.addEventListener("input",function(){
onInput(Number(range.value)/100);
pct.textContent=range.value+"%";
});
row.appendChild(range);
row.appendChild(pct);
wrap.appendChild(title);
wrap.appendChild(row);
return wrap;
}
function cartPicker(dest){
const wrap=document.createElement("div");
const current=CM.cartById(dest.acceptedCart);
wrap.appendChild(el("<p class='ceEmpty'>"+(current?current.name:"Select a cart")+"</p>"));
let frame=null;
if(current){
frame=cartFrame(current);
wrap.appendChild(frame);
wrap.appendChild(sizeSlider("Cart Size",CM.cartVisualScale(current.id),function(scale){
CM.setCartScale(current.id,scale);
if(frame&&frame.fit)frame.fit();
}));
if(CM.cartScaleIsCustom(current.id)){
wrap.appendChild(button("Use default size",null,function(){
CM.clearCartScale(current.id);
renderSide();
}));
}
}
wrap.appendChild(sizeSlider("Default cart size",CM.defaultCartScale(),function(scale){
CM.setDefaultCartScale(scale);
if(current&&!CM.cartScaleIsCustom(current.id)&&frame&&frame.fit)frame.fit();
}));
const grid=document.createElement("div");
grid.className="ceCarts";
CM.CARTS.forEach(function(cart){
const node=document.createElement("button");
node.type="button";
node.title=cart.name;
if(dest.acceptedCart===cart.id)node.classList.add("active");
const img=document.createElement("img");
img.src=cart.image;
img.alt=cart.name;
node.appendChild(img);
node.appendChild(document.createTextNode(cart.name));
node.addEventListener("click",function(){mutate(function(){dest.acceptedCart=cart.id;});});
grid.appendChild(node);
});
wrap.appendChild(grid);
wrap.appendChild(button("Choose",{"data-library":"cart"},function(){
openLibrary("cart",function(asset){
if(!asset.cartId){setStatus("That sprite is not a cart");return;}
mutate(function(){dest.acceptedCart=asset.cartId;});
});
}));
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
host.appendChild(el("<h3>ASSETS</h3>"));
if(selectedAsset){
host.appendChild(thumb(selectedAsset,48));
host.appendChild(el("<p class='ceEmpty'>"+selectedAsset.name+"</p>"));
}
const context=mode==="objects"?"object":mode==="paint"?"tile":"tile";
host.appendChild(button("Open library",null,function(){
openLibrary(context,function(asset){selectedAsset=asset;renderPalette();setStatus(asset.name);});
}));
const grid=document.createElement("div");
grid.className="ceGrid";
quickList(libraryAssets(context),96).forEach(function(asset){
const node=document.createElement("button");
node.type="button";
node.title=(asset.category||"")+" / "+asset.name;
if(selectedAsset&&CM.spriteRef(selectedAsset)===CM.spriteRef(asset))node.classList.add("active");
node.appendChild(thumb(asset,32));
node.addEventListener("click",function(){selectedAsset=asset;renderPalette();setStatus(asset.name);});
grid.appendChild(node);
});
host.appendChild(grid);
if(mode==="paint"){
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
host.appendChild(el("<p class='ceEmpty'>A tile fills one grid cell. Larger pieces belong on an Objects layer.</p>"));
}else if(mode==="skeleton"){
host.appendChild(el("<p class='ceEmpty'>Choose a road or building from the selection panel.</p>"));
}else host.appendChild(el("<p class='ceEmpty'>Place the selected piece. It keeps its own pixel size.</p>"));
}
function assetFits(asset,context){
const role=assetRole(asset);
if(asset.kind==="reference"||role==="reference")return false;
if(context==="road")return role==="road";
if(context==="building")return role==="building";
if(context==="object")return role==="building"||role==="nature"||role==="decoration"||role==="character"||asset.kind==="object";
if(context==="tile")return role==="tile"||role==="road"||role==="ground";
return true;
}
function ranked(list,limit){
return list.slice().sort(function(a,b){
const sheet=(a.sheet?1:0)-(b.sheet?1:0);
if(sheet)return sheet;
return String(a.name).localeCompare(String(b.name));
}).slice(0,limit);
}
function quickList(list,limit){
const groups={};
list.forEach(function(asset){
const key=asset.category||"Other";
if(!groups[key])groups[key]=[];
groups[key].push(asset);
});
const out=[];
Object.keys(groups).sort().forEach(function(key){
const items=groups[key].slice().sort(function(a,b){
const sheet=(a.sheet?1:0)-(b.sheet?1:0);
if(sheet)return sheet;
return String(a.name).localeCompare(String(b.name));
});
items.slice(0,8).forEach(function(asset){
if(out.length<limit)out.push(asset);
});
});
return out;
}
function libraryAssets(context){
return assets.filter(function(asset){
if(!assetFits(asset,context))return false;
if(librarySheet&&asset.sheet!==librarySheet)return false;
if(assetCategory!=="all"&&asset.category!==assetCategory)return false;
if(!assetQuery)return true;
const hay=(asset.name+" "+asset.category+" "+(asset.sheet||"")).toLowerCase();
return hay.indexOf(assetQuery.toLowerCase())!==-1;
});
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
let librarySheet="";
function categoriesFor(context){
const found={};
assets.forEach(function(asset){
if(!assetFits(asset,context))return;
if(librarySheet&&asset.sheet!==librarySheet)return;
found[asset.category||"Other"]=true;
});
return Object.keys(found).sort();
}
function thumb(asset,size){
const node=document.createElement("span");
node.className="ceThumb";
node.style.width=size+"px";
node.style.height=size+"px";
const part=CM.parseSprite(CM.spriteRef(asset));
if(!part.rect){
node.style.backgroundImage="url(\""+part.src+"\")";
node.style.backgroundSize="contain";
node.style.backgroundPosition="center";
return node;
}
const scale=size/Math.max(part.rect.w,part.rect.h);
node.style.backgroundImage="url(\""+part.src+"\")";
node.style.backgroundRepeat="no-repeat";
node.style.backgroundPosition=(-part.rect.x*scale)+"px "+(-part.rect.y*scale)+"px";
node.style.backgroundSize=((asset.sheetWidth||part.rect.w)*scale)+"px "+((asset.sheetHeight||part.rect.h)*scale)+"px";
return node;
}
const LIBRARY_FILTERS=[
{id:"all",label:"ALL"},
{id:"favorites",label:"FAVORITES"},
{id:"tiles",label:"TILES"},
{id:"roads",label:"ROADS"},
{id:"buildings",label:"BUILDINGS"},
{id:"nature",label:"NATURE"},
{id:"decorations",label:"DECORATIONS"},
{id:"objects",label:"OBJECTS"},
{id:"carts",label:"CARTS"}
];
function libraryFilterFor(context){
if(context==="road")return "roads";
if(context==="building")return "buildings";
if(context==="cart")return "carts";
if(context==="object")return "objects";
if(context==="tile")return "tiles";
return "all";
}
function libraryGroup(asset){
if(!asset)return "objects";
if(asset.role==="cart"||asset.kind==="cart")return "carts";
const role=assetRole(asset);
if(role==="road")return "roads";
if(role==="building")return "buildings";
if(role==="nature")return "nature";
if(role==="decoration")return "decorations";
if(role==="character"||asset.kind==="object")return "objects";
return "tiles";
}
function cartLibraryAssets(){
return CM.CARTS.map(function(cart){
return {
id:"carts-"+cart.id,
name:cart.name,
category:"Carts",
role:"cart",
kind:"cart",
src:cart.image,
ref:cart.image,
cartId:cart.id,
sound:cart.sound,
tags:["cart",cart.id,cart.name]
};
});
}
function masterLibrary(){
const list=cartLibraryAssets();
assets.forEach(function(asset){
if(asset.kind==="reference"||assetRole(asset)==="reference")return;
list.push(asset);
});
return list;
}
function assetHay(asset){
const tags=Array.isArray(asset.tags)?asset.tags.join(" "):"";
return [asset.name,asset.category,asset.id,asset.sheet,asset.role,asset.kind,asset.cartId,tags].join(" ").toLowerCase();
}
function libraryMatches(asset,filter,query){
if(filter==="favorites"){
if(!CM.isFavorite(asset.id))return false;
}else if(filter&&filter!=="all"&&libraryGroup(asset)!==filter)return false;
if(!query)return true;
return assetHay(asset).indexOf(query)!==-1;
}
function openLibrary(context,onPick){
openSpriteLibrary({context:context||"tile",initialFilter:libraryFilterFor(context),onPick:onPick});
}
function openSpriteLibrary(options){
const opts=options||{};
const onPick=opts.onPick||function(){};
libraryContext=opts.context||"tile";
let filter=opts.initialFilter||libraryFilterFor(libraryContext);
let query="";
let hoverAsset=null;
let list=[];
const root=document.createElement("div");
root.className="ceLibrary";
root.setAttribute("role","dialog");
const head=document.createElement("div");
head.className="ceLibHead";
const title=document.createElement("h3");
title.textContent="SPRITE LIBRARY";
head.appendChild(title);
head.appendChild(button("×",{"aria-label":"Close"},closeDialog));
root.appendChild(head);
const search=document.createElement("input");
search.type="search";
search.className="ceLibSearch";
search.placeholder="Search name, category, or tag";
search.addEventListener("input",function(){
query=search.value.trim().toLowerCase();
scroll.scrollTop=0;
refreshList();
});
search.addEventListener("keydown",function(event){
if(event.key==="Escape")closeDialog();
});
root.appendChild(search);
const filters=document.createElement("div");
filters.className="ceLibFilters";
LIBRARY_FILTERS.forEach(function(item){
const node=button(item.label,{"data-filter":item.id},function(){
filter=item.id;
scroll.scrollTop=0;
markFilters();
refreshList();
});
filters.appendChild(node);
});
root.appendChild(filters);
const main=document.createElement("div");
main.className="ceLibMain";
const scroll=document.createElement("div");
scroll.className="ceLibScroll ceLibGrid";
const canvas=document.createElement("div");
canvas.className="ceLibCanvas";
scroll.appendChild(canvas);
const preview=document.createElement("div");
preview.className="ceLibPreview";
main.appendChild(scroll);
main.appendChild(preview);
root.appendChild(main);
const count=document.createElement("p");
count.className="ceEmpty ceLibCount";
root.appendChild(count);
const row=document.createElement("div");
row.className="ceRow";
row.appendChild(button("Close",null,closeDialog));
root.appendChild(row);
function markFilters(){
[...filters.children].forEach(function(node){
node.classList.toggle("active",node.getAttribute("data-filter")===filter);
});
}
function useAsset(asset){
if(libraryContext==="cart"&&!asset.cartId){
setStatus("That sprite is not a cart");
return;
}
selectedAsset=asset;
onPick(asset);
closeDialog();
}
function paintPreview(){
preview.innerHTML="";
if(filter==="carts"||(hoverAsset&&hoverAsset.kind==="cart")){
preview.appendChild(sizeSlider("Default cart size",CM.defaultCartScale(),function(scale){
CM.setDefaultCartScale(scale);
const art=preview.querySelector(".cePreviewArt");
if(art&&hoverAsset&&hoverAsset.cartId&&!CM.cartScaleIsCustom(hoverAsset.cartId)){
art.style.transform="rotate(180deg) scale("+CM.cartVisualScale(hoverAsset.cartId)+")";
}
}));
}
if(!hoverAsset){
preview.appendChild(el("<p class='ceEmpty'>Hover a sprite to preview it.</p>"));
return;
}
const asset=hoverAsset;
const big=thumb(asset,160);
big.classList.add("cePreviewArt");
if(asset.kind==="cart"){
big.classList.add("ceCartSpin");
big.style.transform="rotate(180deg) scale("+CM.cartVisualScale(asset.cartId)+")";
big.style.transformOrigin="center";
}
preview.appendChild(big);
const name=document.createElement("p");
name.className="ceLibName";
name.textContent=asset.name||asset.id;
preview.appendChild(name);
preview.appendChild(line("Category: "+(asset.category||libraryGroup(asset))));
if(asset.sheet)preview.appendChild(line("Sheet: "+asset.sheet));
preview.appendChild(line(CM.isFavorite(asset.id)?"Favorite":"Not a favorite"));
if(asset.kind==="cart"){
preview.appendChild(sizeSlider("Cart Size",CM.cartVisualScale(asset.cartId),function(scale){
CM.setCartScale(asset.cartId,scale);
big.style.transform="rotate(180deg) scale("+CM.cartVisualScale(asset.cartId)+")";
}));
if(CM.cartScaleIsCustom(asset.cartId)){
preview.appendChild(button("Use default size",null,function(){
CM.clearCartScale(asset.cartId);
paintPreview();
}));
}
}
}
function line(text){
const node=document.createElement("p");
node.className="ceEmpty";
node.textContent=text;
return node;
}
function paintCells(){
const width=scroll.clientWidth||720;
const cols=Math.max(4,Math.min(8,Math.floor(width/108)));
const cellW=Math.floor(width/cols);
const cellH=124;
const rows=Math.ceil(list.length/cols)||0;
canvas.style.height=(rows*cellH)+"px";
canvas.innerHTML="";
if(!list.length){
canvas.style.height="80px";
canvas.appendChild(el("<p class='ceEmpty'>"+(filter==="favorites"?"No favorites yet.":"No matching sprites.")+"</p>"));
return;
}
const view=scroll.clientHeight||480;
const first=Math.max(0,Math.floor(scroll.scrollTop/cellH)-1);
const last=Math.min(rows-1,Math.ceil((scroll.scrollTop+view)/cellH)+1);
const frag=document.createDocumentFragment();
for(let r=first;r<=last;r++){
for(let c=0;c<cols;c++){
const index=r*cols+c;
if(index>=list.length)break;
const asset=list[index];
const cell=document.createElement("div");
cell.className="ceLibCell";
cell.style.left=(c*cellW)+"px";
cell.style.top=(r*cellH)+"px";
cell.style.width=(cellW-8)+"px";
const star=document.createElement("button");
star.type="button";
star.className="ceLibStar"+(CM.isFavorite(asset.id)?" on":"");
star.textContent=CM.isFavorite(asset.id)?"★":"☆";
star.title=CM.isFavorite(asset.id)?"Remove favorite":"Favorite";
star.addEventListener("click",function(event){
event.preventDefault();
event.stopPropagation();
const on=CM.toggleFavorite(asset.id);
star.textContent=on?"★":"☆";
star.classList.toggle("on",on);
star.title=on?"Remove favorite":"Favorite";
if(hoverAsset&&hoverAsset.id===asset.id)paintPreview();
if(filter==="favorites"&&!on)refreshList();
});
const use=document.createElement("button");
use.type="button";
use.className="ceLibUse";
use.title=asset.name||asset.id;
use.setAttribute("data-asset",asset.id);
const art=thumb(asset,64);
if(asset.kind==="cart")art.classList.add("ceCartSpin");
use.appendChild(art);
const caption=document.createElement("span");
caption.textContent=asset.name||asset.id;
use.appendChild(caption);
use.addEventListener("mouseenter",function(){
hoverAsset=asset;
paintPreview();
});
use.addEventListener("click",function(){useAsset(asset);});
cell.appendChild(star);
cell.appendChild(use);
frag.appendChild(cell);
}
}
canvas.appendChild(frag);
}
function refreshList(){
const source=masterLibrary();
list=source.filter(function(asset){return libraryMatches(asset,filter,query);});
count.textContent=list.length+(list.length===1?" sprite":" sprites");
paintCells();
}
scroll.addEventListener("scroll",paintCells);
if(window.ResizeObserver)new ResizeObserver(paintCells).observe(scroll);
markFilters();
const dialog=document.getElementById("ceDialog");
dialog.innerHTML="";
dialog.appendChild(root);
dialog.classList.remove("hidden");
requestAnimationFrame(function(){
refreshList();
paintPreview();
search.focus();
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
function toggleGrid(){map.grid.visible=!map.grid.visible;setStatus(map.grid.visible?"Grid lines on":"Grid lines off");dirty=true;draw();}
function toggleSnap(){map.grid.snap=!map.grid.snap;setStatus(map.grid.snap?"Path and object snap on":"Path and object snap off");}

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
else if(mode==="paint")decorDown(event,world);
else objectsDown(event,world);
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
if(!inter)return;
const aimed=(map.skeleton.paths||[]).some(function(item){
return item.from&&item.from.kind==="intersection"&&item.from.id===inter.id&&CM.pathCompass(item)===(inter.direction||"up");
});
if(!aimed)CM.setIntersectionDirection(map,inter,CM.pathCompass(path)||"up");
}
}

function onPointerMove(event){
if(!active)return;
const world=worldFromEvent(event);
if(map){
const cell=CM.cellOf(map,world.x,world.y);
const key=cell.c+","+cell.r;
hover=world;
if(key!==hoverKey){hoverKey=key;dirty=true;}
}
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
if(drag.kind==="area"||drag.kind==="cells")area={a:CM.cellOf(map,drag.start.x,drag.start.y),b:CM.cellOf(map,world.x,world.y)};
if(drag.kind==="marquee")selectMarquee(drag.start,world,event.shiftKey);
if(drag.kind==="pencil"||drag.kind==="move"){map.updated=Date.now();renderSide();}
drag=null;
gestureEnd();
dirty=true;draw();
}

function objectRecord(){
return (map.layerRecords||[]).filter(function(record){return record.kind==="object";})[0]||null;
}
function skeletonLocked(){
const route=(map.layerRecords||[]).filter(function(record){return record.kind==="route";})[0];
return !!(route&&route.locked);
}
function layerVisible(id){
const records=map.layerRecords||[];
const record=records.filter(function(item){
return item.id===id||(id==="skeleton"&&item.kind==="route");
})[0];
if(!record)return true;
return record.visible!==false;
}
function layerLocked(name){
if(!name)return false;
const record=(map.layerRecords||[]).filter(function(item){return item.id===name;})[0];
if(record)return !!record.locked;
return !!(map.layerState&&map.layerState[name]&&map.layerState[name].locked);
}

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
if(pasteArmed&&clipboard){pasteAt(world);return;}
if(tool==="select"){drag={kind:"cells",start:world,current:world};dirty=true;return;}
if(tool==="area"){gestureStart();drag={kind:"area",start:world,current:world};return;}
const layerName=activeLayer;
const paintLayer=(map.layerRecords||[]).filter(function(record){return record.id===layerName&&record.kind==="tile";})[0];
if(!paintLayer){setStatus("Add a tile layer first");return;}
if(layerLocked(layerName)&&tool!=="eyedropper"){setStatus((paintLayer.name||"Layer")+" is locked");return;}
if(tool==="eyedropper")return pickTile(world);
if(tool==="bucket")return doFlood(world);
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

function objectsDown(event,world){
if(objectRecord()&&objectRecord().locked&&tool!=="select"){setStatus("Objects layer is locked");return;}
if(tool==="select")return selectDown(event,world,false);
if(tool==="place")return placeObject(world);
if(tool==="rotate"||tool==="scale")return nudgeObject(world,tool,event.shiftKey);
if(tool==="delete"){
const hit=hitTest(world.x,world.y,false);
if(!hit)return;
selection=[hit];
deleteSelection();
}
}

function nudgeObject(world,kind,shrink){
const hit=hitTest(world.x,world.y,false);
if(!hit||hit.kind!=="object"){setStatus("Click an object");return;}
selection=[hit];
mutate(function(){
const obj=CM.byId(map.objects,hit.id);
if(!obj)return;
if(kind==="rotate")obj.rotation=(obj.rotation||0)+15;
else obj.scale=clamp((obj.scale||1)+(shrink?-0.1:0.1),0.1,8);
});
}

function placeNode(kind,world){
const point=CM.snapPoint(map,world.x,world.y);
mutate(function(){
if(kind==="spawn"){
const spawn={id:CM.newId(map,"s"),x:point.x,y:point.y,pathId:"",enabled:true};
map.skeleton.spawns.push(spawn);
selection=[{kind:"spawn",id:spawn.id}];
}else{
const letter=CM.nextCartLetter(map);
const dest={id:CM.newId(map,"d"),x:point.x,y:point.y,pathId:"",accepts:letter,label:letter,acceptedCart:"cart"};
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
const inter={id:CM.newId(map,"i"),x:point.x,y:point.y,direction:"up",defaultDirection:""};
CM.setIntersectionDirection(map,inter,"up");
map.skeleton.intersections.push(inter);
selection=[{kind:"intersection",id:inter.id}];
});
}

function insertIntersection(hit){
mutate(function(){
const path=hit.path;
const point={x:hit.x,y:hit.y};
const inter={id:CM.newId(map,"i"),x:point.x,y:point.y,direction:"up",defaultDirection:""};
const after=[{x:point.x,y:point.y}].concat(path.points.slice(hit.index+1));
const before=path.points.slice(0,hit.index+1);
before.push({x:point.x,y:point.y});
const neu={
id:CM.newId(map,"p"),
width:path.width,
branchId:path.branchId||"",
visualStyle:copyStyle(path.visualStyle),
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
CM.setIntersectionDirection(map,inter,CM.pathCompass(neu)||"up");
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
const pending=draft;
draft=null;
const points=pending.points.map(function(p){return {x:p.x,y:p.y};});
if(pending.extend){
if(!points.length)return;
mutate(function(){
const path=pending.extend.path;
if(pending.extend.end==="to")path.points=path.points.concat(points);
else path.points=points.reverse().concat(path.points);
if(attach)CM.linkPath(map,path,pending.extend.end,asTarget(attach));
});
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
if(pending.from)CM.linkPath(map,path,"from",asTarget(pending.from));
if(attach)CM.linkPath(map,path,"to",asTarget(attach));
straighten(path);
selection=[{kind:"path",id:path.id}];
});
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
const locked=skeletonMode?skeletonLocked():!!(objectRecord()&&objectRecord().locked);
if(locked){renderSide();dirty=true;draw();return;}
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
if(sel.kind==="path"){
const path=CM.byId(map.skeleton.paths,sel.id);
return {kind:"path",id:sel.id,points:path.points.map(function(p){return {x:p.x,y:p.y};})};
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
if(objectRecord()&&objectRecord().locked)return;
const obj=CM.byId(map.objects,item.id);
if(obj){obj.x=item.x+dx;obj.y=item.y+dy;}
return;
}
if(item.kind==="path"){
if(layerLocked("roads"))return;
const path=CM.byId(map.skeleton.paths,item.id);
if(!path)return;
item.points.forEach(function(point,index){movePoint(path,index,point.x+dx,point.y+dy);});
return;
}
if(item.kind==="destination"){
const buildingRecord=(map.layerRecords||[]).filter(function(record){return record.role==="building"||record.id==="buildings";})[0];
if(buildingRecord&&buildingRecord.locked)return;
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
if(skeletonMode){
let best=null;
let bestDist=reach;
map.skeleton.paths.forEach(function(path){
path.points.forEach(function(point,index){
const dist=Math.hypot(point.x-x,point.y-y);
if(dist<=bestDist){bestDist=dist;best={kind:"point",id:path.id,index:index};}
});
});
if(best)return best;
let marker=null;
map.skeleton.destinations.forEach(function(dest){
if(Math.abs(dest.x-x)<=36&&Math.abs(dest.y-y)<=28)marker={kind:"destination",id:dest.id};
});
map.skeleton.spawns.forEach(function(spawn){
if(Math.hypot(spawn.x-x,spawn.y-y)<=16)marker={kind:"spawn",id:spawn.id};
});
map.skeleton.intersections.forEach(function(inter){
if(Math.hypot(inter.x-x,inter.y-y)<=40)marker={kind:"intersection",id:inter.id};
});
if(marker)return marker;
const link=CM.nearestLink(map,x,y,18/Math.max(camera.zoom,0.4));
if(link&&link.kind!=="path")return {kind:link.kind,id:link.id};
let body=null;
let bodyDist=Infinity;
map.skeleton.paths.forEach(function(path){
const limit=Math.max(16/Math.max(camera.zoom,0.4),(path.width||map.roadWidth||64)/2);
for(let i=0;i<path.points.length-1;i++){
const proj=project(x,y,path.points[i],path.points[i+1]);
if(proj.dist<=limit&&proj.dist<bodyDist){bodyDist=proj.dist;body=path;}
}
});
if(body){
if(layerLocked("roads")){setStatus("Road layer is locked");return null;}
return {kind:"path",id:body.id};
}
}
if(!skeletonMode){
const objectLayer=(map.layerRecords||[]).filter(function(record){return record.kind==="object"&&record.visible!==false&&!record.locked;})[0];
if(objectLayer){
for(let i=map.objects.length-1;i>=0;i--){
const obj=map.objects[i];
if(Math.abs(obj.x-x)<=obj.w*obj.scale/2&&Math.abs(obj.y-y)<=obj.h*obj.scale/2)return {kind:"object",id:obj.id};
}
}
return null;
}
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
if(mode!=="skeleton"&&selection.some(function(sel){return sel.kind!=="object";})){
setStatus("Switch to Skeleton to delete routes");
return;
}
if(mode==="skeleton"&&selection.some(function(sel){return sel.kind==="object";})){
setStatus("Switch to Objects to delete decorations");
return;
}
const roadRecord=(map.layerRecords||[]).filter(function(record){return record.role==="road"||record.id==="roads";})[0];
if(roadRecord&&roadRecord.locked&&selection.some(function(sel){return sel.kind==="path"||sel.kind==="point";})){
setStatus("Road layer is locked");
return;
}
if(objectRecord()&&objectRecord().locked&&selection.some(function(sel){return sel.kind==="object";})){
setStatus("Objects layer is locked");
return;
}
const buildingRecord=(map.layerRecords||[]).filter(function(record){return record.role==="building"||record.id==="buildings";})[0];
if(buildingRecord&&buildingRecord.locked&&selection.some(function(sel){return sel.kind==="destination";})){
setStatus("Buildings layer is locked");
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
visualStyle:copyStyle(path.visualStyle),
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
if(sel.kind==="destination"){
const letter=CM.nextCartLetter(map);
copy.accepts=letter;
copy.label=letter;
}
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
if(!randomOn)return CM.spriteRef(selectedAsset);
const group=CM.variationGroup(assets,selectedAsset);
const pick=group[Math.floor(Math.random()*group.length)];
return pick?CM.spriteRef(pick):CM.spriteRef(selectedAsset);
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
const result=CM.flood(map,activeLayer,cell.c,cell.r,CM.spriteRef(selectedAsset));
if(result.capped)setStatus("Fill stopped at "+CM.FLOOD_LIMIT+" tiles");
else setStatus("Filled "+result.filled+" tiles");
});
}
function pickTile(world){
const cell=CM.cellOf(map,world.x,world.y);
const layer=map.layers[activeLayer];
if(!layer){setStatus("Add a tile layer first");return;}
const src=layer[cell.c+","+cell.r]||"";
if(!src){setStatus("Empty cell");return;}
selectedAsset=assets.filter(function(asset){return CM.spriteRef(asset)===src||asset.src===src;})[0]||{id:src,name:src,category:"picked",src:src,ref:src};
if(assets.indexOf(selectedAsset)===-1&&selectedAsset.category==="picked")assets.push(selectedAsset);
setStatus("Picked "+selectedAsset.name);
renderPalette();
}
function placeObject(world){
if(!selectedAsset){setStatus("Select an asset first");return;}
const objectLayer=(map.layerRecords||[]).filter(function(record){return record.kind==="object";})[0];
if(!objectLayer){setStatus("Add an Objects layer first");return;}
if(objectLayer.locked){setStatus("Objects layer is locked");return;}
const point=CM.snapPoint(map,world.x,world.y);
const part=CM.parseSprite(CM.spriteRef(selectedAsset));
const img=imageOf(part.src);
const size=map.grid.size||32;
mutate(function(){
const obj={
id:CM.newId(map,"o"),
asset:CM.spriteRef(selectedAsset),
layerId:objectLayer.id,
x:point.x,y:point.y,
rotation:0,scale:1,
w:part.rect?part.rect.w:(img&&img.naturalWidth?img.naturalWidth:size),
h:part.rect?part.rect.h:(img&&img.naturalHeight?img.naturalHeight:size)
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
(map.layerRecords||[]).forEach(function(record){
if(record.kind!=="tile"||!map.layers[record.id])return;
const name=record.id;
layers[name]={};
Object.keys(map.layers[name]||{}).forEach(function(key){
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
Object.keys(clipboard.layers||{}).forEach(function(name){
if(layerLocked(name)||!map.layers[name])return;
Object.keys(clipboard.layers[name]||{}).forEach(function(key){
const parts=key.split(",");
const c=cell.c+Number(parts[0]);
const r=cell.r+Number(parts[1]);
if(CM.inMapCell(map,c,r))map.layers[name][c+","+r]=clipboard.layers[name][key];
});
});
const objectLayer=(map.layerRecords||[]).filter(function(record){return record.kind==="object"&&!record.locked;})[0];
if(objectLayer){
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
"<label class='ceField'>Width (tiles)<input id='ceNewW' type='number' value='50'></label>",
"<label class='ceField'>Height (tiles)<input id='ceNewH' type='number' value='38'></label>",
"<label class='ceField'>Tile size<input id='ceNewSize' type='number' value='32'></label>",
"<div class='ceRow'><button type='button' id='ceNewOk'>Create</button><button type='button' id='ceNewCancel'>Cancel</button></div>"
].join(""),function(){
document.getElementById("ceNewCancel").onclick=closeDialog;
document.getElementById("ceNewOk").onclick=function(){
const name=document.getElementById("ceNewName").value;
const w=Number(document.getElementById("ceNewW").value);
const h=Number(document.getElementById("ceNewH").value);
const size=Number(document.getElementById("ceNewSize").value);
const doc=CM.blank(name);
CM.setCellSize(doc,size||32);
CM.setTileCounts(doc,w,h);
loadDocument(doc);
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
const name=document.getElementById("ceRename").value.slice(0,48)||"Untitled map";
closeDialog();
renameOnServer(name);
};
});
}
function deleteMap(){
if(!map.id||map.id==="builtin"){setStatus("This map is not saved yet");return;}
openDialog("<h3>Delete this map?</h3><p>"+escapeHtml(map.name)+"</p><div class='ceRow'><button type='button' id='ceDelOk'>Delete</button><button type='button' id='ceDelCancel'>Cancel</button></div>",function(){
document.getElementById("ceDelCancel").onclick=closeDialog;
document.getElementById("ceDelOk").onclick=function(){
const id=map.id;
const name=map.name;
closeDialog();
deleteOnServer(id,name);
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
if(!map.id||map.id==="builtin"||!/^c[a-f0-9]{12}$/.test(map.id))map.id=newMapId();
const doc=CM.normalize(map);
map=doc;
const previousId=doc.id;
cacheMap(doc);
try{
const response=await fetch(cartsApi("/api/carts-maps"),{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({map:doc})
});
if(!response.ok){
setStatus("Not saved to the database. "+await serverError(response));
renderSide();
return;
}
const body=await response.json();
if(body&&body.ok===true&&body.persisted==="postgres"&&body.map){
const stored=CM.normalize(body.map);
if(stored.id&&stored.id!==previousId)uncacheMap(previousId);
map=stored;
cacheMap(map);
setStatus("Saved "+map.name+" to the database");
renderSide();
return;
}
const detail=body&&(body.error||body.warning);
setStatus("Not saved to the database."+(detail?" "+detail:" The server did not confirm database storage."));
}catch(err){
setStatus("Could not reach the map server. The map is only in this browser.");
}
renderSide();
}
async function renameOnServer(name){
if(!map.id||map.id==="builtin"){
map.name=name;
renderSide();
setStatus("Renamed in this browser. Save the map to store it in the database.");
return;
}
try{
const response=await fetch(cartsApi("/api/carts-maps/"+encodeURIComponent(map.id)+"/rename"),{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({name:name})
});
if(!response.ok){
setStatus("Rename failed. "+await serverError(response));
renderSide();
return;
}
const body=await response.json();
if(!(body&&body.ok===true&&body.persisted==="postgres")){
const detail=body&&(body.error||body.warning);
setStatus("Rename was not stored in the database."+(detail?" "+detail:""));
renderSide();
return;
}
map=body.map?CM.normalize(body.map):map;
map.name=map.name||name;
cacheMap(map);
setStatus("Renamed "+map.name+" in the database");
}catch(err){
setStatus("Could not reach the map server. The name was not changed.");
}
renderSide();
}
async function deleteOnServer(id,name){
try{
const response=await fetch(cartsApi("/api/carts-maps/"+encodeURIComponent(id)),{method:"DELETE"});
if(!response.ok){
setStatus("Delete failed. "+await serverError(response));
return;
}
const body=await response.json();
if(!body||body.ok!==true){
setStatus("Delete failed. "+((body&&body.error)||"The server did not confirm deletion."));
return;
}
}catch(err){
setStatus("Could not reach the map server. The map was not deleted.");
return;
}
uncacheMap(id);
loadDocument(CM.clone(CM.builtin()));
setStatus("Deleted "+name+" from the database");
}

async function loadDialog(){
const local=readStore();
let remote=[];
let remoteLabel="database";
let listError="";
try{
const response=await fetch(cartsApi("/api/carts-maps"));
if(response.ok){
const body=await response.json();
remote=body.maps||[];
remoteLabel=body.persisted==="cache"?"server cache":"database";
}else listError=await serverError(response);
}catch(err){
listError="Could not reach the map server.";
}
const merged={};
Object.keys(local).forEach(function(id){merged[id]={id:id,name:local[id].name,updated:local[id].updated||0,source:"browser"};});
remote.forEach(function(item){
if(!item||!item.id)return;
const prev=merged[item.id];
if(!prev||(item.updated||0)>=(prev.updated||0))merged[item.id]={id:item.id,name:item.name,updated:item.updated||0,source:remoteLabel};
});
const ids=Object.keys(merged).sort(function(a,b){return (merged[b].updated||0)-(merged[a].updated||0);});
const buttons=ids.map(function(id){
return "<button type='button' data-id='"+id+"'>"+escapeHtml(merged[id].name)+" ("+merged[id].source+")</button>";
}).join("");
const notice=listError?"<p class='ceEmpty'>"+escapeHtml(listError)+"</p>":"";
openDialog("<h3>Load map</h3>"+notice+"<div class='ceMapList'>"+(buttons||"<p>No saved Carts maps.</p>")+"</div><div class='ceRow'><button type='button' id='ceLoadCancel'>Cancel</button></div>",function(){
const cancel=document.getElementById("ceLoadCancel");
if(cancel)cancel.onclick=closeDialog;
document.querySelectorAll(".ceMapList button").forEach(function(node){
node.onclick=function(){loadById(node.dataset.id,local);};
});
});
}
async function loadById(id,local){
let doc=local[id]||null;
let serverDoc=null;
let serverProblem="";
try{
const response=await fetch(cartsApi("/api/carts-maps/"+encodeURIComponent(id)));
if(response.ok){
const body=await response.json();
if(body&&body.map)serverDoc=body.map;
}else if(response.status!==404)serverProblem=await serverError(response);
}catch(err){
serverProblem="Could not reach the map server.";
}
if(serverDoc&&(!doc||(serverDoc.updated||0)>=(doc.updated||0)))doc=serverDoc;
if(!doc){setStatus(serverProblem||"Map not found");return;}
if((doc.type&&doc.type!=="carts")||(doc.game&&doc.game!=="carts")){setStatus("That is not a Carts map");return;}
loadDocument(doc);
if(serverDoc&&doc===serverDoc)cacheMap(CM.normalize(doc));
closeDialog();
setStatus(serverProblem?"Loaded "+map.name+" from this browser. "+serverProblem:"Loaded "+map.name);
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
const firstTile=(map.layerRecords||[]).filter(function(record){return record.kind==="tile";})[0];
activeLayer=firstTile?firstTile.id:"";
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
ctx.imageSmoothingEnabled=false;
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
drawStacked();
if(mode==="skeleton"&&layerVisible("skeleton"))drawDestinationLabels();
if(!drag)drawHoverPreview();
if(map.grid.visible)drawGrid();
drawCellSelection();
if(draft)drawDraft();
if(drag&&(drag.kind==="rect"||drag.kind==="area"||drag.kind==="marquee"||drag.kind==="cells"))drawDrag();
ctx.restore();
dirty=false;
}
function drawSpriteRef(ref,x,y,w,h){
const part=CM.parseSprite(ref);
const img=imageOf(part.src);
ctx.imageSmoothingEnabled=false;
if(!img){ctx.fillStyle="#d5dbe3";ctx.fillRect(x,y,w,h);return;}
if(part.rect)ctx.drawImage(img,part.rect.x,part.rect.y,part.rect.w,part.rect.h,x,y,w,h);
else ctx.drawImage(img,x,y,w,h);
}
function drawStacked(){
const records=map.layerRecords||[];
let route=false;
let roads=false;
let buildings=false;
let objects=false;
records.forEach(function(record){
if(record.kind==="route")route=true;
if(record.role==="road"||record.id==="roads")roads=true;
if(record.role==="building"||record.id==="buildings")buildings=true;
if(record.kind==="object")objects=true;
if(record.visible===false)return;
if(record.kind==="route"){drawSkeleton(mode!=="skeleton");return;}
if(record.kind==="object"){drawObjects();return;}
drawTileLayer(record.id);
if(record.role==="road"||record.id==="roads")drawStyledRoads();
if(record.role==="building"||record.id==="buildings")drawStyledBuildings();
});
if(!roads)drawStyledRoads();
if(!buildings)drawStyledBuildings();
if(!objects)drawObjects();
if(!route)drawSkeleton(mode!=="skeleton");
}
function visibleWorld(){
const rect=canvas.getBoundingClientRect();
const halfW=rect.width/2/camera.zoom;
const halfH=rect.height/2/camera.zoom;
return {x0:camera.cx-halfW,y0:camera.cy-halfH,x1:camera.cx+halfW,y1:camera.cy+halfH};
}
function drawTileLayer(name){
const view=visibleWorld();
const size=map.grid.size||32;
const layer=map.layers[name]||{};
Object.keys(layer).forEach(function(key){
const parts=key.split(",");
const c=Number(parts[0]);
const r=Number(parts[1]);
if(!CM.inMapCell(map,c,r))return;
const x=c*size;
const y=r*size;
if(x>view.x1||y>view.y1||x+size<view.x0||y+size<view.y0)return;
drawSpriteRef(layer[key],x,y,size,size);
});
}
function drawGrid(){
const size=map.grid.size||32;
const counts=CM.tileCounts(map);
const view=visibleWorld();
const c0=Math.max(0,Math.floor(view.x0/size));
const c1=Math.min(counts.cols,Math.ceil(view.x1/size));
const r0=Math.max(0,Math.floor(view.y0/size));
const r1=Math.min(counts.rows,Math.ceil(view.y1/size));
ctx.strokeStyle="rgba(0,0,0,.28)";
ctx.lineWidth=1/camera.zoom;
ctx.beginPath();
for(let c=c0;c<=c1;c++){
const x=c*size;
ctx.moveTo(x,r0*size);
ctx.lineTo(x,r1*size);
}
for(let r=r0;r<=r1;r++){
const y=r*size;
ctx.moveTo(c0*size,y);
ctx.lineTo(c1*size,y);
}
ctx.stroke();
}
function cellBox(a,b){
const ca=CM.cellOf(map,a.x,a.y);
const cb=CM.cellOf(map,b.x,b.y);
const size=map.grid.size||32;
const c0=Math.min(ca.c,cb.c);
const c1=Math.max(ca.c,cb.c);
const r0=Math.min(ca.r,cb.r);
const r1=Math.max(ca.r,cb.r);
return {x:c0*size,y:r0*size,w:(c1-c0+1)*size,h:(r1-r0+1)*size};
}
function drawHoverPreview(){
if(!hover||mode!=="paint")return;
if(tool!=="pencil"&&tool!=="rect"&&tool!=="bucket"&&tool!=="eraser"&&tool!=="select")return;
const size=map.grid.size||32;
const origin=CM.cellOf(map,hover.x,hover.y);
if(!CM.inMapCell(map,origin.c,origin.r))return;
const span=tool==="pencil"||tool==="eraser"?brush:1;
const ref=tool!=="eraser"&&tool!=="select"&&selectedAsset?CM.spriteRef(selectedAsset):"";
ctx.save();
ctx.globalAlpha=ref?0.72:1;
for(let x=0;x<span;x++){
for(let y=0;y<span;y++){
const c=origin.c+x;
const r=origin.r+y;
if(!CM.inMapCell(map,c,r))continue;
const px=c*size;
const py=r*size;
if(tool==="eraser"){ctx.fillStyle="rgba(229,57,53,.28)";ctx.fillRect(px,py,size,size);}
else if(ref)drawSpriteRef(ref,px,py,size,size);
ctx.strokeStyle=tool==="eraser"?"#e53935":"#1565c0";
ctx.lineWidth=2/camera.zoom;
ctx.strokeRect(px,py,size,size);
}
}
ctx.restore();
}
function drawCellSelection(){
if(!area||!area.a||!area.b)return;
const size=map.grid.size||32;
const c0=Math.min(area.a.c,area.b.c);
const c1=Math.max(area.a.c,area.b.c);
const r0=Math.min(area.a.r,area.b.r);
const r1=Math.max(area.a.r,area.b.r);
ctx.strokeStyle="#4f9cff";
ctx.lineWidth=2/camera.zoom;
ctx.strokeRect(c0*size,r0*size,(c1-c0+1)*size,(r1-r0+1)*size);
}
function drawStyledRoads(){
const view=visibleWorld();
const size=map.grid.size||32;
map.skeleton.paths.forEach(function(path){
if(!path.visualStyle||!path.visualStyle.src)return;
const ref=path.visualStyle.src;
CM.roadCells(map,path).forEach(function(key){
const parts=key.split(",");
const c=Number(parts[0]);
const r=Number(parts[1]);
if(!CM.inMapCell(map,c,r))return;
const x=c*size;
const y=r*size;
if(x>view.x1||y>view.y1||x+size<view.x0||y+size<view.y0)return;
drawSpriteRef(ref,x,y,size,size);
});
});
}
function drawStyledBuildings(){
map.skeleton.destinations.forEach(function(dest){
if(dest.visual)drawLinkedSprite(dest.visual,dest.x,dest.y,128);
});
}
function drawLinkedSprite(visual,x,y,maxSize){
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
else{ctx.strokeStyle="#333";ctx.strokeRect(-maxSize*scale/2,-maxSize*scale/2,maxSize*scale,maxSize*scale);}
ctx.restore();
}
function drawObjects(){
map.objects.forEach(function(obj){
ctx.save();
ctx.translate(obj.x,obj.y);
ctx.rotate((obj.rotation||0)*Math.PI/180);
ctx.scale(obj.scale||1,obj.scale||1);
const part=CM.parseSprite(obj.asset);
const img=imageOf(part.src);
ctx.imageSmoothingEnabled=false;
if(img&&part.rect)ctx.drawImage(img,part.rect.x,part.rect.y,part.rect.w,part.rect.h,-obj.w/2,-obj.h/2,obj.w,obj.h);
else if(img)ctx.drawImage(img,-obj.w/2,-obj.h/2,obj.w,obj.h);
else{ctx.strokeStyle="#333";ctx.strokeRect(-obj.w/2,-obj.h/2,obj.w,obj.h);}
ctx.restore();
const selected=selection.some(function(sel){return sel.kind==="object"&&sel.id===obj.id;});
if(selected){ctx.strokeStyle="#4f9cff";ctx.lineWidth=2/camera.zoom;ctx.strokeRect(obj.x-obj.w*obj.scale/2,obj.y-obj.h*obj.scale/2,obj.w*obj.scale,obj.h*obj.scale);}
});
map.skeleton.spawns.forEach(function(spawn){
if(spawn.visual)drawLinkedSprite(spawn.visual,spawn.x,spawn.y,72);
});
}
function drawSkeleton(faint){
ctx.save();
if(faint)ctx.globalAlpha=0.35;
const graph=CM.compile(map);
map.skeleton.paths.forEach(function(path){
if(!path.points||path.points.length<2)return;
const hot=graph.intersections.some(function(inter){
return inter.outgoing.some(function(branch){return branch.pathId===path.id&&branch.id===inter.defaultDirection;});
});
const chosen=selection.some(function(sel){return (sel.kind==="path"||sel.kind==="point")&&sel.id===path.id;});
const styled=path.visualStyle&&path.visualStyle.src;
ctx.beginPath();
ctx.moveTo(path.points[0].x,path.points[0].y);
path.points.forEach(function(point){ctx.lineTo(point.x,point.y);});
ctx.lineCap="round";
ctx.lineJoin="round";
if(!styled){
ctx.lineWidth=path.width||map.roadWidth||64;
ctx.strokeStyle=chosen?"rgba(245,197,66,.28)":"rgba(20,20,20,.16)";
ctx.stroke();
}
ctx.lineWidth=chosen?4:2;
ctx.strokeStyle=chosen?"#f5c542":hot?"#1565c0":"#111";
ctx.stroke();
for(let i=1;i<path.points.length;i++)drawArrow(path.points[i-1],path.points[i],chosen?"#f5c542":"#111");
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
drawIntersectionArrow(inter,inter.direction||"up");
});
ctx.restore();
}
function drawIntersectionArrow(inter,direction){
const angle=((CM.DIRECTION_ANGLE&&CM.DIRECTION_ANGLE[direction])||0)*Math.PI/180;
const img=imageOf(CM.ARROW_SRC);
ctx.save();
ctx.translate(inter.x,inter.y);
ctx.rotate(angle);
ctx.imageSmoothingEnabled=true;
if(img)ctx.drawImage(img,-CM.ARROW_W/2,-CM.ARROW_H/2,CM.ARROW_W,CM.ARROW_H);
else{
ctx.fillStyle="#f5c542";
ctx.beginPath();
ctx.moveTo(0,-22);
ctx.lineTo(14,16);
ctx.lineTo(-14,16);
ctx.closePath();
ctx.fill();
}
ctx.restore();
}
function drawDestinationLabels(){
map.skeleton.destinations.forEach(function(dest){
if(!dest.visual||!dest.visual.src)return;
const text=dest.label||dest.accepts||"";
if(!text)return;
ctx.font="bold 20px Arial";
ctx.textAlign="center";
ctx.textBaseline="middle";
ctx.lineWidth=4/camera.zoom;
ctx.strokeStyle="#fff";
ctx.strokeText(text,dest.x,dest.y);
ctx.fillStyle="#111";
ctx.fillText(text,dest.x,dest.y);
});
}
function drawArrow(a,b,color){
const ang=Math.atan2(b.y-a.y,b.x-a.x);
ctx.save();
ctx.translate((a.x+b.x)/2,(a.y+b.y)/2);
ctx.rotate(ang);
ctx.fillStyle=color;
ctx.beginPath();
ctx.moveTo(12,0);
ctx.lineTo(-8,6);
ctx.lineTo(-8,-6);
ctx.closePath();
ctx.fill();
ctx.restore();
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
if(drag.kind==="marquee"){
ctx.strokeRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));
return;
}
const box=cellBox(a,b);
ctx.strokeRect(box.x,box.y,box.w,box.h);
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
found.forEach(function(asset){asset.ref=CM.spriteRef(asset);});
assets=extraAssets.concat(found);
renderPalette();
if(map)renderSide();
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
