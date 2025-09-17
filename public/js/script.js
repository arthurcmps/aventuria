// app.js - AventurIA (modern modular JS)
import { auth, db } from './firebase.js';
import {
  onAuthStateChanged,
  signInAnonymously
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where
} from "firebase/firestore";

// ---------- DOM Elements ----------
const btnAuth = document.getElementById('btn-auth');
const btnSend = document.getElementById('btn-send');
const inputText = document.getElementById('input-text');
const narration = document.getElementById('narration');
const usernameEl = document.getElementById('username');

// ---------- App State ----------
let currentUser = null;
let currentSessionId = null; // id da partida/adventure
let messagesUnsubscribe = null; // para parar de ouvir msgs

// ---------- Authentication ----------
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    usernameEl.innerText = `Player-${user.uid.slice(0, 6)}`;
    btnAuth.innerText = 'Sair';
    ensureSession('portal-yalara').then(listenMessages);
  } else {
    currentUser = null;
    usernameEl.innerText = 'Visitante';
    btnAuth.innerText = 'Entrar (Anon)';
    if(messagesUnsubscribe) messagesUnsubscribe(); // para de ouvir a sessão anterior
  }
});

btnAuth.addEventListener('click', async () => {
  if (currentUser) {
    await auth.signOut();
  } else {
    try {
      const userCredential = await signInAnonymously(auth);
      currentUser = userCredential.user;
      usernameEl.innerText = `Player-${currentUser.uid.slice(0, 6)}`;
      btnAuth.innerText = 'Desconectar';
      await ensureSession('portal-yalara');
      listenMessages();
    } catch (err) {
      console.error(err);
      alert('Erro no login: ' + err.message);
    }
  }
});

// ---------- Session Management ----------
async function ensureSession(slug) {
  const sessionsRef = collection(db, 'sessions');
  const q = query(sessionsRef, where('slug', '==', slug));
  const querySnapshot = await getDocs(q);

  if (!querySnapshot.empty) {
    const doc = querySnapshot.docs[0];
    currentSessionId = doc.id;
  } else {
    const docRef = await addDoc(sessionsRef, {
      slug,
      title: 'O Portal de Yalara',
      createdAt: serverTimestamp(),
      owner: currentUser ? currentUser.uid : null,
      players: []
    });
    currentSessionId = docRef.id;
  }
}

// ---------- Realtime Chat ----------
async function sendMessage() {
  if (!currentUser) { alert('Faça login (Entrar) primeiro.'); return; }
  const text = inputText.value.trim();
  if (!text) return;
  inputText.value = '';
  const messagesRef = collection(db, 'sessions', currentSessionId, 'messages');

  await addDoc(messagesRef, {
    from: 'player',
    uid: currentUser.uid,
    text,
    createdAt: serverTimestamp()
  });

  // Simular resposta do mestre (aqui você chamaria uma Cloud Function que usa IA)
  setTimeout(async () => {
    await addDoc(messagesRef, {
      from: 'mestre',
      uid: 'mestre-ai',
      text: `O Mestre responde: \""${text}\"" — o mundo reage...`,
      createdAt: serverTimestamp()
    });
  }, 700);
}

function listenMessages() {
  if (messagesUnsubscribe) messagesUnsubscribe(); // Cancela listener anterior
  if (!currentSessionId) return;

  const messagesRef = collection(db, 'sessions', currentSessionId, 'messages');
  const q = query(messagesRef, orderBy('createdAt', 'asc'));

  messagesUnsubscribe = onSnapshot(q, snapshot => {
    narration.innerHTML = ''; // limpa e re-renderiza (p/ MVP)
    snapshot.forEach(doc => {
      const m = doc.data();
      const el = document.createElement('div');
      el.classList.add('message');
      if (m.from === 'mestre') el.classList.add('m-mestre');
      else if (m.from === 'player') el.classList.add('m-jogador');
      else el.classList.add('m-system');
      const time = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate().toLocaleTimeString() : '';
      el.innerHTML = `<div>${m.text}</div><div class="small">${time}</div>`;
      narration.appendChild(el);
      narration.scrollTop = narration.scrollHeight;
    });
  });
}

btnSend.addEventListener('click', sendMessage);
inputText.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

// ---------- Dice Rolling ----------
document.querySelectorAll('.dice button').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!currentSessionId) return alert('Abra uma sessão antes de rolar');
    const d = Number(btn.dataset.d);
    const n = Math.floor(Math.random() * d) + 1;
    const messagesRef = collection(db, 'sessions', currentSessionId, 'messages');
    await addDoc(messagesRef, {
      from: 'sistema',
      text: `Rolagem d${d}: ${n}`,
      createdAt: serverTimestamp()
    });
  });
});
