const SERVER="https://cardb-2uys.onrender.com";
const socket=io(SERVER);

const status=document.getElementById("status");
const code=document.getElementById("code");

const lobbyScreen=document.getElementById("lobbyScreen");
const placementScreen=document.getElementById("placementScreen");
const gameScreen=document.getElementById("gameScreen");

const boardEl=document.getElementById("board");
const confirmBtn=document.getElementById("confirmBtn");
const placementStatus=document.getElementById("placementStatus");

const gameBoardEl=document.getElementById("gameBoard");
const turnIndicator=document.getElementById("turnIndicator");
const handEl=document.getElementById("hand");
const gameMsg=document.getElementById("gameMsg");
const pileInfo=document.getElementById("pileInfo");
const myInfo=document.getElementById("myInfo");
const oppInfo=document.getElementById("oppInfo");
const gameLogEl=document.getElementById("gameLog");
const playAgainBtn=document.getElementById("playAgainBtn");
const abilityCard=document.getElementById("abilityCard");

const BOARD_SIZE=8;
const ROOM_CODE_PATTERN=/^[A-Z0-9]{4,8}$/;
// Emojis for the selectable characters (used in the player panel,
// on your own hidden tile and in the game log).
const CHARACTER_ICONS={Knight:"\u{1F6E1}\uFE0F",Mage:"\u{1F9D9}",Hunter:"\u{1F3F9}",Rogue:"\u{1F5E1}\uFE0F"};

// How each card works from the UI side: what it does (desc), how it
// is targeted (row / column / tile / none) and how to aim it (hint).
// Clicking a card first EXPLAINS it; then a board click plays targeted
// cards, while a second click on the card itself plays untargeted
// ones. Adding a new card only needs a new entry here.
const CARD_UI={
scanRow:{target:"row",desc:"Asks whether the opponent hides somewhere in one row (YES/NO).",hint:"Click any square in the row you want to scan."},
scanColumn:{target:"column",desc:"Asks whether the opponent hides somewhere in one column (YES/NO).",hint:"Click any square in the column you want to scan."},
scanArea:{target:"tile",desc:"Checks the chosen tile and all 8 tiles around it (YES/NO).",hint:"Click the centre of the 3x3 area to scan."},
scanCross:{target:"tile",desc:"Checks one tile's entire row AND column (YES/NO).",hint:"Click the centre square of the cross to scan."},
moveOne:{target:"tile",desc:"Moves your hidden character exactly one tile up, down, left or right.",hint:"Click an adjacent square."},
dash:{target:"tile",desc:"Moves your hidden character exactly two tiles (two steps in total).",hint:"Click a square exactly two steps away."},
teleport:{target:"tile",desc:"Moves your hidden character to any other square.",hint:"Click any square to teleport to."},
attack:{target:"tile",desc:"Strikes one tile. An exact hit wins the game!",hint:"Click the square you want to attack."},
rest:{target:"none",desc:"Skips your action and immediately draws a replacement card."},
revealTrail:{target:"none",desc:"Tells you whether the opponent moved during their last two turns."},
radar:{target:"none",desc:"Tells you whether the opponent is in the North or South half. The half stays highlighted in yellow."},
compass:{target:"none",desc:"Tells you whether the opponent is in the East or West half. The half stays highlighted in yellow."},
heatMap:{target:"none",desc:"Highlights a 3x3 region that is LIKELY (not certain) to contain the opponent."}
};

// How each character ability is aimed (descriptions come from the
// server via "abilityUpdate").
const ABILITY_UI={
knightStrike:{target:"tile",hint:"Click the tile you want to strike."},
mirrorImage:{target:"tile",hint:"Click a tile to place your mirror image."},
eagleEye:{target:"tile",hint:"Click the centre of the 3x3 area to scan."},
shadowStep:{target:"none",hint:""}
};

// Client-side state. This is only used for RENDERING — the server
// owns the real game state (decks, hands, turn, positions).
let currentRoom=null;    // lobby code of the room this client is in
let lobbyPlayers=[];     // public player info (id, name, character)
let selectedName="Wolf";
let selectedCharacter="Knight";
let selectedTile=null;   // placement: currently selected tile
let myPosition=null;     // my own hidden square (updates when I move)
let myTurn=null;         // true when it is this client's turn
let hand=[];             // my cards (as sent by the server)
let deckCount=0;
let discardCount=0;
let selectedCardUid=null;// card currently awaiting a board target
let selectedAbility=false;// ability currently awaiting a board target
let playedThisTurn=false;// locks the hand after playing until turnChanged
let gameOver=false;
let abilityInfo=null;    // my ability status (from "abilityUpdate")
let mirrorPos=null;      // my Mage mirror position (only mine)

// Deduction knowledge, driven ONLY by facts I am entitled to know
// (my own private scan answers plus public attack results):
// - candidates: every tile the enemy could still be on. Starts as the
//   whole board and shrinks as scans rule areas in or out. Rendered
//   yellow; everything ruled out is rendered green.
// - narrowed: true once any real information exists, so the board
//   stays neutral before the first scan.
// - confirmedIn: true once a YES answer has pinned the enemy inside a
//   known region, which is when "?" marks become meaningful.
// - oppScanned: tiles the OPPONENT has scanned (shown with a red edge).
let candidates=new Set();
let narrowed=false;
let confirmedIn=false;
let oppScanned=new Set();
let lastMyAction=null;
function tileKey(row,col){return row+","+col;}

/* ============================================================
   LOBBY
   ============================================================ */

// Name selection: no typing — your name is Wolf or Mermaid.
document.querySelectorAll(".nameOption").forEach((option)=>{
option.onclick=()=>{
document.querySelectorAll(".nameOption").forEach((o)=>o.classList.remove("selected"));
option.classList.add("selected");
selectedName=option.dataset.name;
};
});

// Character selection: Knight, Mage, Hunter or Rogue.
document.querySelectorAll(".charOption").forEach((option)=>{
option.onclick=()=>{
document.querySelectorAll(".charOption").forEach((o)=>o.classList.remove("selected"));
option.classList.add("selected");
selectedCharacter=option.dataset.character;
};
});

// Lobby code inputs auto-convert to uppercase while typing.
["createCode","roomCode"].forEach((id)=>{
const input=document.getElementById(id);
input.addEventListener("input",()=>{input.value=input.value.toUpperCase();});
});

document.getElementById("createBtn").onclick=()=>{
const room=document.getElementById("createCode").value.trim().toUpperCase();
if(!ROOM_CODE_PATTERN.test(room)){alert("Lobby code must be 4-8 letters or numbers");return;}
socket.emit("createLobby",{name:selectedName,character:selectedCharacter,room});
status.textContent="Creating lobby...";
};

document.getElementById("joinBtn").onclick=()=>{
const room=document.getElementById("roomCode").value.trim().toUpperCase();
if(!room){alert("Enter lobby code");return;}
socket.emit("joinLobby",{name:selectedName,character:selectedCharacter,room});
// Remember the code we tried to join; confirmed once "gameStart" arrives.
currentRoom=room;
status.textContent="Joining...";
};

socket.on("lobbyCreated",(data)=>{
currentRoom=data.room;
code.textContent="Lobby Code: "+data.room;
status.textContent="Waiting for Player 2...";
});

// Fired by the server when the second player joins the lobby.
// Carries the public player list (id, name, character) used to
// render the player information panel during the game.
socket.on("gameStart",(data)=>{
if(data&&data.room)currentRoom=data.room;
if(data&&data.players)lobbyPlayers=data.players;
status.textContent="Player joined! Starting game...";
setTimeout(showPlacementScreen,1500);
});

socket.on("playerLeft",()=>{
// Return to the lobby screen no matter which phase we were in.
placementScreen.classList.add("hidden");
gameScreen.classList.add("hidden");
lobbyScreen.classList.remove("hidden");
code.textContent="";
status.textContent="Other player disconnected.";
});

socket.on("errorMessage",(msg)=>{
// During the game, a rejected play (e.g. an invalid Dash target) must
// NOT freeze the match: unlock the hand so the player can try again,
// and show the reason on screen instead of an alert.
if(!gameScreen.classList.contains("hidden")&&!gameOver){
playedThisTurn=false;
selectedCardUid=null;
selectedAbility=false;
gameMsg.textContent=msg+" Try again.";
renderHand();
renderAbility();
return;
}
alert(msg);
});

/* ============================================================
   CHARACTER PLACEMENT PHASE
   ============================================================ */

// Build the 8x8 board and switch to the placement UI. Also used when
// a rematch resets the match back to the placement phase.
function showPlacementScreen(){
lobbyScreen.classList.add("hidden");
gameScreen.classList.add("hidden");
placementScreen.classList.remove("hidden");
buildBoard();
}

// Generate the 8x8 grid dynamically. Each tile stores its row/col
// and becomes selectable; only one tile can be selected at a time.
function buildBoard(){
boardEl.innerHTML="";
boardEl.classList.remove("disabled");
selectedTile=null;
confirmBtn.disabled=true;
placementStatus.textContent="";
for(let row=0;row<BOARD_SIZE;row++){
for(let col=0;col<BOARD_SIZE;col++){
const tile=document.createElement("div");
tile.className="tile";
tile.dataset.row=row;
tile.dataset.col=col;
tile.onclick=()=>selectTile(tile);
boardEl.appendChild(tile);
}
}
}

// Move the highlight to the clicked tile. Selection stays editable
// until the player presses Confirm Position.
function selectTile(tile){
if(selectedTile)selectedTile.classList.remove("selected");
selectedTile=tile;
tile.classList.add("selected");
confirmBtn.disabled=false;
}

// Confirm Position: send the chosen square to the server, then lock
// the board and the button so the choice can no longer change.
confirmBtn.onclick=()=>{
if(!selectedTile||!currentRoom)return;
myPosition={
row:Number(selectedTile.dataset.row),
col:Number(selectedTile.dataset.col)
};
// "placeCharacter" tells the server this player's hidden position.
socket.emit("placeCharacter",{roomCode:currentRoom,position:myPosition});
boardEl.classList.add("disabled");
confirmBtn.disabled=true;
};

// "waitingOpponent" — sent only to the player who has already
// confirmed, while the opponent is still choosing a square.
socket.on("waitingOpponent",()=>{
placementStatus.textContent="Waiting for opponent...";
});

// "bothPlayersReady" — sent to both clients once both positions are
// locked in. Hide the placement interface, show "Game Starting...",
// then load the gameplay screen after one second.
socket.on("bothPlayersReady",()=>{
placementStatus.textContent="Game Starting...";
boardEl.classList.add("disabled");
confirmBtn.disabled=true;
setTimeout(showGameScreen,1000);
});

/* ============================================================
   CARD GAME — the client only RENDERS state; every rule is
   validated by the server. Turns are entirely card-driven:
   draw -> play one card -> resolve -> discard -> turn passes.
   ============================================================ */

// "gameStarted" — sent individually to each client at game start with
// their private hand, their pile counts and whether they begin.
socket.on("gameStarted",(data)=>{
myTurn=data.yourTurn;
if(data.hand)hand=data.hand;
if(typeof data.deckCount==="number")deckCount=data.deckCount;
if(typeof data.discardCount==="number")discardCount=data.discardCount;
renderGameState();
});

// "handUpdate" — sent only to this client whenever THEIR hand or pile
// counts change (draws, plays, reshuffles). Never contains opponent data.
socket.on("handUpdate",(data)=>{
hand=data.hand;
deckCount=data.deckCount;
discardCount=data.discardCount;
renderGameState();
});

// "turnChanged" — the turn passed automatically after a card resolved.
// Unlocks the hand for the new active player.
socket.on("turnChanged",(data)=>{
myTurn=data.yourTurn;
playedThisTurn=false;
selectedCardUid=null;
selectedAbility=false;
renderGameState();
});

// "abilityUpdate" — my own character ability status: readiness,
// cooldown, mirror position (Mage), passive used (Rogue). Private.
socket.on("abilityUpdate",(data)=>{
abilityInfo=data;
// If my mirror was destroyed, remove its marker from my board.
if(mirrorPos&&!data.mirror){
const tile=tileAt(mirrorPos.row,mirrorPos.col);
if(tile){tile.classList.remove("mirror");refreshTile(tile);}
mirrorPos=null;
addLog("Your mirror image was destroyed!",true);
}
renderAbility();
});

// "actionPlayed" — public broadcast for EVERY card either player
// plays: who played what, plus public target info (scanned row/
// column/area, attacked tile, heat map region). Movement and
// information cards carry no target — the opponent learns what was
// played but never destinations or private answers. Drives the game
// log and the board animations for both players.
socket.on("actionPlayed",(data)=>{
// Remember MY latest play so the private result that follows knows
// which board area it refers to (for the "?" deduction marks).
if(data.by===socket.id)lastMyAction={cardId:data.cardId,public:data.public||{}};
addLog(actionLogText(data),false);
animateAction(data);
});

// "cardResult" — private result of MY card or ability: scan YES/NO
// answers, radar/compass halves, my new position, my mirror position.
socket.on("cardResult",(data)=>{
const result=data.result||{};
if(result.position){
moveMyMarker(result.position);
gameMsg.textContent=(data.cardId==="shadowStep"?"Shadow Step! You escaped to ":"You moved to ")+tileLabel(result.position.row,result.position.col)+".";
addLog((data.cardId==="shadowStep"?"Shadow Step teleported you to ":"You moved to ")+tileLabel(result.position.row,result.position.col)+". (only you can see this)",true);
return;
}
if(result.mirror){
placeMirrorMarker(result.mirror);
gameMsg.textContent="Mirror image placed at "+tileLabel(result.mirror.row,result.mirror.col)+".";
addLog("Your mirror image stands at "+tileLabel(result.mirror.row,result.mirror.col)+". (only you can see this)",true);
return;
}
if(result.answer){
gameMsg.textContent=data.cardName+": "+result.answer;
addLog("Result ("+data.cardName+"): "+result.answer,true);
if(result.answer==="YES"||result.answer==="NO"){
applyScanKnowledge(result.answer);
}else if(data.cardId==="radar"||data.cardId==="compass"){
applyHalfKnowledge(data.cardId,result.answer);
}
}
});

// "gameOver" — the server decided the winner (exact-position attack).
socket.on("gameOver",(data)=>{
gameOver=true;
turnIndicator.textContent=data.youWin?"You Win!":"You Lose!";
gameMsg.textContent=data.youWin?"You found the opponent's hiding spot!":"The opponent found your hiding spot.";
addLog(data.youWin?"You won the game!":"You lost the game.",true);
playAgainBtn.classList.remove("hidden");
playAgainBtn.disabled=false;
playAgainBtn.textContent="Play Again";
renderHand();
});

/* ============================================================
   REMATCH (Play Again)
   ============================================================ */

// "playAgain" — vote for a rematch; the game only resets when both
// players have voted.
playAgainBtn.onclick=()=>{
if(!currentRoom)return;
socket.emit("playAgain",{roomCode:currentRoom});
playAgainBtn.disabled=true;
playAgainBtn.textContent="Waiting for opponent...";
};

// "playAgainWait" — my vote is in, the opponent has not voted yet.
socket.on("playAgainWait",()=>{
playAgainBtn.textContent="Waiting for opponent...";
});

// "gameReset" — both players accepted: wipe all match state and go
// back to the hidden placement phase (same lobby, same players).
socket.on("gameReset",()=>{
myPosition=null;
myTurn=null;
hand=[];
deckCount=0;
discardCount=0;
selectedCardUid=null;
selectedAbility=false;
playedThisTurn=false;
gameOver=false;
abilityInfo=null;
mirrorPos=null;
resetKnowledge();
oppScanned=new Set();
lastMyAction=null;
gameMsg.textContent="";
gameLogEl.innerHTML="";
playAgainBtn.classList.add("hidden");
showPlacementScreen();
});

/* ============================================================
   RENDERING
   ============================================================ */

function showGameScreen(){
placementScreen.classList.add("hidden");
gameScreen.classList.remove("hidden");
resetKnowledge();
oppScanned=new Set();
lastMyAction=null;
mirrorPos=null;
buildGameBoard();
renderPlayerPanel();
renderGameState();
addLog("Game started. Good luck!",true);
}

// The gameplay board stays visible for the whole game. It shows your
// own hidden position plus all public info (scans and attacks).
function buildGameBoard(){
gameBoardEl.innerHTML="";
for(let row=0;row<BOARD_SIZE;row++){
for(let col=0;col<BOARD_SIZE;col++){
const tile=document.createElement("div");
tile.className="tile";
tile.dataset.row=row;
tile.dataset.col=col;
if(myPosition&&myPosition.row===row&&myPosition.col===col){
tile.classList.add("you");
tile.textContent=myCharacterIcon();
}
tile.onclick=()=>onGameBoardClick(tile);
gameBoardEl.appendChild(tile);
}
}
}

function getMe(){return lobbyPlayers.find((p)=>p.id===socket.id);}
function getOpp(){return lobbyPlayers.find((p)=>p.id!==socket.id);}

function myCharacterIcon(){
const me=getMe();
return me?(CHARACTER_ICONS[me.character]||"?"):"?";
}

// Player information panel: both players always see their own
// character and the opponent's character (emoji + name + player).
function renderPlayerPanel(){
fillPlayerInfo(myInfo,getMe());
fillPlayerInfo(oppInfo,getOpp());
}

function fillPlayerInfo(el,player){
el.innerHTML="";
const charLine=document.createElement("div");
charLine.className="charLine";
charLine.textContent=player?(CHARACTER_ICONS[player.character]||"?")+" "+player.character:"?";
const nameLine=document.createElement("div");
nameLine.className="nameLine";
nameLine.textContent=player?"Player: "+player.name:"";
el.appendChild(charLine);
el.appendChild(nameLine);
}

function renderGameState(){
if(!gameOver)turnIndicator.textContent=myTurn?"Your Turn":"Opponent's Turn";
pileInfo.textContent="Deck: "+deckCount+" | Discard: "+discardCount;
renderHand();
renderAbility();
}

// Render my character ability as a golden card next to the hand,
// with its readiness / cooldown / passive status.
function renderAbility(){
if(!abilityInfo){
abilityCard.classList.add("hidden");
return;
}
abilityCard.classList.remove("hidden");
let statusText;
if(abilityInfo.type==="passive"){
statusText=abilityInfo.passiveUsed?"Used":"Passive";
}else if(abilityInfo.mirror){
statusText="Mirror active";
}else if(abilityInfo.cooldownLeft>0){
statusText="Cooldown: "+abilityInfo.cooldownLeft;
}else if(abilityInfo.usedThisTurn){
statusText="Used this turn";
}else{
statusText="Ready";
}
abilityCard.innerHTML="";
const nameNode=document.createElement("span");
nameNode.textContent=abilityInfo.name;
const statusNode=document.createElement("span");
statusNode.className="cat";
statusNode.textContent=statusText;
abilityCard.appendChild(nameNode);
abilityCard.appendChild(statusNode);
abilityCard.classList.toggle("selected",selectedAbility);
const usable=abilityInfo.type==="active"&&abilityInfo.ready&&myTurn&&!gameOver;
abilityCard.classList.toggle("unavailable",!usable);
abilityCard.onclick=onAbilityClick;
}

// Ability click: first click explains it; for targeted abilities a
// board click then uses it (clicking the ability again cancels).
function onAbilityClick(){
if(!abilityInfo)return;
const ui=ABILITY_UI[abilityInfo.id]||{target:"none",hint:""};
if(selectedAbility){
selectedAbility=false;
gameMsg.textContent="";
renderAbility();
return;
}
const usable=abilityInfo.type==="active"&&abilityInfo.ready&&myTurn&&!gameOver;
if(!usable){
// Not usable right now: just explain the ability.
gameMsg.textContent=abilityInfo.name+": "+abilityInfo.desc;
return;
}
selectedAbility=true;
selectedCardUid=null;
gameMsg.textContent=abilityInfo.name+": "+abilityInfo.desc+" "+ui.hint;
renderHand();
renderAbility();
}

// Render the hand underneath the board. Cards are only clickable for
// the active player who has not yet played this turn.
function renderHand(){
handEl.innerHTML="";
const locked=!myTurn||playedThisTurn||gameOver;
handEl.classList.toggle("disabled",locked);
hand.forEach((card)=>{
const el=document.createElement("div");
el.className="card";
if(card.uid===selectedCardUid)el.classList.add("selected");
const nameNode=document.createElement("span");
nameNode.textContent=card.name;
const catNode=document.createElement("span");
catNode.className="cat";
catNode.textContent=card.category;
el.appendChild(nameNode);
el.appendChild(catNode);
el.onclick=()=>onCardClick(card);
handEl.appendChild(el);
});
}

/* ============================================================
   PLAYING CARDS
   ============================================================ */

// First click on a card EXPLAINS what it does. Then:
//   - targeted cards (row/column/tile): click a board square to play;
//     clicking the card again cancels the selection.
//   - untargeted cards (Rest, Radar, ...): click the SAME card again
//     to actually use it.
function onCardClick(card){
if(!myTurn||playedThisTurn||gameOver)return;
const ui=CARD_UI[card.id]||{target:"none",desc:""};
if(selectedCardUid===card.uid){
if(ui.target==="none"){
// Second click on an untargeted card: use it.
emitPlayCard(card,{});
}else{
// Second click on a targeted card: cancel the selection.
selectedCardUid=null;
gameMsg.textContent="";
renderHand();
}
return;
}
// First click: select the card and explain it.
selectedCardUid=card.uid;
selectedAbility=false;
gameMsg.textContent=card.name+": "+ui.desc+" "+(ui.target==="none"?"Click the card again to use it.":ui.hint);
renderHand();
renderAbility();
}

// Board click while a card is selected: build the card-specific
// target and send the play to the server. The server validates the
// card, the target and the turn.
function onGameBoardClick(tile){
if(!myTurn||gameOver)return;
const row=Number(tile.dataset.row);
const col=Number(tile.dataset.col);
// An armed ability takes priority over card targeting.
if(selectedAbility){
// "useAbility" — abilities never consume the card turn.
socket.emit("useAbility",{roomCode:currentRoom,target:{row,col}});
selectedAbility=false;
gameMsg.textContent="";
renderAbility();
return;
}
if(playedThisTurn||selectedCardUid===null)return;
const card=hand.find((c)=>c.uid===selectedCardUid);
if(!card)return;
const ui=CARD_UI[card.id]||{target:"none"};
// Untargeted cards are played by clicking the card again, not the board.
if(ui.target==="none")return;
let target;
if(ui.target==="row")target={row};
else if(ui.target==="column")target={col};
else target={row,col};
emitPlayCard(card,target);
}

// "playCard" — playing one card is the entire turn. The client locks
// its hand until the server passes the turn back.
function emitPlayCard(card,target){
socket.emit("playCard",{roomCode:currentRoom,cardUid:card.uid,target});
playedThisTurn=true;
selectedCardUid=null;
gameMsg.textContent="";
renderHand();
}

/* ============================================================
   GAME LOG + ANIMATIONS (driven by "actionPlayed")
   ============================================================ */

// Board coordinates in the log use chess-like labels: column letter
// (A-H) + row number (1-8), e.g. D5.
function tileLabel(row,col){
return String.fromCharCode(65+col)+(row+1);
}

function actionLogText(d){
const icon=CHARACTER_ICONS[d.character]||"";
const who=icon+" "+d.name;
const p=d.public||{};
switch(d.cardId){
case "scanRow":return who+" scanned Row "+(p.row+1)+".";
case "scanColumn":return who+" scanned Column "+String.fromCharCode(65+p.col)+".";
case "scanArea":return who+" scanned a 3x3 area around "+tileLabel(p.row,p.col)+".";
case "scanCross":return who+" scanned a cross at "+tileLabel(p.row,p.col)+".";
case "attack":return who+" attacked "+tileLabel(p.row,p.col)+(p.mirror?" — destroyed a Mirror Image!":p.hit?" — HIT!":" — miss.");
case "heatMap":return who+" used Heat Map: region "+tileLabel(p.row,p.col)+" to "+tileLabel(p.row+2,p.col+2)+" highlighted.";
case "knightStrike":return who+" used Power Strike on "+tileLabel(p.row,p.col)+(p.mirror?" — destroyed a Mirror Image!":p.hit?" — HIT!":" — miss.");
case "eagleEye":return who+" used Eagle Eye around "+tileLabel(p.row,p.col)+".";
case "mirrorImage":return who+" created a Mirror Image somewhere on the board.";
case "shadowStep":return who+"'s Shadow Step activated — they vanished to a new hiding spot!";
default:return who+" played "+d.cardName+".";
}
}

// The log never contains hidden positions: it is built exclusively
// from public "actionPlayed" data plus this client's OWN private
// results (marked green and only rendered locally).
function addLog(text,isPrivate){
const line=document.createElement("p");
line.textContent=text;
if(isPrivate)line.classList.add("private");
gameLogEl.appendChild(line);
gameLogEl.scrollTop=gameLogEl.scrollHeight;
}

function tileAt(row,col){
return gameBoardEl.querySelector(".tile[data-row='"+row+"'][data-col='"+col+"']");
}
function tilesInRow(row){
return Array.from(gameBoardEl.querySelectorAll(".tile[data-row='"+row+"']"));
}
function tilesInCol(col){
return Array.from(gameBoardEl.querySelectorAll(".tile[data-col='"+col+"']"));
}
function tilesInArea(row,col,size){
const tiles=[];
for(let r=row;r<row+size;r++)for(let c=col;c<col+size;c++){
const t=tileAt(r,c);
if(t)tiles.push(t);
}
return tiles;
}

// The board tiles a public action touched (used for both the reveal
// tinting and the "?" deduction marks).
function regionForAction(cardId,p){
switch(cardId){
case "scanRow":return tilesInRow(p.row);
case "scanColumn":return tilesInCol(p.col);
case "scanArea":case "eagleEye":return tilesInArea(p.row-1,p.col-1,3);
case "scanCross":return [...tilesInRow(p.row),...tilesInCol(p.col)];
default:return [];
}
}

// Small board animation for every played card (both players see it).
// Scans I play feed the deduction map; scans the OPPONENT plays are
// outlined in red so I can see what they are learning about me.
function animateAction(d){
const p=d.public||{};
const mine=d.by===socket.id;
const isScan=["scanRow","scanColumn","scanArea","scanCross","eagleEye"].includes(d.cardId);

if(isScan){
const region=regionForAction(d.cardId,p);
region.forEach(flashTile);
if(!mine){
// Record what the opponent scanned (public knowledge).
region.forEach((t)=>oppScanned.add(tileKey(Number(t.dataset.row),Number(t.dataset.col))));
renderKnowledge();
}
}

if(d.cardId==="attack"||d.cardId==="knightStrike"){
markAttacked(p.row,p.col);
// A miss proves that tile is empty. Hitting the decoy proves it too:
// the server never lets a Mage place a mirror on its own tile.
if(mine&&!p.hit)applyMissKnowledge(p.row,p.col);
}

if(d.cardId==="heatMap")flashHeat(tilesInArea(p.row,p.col,3));

// The opponent changing tiles invalidates every earlier deduction.
if(!mine&&(d.category==="Movement"||d.cardId==="shadowStep"))staleKnowledge();
}

// Attacked squares flash and stay marked with a cross.
function markAttacked(row,col){
const tile=tileAt(row,col);
if(!tile)return;
tile.classList.add("attacked");
refreshTile(tile);
flashTile(tile);
}

// Heat map: temporary highlight of the 3x3 region.
function flashHeat(tiles){
tiles.forEach((tile)=>{
tile.classList.add("heat");
setTimeout(()=>tile.classList.remove("heat"),3000);
});
}

function flashTile(tile){
tile.classList.remove("flash");
void tile.offsetWidth; // restart the CSS animation
tile.classList.add("flash");
setTimeout(()=>tile.classList.remove("flash"),950);
}

// A tile's visible content, by priority: my own character marker,
// my mirror image, an attack cross, then a "?" on tiles where the
// enemy could still be hiding.
function refreshTile(tile){
if(tile.classList.contains("you")){tile.textContent=myCharacterIcon();return;}
if(tile.classList.contains("mirror")){tile.textContent="\u{1FA9E}";return;}
if(tile.classList.contains("attacked")){tile.textContent="\u2716";return;}
const key=tileKey(Number(tile.dataset.row),Number(tile.dataset.col));
if(confirmedIn&&candidates.has(key)){tile.textContent="?";return;}
tile.textContent="";
}

// Move my own character marker after a movement card resolved. Only
// this client ever sees this — the opponent just gets the log entry.
function moveMyMarker(position){
if(myPosition){
const oldTile=tileAt(myPosition.row,myPosition.col);
if(oldTile){
oldTile.classList.remove("you");
refreshTile(oldTile);
}
}
myPosition={row:position.row,col:position.col};
const newTile=tileAt(position.row,position.col);
if(newTile){
newTile.classList.add("you");
refreshTile(newTile);
flashTile(newTile);
}
}

// Show my Mage mirror image on my own board (never on the opponent's).
function placeMirrorMarker(position){
mirrorPos={row:position.row,col:position.col};
const tile=tileAt(position.row,position.col);
if(tile){
tile.classList.add("mirror");
refreshTile(tile);
flashTile(tile);
}
}

/* ============================================================
   DEDUCTION KNOWLEDGE
   ============================================================
   The enemy's exact tile is never sent to this client. Everything
   below is inferred from my OWN private answers plus public results,
   then painted as: yellow = the enemy could be here,
   green = the enemy is definitely NOT here.
   ============================================================ */

// Reset to "no information": every tile is a candidate again.
function resetKnowledge(){
candidates=new Set();
for(let row=0;row<BOARD_SIZE;row++){
for(let col=0;col<BOARD_SIZE;col++)candidates.add(tileKey(row,col));
}
narrowed=false;
confirmedIn=false;
}

// The enemy is somewhere in `tiles`: everything outside is ruled out.
// Two overlapping facts therefore leave only their intersection — a
// Radar half plus a Compass half leaves just the crossed quadrant.
function intersectKnowledge(tiles){
const keep=new Set(tiles.map((t)=>tileKey(Number(t.dataset.row),Number(t.dataset.col))));
candidates.forEach((key)=>{if(!keep.has(key))candidates.delete(key);});
narrowed=true;
}

// The enemy is NOT in `tiles`: rule exactly those out, keep the rest.
function eliminateKnowledge(tiles){
tiles.forEach((t)=>candidates.delete(tileKey(Number(t.dataset.row),Number(t.dataset.col))));
narrowed=true;
}

// The opponent moved (movement card or Shadow Step), so every previous
// positional fact is stale — start the deduction map over.
function staleKnowledge(){
resetKnowledge();
renderKnowledge();
addLog("The opponent moved — your scan knowledge was reset.",true);
}

// Repaint the whole board from the current knowledge set.
function renderKnowledge(){
for(let row=0;row<BOARD_SIZE;row++){
for(let col=0;col<BOARD_SIZE;col++){
const tile=tileAt(row,col);
if(!tile)continue;
const key=tileKey(row,col);
const possible=candidates.has(key);
tile.classList.toggle("possible",narrowed&&possible);
tile.classList.toggle("known",narrowed&&!possible);
tile.classList.toggle("oppScan",oppScanned.has(key));
refreshTile(tile);
}
}
}

// Apply a YES/NO answer to the region of my latest scan.
// YES -> the enemy is inside that region (intersect).
// NO  -> the enemy is not inside it (eliminate).
// A Mage's decoy can answer area scans in the real character's place;
// the answer is still treated at face value, so a decoy hit narrows
// the map exactly as a real hit would.
function applyScanKnowledge(answer){
if(!lastMyAction)return;
const tiles=regionForAction(lastMyAction.cardId,lastMyAction.public);
if(tiles.length===0)return;

if(answer==="YES"){
intersectKnowledge(tiles);
confirmedIn=true;
}else{
eliminateKnowledge(tiles);
}
renderKnowledge();
}

// Radar/Compass name the half the enemy is in: keep that half, rule
// out the other. Combined with a previous half this leaves only the
// overlapping quarter highlighted.
function applyHalfKnowledge(cardId,answer){
const tiles=[];
for(let row=0;row<BOARD_SIZE;row++){
for(let col=0;col<BOARD_SIZE;col++){
const inside=cardId==="radar"
?((answer==="North Half")?row<BOARD_SIZE/2:row>=BOARD_SIZE/2)
:((answer==="East Half")?col>=BOARD_SIZE/2:col<BOARD_SIZE/2);
if(inside){
const tile=tileAt(row,col);
if(tile)tiles.push(tile);
}
}
}
intersectKnowledge(tiles);
confirmedIn=true;
renderKnowledge();
}

// A missed attack proves that one tile is empty.
function applyMissKnowledge(row,col){
const tile=tileAt(row,col);
if(!tile)return;
eliminateKnowledge([tile]);
renderKnowledge();
}
