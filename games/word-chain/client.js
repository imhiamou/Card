/* Word Chain — Game Mode 2 client module */
function registerWordChain(socket){

const lobbyScreen=document.getElementById("lobbyScreen");
const wordChainScreen=document.getElementById("wordChainScreen");
const wcTurnIndicator=document.getElementById("wcTurnIndicator");
const wcRequiredLetter=document.getElementById("wcRequiredLetter");
const wcWordInput=document.getElementById("wcWordInput");
const wcSubmitBtn=document.getElementById("wcSubmitBtn");
const wcChainList=document.getElementById("wcChainList");
const wcMsg=document.getElementById("wcMsg");
const wcPlayAgainBtn=document.getElementById("wcPlayAgainBtn");
const wcMyName=document.getElementById("wcMyName");
const wcOppName=document.getElementById("wcOppName");

let currentRoom=null;
let myTurn=null;
let requiredLetter=null;
let players=[];

function showWordChainScreen(){
lobbyScreen.classList.add("hidden");
wordChainScreen.classList.remove("hidden");
}

function hideWordChainScreen(){
wordChainScreen.classList.add("hidden");
}

function onWordChainStart(data){
currentRoom=data.room;
players=data.players||[];
myTurn=data.yourTurn;
requiredLetter=data.requiredLetter;
renderChain(data.chain||[]);
renderWordChainState();
showWordChainScreen();
wcMsg.textContent="Game started!";
}

function onWordChainPlayerLeft(){
hideWordChainScreen();
}

function onWordChainError(msg){
if(!wordChainScreen.classList.contains("hidden")){
wcMsg.textContent=msg;
return true;
}
return false;
}

function renderWordChainState(){
const me=players.find((p)=>p.id===socket.id);
const opp=players.find((p)=>p.id!==socket.id);
wcMyName.textContent=me?me.name:"You";
wcOppName.textContent=opp?opp.name:"Opponent";
wcTurnIndicator.textContent=myTurn?"Your Turn":"Opponent's Turn";
if(requiredLetter===null){
wcRequiredLetter.textContent="Play any valid English word to start the chain.";
}else{
wcRequiredLetter.textContent="Next word must begin with: "+requiredLetter.toUpperCase();
}
const canPlay=myTurn;
wcWordInput.disabled=!canPlay;
wcSubmitBtn.disabled=!canPlay;
}

function renderChain(chain){
wcChainList.innerHTML="";
chain.forEach((word,i)=>{
const row=document.createElement("div");
row.className="wcChainItem";
row.textContent=(i+1)+". "+word.toUpperCase();
wcChainList.appendChild(row);
});
wcChainList.scrollTop=wcChainList.scrollHeight;
}

function submitWord(){
if(!currentRoom||!myTurn)return;
const word=wcWordInput.value.trim();
if(!word){wcMsg.textContent="Enter a word.";return;}
socket.emit("submitWord",{roomCode:currentRoom,word});
wcWordInput.value="";
}

wcSubmitBtn.onclick=submitWord;
wcWordInput.addEventListener("keydown",(e)=>{if(e.key==="Enter")submitWord();});

wcPlayAgainBtn.onclick=()=>{
if(!currentRoom)return;
socket.emit("wordChainPlayAgain",{roomCode:currentRoom});
wcPlayAgainBtn.disabled=true;
wcPlayAgainBtn.textContent="Waiting for opponent...";
};

// "wordChainStarted" — initial state when both players join.
socket.on("wordChainStarted",(data)=>{
onWordChainStart(data);
});

// "wordPlayed" — a valid word was added to the chain (both players).
socket.on("wordPlayed",(data)=>{
wcMsg.textContent=(data.name||"Player")+" played: "+data.word.toUpperCase();
});

// "turnChanged" — turn passed; includes updated chain and required letter.
socket.on("turnChanged",(data)=>{
if(wordChainScreen.classList.contains("hidden"))return;
myTurn=data.yourTurn;
requiredLetter=data.requiredLetter;
if(data.chain)renderChain(data.chain);
renderWordChainState();
});

socket.on("wordChainPlayAgainWait",()=>{
wcPlayAgainBtn.textContent="Waiting for opponent...";
});

socket.on("wordChainReset",()=>{
wcMsg.textContent="";
wcPlayAgainBtn.disabled=false;
wcPlayAgainBtn.textContent="Play Again";
wcWordInput.value="";
});

WordChainGame.onStart=onWordChainStart;
WordChainGame.onPlayerLeft=onWordChainPlayerLeft;
WordChainGame.onError=onWordChainError;
}

const WordChainGame={register:registerWordChain};
window.WordChainGame=WordChainGame;
