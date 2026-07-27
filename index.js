const SERVER="https://cardb-2uys.onrender.com";
const socket=io(SERVER);

const status=document.getElementById("status");
const code=document.getElementById("code");

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
status.textContent="Joining...";
};

socket.on("lobbyCreated",(data)=>{
code.textContent="Lobby Code: "+data.room;
status.textContent="Waiting for Player 2...";
});

socket.on("gameStart",(data)=>{
status.textContent="Player joined! Starting game...";
setTimeout(()=>{
document.body.innerHTML='<h1 style="font-family:Arial;text-align:center;margin-top:20%">Game Coming In Part 4</h1>';
},1500);
});

socket.on("playerLeft",()=>{
status.textContent="Other player disconnected.";
});

socket.on("errorMessage",(msg)=>{
alert(msg);
});
