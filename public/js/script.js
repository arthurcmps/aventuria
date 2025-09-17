// app.js - AventurIA (modern modular JS)
import { auth, db } from './firebase.js';
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
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
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// ---------- DOM Elements ----------
const btnLogout = document.getElementById('btn-auth'); // Now a logout button
const btnSend = document.getElementById('btn-send');
const inputText = document.getElementById('input-text');
const narration = document.getElementById('narration');
const usernameEl = document.getElementById('username');

// ---------- App State ----------
let currentUser = null;
let currentSessionId = null; // id da partida/adventure
let messagesUnsubscribe = null; // para parar de ouvir msgs

// ---------- Authentication & Page Protection ----------
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    // Use displayName from Google, or generate from email, or fallback to UID
    const displayName = user.displayName || user.email.split('@')[0] || `Player-${user.uid.slice(0, 6)}`;
    usernameEl.innerText = displayName;
    btnLogout.innerText = 'Sair';
    ensureSession('portal-yalara').then(listenMessages);
  } else {
    // If no user is logged in, redirect to the login page.
    window.location.href = '/login.html';
  }
});

// Logout Button
btnLogout.addEventListener('click', async () => {
  if (messagesUnsubscribe) {
    messagesUnsubscribe(); // Stop listening to firestore
  }
  await signOut(auth);
  // The onAuthStateChanged listener above will handle the redirect.
});

// ---------- Session Management ----------
async function ensureSession(slug) {
  const sessionsRef = collection(db, 'sessions');
  const q = query(sessionsRef, where('slug', '==', slug));
  const querySnapshot = await getDocs(q);

  if (!querySnapshot.empty) {
    const docSnapshot = querySnapshot.docs[0];
    currentSessionId = docSnapshot.id;
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
  if (!currentUser) { return; } // Should not happen due to page protection
  const text = inputText.value.trim();
  if (!text) return;
  inputText.value = '';
  const messagesRef = collection(db, 'sessions', currentSessionId, 'messages');

  // Apenas envia a mensagem do jogador. A resposta da IA virá da Cloud Function.
  await addDoc(messagesRef, {
    from: 'player',
    uid: currentUser.uid,
    text,
    createdAt: serverTimestamp()
  });
}

function listenMessages() {
  if (messagesUnsubscribe) messagesUnsubscribe();
  if (!currentSessionId) return;

  const messagesRef = collection(db, 'sessions', currentSessionId, 'messages');
  const q = query(messagesRef, orderBy('createdAt', 'asc'));

  messagesUnsubscribe = onSnapshot(q, snapshot => {
    narration.innerHTML = ''; 
    snapshot.forEach(docSnapshot => {
      const m = docSnapshot.data();
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
