// --- IMPORTS --- //
import { auth, db } from './firebase.js';
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// ---------- DOM Elements ----------
// Auth & User
const btnLogout = document.getElementById('btn-auth');
const usernameEl = document.getElementById('username');

// Chat & Narration
const narrationPanel = document.getElementById('narration-panel');
const narration = document.getElementById('narration');
const btnSend = document.getElementById('btn-send');
const inputText = document.getElementById('input-text');
const startAdventureOverlay = document.getElementById('start-adventure-overlay');
const btnStartAdventure = document.getElementById('btn-start-adventure');

// Character Creation Modal
const modal = document.getElementById('character-creation-modal');
const pointsToDistributeEl = document.getElementById('points-to-distribute');
const charNameInput = document.getElementById('char-name');
const attributesGrid = document.querySelector('.attributes-grid');
const btnSaveCharacter = document.getElementById('btn-save-character');

// Character Sheet Panel
const charSheet = document.getElementById('character-sheet');
const charSheetName = document.getElementById('character-sheet-name');
const charSheetAttributes = document.getElementById('character-sheet-attributes');
const sidePanelDivider = document.getElementById('side-panel-divider');

// ---------- App State ----------
let currentUser = null;
let currentCharacter = null;
let currentSessionId = null;
let messagesUnsubscribe = null;

// --- UI CONTROL FUNCTIONS ---
function setChatInputEnabled(enabled) {
    inputText.disabled = !enabled;
    btnSend.disabled = !enabled;
}

// --- CORE APP LOGIC ---

// 1. App Initialization on Auth
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const displayName = user.displayName || user.email.split('@')[0];
    usernameEl.innerText = displayName;
    btnLogout.innerText = 'Sair';
    
    setChatInputEnabled(false); // Disable input by default
    await checkAndLoadCharacter(user.uid);
    // *** AQUI ESTÁ A MUDANÇA CRÍTICA ***
    await ensureSession('portal-yalara-v2'); 
    listenMessages();

  } else {
    window.location.href = '/login.html';
  }
});

// Logout
btnLogout.addEventListener('click', async () => {
  if (messagesUnsubscribe) messagesUnsubscribe();
  await signOut(auth);
});

// 2. Character Management
async function checkAndLoadCharacter(uid) {
  const charRef = doc(db, 'characters', uid);
  const charSnap = await getDoc(charRef);

  if (charSnap.exists()) {
    currentCharacter = charSnap.data();
    displayCharacterSheet(currentCharacter);
    modal.style.display = 'none';
  } else {
    modal.style.display = 'flex';
    initializeAttributePoints();
  }
}

function displayCharacterSheet(character) {
  charSheetName.textContent = character.name;
  charSheetAttributes.innerHTML = `
    <li><span class="attr-name">FOR</span> <span>${character.attributes.strength}</span></li>
    <li><span class="attr-name">DES</span> <span>${character.attributes.dexterity}</span></li>
    <li><span class="attr-name">CON</span> <span>${character.attributes.constitution}</span></li>
    <li><span class="attr-name">INT</span> <span>${character.attributes.intelligence}</span></li>
    <li><span class="attr-name">SAB</span> <span>${character.attributes.wisdom}</span></li>
    <li><span class="attr-name">CAR</span> <span>${character.attributes.charisma}</span></li>
  `;
  charSheet.style.display = 'block';
  sidePanelDivider.style.display = 'block';
}

// 3. Character Creation Logic
let points = 27;
const attributes = {
    strength: 8, dexterity: 8, constitution: 8,
    intelligence: 8, wisdom: 8, charisma: 8
};

function initializeAttributePoints() {
    pointsToDistributeEl.textContent = points;
    for (const attr in attributes) {
        document.getElementById(`attr-${attr}`).textContent = attributes[attr];
    }
}

attributesGrid.addEventListener('click', (e) => {
    if (!e.target.matches('.btn-attr')) return;
    const action = e.target.dataset.action;
    const attrName = e.target.dataset.attribute;
    let currentValue = attributes[attrName];

    if (action === 'increase' && points > 0 && currentValue < 15) {
        attributes[attrName]++;
        points--;
    } else if (action === 'decrease' && currentValue > 8) {
        attributes[attrName]--;
        points++;
    }
    document.getElementById(`attr-${attrName}`).textContent = attributes[attrName];
    pointsToDistributeEl.textContent = points;
});

btnSaveCharacter.addEventListener('click', async () => {
    const charName = charNameInput.value.trim();
    if (!charName) {
        alert('Por favor, dê um nome ao seu personagem.');
        return;
    }
    if (points > 0) {
        alert('Você ainda precisa distribuir todos os seus pontos!');
        return;
    }

    const finalCharacter = { name: charName, attributes: attributes, owner: currentUser.uid };
    const charRef = doc(db, 'characters', currentUser.uid);
    await setDoc(charRef, finalCharacter);

    currentCharacter = finalCharacter;
    displayCharacterSheet(currentCharacter);
    modal.style.display = 'none';
    startAdventureOverlay.style.display = 'flex';
});

// 4. Adventure & Chat Logic
async function ensureSession(slug) {
  const sessionsRef = collection(db, 'sessions');
  const q = query(sessionsRef, where('slug', '==', slug));
  const querySnapshot = await getDocs(q);
  currentSessionId = !querySnapshot.empty ? querySnapshot.docs[0].id : (await addDoc(sessionsRef, { slug, title: 'O Portal de Yalara', createdAt: serverTimestamp(), owner: currentUser.uid })).id;
}

btnStartAdventure.addEventListener('click', async () => {
    startAdventureOverlay.style.display = 'none';
    const messagesRef = collection(db, 'sessions', currentSessionId, 'messages');
    await addDoc(messagesRef, {
        from: 'player',
        uid: currentUser.uid,
        text: '__START_ADVENTURE__',
        createdAt: serverTimestamp()
    });
});

async function sendMessage() {
  if (!currentUser || !currentCharacter) return;
  const text = inputText.value.trim();
  if (!text) return;
  
  setChatInputEnabled(false);
  inputText.value = '';

  const messagesRef = collection(db, 'sessions', currentSessionId, 'messages');
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
  const q = query(messagesRef, orderBy('createdAt'));

  messagesUnsubscribe = onSnapshot(q, snapshot => {
    if (snapshot.empty && currentCharacter) {
        startAdventureOverlay.style.display = 'flex';
        return;
    }
    startAdventureOverlay.style.display = 'none';

    narration.innerHTML = '';
    let hasMasterMessage = false;
    snapshot.forEach(doc => {
      const msg = doc.data();
      if (msg.text === '__START_ADVENTURE__') return;

      if (msg.from === 'mestre') hasMasterMessage = true;

      const el = document.createElement('div');
      el.classList.add('message');
      el.classList.add(msg.from);
      const fromLabel = msg.from === 'player' ? (currentCharacter?.name || 'Você') : 'Mestre';
      el.innerHTML = `<div class="from">${fromLabel}</div><p>${msg.text}</p>`;
      narration.appendChild(el);
    });

    if (hasMasterMessage) {
        setChatInputEnabled(true);
    }

    narrationPanel.scrollTop = narrationPanel.scrollHeight;
  });
}

btnSend.addEventListener('click', sendMessage);
inputText.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !inputText.disabled) sendMessage(); });


// 5. Dice Rolling
document.querySelectorAll('.dice button').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!currentSessionId || inputText.disabled) return;
    const d = Number(btn.dataset.d);
    const result = Math.floor(Math.random() * d) + 1;
    const messagesRef = collection(db, 'sessions', currentSessionId, 'messages');
    await addDoc(messagesRef, {
      from: 'sistema',
      text: `Você rolou 1d${d} e tirou: <strong>${result}</strong>`,
      createdAt: serverTimestamp()
    });
  });
});
