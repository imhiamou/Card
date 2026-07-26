let selected='Knight';

document.querySelectorAll('.char').forEach(btn=>{
 btn.addEventListener('click',()=>{
   document.querySelectorAll('.char').forEach(b=>b.classList.remove('selected'));
   btn.classList.add('selected');
   selected=btn.dataset.char;
 });
});

document.getElementById('createBtn').onclick=()=>{
 const name=document.getElementById('playerName').value.trim();
 if(!name){alert('Enter your name');return;}
 localStorage.setItem('playerName',name);
 localStorage.setItem('character',selected);
 document.getElementById('status').textContent='Backend not connected yet.';
};

document.getElementById('joinBtn').onclick=()=>{
 const name=document.getElementById('playerName').value.trim();
 const code=document.getElementById('lobbyCode').value.trim().toUpperCase();
 if(!name||!code){alert('Enter name and lobby code');return;}
 localStorage.setItem('playerName',name);
 localStorage.setItem('character',selected);
 document.getElementById('status').textContent='Backend not connected yet.';
};
