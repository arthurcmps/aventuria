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

// ===================================================================================
//  1. DOM ELEMENT REFERENCES
// ===================================================================================

// Auth & User
const btnLogout = document.getElementById('btn-auth');
const usernameEl = document.getElementById('username');

// Main Views
const sessionSelectionOverlay = document.getElementById('session-selection-overlay');
const narrationPanel = document.getElementById('narration-panel');
const inputArea = document.getElementById('input-area');

// Session Selection
const characterList = document.getElementById('character-list');
const noCharactersMessage = document.getElementById('no-characters-message');
const btnCreateNewCharacter = document.getElementById('btn-create-new-character');
const btnNewGame = document.getElementById('btn-new-game');

// Chat & Narration
const narration = document.getElementById('narration');
const btnSend = document.getElementById('btn-send');
const inputText = document.getElementById('input-text');

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

// ===================================================================================
//  2. APP STATE
// ===================================================================================

let currentUser = null;
let currentCharacter = null;
let currentSessionId = null;
let messagesUnsubscribe = null;

// ===================================================================================
//  3. UI MANAGEMENT FUNCTIONS
// ===================================================================================

function showSessionSelectionView() {
    sessionSelectionOverlay.style.display = 'flex';
    narrationPanel.style.display = 'none';
    inputArea.style.display = 'none';
    charSheet.style.display = 'none';
    sidePanelDivider.style.display = 'none';
    setChatInputEnabled(false);
}

function showNarrationView() {
    sessionSelectionOverlay.style.display = 'none';
    narrationPanel.style.display = 'block';
    inputArea.style.display = 'flex';
    charSheet.style.display = 'block';
    sidePanelDivider.style.display = 'block';
}

function setChatInputEnabled(enabled) {
    inputText.disabled = !enabled;
    btnSend.disabled = !enabled;
}

function displayCharacterSheet(character) {
    if (!character) return;
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

// ===================================================================================
//  4. CORE APP LOGIC
// ===================================================================================

// --- App Initialization ---
onAuthStateChanged(auth, async(user) => {
    if (user) {
        currentUser = user;
        const displayName = user.displayName || user.email.split('@')[0];
        usernameEl.innerText = displayName;
        btnLogout.innerText = 'Sair';

        await loadSessionList();
        showSessionSelectionView();

    } else {
        window.location.href = '/login.html';
    }
});

// --- Session Management ---
async function loadSessionList() {
    if (!currentUser) return;

    characterList.innerHTML = ''; // Limpa a lista antes de carregar

    const sessionsRef = collection(db, 'sessions');
    const q = query(sessionsRef, where('owner', '==', currentUser.uid), orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
        noCharactersMessage.style.display = 'block';
    } else {
        noCharactersMessage.style.display = 'none';
        querySnapshot.forEach(doc => {
            const session = doc.data();
            const characterItem = document.createElement('div');
            characterItem.className = 'character-item';
            characterItem.textContent = session.character.name;
            characterItem.dataset.sessionId = doc.id;
            characterItem.addEventListener('click', () => loadSession(doc.id));
            characterList.appendChild(characterItem);
        });
    }
}

async function loadSession(sessionId) {
    if (messagesUnsubscribe) messagesUnsubscribe();

    currentSessionId = sessionId;

    const sessionRef = doc(db, 'sessions', sessionId);
    const sessionSnap = await getDoc(sessionRef);

    if (!sessionSnap.exists()) {
        alert("Erro: Sessão não encontrada!");
        showSessionSelectionView();
        return;
    }

    const sessionData = sessionSnap.data();
    currentCharacter = sessionData.character;

    displayCharacterSheet(currentCharacter);
    listenForMessages(currentSessionId);
    showNarrationView();
}

// --- Character Creation ---
let points = 27;
const baseAttributes = {
    strength: 8, dexterity: 8, constitution: 8,
    intelligence: 8, wisdom: 8, charisma: 8
};
let attributes = { ...baseAttributes };

function initializeAttributePoints() {
    points = 27;
    attributes = { ...baseAttributes };
    pointsToDistributeEl.textContent = points;
    for (const attr in attributes) {
        document.getElementById(`attr-${attr}`).textContent = attributes[attr];
    }
    charNameInput.value = '';
}

attributesGrid.addEventListener('click', (e) => {
    if (!e.target.matches('.btn-attr')) return;
    const action = e.target.dataset.action;
    const attrName = e.target.dataset.attribute;
    let currentValue = attributes[attrName];
    const cost = currentValue > 13 ? 2 : 1;

    if (action === 'increase' && points >= cost && currentValue < 15) {
        attributes[attrName]++;
        points -= cost;
    } else if (action === 'decrease' && currentValue > 8) {
        const refund = currentValue > 14 ? 2 : 1;
        attributes[attrName]--;
        points += refund;
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

    // 1. Create the new session document
    const finalCharacter = { name: charName, attributes: attributes };
    const sessionsRef = collection(db, 'sessions');
    const newSessionDoc = await addDoc(sessionsRef, {
        owner: currentUser.uid,
        createdAt: serverTimestamp(),
        character: finalCharacter
    });

    modal.style.display = 'none';
    
    // 2. Load the newly created session
    await loadSession(newSessionDoc.id);

    // 3. Send the initial message to start the story
    const messagesRef = collection(db, 'sessions', newSessionDoc.id, 'messages');
    await addDoc(messagesRef, {
        from: 'player',
        uid: currentUser.uid,
        text: '__START_ADVENTURE__',
        createdAt: serverTimestamp()
    });
});


// --- Chat & Messaging ---
async function sendMessage() {
    if (!currentUser || !currentCharacter || !currentSessionId) return;
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

function listenForMessages(sessionId) {
    if (messagesUnsubscribe) messagesUnsubscribe();

    const messagesRef = collection(db, 'sessions', sessionId, 'messages');
    const q = query(messagesRef, orderBy('createdAt'));

    messagesUnsubscribe = onSnapshot(q, snapshot => {
        narration.innerHTML = '';
        let hasMasterMessage = false;

        if (snapshot.empty) {
            // New session, waiting for the master's first message
             setChatInputEnabled(false);
             const el = document.createElement('div');
             el.className = 'message mestre';
             el.innerHTML = `<div class="from">Mestre</div><p>A escuridão se agita à sua frente. Sua jornada está prestes a começar...</p>`;
             narration.appendChild(el);
             return;
        }

        snapshot.forEach(doc => {
            const msg = doc.data();
            if (msg.text === '__START_ADVENTURE__') return;

            if (msg.from === 'mestre') hasMasterMessage = true;

            const el = document.createElement('div');
            el.classList.add('message');
            el.classList.add(msg.from);
            
            let fromLabel = 'Sistema';
            if (msg.from === 'player') {
                fromLabel = currentCharacter?.name || 'Você';
            } else if (msg.from === 'mestre') {
                fromLabel = 'Mestre';
            }

            el.innerHTML = `<div class="from">${fromLabel}</div><p>${msg.text}</p>`;
            narration.appendChild(el);
});

        // Only enable input after the master has spoken.
        if (hasMasterMessage) {
            setChatInputEnabled(true);
        }

        narrationPanel.scrollTop = narrationPanel.scrollHeight;
    });
}

// ===================================================================================
//  5. EVENT LISTENERS
// ===================================================================================

// --- Header & Session Controls ---
btnLogout.addEventListener('click', async() => {
    if (messagesUnsubscribe) messagesUnsubscribe();
    await signOut(auth);
});

btnNewGame.addEventListener('click', async () => {
    if (messagesUnsubscribe) messagesUnsubscribe();
    currentSessionId = null;
    currentCharacter = null;
    await loadSessionList();
    showSessionSelectionView();
});

btnCreateNewCharacter.addEventListener('click', () => {
    initializeAttributePoints();
    modal.style.display = 'flex';
});

// --- Chat Input ---
btnSend.addEventListener('click', sendMessage);
inputText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !inputText.disabled) sendMessage();
});

// --- Dice Rolling ---
document.querySelectorAll('.dice button').forEach(btn => {
    btn.addEventListener('click', async() => {
        if (!currentSessionId || inputText.disabled) return;
        const d = Number(btn.dataset.d);
        const result = Math.floor(Math.random() * d) + 1;
        const messagesRef = collection(db, 'sessions', currentSessionId, 'messages');
        await addDoc(messagesRef, {
            from: 'sistema',
            uid: currentUser.uid,
            text: `Você rolou 1d${d} e tirou: <strong>${result}</strong>`,
            createdAt: serverTimestamp()
        });
    });
});
