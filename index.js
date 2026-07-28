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
const myPortrait=document.getElementById("myPortrait");
const oppPortrait=document.getElementById("oppPortrait");

const BOARD_SIZE=8;
const CHARACTER_ICONS={Knight:"\u{1F6E1}\uFE0F",Mage:"\u{1F9D9}",Hunter:"\u{1F3F9}",Rogue:"\u{1F5E1}\uFE0F"};

// Client-side state. This is only used for RENDERING — the server
// owns the real game state (decks, hands, turn, positions).
let currentRoom=null;    // lobby code of the room this client is in
let lobbyPlayers=[];     // public player info (id, name, character)
let selectedTile=null;   // placement: currently selected tile
let myPosition=null;     // my own confirmed hidden square
let myTurn=null;         // true when it is this client's turn
let hand=[];             // my cards (as sent by the server)
let deckCount=0;
let discardCount=0;
let selectedCardUid=null;// card currently awaiting a board target
let playedThisTurn=false;// locks the hand after playing until turnChanged
let gameOver=false;

document.getElementById("createBtn").onclick=()=>{
const name=document.getElementById("playerName").value.trim();
const character=document.getElementById("character").value;
if(!name){alert("Enter name");return;}
socket.emit("createLobby",{name,character});
status.textContent="Creating lobby...";
};

document.getElementById("joinBtn").onclick=()=>{
const name=document.getElementById("playerName").value.trim();
const character=document.getElementById("character").value;
const room=document.getElementById("roomCode").value.trim().toUpperCase();
if(!name||!room){alert("Enter name and code");return;}
socket.emit("joinLobby",{name,character,room});
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
// Carries the public player list (id, name, character) so both
// clients can render the character portraits later.
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

// Build the 8x8 board and switch from the lobby UI to placement UI.
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

// "scanResult" — private answer to MY scan: only YES or NO, never the
// exact position.
socket.on("scanResult",(data)=>{
markRowScanned(data.row,false);
gameMsg.textContent="You scanned Row "+(data.row+1)+": "+(data.hit?"YES":"NO");
});

// "opponentScanned" — the opponent scanned a row; show which one with
// a brief highlight. Scans are public information.
socket.on("opponentScanned",(data)=>{
markRowScanned(data.row,true);
gameMsg.textContent="Opponent scanned Row "+(data.row+1)+".";
});

// "attackResult" — a square was attacked (public for both players).
socket.on("attackResult",(data)=>{
markSquareAttacked(data.row,data.col);
if(data.hit){
gameMsg.textContent="Direct hit at Row "+(data.row+1)+", Col "+(data.col+1)+"!";
}else if(playedThisTurn){
gameMsg.textContent="Your attack at Row "+(data.row+1)+", Col "+(data.col+1)+" missed.";
}else{
gameMsg.textContent="Opponent attacked Row "+(data.row+1)+", Col "+(data.col+1)+" and missed.";
}
});

// "gameOver" — the server decided the winner (exact-position attack).
socket.on("gameOver",(data)=>{
gameOver=true;
turnIndicator.textContent=data.youWin?"You Win!":"You Lose!";
gameMsg.textContent=data.youWin?"You found the opponent's hiding spot!":"The opponent found your hiding spot.";
renderHand();
});

/* ------------------ rendering helpers ------------------ */

function showGameScreen(){
placementScreen.classList.add("hidden");
gameScreen.classList.remove("hidden");
buildGameBoard();
renderPortraits();
renderGameState();
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

function myCharacterIcon(){
const me=lobbyPlayers.find(p=>p.id===socket.id);
return me?(CHARACTER_ICONS[me.character]||"\u{1F464}"):"\u{1F464}";
}

// Both players always see their own portrait and the opponent's.
function renderPortraits(){
const me=lobbyPlayers.find(p=>p.id===socket.id);
const opp=lobbyPlayers.find(p=>p.id!==socket.id);
myPortrait.innerHTML=portraitHtml(me,"You");
oppPortrait.innerHTML=portraitHtml(opp,"Opponent");
}

function portraitHtml(player,label){
if(!player)return"<div class='icon'>?</div>"+label;
const icon=CHARACTER_ICONS[player.character]||"\u{1F464}";
return"<div class='icon'>"+icon+"</div>"+player.name+"<br>("+label+")";
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
el.innerHTML=card.name+"<span class='cat'>"+card.category+"</span>";
el.onclick=()=>onCardClick(card);
handEl.appendChild(el);
});
}

// Selecting a card puts the board into targeting mode for that card.
// Clicking the same card again cancels the selection.
function onCardClick(card){
if(!myTurn||playedThisTurn||gameOver)return;
if(!card.implemented){
gameMsg.textContent=card.name+" is not available yet.";
return;
}
if(selectedCardUid===card.uid){
selectedCardUid=null;
gameMsg.textContent="";
}else{
selectedCardUid=card.uid;
if(card.id==="scanRow"){
gameMsg.textContent="Click any square in the row you want to scan.";
}else if(card.id==="attack"){
gameMsg.textContent="Click the square you want to attack.";
}
}
renderHand();
}

// Board click while a card is selected: send the play to the server.
// The server validates the card, the target and the turn; the client
// locks its hand until the server passes the turn back.
function onGameBoardClick(tile){
if(!myTurn||playedThisTurn||gameOver||selectedCardUid===null)return;
const card=hand.find(c=>c.uid===selectedCardUid);
if(!card)return;
const row=Number(tile.dataset.row);
const col=Number(tile.dataset.col);
const target=card.id==="scanRow"?{row}:{row,col};
// "playCard" — playing one card is the entire turn.
socket.emit("playCard",{roomCode:currentRoom,cardUid:card.uid,target});
playedThisTurn=true;
selectedCardUid=null;
gameMsg.textContent="";
renderHand();
}

// Mark every tile of a scanned row; optionally flash it briefly so
// the scanned player immediately notices the scan.
function markRowScanned(row,flash){
const tiles=gameBoardEl.querySelectorAll(".tile[data-row='"+row+"']");
tiles.forEach((tile)=>{
tile.classList.add("scanned");
if(flash){
tile.classList.add("flash");
setTimeout(()=>tile.classList.remove("flash"),950);
}
});
}

// Mark an attacked square with a cross (public for both players).
function markSquareAttacked(row,col){
const tile=gameBoardEl.querySelector(".tile[data-row='"+row+"'][data-col='"+col+"']");
if(!tile)return;
tile.classList.add("attacked");
if(!tile.classList.contains("you"))tile.textContent="\u2716";
}
