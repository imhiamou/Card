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
const turnIndicator=document.getElementById("turnIndicator");

const BOARD_SIZE=8;

// Client-side state for the current match
let currentRoom=null;   // lobby code of the room this client is in
let selectedTile=null;  // DOM element of the currently selected tile
let myTurn=null;        // true/false once the server assigns turns

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
// Both players move from the lobby UI to the placement phase.
socket.on("gameStart",(data)=>{
if(data&&data.room)currentRoom=data.room;
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
// "placeCharacter" tells the server this player's hidden position.
socket.emit("placeCharacter",{
roomCode:currentRoom,
position:{
row:Number(selectedTile.dataset.row),
col:Number(selectedTile.dataset.col)
}
});
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

// "gameStarted" — sent individually to each client with whether it is
// their turn. The server keeps the authoritative turn state.
socket.on("gameStarted",(data)=>{
myTurn=data.yourTurn;
updateTurnIndicator();
});

/* ============================================================
   INITIAL GAME SCREEN
   ============================================================ */

function showGameScreen(){
placementScreen.classList.add("hidden");
gameScreen.classList.remove("hidden");
updateTurnIndicator();
}

function updateTurnIndicator(){
if(myTurn===null)return;
turnIndicator.textContent=myTurn?"Your Turn":"Opponent's Turn";
}

// Action buttons exist but contain no gameplay logic yet (next phase).
document.getElementById("scanRowBtn").onclick=()=>{};
document.getElementById("scanColBtn").onclick=()=>{};
document.getElementById("attackBtn").onclick=()=>{};
document.getElementById("endTurnBtn").onclick=()=>{};
