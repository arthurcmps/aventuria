// --- IMPORTS --- //
import { auth, db, functions } from './firebase.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// ===================================================================================
//  1. DOM ELEMENT REFERENCES
// ===================================================================================

const diceRoller = document.getElementById('dice-roller');
const diceAnimationOverlay = document.getElementById('dice-animation-overlay');
const d20Animation = document.getElementById('d20-animation');

// (O resto das referências do DOM não foi mostrado, mas elas existem)
const narrationPanel = document.getElementById('narration-panel');
const inputArea = document.getElementById('input-area');
const sidePanel = document.getElementById('side-panel');
const characterSheet = document.getElementById('character-sheet');
const partyManagementPanel = document.getElementById('party-management-panel');
const btnSend = document.getElementById('btn-send');
const inputText = document.getElementById('input-text');
const narration = document.getElementById('narration');
const characterSheetName = document.getElementById('character-sheet-name');
const characterSheetAttributes = document.getElementById('character-sheet-attributes');
const sidePanelDivider = document.getElementById('side-panel-divider');
const sidePanelDivider2 = document.querySelector('.side-panel-divider-2');
const partyList = document.getElementById('party-list');

// ===================================================================================
//  2. APP STATE
// ===================================================================================

let currentUser = null;
let currentCharacter = null;
let currentParty = [];
let currentSessionId = null;
let messagesUnsubscribe = null;
let partyUnsubscribe = null;
let sessionUnsubscribe = null; 
let isDiceRolling = false;
let lastRollTimestamp = 0; 
let localRollData = null; // << REFACTOR: Armazena os dados da rolagem local

// ===================================================================================
//  3. UI MANAGEMENT & ANIMATIONS
// ===================================================================================

/**
 * Exibe a animação de rolagem de dados para todos os jogadores.
 */
function triggerDiceAnimation(rollerName, dieType, result) {
    if (isDiceRolling) return;
    isDiceRolling = true;

    const rollerText = document.createElement('div');
    rollerText.className = 'roller-text';
    rollerText.textContent = `${rollerName} rola um d${dieType}...`;
    d20Animation.innerHTML = '';
    d20Animation.appendChild(rollerText);

    diceAnimationOverlay.style.display = 'flex';

    setTimeout(() => {
        diceAnimationOverlay.classList.add('visible');
        d20Animation.classList.add('rolling');
    }, 10);

    setTimeout(() => {
        rollerText.style.display = 'none';
        const resultText = document.createElement('div');
        resultText.className = 'result-text';
        resultText.textContent = result;
        d20Animation.appendChild(resultText);
    }, 800);
}

// ===================================================================================
//  4. CORE APP LOGIC
// ===================================================================================

// (Funções de autenticação, carregamento de sessão, criação de personagem, etc. sem alterações)

async function sendChatMessage(text) {
  if (!text.trim() || !currentSessionId || !currentCharacter) return;
  try {
    await addDoc(collection(db, 'sessions', currentSessionId, 'messages'), {
      from: 'player',
      text: text,
      characterName: currentCharacter.name,
      createdAt: serverTimestamp()
    });
    inputText.value = '';
    narration.scrollTop = narration.scrollHeight;
  } catch (error) {
    console.error("Erro ao enviar mensagem: ", error);
  }
}

function listenForMessages(sessionId) {
    // ...
}

function listenForPartyChanges(sessionId) {
    // ...
}

function listenForSessionChanges(sessionId) {
    if (sessionUnsubscribe) sessionUnsubscribe();
    
    const sessionRef = doc(db, 'sessions', sessionId);
    sessionUnsubscribe = onSnapshot(sessionRef, (doc) => {
        const sessionData = doc.data();
        const diceRoll = sessionData.latestDiceRoll;

        if (diceRoll && diceRoll.timestamp?.toMillis() > lastRollTimestamp) {
            lastRollTimestamp = diceRoll.timestamp.toMillis();
            triggerDiceAnimation(diceRoll.rollerName, diceRoll.dieType, diceRoll.result);
        }
    });
}


// ===================================================================================
//  5. EVENT LISTENERS & CLOUD FUNCTION CALLS
// ===================================================================================

/**
 * Listener para o clique nos botões de dado.
 * Agora, apenas atualiza o Firestore e armazena os dados da rolagem localmente.
 * A mensagem de chat é enviada pelo listener 'animationend'.
 */
diceRoller.addEventListener('click', async (e) => {
    if (e.target.matches('.btn[data-d]') && !isDiceRolling) {
        if (!currentSessionId || !currentCharacter) return;

        const dieType = parseInt(e.target.dataset.d);
        const result = Math.floor(Math.random() * dieType) + 1;
        
        // << REFACTOR: Armazena os dados localmente para enviar a mensagem depois
        localRollData = {
            name: currentCharacter.name,
            type: dieType,
            result: result
        };
        
        const diceRollPayload = {
            rollerName: currentCharacter.name,
            dieType: dieType,
            result: result,
            timestamp: serverTimestamp()
        };

        const sessionRef = doc(db, 'sessions', currentSessionId);
        await updateDoc(sessionRef, { latestDiceRoll: diceRollPayload });
        
        // O setTimeout para enviar a mensagem foi REMOVIDO.
    }
});

/**
 * Listener para o fim da animação do dado.
 * Esconde a animação e, se a rolagem foi local, envia a mensagem para o chat.
 */
d20Animation.addEventListener('animationend', async () => {
    // Esconde o overlay da animação
    diceAnimationOverlay.classList.remove('visible');
    d20Animation.classList.remove('rolling');
    
    // << REFACTOR: Se foi uma rolagem local, envia a mensagem de chat agora.
    if (localRollData) {
        const { name, type, result } = localRollData;
        const message = `${name} rolou um d${type} e tirou: **${result}**`;
        await sendChatMessage(message);
        localRollData = null; // Limpa os dados da rolagem local
    }

    // Atraso para a transição de opacidade do overlay terminar antes de escondê-lo
    setTimeout(() => { 
        diceAnimationOverlay.style.display = 'none';
        isDiceRolling = false;
    }, 300);
});

// (Outros listeners do projeto, como btnSend.addEventListener, etc.)
btnSend.addEventListener('click', () => sendChatMessage(inputText.value));
inputText.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendChatMessage(inputText.value);
  }
});

// A inicialização (onAuthStateChanged) e outros listeners não mostrados permanecem os mesmos
onAuthStateChanged(auth, user => {
    // ...
});
