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

const BOARD_SIZE=8;
const ROOM_CODE_PATTERN=/^[A-Z0-9]{4,8}$/;
const CHARACTER_ICONS={Wolf:"\u{1F43A}",Mermaid:"\u{1F9DC}"};

// How each card is targeted on the board. Cards without an entry
// resolve immediately when clicked (no board target required).
// Adding a new targeted card only needs a new entry here.
const CARD_UI={
scanRow:{target:"row",hint:"Click any square in the row you want to scan."},
scanColumn:{target:"column",hint:"Click any square in the column you want to scan."},
scan2x2:{target:"tile",hint:"Click the top-left square of the 2x2 area to scan."},
scanCross:{target:"tile",hint:"Click the centre square of the cross to scan."},
moveOne:{target:"tile",hint:"Click an adjacent square (up, down, left or right)."},
dash:{target:"tile",hint:"Click a square exactly two tiles away."},
teleport:{target:"tile",hint:"Click any square to teleport to."},
attack:{target:"tile",hint:"Click the square you want to attack."}
};

// Client-side state. This is only used for RENDERING — the server
// owns the real game state (decks, hands, turn, positions).
let currentRoom=null;    // lobby code of the room this client is in
let lobbyPlayers=[];     // public player info (id, name, character)
let selectedCharacter="Wolf";
let selectedTile=null;   // placement: currently selected tile
let myPosition=null;     // my own hidden square (updates when I move)
let myTurn=null;         // true when it is this client's turn
let hand=[];             // my cards (as sent by the server)
let deckCount=0;
let discardCount=0;
let selectedCardUid=null;// card currently awaiting a board target
let playedThisTurn=false;// locks the hand after playing until turnChanged
let gameOver=false;

/* ============================================================
   LOBBY
   ============================================================ */

// Character selection: click one of the two options to choose it.
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
const name=document.getElementById("playerName").value.trim();
const room=document.getElementById("createCode").value.trim().toUpperCase();
if(!name){alert("Enter name");return;}
if(!ROOM_CODE_PATTERN.test(room)){alert("Lobby code must be 4-8 letters or numbers");return;}
socket.emit("createLobby",{name,character:selectedCharacter,room});
status.textContent="Creating lobby...";
};

document.getElementById("joinBtn").onclick=()=>{
const name=document.getElementById("playerName").value.trim();
const room=document.getElementById("roomCode").value.trim().toUpperCase();
if(!name||!room){alert("Enter name and code");return;}
socket.emit("joinLobby",{name,character:selectedCharacter,room});
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
renderGameState();
});

// "actionPlayed" — public broadcast for EVERY card either player
// plays: who played what, plus public target info (scanned row/
// column/area, attacked tile, heat map region). Movement and
// information cards carry no target — the opponent learns what was
// played but never destinations or private answers. Drives the game
// log and the board animations for both players.
socket.on("actionPlayed",(data)=>{
addLog(actionLogText(data),false);
animateAction(data);
});

// "cardResult" — private result of MY card: scan YES/NO answers,
// radar/compass halves, my own new position after moving, etc.
socket.on("cardResult",(data)=>{
const result=data.result||{};
if(result.position){
moveMyMarker(result.position);
gameMsg.textContent="You moved to "+tileLabel(result.position.row,result.position.col)+".";
addLog("You moved to "+tileLabel(result.position.row,result.position.col)+". (only you can see this)",true);
}else if(result.answer){
gameMsg.textContent=data.cardName+": "+result.answer;
addLog("Result ("+data.cardName+"): "+result.answer,true);
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
playedThisTurn=false;
gameOver=false;
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

// Selecting a card either plays it immediately (cards without a
// board target, e.g. Radar or Rest) or puts the board into targeting
// mode. Clicking the same card again cancels the selection.
function onCardClick(card){
if(!myTurn||playedThisTurn||gameOver)return;
const ui=CARD_UI[card.id];
if(!ui){
// No board target needed: play the card straight away.
emitPlayCard(card,{});
return;
}
if(selectedCardUid===card.uid){
selectedCardUid=null;
gameMsg.textContent="";
}else{
selectedCardUid=card.uid;
gameMsg.textContent=ui.hint;
}
renderHand();
}

// Board click while a card is selected: build the card-specific
// target and send the play to the server. The server validates the
// card, the target and the turn.
function onGameBoardClick(tile){
if(!myTurn||playedThisTurn||gameOver||selectedCardUid===null)return;
const card=hand.find((c)=>c.uid===selectedCardUid);
if(!card)return;
const ui=CARD_UI[card.id];
const row=Number(tile.dataset.row);
const col=Number(tile.dataset.col);
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
case "scan2x2":return who+" scanned a 2x2 area at "+tileLabel(p.row,p.col)+".";
case "scanCross":return who+" scanned a cross at "+tileLabel(p.row,p.col)+".";
case "attack":return who+" attacked "+tileLabel(p.row,p.col)+(p.hit?" — HIT!":" — miss.");
case "heatMap":return who+" used Heat Map: region "+tileLabel(p.row,p.col)+" to "+tileLabel(p.row+2,p.col+2)+" highlighted.";
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

// Small board animation for every played card (both players see it).
function animateAction(d){
const p=d.public||{};
switch(d.cardId){
case "scanRow":markScanned(tilesInRow(p.row));break;
case "scanColumn":markScanned(tilesInCol(p.col));break;
case "scan2x2":markScanned(tilesInArea(p.row,p.col,2));break;
case "scanCross":markScanned([...tilesInRow(p.row),...tilesInCol(p.col)]);break;
case "attack":markAttacked(p.row,p.col);break;
case "heatMap":flashHeat(tilesInArea(p.row,p.col,3));break;
}
}

// Scanned tiles flash briefly and stay tinted (public knowledge).
function markScanned(tiles){
tiles.forEach((tile)=>{
tile.classList.add("scanned");
flashTile(tile);
});
}

// Attacked squares flash and stay marked with a cross.
function markAttacked(row,col){
const tile=tileAt(row,col);
if(!tile)return;
tile.classList.add("attacked");
if(!tile.classList.contains("you"))tile.textContent="\u2716";
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

// Move my own character marker after a movement card resolved. Only
// this client ever sees this — the opponent just gets the log entry.
function moveMyMarker(position){
if(myPosition){
const oldTile=tileAt(myPosition.row,myPosition.col);
if(oldTile){
oldTile.classList.remove("you");
oldTile.textContent=oldTile.classList.contains("attacked")?"\u2716":"";
}
}
myPosition={row:position.row,col:position.col};
const newTile=tileAt(position.row,position.col);
if(newTile){
newTile.classList.add("you");
newTile.textContent=myCharacterIcon();
flashTile(newTile);
}
}
