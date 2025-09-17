// app.js - AventurIA (vanilla)
// ---------- CONFIGURE AQUI ----------
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};
// ------------------------------------

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const btnAuth = document.getElementById('btn-auth');
const btnSend = document.getElementById('btn-send');
const inputText = document.getElementById('input-text');
const narration = document.getElementById('narration');

let currentUser = null;
let currentSessionId = null; // id da partida/adventure

// autenticação anônima simples
btnAuth.addEventListener('click', async () => {
  try {
    const userCredential = await auth.signInAnonymously();
    currentUser = userCredential.user;
    document.getElementById('username').innerText = `Player-${currentUser.uid.slice(0,6)}`;
    btnAuth.innerText = 'Desconectar';
    // criar ou conectar a uma sessão default (ex: "portal-yalara")
    ensureSession('portal-yalara');
    listenMessages();
  } catch (err) {
    console.error(err);
    alert('Erro no login: ' + err.message);
  }
});

// criar/garantir sessão
async function ensureSession(slug){
  // tenta encontrar sessão; se não existir, cria
  const sessions = db.collection('sessions');
  const q = await sessions.where('slug','==',slug).get();
  if (!q.empty){
    const doc = q.docs[0];
    currentSessionId = doc.id;
  } else {
    const docRef = await sessions.add({
      slug,
      title: 'O Portal de Yalara',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      owner: currentUser ? currentUser.uid : null,
      players: []
    });
    currentSessionId = docRef.id;
  }
}

// enviar mensagem (player -> mestre / narracao)
btnSend.addEventListener('click', sendMessage);
inputText.addEventListener('keydown', (e)=> { if(e.key === 'Enter') sendMessage(); });

async function sendMessage(){
  if(!currentUser){ alert('Faça login (Entrar) primeiro.'); return; }
  const text = inputText.value.trim();
  if(!text) return;
  inputText.value = '';
  const messagesRef = db.collection('sessions').doc(currentSessionId).collection('messages');
  await messagesRef.add({
    from: 'player',
    uid: currentUser.uid,
    text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  // Simular resposta do mestre (aqui você chamaria uma Cloud Function que usa IA)
  // Para MVP local, adicionamos resposta automática
  setTimeout(async () => {
    await messagesRef.add({
      from: 'mestre',
      uid: 'mestre-ai',
      text: `O Mestre responde: "${text}" — o mundo reage...`,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }, 700);
}

// função para escutar mensagens em tempo real
function listenMessages(){
  if(!currentSessionId) return;
  const messagesRef = db.collection('sessions').doc(currentSessionId).collection('messages').orderBy('createdAt','asc');
  messagesRef.onSnapshot(snapshot => {
    narration.innerHTML = ''; // limpa e re-renderiza (p/ MVP)
    snapshot.forEach(doc => {
      const m = doc.data();
      const el = document.createElement('div');
      el.classList.add('message');
      if(m.from === 'mestre') el.classList.add('m-mestre');
      else if(m.from === 'player') el.classList.add('m-jogador');
      else el.classList.add('m-system');
      const time = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().toLocaleTimeString() : '';
      el.innerHTML = `<div>${m.text}</div><div class="small" style="opacity:0.6;font-size:0.8rem;margin-top:6px">${time}</div>`;
      narration.appendChild(el);
      narration.scrollTop = narration.scrollHeight;
    });
  });
}

// rolar dados
document.querySelectorAll('.dice button').forEach(btn => {
  btn.addEventListener('click', async () => {
    const d = Number(btn.dataset.d);
    const n = Math.floor(Math.random()*d) + 1;
    // salvar resultado como mensagem de sistema
    if(!currentSessionId) return alert('Abra uma sessão antes de rolar');
    const messagesRef = db.collection('sessions').doc(currentSessionId).collection('messages');
    await messagesRef.add({
      from:'sistema',
      text: `Rolagem d${d}: ${n}`,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  });
});

// inicial: tentar manter sessão se já tiver user anon
auth.onAuthStateChanged(user => {
  if(user){
    currentUser = user;
    document.getElementById('username').innerText = `Player-${user.uid.slice(0,6)}`;
    btnAuth.innerText = 'Sair';
    ensureSession('portal-yalara').then(listenMessages);
  } else {
    currentUser = null;
    document.getElementById('username').innerText = 'Visitante';
    btnAuth.innerText = 'Entrar (Anon)';
  }
});
