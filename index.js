const SERVER="https://cardb-2uys.onrender.com";
const socket=io(SERVER);

const status=document.getElementById("status");
const code=document.getElementById("code");
const lobbyScreen=document.getElementById("lobbyScreen");
const characterSection=document.getElementById("characterSection");

const ROOM_CODE_PATTERN=/^[A-Z0-9]{4,8}$/;

let selectedName="Wolf";
let selectedCharacter="Knight";
let selectedGameMode="hidden-hunt";
let currentRoom=null;
let activeGameMode=null;

// Register every game module's Socket.IO handlers once at startup.
HiddenHuntGame.register(socket);
WordChainGame.register(socket);

/* ============================================================
   LOBBY — shared by all game modes
   ============================================================ */

document.querySelectorAll(".nameOption").forEach((option)=>{
option.onclick=()=>{
document.querySelectorAll(".nameOption").forEach((o)=>o.classList.remove("selected"));
option.classList.add("selected");
selectedName=option.dataset.name;
};
});

document.querySelectorAll(".charOption").forEach((option)=>{
option.onclick=()=>{
document.querySelectorAll(".charOption").forEach((o)=>o.classList.remove("selected"));
option.classList.add("selected");
selectedCharacter=option.dataset.character;
};
});

document.querySelectorAll(".modeOption").forEach((option)=>{
option.onclick=()=>{
document.querySelectorAll(".modeOption").forEach((o)=>o.classList.remove("selected"));
option.classList.add("selected");
selectedGameMode=option.dataset.mode;
const radio=option.querySelector("input");
if(radio)radio.checked=true;
characterSection.classList.toggle("hidden",selectedGameMode!=="hidden-hunt");
};
});

["createCode","roomCode"].forEach((id)=>{
const input=document.getElementById(id);
input.addEventListener("input",()=>{input.value=input.value.toUpperCase();});
});

document.getElementById("createBtn").onclick=()=>{
const room=document.getElementById("createCode").value.trim().toUpperCase();
if(!ROOM_CODE_PATTERN.test(room)){alert("Lobby code must be 4-8 letters or numbers");return;}
// Always read the selected mode from the UI at click time.
const modeInput=document.querySelector('input[name="gameMode"]:checked');
if(modeInput)selectedGameMode=modeInput.value;
socket.emit("createLobby",{
name:selectedName,
character:selectedGameMode==="hidden-hunt"?selectedCharacter:null,
room,
gameMode:selectedGameMode
});
status.textContent="Creating lobby...";
};

document.getElementById("joinBtn").onclick=()=>{
const room=document.getElementById("roomCode").value.trim().toUpperCase();
if(!room){alert("Enter lobby code");return;}
socket.emit("joinLobby",{
name:selectedName,
character:selectedCharacter,
room
});
currentRoom=room;
status.textContent="Joining...";
};

socket.on("lobbyCreated",(data)=>{
currentRoom=data.room;
activeGameMode=data.gameMode;
const modeLabel=data.gameMode==="word-chain"?"Word Chain":"Hidden Hunt";
code.textContent="Lobby Code: "+data.room+" ("+modeLabel+")";
status.textContent="Waiting for Player 2...";
});

// Both players joined — route to the correct game module.
socket.on("gameStart",(data)=>{
if(data&&data.room)currentRoom=data.room;
activeGameMode=data.gameMode;
status.textContent="Player joined! Starting game...";
// Hidden Hunt begins from gameStart; Word Chain opens when
// wordChainStarted arrives (emitted immediately after by the server).
if(data.gameMode!=="word-chain"){
HiddenHuntGame.onStart(data);
}
});

socket.on("playerLeft",()=>{
HiddenHuntGame.onPlayerLeft();
WordChainGame.onPlayerLeft();
lobbyScreen.classList.remove("hidden");
code.textContent="";
status.textContent="Other player disconnected.";
activeGameMode=null;
currentRoom=null;
});

socket.on("errorMessage",(msg)=>{
if(activeGameMode==="hidden-hunt"&&HiddenHuntGame.onError(msg))return;
if(activeGameMode==="word-chain"&&WordChainGame.onError(msg))return;
alert(msg);
});
