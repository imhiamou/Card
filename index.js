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
const endgameReveal=document.getElementById("endgameReveal");
const endgameSummary=document.getElementById("endgameSummary");
const endgameMyMap=document.getElementById("endgameMyMap");
const endgameOppMap=document.getElementById("endgameOppMap");
const endgameOppMapStatus=document.getElementById("endgameOppMapStatus");

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
radar:{target:"none",desc:"Tells you whether the opponent is in the North or South half. The half stays highlighted in yellow."},
compass:{target:"none",desc:"Tells you whether the opponent is in the East or West half. The half stays highlighted in yellow."},
heatMap:{target:"none",desc:"Highlights a 3x3 region that ALWAYS contains the opponent or their clone."},
revealTrail:{target:"none",desc:"Learns the opponent's last movement card and starting square. Move One → 3x3 ?, Dash → 4x4 ?, Teleport → text only."}
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
let selectedCharacter=null; // chosen on the Hidden Hunt placement screen
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

// Deduction knowledge, built ONLY from facts I am entitled to know
// (my own private scan answers plus public attack results):
// - eliminated: tiles proven empty. Rendered GREEN.
// - confined:   null until a YES answer proves the enemy is inside a
//               region; then the surviving candidates of that region.
//               Rendered YELLOW with "?".
// - hinted:     Heat Map / Reveal Trail hint region. Also rendered
//               YELLOW with "?", but it proves nothing so it never
//               turns any other tile green.
// - oppScanned: tiles the OPPONENT has scanned (shown with a red edge).
// - halfFacts:  Radar/Compass answers kept so they can be re-applied
//               after a Mirror Image destroy collapses scan traps.
// - attackMisses: tiles proven empty by a missed attack / destroyed decoy.
let eliminated=new Set();
let confined=null;
let hinted=new Set();
let oppScanned=new Set();
let halfFacts=[];
let attackMisses=new Set();
let lastMyAction=null;
let lastEndgameReveal=null; // positions from the latest gameOver payload
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

// Character selection happens on the Hidden Hunt placement screen
// (after the hiding tile), not in the lobby.
document.querySelectorAll("#placementCharSelect .charOption").forEach((option)=>{
option.onclick=()=>{
if(boardEl.classList.contains("disabled"))return;
document.querySelectorAll("#placementCharSelect .charOption").forEach((o)=>o.classList.remove("selected"));
option.classList.add("selected");
selectedCharacter=option.dataset.character;
updateConfirmEnabled();
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
const game=document.getElementById("gameSelect").value==="word-chain"?"word-chain":"hidden-hunt";
socket.emit("createLobby",{name:selectedName,room,game});
status.textContent="Creating lobby...";
};

document.getElementById("joinBtn").onclick=()=>{
const room=document.getElementById("roomCode").value.trim().toUpperCase();
if(!room){alert("Enter lobby code");return;}
socket.emit("joinLobby",{name:selectedName,room});
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
// Word Chain handles its own rejected-word messages when active.
if(window.WordChain&&WordChain.isActive()&&WordChain.showError(msg))return;
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
selectedCharacter=null;
document.querySelectorAll("#placementCharSelect .charOption").forEach((o)=>o.classList.remove("selected"));
buildBoard();
}

function updateConfirmEnabled(){
if(boardEl.classList.contains("disabled")){
confirmBtn.disabled=true;
return;
}
confirmBtn.disabled=!(selectedTile&&selectedCharacter);
}

// Wrap a .board element with A–H column and 1–8 row labels once.
function ensureBoardCoords(boardElement){
if(!boardElement||!boardElement.parentElement)return;
if(boardElement.parentElement.classList.contains("boardWrap"))return;
const wrap=document.createElement("div");
wrap.className="boardWrap";
const corner=document.createElement("div");
corner.className="boardCorner";
const cols=document.createElement("div");
cols.className="boardColLabels";
for(let col=0;col<BOARD_SIZE;col++){
const label=document.createElement("div");
label.textContent=String.fromCharCode(65+col);
cols.appendChild(label);
}
const rows=document.createElement("div");
rows.className="boardRowLabels";
for(let row=0;row<BOARD_SIZE;row++){
const label=document.createElement("span");
label.textContent=String(row+1);
rows.appendChild(label);
}
boardElement.parentElement.insertBefore(wrap,boardElement);
wrap.appendChild(corner);
wrap.appendChild(cols);
wrap.appendChild(rows);
wrap.appendChild(boardElement);
}

// Generate the 8x8 grid dynamically. Each tile stores its row/col
// and becomes selectable; only one tile can be selected at a time.
function buildBoard(){
ensureBoardCoords(boardEl);
boardEl.innerHTML="";
boardEl.classList.remove("disabled");
selectedTile=null;
placementStatus.textContent="";
updateConfirmEnabled();
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
// until the player presses Confirm (tile + character required).
function selectTile(tile){
if(boardEl.classList.contains("disabled"))return;
if(selectedTile)selectedTile.classList.remove("selected");
selectedTile=tile;
tile.classList.add("selected");
updateConfirmEnabled();
}

// Confirm: send the chosen square AND character to the server, then
// lock the board so the choice can no longer change.
confirmBtn.onclick=()=>{
if(!selectedTile||!selectedCharacter||!currentRoom)return;
myPosition={
row:Number(selectedTile.dataset.row),
col:Number(selectedTile.dataset.col)
};
socket.emit("placeCharacter",{
roomCode:currentRoom,
position:myPosition,
character:selectedCharacter
});
boardEl.classList.add("disabled");
confirmBtn.disabled=true;
};

// "waitingOpponent" — sent only to the player who has already
// confirmed, while the opponent is still choosing a square.
socket.on("waitingOpponent",()=>{
placementStatus.textContent="Waiting for opponent...";
});

// "bothPlayersReady" — both hid + picked a character. Carries the
// final public player list (now including characters) for the panel.
socket.on("bothPlayersReady",(data)=>{
if(data&&data.players)lobbyPlayers=data.players;
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
}else if(data.cardId==="revealTrail"&&result.cells&&result.cells.length){
// Move One → 3×3 ?, Dash → 4×4 ? around the start square.
const tiles=result.cells.map((c)=>tileAt(c.row,c.col)).filter(Boolean);
hintKnowledge(tiles);
tiles.forEach(flashTile);
renderKnowledge();
}
}
});

// "gameOver" — the server decided the winner (exact-position attack)
// and reveals both hiding spots so both players can inspect the maps.
socket.on("gameOver",(data)=>{
gameOver=true;
turnIndicator.textContent=data.youWin?"You Win!":"You Lose!";
gameMsg.textContent=data.youWin?"You found the opponent's hiding spot!":"The opponent found your hiding spot.";
addLog(data.youWin?"You won the game!":"You lost the game.",true);
playAgainBtn.classList.remove("hidden");
playAgainBtn.disabled=false;
playAgainBtn.textContent="Play Again";
renderHand();
showEndgameReveal(data);
});

// Opponent's private deduction map, shared only after the game ends.
socket.on("opponentEndgameKnowledge",(data)=>{
if(!gameOver||!lastEndgameReveal)return;
// Flip positions: on THEIR map, they are "you" and you are the enemy.
paintEndgameMap(endgameOppMap,{
eliminated:new Set(data.eliminated||[]),
confined:data.confined===null?null:new Set(data.confined||[]),
hinted:new Set(data.hinted||[]),
oppScanned:new Set(data.oppScanned||[])
},{
yourPosition:lastEndgameReveal.opponentPosition,
opponentPosition:lastEndgameReveal.yourPosition,
yourCharacter:lastEndgameReveal.opponentCharacter,
opponentCharacter:lastEndgameReveal.yourCharacter,
yourMirror:lastEndgameReveal.opponentMirror,
opponentMirror:lastEndgameReveal.yourMirror
});
if(endgameOppMapStatus)endgameOppMapStatus.textContent="How they were tracking you:";
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
lastEndgameReveal=null;
gameMsg.textContent="";
gameLogEl.innerHTML="";
playAgainBtn.classList.add("hidden");
hideEndgameReveal();
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
lastEndgameReveal=null;
mirrorPos=null;
hideEndgameReveal();
buildGameBoard();
renderPlayerPanel();
renderGameState();
addLog("Game started. Good luck!",true);
}

// The gameplay board stays visible for the whole game. It shows your
// own hidden position plus all public info (scans and attacks).
function buildGameBoard(){
ensureBoardCoords(gameBoardEl);
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
}else if(abilityInfo.mirrorUsed){
statusText="Used";
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
case "revealTrail":return who+" used Reveal Trail.";
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
// A miss proves that tile is empty. Hitting the decoy proves it too,
// and also rebuilds the deduction map so Radar/Compass ? return
// (YES-scan traps may have collapsed onto the decoy alone).
if(mine&&!p.hit){
if(p.mirror)applyMirrorDestroyedKnowledge(p.row,p.col);
else applyMissKnowledge(p.row,p.col);
}
}

if(d.cardId==="heatMap"){
const region=tilesInArea(p.row,p.col,3);
region.forEach(flashTile);
// Only MY heat map tells me anything; the opponent's is their hint.
if(mine){
hintKnowledge(region);
renderKnowledge();
}
}

// The opponent changing tiles invalidates every earlier deduction
// and clears attack X marks (they only last until the target moves).
if(!mine&&(d.category==="Movement"||d.cardId==="shadowStep")){
clearAttackMarks();
staleKnowledge();
}
}

// Attacked squares flash and stay marked with a cross until the
// opponent moves (then clearAttackMarks wipes them).
function markAttacked(row,col){
const tile=tileAt(row,col);
if(!tile)return;
tile.classList.add("attacked");
refreshTile(tile);
flashTile(tile);
}

function clearAttackMarks(){
gameBoardEl.querySelectorAll(".tile.attacked").forEach((tile)=>{
tile.classList.remove("attacked");
refreshTile(tile);
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
if(isMaybeTile(tileKey(Number(tile.dataset.row),Number(tile.dataset.col)))){tile.textContent="?";return;}
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
   below is inferred from my OWN private answers plus public results:
     GREEN            = proven empty
     YELLOW with "?"  = the enemy could be here
   A NO answer only ever paints its own region green; it never turns
   the rest of the board yellow, because ruling one area out says
   nothing about where the enemy actually is.
   ============================================================ */

// Reset to "no information at all".
function resetKnowledge(){
eliminated=new Set();
confined=null;
hinted=new Set();
halfFacts=[];
attackMisses=new Set();
}

function keysOf(tiles){
return tiles.map((t)=>tileKey(Number(t.dataset.row),Number(t.dataset.col)));
}

// Tiles belonging to a Radar/Compass half answer.
function halfTiles(cardId,answer){
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
return tiles;
}

// The enemy IS somewhere in `tiles` (a YES answer). Narrow the confined
// region and, since the enemy must be inside it, prove the outside
// empty. Two overlapping YES facts therefore leave only their
// intersection yellow — a Radar half plus a Compass half leaves just
// the crossed quadrant.
function confineKnowledge(tiles){
const region=new Set(keysOf(tiles));
confined=confined===null?region:new Set([...confined].filter((k)=>region.has(k)));
for(let row=0;row<BOARD_SIZE;row++){
for(let col=0;col<BOARD_SIZE;col++){
const key=tileKey(row,col);
if(!confined.has(key))eliminated.add(key);
}
}
eliminated.forEach((k)=>confined.delete(k));
}

// The enemy is NOT in `tiles` (a NO answer, or a missed attack). Only
// those tiles are proven empty; nothing else changes colour.
function eliminateKnowledge(tiles){
keysOf(tiles).forEach((key)=>{
eliminated.add(key);
if(confined)confined.delete(key);
hinted.delete(key);
});
}

// Heat Map / Reveal Trail: a region that may hold the enemy. Shown
// yellow with "?" but never used to prove anything, so it replaces the
// previous hint and leaves every other tile untouched.
function hintKnowledge(tiles){
hinted=new Set(keysOf(tiles).filter((k)=>!eliminated.has(k)));
}

// Rebuild deduction from facts that survive a destroyed Mirror Image:
// attack misses stay green; Radar/Compass halves are re-applied so "?"
// candidates return. YES-scan traps are dropped — they may have been
// the decoy alone.
function rebuildKnowledgeAfterMirror(){
const misses=new Set(attackMisses);
const halves=halfFacts.slice();
resetKnowledge();
attackMisses=misses;
halfFacts=halves;
eliminated=new Set(attackMisses);
halves.forEach((fact)=>{
const tiles=halfTiles(fact.cardId,fact.answer);
if(tiles.length)confineKnowledge(tiles);
});
// If there is still no candidate region (no Radar/Compass yet), mark
// every non-eliminated tile as a soft "?" so the board is not blank.
if(!confined||confined.size===0){
confined=null;
const open=[];
for(let row=0;row<BOARD_SIZE;row++){
for(let col=0;col<BOARD_SIZE;col++){
const key=tileKey(row,col);
if(eliminated.has(key))continue;
const tile=tileAt(row,col);
if(tile)open.push(tile);
}
}
hintKnowledge(open);
}
}

// The opponent moved (movement card or Shadow Step), so every previous
// positional fact is stale — start the deduction map over.
function staleKnowledge(){
resetKnowledge();
renderKnowledge();
addLog("The opponent moved — your scan knowledge was reset.",true);
}

// Is this tile somewhere the enemy might still be?
function isMaybeTile(key){
if(eliminated.has(key))return false;
if(confined&&confined.has(key))return true;
return hinted.has(key);
}

// Repaint the whole board from the current knowledge.
function renderKnowledge(){
for(let row=0;row<BOARD_SIZE;row++){
for(let col=0;col<BOARD_SIZE;col++){
const tile=tileAt(row,col);
if(!tile)continue;
const key=tileKey(row,col);
tile.classList.toggle("known",eliminated.has(key));
tile.classList.toggle("possible",isMaybeTile(key));
tile.classList.toggle("oppScan",oppScanned.has(key));
refreshTile(tile);
}
}
}

// Apply a YES/NO answer to the region of my latest scan.
// A Mage's decoy can answer any scan in the real character's place;
// the answer is taken at face value, so a decoy hit narrows the map
// exactly as a real hit would.
function applyScanKnowledge(answer){
if(!lastMyAction)return;
const tiles=regionForAction(lastMyAction.cardId,lastMyAction.public);
if(tiles.length===0)return;
if(answer==="YES"){
confineKnowledge(tiles);
}else{
eliminateKnowledge(tiles);
}
renderKnowledge();
}

// Radar/Compass name the half the enemy is in: that is a YES for the
// whole half, so it confines and rules out the other half.
function applyHalfKnowledge(cardId,answer){
halfFacts=halfFacts.filter((f)=>f.cardId!==cardId);
halfFacts.push({cardId,answer});
const tiles=halfTiles(cardId,answer);
confineKnowledge(tiles);
renderKnowledge();
}

// A missed attack proves that one tile is empty.
function applyMissKnowledge(row,col){
attackMisses.add(tileKey(row,col));
const tile=tileAt(row,col);
if(!tile)return;
eliminateKnowledge([tile]);
renderKnowledge();
}

// Destroying a Mirror Image proves that tile empty, but YES-scan
// confinement may have narrowed onto the decoy alone — leaving the
// board with no "?" even though the Mage is still alive. Rebuild from
// attack misses + Radar/Compass halves so candidates return.
function applyMirrorDestroyedKnowledge(row,col){
attackMisses.add(tileKey(row,col));
rebuildKnowledgeAfterMirror();
renderKnowledge();
addLog("Mirror Image destroyed — scan traps on the decoy were cleared. Radar/Compass halves kept.",true);
}

/* ============================================================
   END-GAME REVEAL
   ============================================================ */

function hideEndgameReveal(){
if(endgameReveal)endgameReveal.classList.add("hidden");
if(endgameMyMap)endgameMyMap.innerHTML="";
if(endgameOppMap)endgameOppMap.innerHTML="";
if(endgameOppMapStatus)endgameOppMapStatus.textContent="Waiting for opponent's map...";
if(endgameSummary)endgameSummary.textContent="";
}

function markMainBoardReveal(data){
if(!data)return;
if(data.opponentPosition){
const enemy=tileAt(data.opponentPosition.row,data.opponentPosition.col);
if(enemy){
enemy.classList.add("enemy");
enemy.textContent=(CHARACTER_ICONS[data.opponentCharacter]||"?");
}
addLog("Opponent was hiding at "+tileLabel(data.opponentPosition.row,data.opponentPosition.col)+".",true);
}
if(data.yourPosition){
const you=tileAt(data.yourPosition.row,data.yourPosition.col);
if(you){
you.classList.add("you","allyReveal");
you.textContent=myCharacterIcon();
}
}
if(data.opponentMirror){
const m=tileAt(data.opponentMirror.row,data.opponentMirror.col);
if(m){
m.classList.add("mirror");
if(!m.classList.contains("enemy")&&!m.classList.contains("you"))m.textContent="\u{1FA9E}";
}
}
if(data.yourMirror){
const m=tileAt(data.yourMirror.row,data.yourMirror.col);
if(m){
m.classList.add("mirror");
if(!m.classList.contains("enemy")&&!m.classList.contains("you"))m.textContent="\u{1FA9E}";
}
}
}

function paintEndgameMap(board,knowledge,reveal){
if(!board)return;
ensureBoardCoords(board);
board.innerHTML="";
const elim=knowledge.eliminated||new Set();
const conf=knowledge.confined;
const hint=knowledge.hinted||new Set();
const scans=knowledge.oppScanned||new Set();
for(let row=0;row<BOARD_SIZE;row++){
for(let col=0;col<BOARD_SIZE;col++){
const tile=document.createElement("div");
tile.className="tile";
tile.dataset.row=row;
tile.dataset.col=col;
const key=tileKey(row,col);
const isYou=reveal&&reveal.yourPosition&&reveal.yourPosition.row===row&&reveal.yourPosition.col===col;
const isEnemy=reveal&&reveal.opponentPosition&&reveal.opponentPosition.row===row&&reveal.opponentPosition.col===col;
const isYourMirror=reveal&&reveal.yourMirror&&reveal.yourMirror.row===row&&reveal.yourMirror.col===col;
const isOppMirror=reveal&&reveal.opponentMirror&&reveal.opponentMirror.row===row&&reveal.opponentMirror.col===col;
if(elim.has(key))tile.classList.add("known");
const maybe=(!elim.has(key))&&((conf&&conf.has(key))||hint.has(key));
if(maybe)tile.classList.add("possible");
if(scans.has(key))tile.classList.add("oppScan");
if(isEnemy){
tile.classList.add("enemy");
tile.textContent=(CHARACTER_ICONS[reveal.opponentCharacter]||"E");
}else if(isYou){
tile.classList.add("you","allyReveal");
tile.textContent=CHARACTER_ICONS[reveal.yourCharacter]||myCharacterIcon();
}else if(isOppMirror||isYourMirror){
tile.classList.add("mirror");
tile.textContent="\u{1FA9E}";
}else if(maybe){
tile.textContent="?";
}
board.appendChild(tile);
}
}
}

function showEndgameReveal(data){
lastEndgameReveal=data||null;
if(!endgameReveal)return;
endgameReveal.classList.remove("hidden");
const oppLabel=data.opponentPosition
?tileLabel(data.opponentPosition.row,data.opponentPosition.col)
:"?";
const myLabel=data.yourPosition
?tileLabel(data.yourPosition.row,data.yourPosition.col)
:"?";
endgameSummary.textContent=
(data.opponentName||"Opponent")+" hid at "+oppLabel+
". You hid at "+myLabel+".";
markMainBoardReveal(data);
paintEndgameMap(endgameMyMap,{
eliminated:new Set(eliminated),
confined:confined?new Set(confined):null,
hinted:new Set(hinted),
oppScanned:new Set(oppScanned)
},data);
if(endgameOppMapStatus)endgameOppMapStatus.textContent="Waiting for opponent's map...";
if(endgameOppMap)endgameOppMap.innerHTML="";
// Share my deduction map so the opponent can see how I guessed.
if(currentRoom){
socket.emit("endgameKnowledge",{
roomCode:currentRoom,
eliminated:[...eliminated],
confined:confined?[...confined]:null,
hinted:[...hinted],
oppScanned:[...oppScanned]
});
}
}

// Wire Word Chain to the shared lobby socket (no Hidden Hunt gameplay changes).
if(window.WordChain)WordChain.init(socket);
