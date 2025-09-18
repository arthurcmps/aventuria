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

// ... (referências de DOM existentes) ...
const diceRoller = document.getElementById('dice-roller');
const diceAnimationOverlay = document.getElementById('dice-animation-overlay');
const d20Animation = document.getElementById('d20-animation');

// ===================================================================================
//  2. APP STATE
// ===================================================================================

let currentUser = null;
let currentCharacter = null;
let currentParty = [];
let currentSessionId = null;
let messagesUnsubscribe = null;
let partyUnsubscribe = null;
let sessionUnsubscribe = null; // Listener para a sessão (rolagem de dados)
let isDiceRolling = false;
let lastRollTimestamp = 0; // Para evitar acionar a mesma animação múltiplas vezes

// ===================================================================================
//  3. UI MANAGEMENT & ANIMATIONS
// ===================================================================================

// ... (funções de UI existentes) ...

async function triggerDiceAnimation(rollerName, dieType, result) {
    if (isDiceRolling) return;
    isDiceRolling = true;

    // Define o texto que aparecerá antes da animação, ex: "Kael rola um d20..."
    const rollerText = document.createElement('div');
    rollerText.className = 'roller-text';
    rollerText.textContent = `${rollerName} rola um d${dieType}...`;
    d20Animation.innerHTML = ''; // Limpa conteúdo anterior
    d20Animation.appendChild(rollerText);

    diceAnimationOverlay.style.display = 'flex';

    setTimeout(() => {
        diceAnimationOverlay.classList.add('visible');
        d20Animation.classList.add('rolling');
    }, 10);

    setTimeout(() => {
        rollerText.style.display = 'none'; // Esconde o nome do jogador
        const resultText = document.createElement('div');
        resultText.className = 'result-text';
        resultText.textContent = result;
        d20Animation.appendChild(resultText); // Mostra o resultado
    }, 800);

    setTimeout(() => {
        diceAnimationOverlay.classList.remove('visible');
        d20Animation.classList.remove('rolling');
        setTimeout(() => { 
            diceAnimationOverlay.style.display = 'none';
            isDiceRolling = false;
        }, 300);
    }, 2000); // Aumenta um pouco a duração para dar tempo de ler o resultado
}

// ===================================================================================
//  4. CORE APP LOGIC
// ===================================================================================

// ... (onAuthStateChanged, loadSessionList) ...

async function loadSession(sessionId) {
    if (messagesUnsubscribe) messagesUnsubscribe();
    if (partyUnsubscribe) partyUnsubscribe();
    if (sessionUnsubscribe) sessionUnsubscribe(); // Limpa listener anterior

    currentSessionId = sessionId;

    // Listener para o documento da sessão (para rolagem de dados em tempo real)
    listenForSessionChanges(sessionId);

    const userCharRef = doc(db, 'sessions', sessionId, 'characters', currentUser.uid);
    // ... (resto da função loadSession)
}

// ... (criação de personagem) ...

async function sendChatMessage(text) { /* ... (sem mudanças) ... */ }
function listenForMessages(sessionId) { /* ... (sem mudanças) ... */ }
function listenForPartyChanges(sessionId) { /* ... (sem mudanças) ... */ }

// NOVA FUNÇÃO: Ouve mudanças no documento da sessão (para rolagem de dados)
function listenForSessionChanges(sessionId) {
    if (sessionUnsubscribe) sessionUnsubscribe();
    
    const sessionRef = doc(db, 'sessions', sessionId);
    sessionUnsubscribe = onSnapshot(sessionRef, (doc) => {
        const sessionData = doc.data();
        const diceRoll = sessionData.latestDiceRoll;

        if (diceRoll && diceRoll.timestamp?.toMillis() > lastRollTimestamp) {
            lastRollTimestamp = diceRoll.timestamp.toMillis();
            // Aciona a animação para todos os jogadores na sessão
            triggerDiceAnimation(diceRoll.rollerName, diceRoll.dieType, diceRoll.result);
        }
    });
}

// ===================================================================================
//  5. EVENT LISTENERS & CLOUD FUNCTION CALLS
// ===================================================================================

// ... (listeners existentes) ...

// --- Dice Roller Listener (Agora atualiza o Firestore) ---
diceRoller.addEventListener('click', async (e) => {
    if (e.target.matches('.btn[data-d]') && !isDiceRolling) {
        if (!currentSessionId || !currentCharacter) return;

        const dieType = parseInt(e.target.dataset.d);
        const result = Math.floor(Math.random() * dieType) + 1;
        
        // Cria o payload da rolagem
        const diceRollPayload = {
            rollerName: currentCharacter.name,
            dieType: dieType,
            result: result,
            timestamp: serverTimestamp() // Essencial para sincronização
        };

        // Atualiza o documento da sessão com a última rolagem
        const sessionRef = doc(db, 'sessions', currentSessionId);
        await updateDoc(sessionRef, { latestDiceRoll: diceRollPayload });

        // A mensagem de chat agora é enviada após a animação (ou pode ser acionada por ela)
        // Para simplificar, vamos enviar a mensagem logo após o gatilho da animação
        setTimeout(async () => {
            const message = `${currentCharacter.name} rolou um d${dieType} e tirou: **${result}**`;
            await sendChatMessage(message);
        }, 2100); // Envia a mensagem após o término da animação
    }
});

// ... (outros listeners) ...
