/*
 *  script.js - Versão Completa e Corrigida (com tratamento de link de convite)
 */

// --- IMPORTS --- //
import { auth, db, functions } from './firebase.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js";
import { onAuthStateChanged, signOut, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// ===================================================================================
//  1. DOM ELEMENT REFERENCES
// ===================================================================================
const username = document.getElementById('username');
const btnAuth = document.getElementById('btn-auth');
const btnNewGame = document.getElementById('btn-new-game');

const sessionSelectionOverlay = document.getElementById('session-selection-overlay');
const characterList = document.getElementById('character-list');
const noCharactersMessage = document.getElementById('no-characters-message');
const btnCreateNewCharacter = document.getElementById('btn-create-new-character');

const narrationPanel = document.getElementById('narration-panel');
const narration = document.getElementById('narration');
const sidePanel = document.getElementById('side-panel');
const inputArea = document.getElementById('input-area');
const inputText = document.getElementById('input-text');
const btnSend = document.getElementById('btn-send');

const characterSheet = document.getElementById('character-sheet');
const characterSheetName = document.getElementById('character-sheet-name');
const characterSheetAttributes = document.getElementById('character-sheet-attributes');
const sidePanelDivider = document.getElementById('side-panel-divider');
const partyManagementPanel = document.getElementById('party-management-panel');
const partyList = document.getElementById('party-list');
const btnInvitePlayer = document.getElementById('btn-invite-player');
const sidePanelDivider2 = document.querySelector('.side-panel-divider-2');

const characterCreationModal = document.getElementById('character-creation-modal');
const pointsToDistributeSpan = document.getElementById('points-to-distribute');
const charNameInput = document.getElementById('char-name');
const attributesGrid = document.querySelector('.attributes-grid');
const btnSaveCharacter = document.getElementById('btn-save-character');

const inviteModal = document.getElementById('invite-modal');
const inviteEmailInput = document.getElementById('invite-email');
const btnCancelInvite = document.getElementById('btn-cancel-invite');
const btnSendInvite = document.getElementById('btn-send-invite');

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
let sessionUnsubscribe = null;
let isDiceRolling = false;
let lastRollTimestamp = 0;
let localRollData = null; 

// ===================================================================================
//  3. UI MANAGEMENT
// ===================================================================================
const showNarrationView = () => {
  sessionSelectionOverlay.style.display = 'none';
  narrationPanel.style.display = 'block';
  sidePanel.style.display = 'block';
  inputArea.style.display = 'flex';
};

const showSessionSelection = () => {
  sessionSelectionOverlay.style.display = 'flex';
  narrationPanel.style.display = 'none';
  sidePanel.style.display = 'none';
  inputArea.style.display = 'none';
  characterSheet.style.display = 'none';
  partyManagementPanel.style.display = 'none';
  sidePanelDivider.style.display = 'none';
  sidePanelDivider2.style.display = 'none';
};

// ===================================================================================
//  4. CORE APP LOGIC
// ===================================================================================

async function loadSessionList(userId) {
    const charactersRef = collection(db, "characters");
    const q = query(charactersRef, where("uid", "==", userId));
    const querySnapshot = await getDocs(q);

    characterList.innerHTML = ''; 
    if (querySnapshot.empty) {
        noCharactersMessage.style.display = 'block';
    } else {
        noCharactersMessage.style.display = 'none';
        querySnapshot.forEach(doc => {
            const character = doc.data();
            const charElement = document.createElement('div');
            charElement.className = 'character-item';
            charElement.textContent = character.name;
            charElement.dataset.characterId = doc.id;
            charElement.dataset.sessionId = character.sessionId; 
            characterList.appendChild(charElement);
        });
    }
    showSessionSelection();
}

async function loadSession(sessionId) {
    if (messagesUnsubscribe) messagesUnsubscribe();
    if (partyUnsubscribe) partyUnsubscribe();
    if (sessionUnsubscribe) sessionUnsubscribe();

    currentSessionId = sessionId;
    
    // Corrigido: Busca o personagem pelo UID do usuário atual na subcoleção da sessão.
    const partyRef = collection(db, 'sessions', sessionId, 'characters');
    const q = query(partyRef, where("uid", "==", currentUser.uid));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
        const charDoc = querySnapshot.docs[0]; // Pega o primeiro personagem encontrado para o usuário
        currentCharacter = charDoc.data();
        updateCharacterSheet(currentCharacter);
    } else {
        console.error("Personagem não encontrado para o usuário nesta sessão.");
        // Você pode querer mostrar uma mensagem de erro aqui
    }

    listenForMessages(sessionId);
    listenForPartyChanges(sessionId);
    listenForSessionChanges(sessionId);
    showNarrationView();
}


async function sendChatMessage(text) {
  if (!text.trim() || !currentSessionId || !currentCharacter) return;
  try {
    await addDoc(collection(db, 'sessions', currentSessionId, 'messages'), {
      from: 'player',
      text: text,
      characterName: currentCharacter.name,
      uid: currentUser.uid,
      createdAt: serverTimestamp()
    });
    inputText.value = '';
    narration.scrollTop = narration.scrollHeight;
  } catch (error) {
    console.error("Erro ao enviar mensagem: ", error);
  }
}

function listenForMessages(sessionId) {
    const messagesRef = collection(db, 'sessions', sessionId, 'messages');
    const q = query(messagesRef, orderBy("createdAt"));
    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        narration.innerHTML = '';
        snapshot.forEach(doc => {
            const message = doc.data();
            const messageClass = message.from === 'mestre' ? 'mestre' : 'player';
            const from = message.from === 'mestre' ? "Mestre" : (message.characterName || "Jogador");
            narration.innerHTML += `<div class="message ${messageClass}"><p class="from">${from}</p><p>${message.text}</p></div>`;
        });
        narration.scrollTop = narration.scrollHeight;
    });
}

function listenForPartyChanges(sessionId) {
    const partyRef = collection(db, 'sessions', sessionId, 'characters');
    partyUnsubscribe = onSnapshot(partyRef, (snapshot) => {
        currentParty = [];
        partyList.innerHTML = '';
        snapshot.forEach(doc => {
            const member = doc.data();
            currentParty.push(member);
            const li = document.createElement('li');
            li.textContent = member.name;
            partyList.appendChild(li);
        });
        partyManagementPanel.style.display = 'block';
        sidePanelDivider.style.display = 'block';
        sidePanelDivider2.style.display = 'block';
    });
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

function updateCharacterSheet(character) {
    if (!character) return;
    characterSheetName.textContent = character.name;
    characterSheetAttributes.innerHTML = '';
    for (const [attr, value] of Object.entries(character.attributes)) {
        const li = document.createElement('li');
        li.innerHTML = `<span class="attr-name">${attr.charAt(0).toUpperCase() + attr.slice(1)}</span><span class="attr-value">${value}</span>`;
        characterSheetAttributes.appendChild(li);
    }
    characterSheet.style.display = 'block';
}

// ===================================================================================
//  5. DICE ROLLING LOGIC
// ===================================================================================

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
//  6. EVENT LISTENERS
// ===================================================================================

btnAuth.addEventListener('click', () => {
    if (currentUser) {
        signOut(auth);
    } else {
        window.location.href = '/login.html';
    }
});

btnNewGame.addEventListener('click', () => {
    if (currentUser) {
        loadSessionList(currentUser.uid);
    } else {
        showSessionSelection();
    }
});

characterList.addEventListener('click', (e) => {
    if (e.target.classList.contains('character-item')) {
        const sessionId = e.target.dataset.sessionId;
        if (sessionId) {
            loadSession(sessionId);
        }
    }
});

btnCreateNewCharacter.addEventListener('click', () => {
  characterCreationModal.style.display = 'flex';
});

let pointsToDistribute = 27;
const attributes = { strength: 8, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8 };

attributesGrid.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    const action = e.target.dataset.action;
    const attribute = e.target.dataset.attribute;
    let currentValue = attributes[attribute];
    if (action === 'increase' && pointsToDistribute > 0 && currentValue < 15) {
        attributes[attribute]++;
        pointsToDistribute--;
    } else if (action === 'decrease' && currentValue > 8) {
        attributes[attribute]--;
        pointsToDistribute++;
    }
    document.getElementById(`attr-${attribute}`).textContent = attributes[attribute];
    pointsToDistributeSpan.textContent = pointsToDistribute;
});

btnSaveCharacter.addEventListener('click', async () => {
    const charName = charNameInput.value.trim();
    if (!charName) {
        alert('Por favor, dê um nome ao seu personagem.');
        return;
    }
    if (!currentUser) {
        alert('Você precisa estar logado para criar um personagem.');
        return;
    }

    try {
        const createAndJoinSession = httpsCallable(functions, 'createAndJoinSession');
        const result = await createAndJoinSession({ characterName: charName, attributes: attributes });
        const { sessionId } = result.data;
        
        characterCreationModal.style.display = 'none';
        await loadSession(sessionId);

    } catch (error) {
        console.error("Erro ao salvar personagem e criar sessão: ", error);
        alert(`Erro ao criar sessão: ${error.message}`);
    }
});

btnInvitePlayer.addEventListener('click', () => {
  inviteModal.style.display = 'flex';
});

btnCancelInvite.addEventListener('click', () => {
  inviteModal.style.display = 'none';
  inviteEmailInput.value = '';
});

btnSendInvite.addEventListener('click', async () => {
    const email = inviteEmailInput.value.trim();
    if (!email) return alert('Digite um e-mail.');
    
    const invitePlayer = httpsCallable(functions, 'invitePlayer');
    try {
        const result = await invitePlayer({ email: email, sessionId: currentSessionId });
        alert(result.data.message);
        inviteModal.style.display = 'none';
        inviteEmailInput.value = '';
    } catch (error) {
        console.error("Erro ao convidar jogador:", error);
        alert(`Erro: ${error.message}`);
    }
});

btnSend.addEventListener('click', () => sendChatMessage(inputText.value));
inputText.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage(inputText.value);
  }
});

diceRoller.addEventListener('click', async (e) => {
    if (e.target.matches('.btn[data-d]') && !isDiceRolling) {
        if (!currentSessionId || !currentCharacter) return;
        const dieType = parseInt(e.target.dataset.d);
        const result = Math.floor(Math.random() * dieType) + 1;
        localRollData = { name: currentCharacter.name, type: dieType, result: result };
        const diceRollPayload = { rollerName: currentCharacter.name, dieType: dieType, result: result, timestamp: serverTimestamp() };
        await updateDoc(doc(db, 'sessions', currentSessionId), { latestDiceRoll: diceRollPayload });
    }
});

d20Animation.addEventListener('animationend', async () => {
    diceAnimationOverlay.classList.remove('visible');
    d20Animation.classList.remove('rolling');
    if (localRollData) {
        const { name, type, result } = localRollData;
        const message = `${name} rolou um d${type} e tirou: **${result}**`;
        await sendChatMessage(message);
        localRollData = null;
    }
    setTimeout(() => { 
        diceAnimationOverlay.style.display = 'none';
        isDiceRolling = false;
    }, 300);
});

// ===================================================================================
//  7. APP INITIALIZATION & AUTHENTICATION (REFACTORED)
// ===================================================================================

// Função centralizada para lidar com o estado de autenticação
const handleAuthState = async (user) => {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionIdFromUrl = urlParams.get('sessionId');
    
    // Limpa a URL para evitar loops de recarregamento ou re-entrada na sessão.
    if (sessionIdFromUrl) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (user) {
        // --- USUÁRIO LOGADO ---
        currentUser = user;
        username.textContent = user.displayName || user.email;
        btnAuth.textContent = 'Sair';

        if (sessionIdFromUrl) {
            // Se o usuário veio de um link de convite, tenta entrar na sessão
            try {
                const joinSession = httpsCallable(functions, 'joinSessionFromInvite');
                await joinSession({ sessionId: sessionIdFromUrl });
                await loadSession(sessionIdFromUrl);
            } catch (error) {
                console.error('Falha ao entrar na sessão via convite:', error);
                alert(`Erro ao entrar na sessão: ${error.message}. Carregando sua lista de personagens.`);
                await loadSessionList(user.uid); // Se falhar, carrega a lista normal
            }
        } else {
            // Se for um login normal, apenas carrega a lista de personagens
            await loadSessionList(user.uid);
        }
    } else {
        // --- USUÁRIO DESLOGADO ---
        currentUser = null;
        currentCharacter = null;
        currentSessionId = null;
        if(messagesUnsubscribe) messagesUnsubscribe();
        if(partyUnsubscribe) partyUnsubscribe();
        if(sessionUnsubscribe) sessionUnsubscribe();

        username.textContent = 'Visitante'; // Correção de sintaxe aqui
        btnAuth.textContent = 'Login';
        showSessionSelection();
        characterList.innerHTML = '<p id="no-characters-message">Faça login para ver seus personagens.</p>';
    }
};

// Função de inicialização principal
const initializeApp = () => {
    const url = window.location.href;

    // 1. Verifica se a URL é um link de login
    if (isSignInWithEmailLink(auth, url)) {
        let email = window.localStorage.getItem('emailForSignIn');
        if (!email) {
            email = window.prompt('Por favor, confirme seu e-mail para completar o login.');
        }
        
        if (email) {
            signInWithEmailLink(auth, email, url)
                .then((result) => {
                    window.localStorage.removeItem('emailForSignIn');
                    // O onAuthStateChanged será acionado automaticamente após o login
                    // e a função handleAuthState cuidará de todo o fluxo.
                })
                .catch((error) => {
                    console.error("Erro ao logar com link:", error);
                    alert("Falha ao fazer login. O link pode ter expirado ou o e-mail está incorreto.");
                    window.localStorage.removeItem('emailForSignIn');
                    // Mesmo com erro, ativa o listener para tratar o estado de deslogado.
                    onAuthStateChanged(auth, handleAuthState);
                });
        }
    } else {
        // 2. Se não for um link de login, apenas configura o observador de autenticação.
        // onAuthStateChanged irá lidar com o usuário logado ou deslogado.
        onAuthStateChanged(auth, handleAuthState);
    }
};

// Inicia o aplicativo
initializeApp();
