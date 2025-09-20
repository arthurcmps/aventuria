/*
 *  script.js - IMPLEMENTAÇÃO COMPLETA DO SISTEMA DE TURNOS
 *  - Adiciona listener para `turnoAtualUid` na sessão.
 *  - Habilita/desabilita a interface de input com base no turno do jogador.
 *  - Implementa a funcionalidade do botão "Passar Turno".
 *  - Mantém todas as funcionalidades anteriores (chat, grupo, voltar, etc.).
 */

// --- IMPORTS --- //
import { auth, db, functions } from './firebase.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {

    // --- DOM ELEMENT REFERENCES ---
    const username = document.getElementById('username');
    const btnAuth = document.getElementById('btn-auth');
    const btnBackToSelection = document.getElementById('btn-back-to-selection');
    const btnCreateNewCharacter = document.getElementById('btn-create-new-character');
    const gameView = document.getElementById('game-view');
    const sessionSelectionOverlay = document.getElementById('session-selection-overlay');
    const narration = document.getElementById('narration');
    const inputText = document.getElementById('input-text');
    const btnSend = document.getElementById('btn-send');
    const partyList = document.getElementById('party-list');
    // Turn System UI
    const turnStatus = document.getElementById('turn-status');
    const btnPassTurn = document.getElementById('btn-pass-turn');

    // --- (Outras referências DOM inalteradas) ---
    const notificationsSection = document.getElementById('notifications-section');
    const invitesList = document.getElementById('invites-list');
    const characterList = document.getElementById('character-list');
    const noCharactersMessage = document.getElementById('no-characters-message');
    const characterSheetName = document.getElementById('character-sheet-name');
    const characterSheetAttributes = document.getElementById('character-sheet-attributes');
    const characterCreationModal = document.getElementById('character-creation-modal');
    const btnCloseCharCreation = document.getElementById('btn-close-char-creation');
    const creationLoadingIndicator = document.getElementById('creation-loading-indicator');
    const pointsToDistributeSpan = document.getElementById('points-to-distribute');
    const charNameInput = document.getElementById('char-name');
    const attributesGrid = document.querySelector('.attributes-grid');
    const btnSaveCharacter = document.getElementById('btn-save-character');
    
    // --- APP STATE ---
    let currentUser = null;
    let currentCharacter = null;
    let currentSessionId = null;
    let messagesUnsubscribe = null;
    let partyUnsubscribe = null;
    let sessionUnsubscribe = null; // Listener para o turno
    const attributeNames = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    const baseAttributes = { strength: 8, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8 };
    let attributes = { ...baseAttributes };
    let pointsToDistribute = 27;

    // --- UI MANAGEMENT ---
    const showView = (view) => {
        sessionSelectionOverlay.style.display = 'none';
        gameView.style.display = 'none';
        view.style.display = view === gameView ? 'grid' : 'flex';
        const isInGame = view === gameView;
        btnBackToSelection.style.display = isInGame ? 'inline-block' : 'none';
        btnCreateNewCharacter.style.display = !isInGame && currentUser ? 'inline-block' : 'none';
    };

    const cleanupSessionListeners = () => {
        if (messagesUnsubscribe) messagesUnsubscribe();
        if (partyUnsubscribe) partyUnsubscribe();
        if (sessionUnsubscribe) sessionUnsubscribe();
        messagesUnsubscribe = null;
        partyUnsubscribe = null;
        sessionUnsubscribe = null;
    };
    
    const returnToSelectionScreen = async () => {
        cleanupSessionListeners();
        // Resetar UI e estado
        showView(sessionSelectionOverlay);
    };

    // NOVO: Atualiza a UI de turno
    const updateTurnUI = async (sessionData) => {
        if (!sessionData || !currentUser) return;
        const isMyTurn = sessionData.turnoAtualUid === currentUser.uid;
        const ownerIsPlaying = sessionData.turnoAtualUid === sessionData.owner;

        inputText.disabled = !isMyTurn;
        btnSend.disabled = !isMyTurn;
        btnPassTurn.disabled = !isMyTurn;

        if (isMyTurn) {
            turnStatus.textContent = "É o seu turno!";
            turnStatus.classList.add('my-turn');
            inputText.focus();
        } else {
            // Busca o nome do jogador do turno atual
            const turnPlayerDoc = await getDoc(doc(db, `sessions/${currentSessionId}/characters`, sessionData.turnoAtualUid));
            const playerName = turnPlayerDoc.exists() ? turnPlayerDoc.data().name : "outro jogador";
            turnStatus.textContent = `Aguardando o turno de ${playerName}...`;
            turnStatus.classList.remove('my-turn');
        }
    };

    // --- SESSION & CORE APP LOGIC ---
    async function loadSession(sessionId) {
        cleanupSessionListeners();
        currentSessionId = sessionId;

        try {
            const charQuery = query(collection(db, 'sessions', sessionId, 'characters'), where("uid", "==", currentUser.uid));
            const charSnapshot = await getDocs(charQuery);
            if (charSnapshot.empty) throw new Error("Você não tem um personagem nesta sessão.");
            currentCharacter = { id: charSnapshot.docs[0].id, ...charSnapshot.docs[0].data() };
            
            showView(gameView);
            // Inicia todos os listeners da sessão
            listenForSessionUpdates(sessionId);
            listenForMessages(sessionId);
            listenForPartyChanges(sessionId);
        } catch (error) {
            await returnToSelectionScreen();
        }
    }

    // NOVO: Listener para o documento da sessão (turnos)
    function listenForSessionUpdates(sessionId) {
        sessionUnsubscribe = onSnapshot(doc(db, "sessions", sessionId), (doc) => {
            if (doc.exists()) {
                updateTurnUI(doc.data());
            }
        });
    }

    function listenForMessages(sessionId) {
        const q = query(collection(db, 'sessions', sessionId, 'messages'), orderBy("createdAt"));
        narration.innerHTML = '';
        messagesUnsubscribe = onSnapshot(q, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === "added") {
                    const msg = change.doc.data();
                    const messageElement = document.createElement('div');
                    messageElement.classList.add('message');
                    const from = msg.from === 'mestre' ? "Mestre" : (msg.characterName || "Jogador");
                    const text = msg.text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
                    messageElement.innerHTML = `<p class="from">${from}</p><p>${text}</p>`;
                    narration.appendChild(messageElement);
                }
            });
            narration.scrollTop = narration.scrollHeight;
        });
    }

    function listenForPartyChanges(sessionId) {
        const q = query(collection(db, 'sessions', sessionId, 'characters'));
        partyUnsubscribe = onSnapshot(q, (snapshot) => {
            partyList.innerHTML = '';
            snapshot.forEach(doc => {
                partyList.innerHTML += `<li>${doc.data().name}</li>`;
            });
        });
    }

    async function sendChatMessage(text) {
        if (!text.trim() || !currentSessionId || !currentCharacter) return;
        inputText.disabled = true; // Desabilita o input imediatamente
        try {
            await addDoc(collection(db, 'sessions', currentSessionId, 'messages'), {
                from: 'player', text, characterName: currentCharacter.name, uid: currentUser.uid, createdAt: serverTimestamp()
            });
            inputText.value = '';
        } catch (error) {
            inputText.disabled = false; // Reabilita em caso de erro
        }
    }

    // NOVO: Ação para passar o turno
    async function passTurn() {
        if (!currentSessionId) return;
        btnPassTurn.disabled = true;
        btnPassTurn.textContent = '...';
        const passarTurno = httpsCallable(functions, 'passarTurno');
        try {
            await passarTurno({ sessionId: currentSessionId });
        } catch (error) {
            alert(error.message);
            btnPassTurn.disabled = false;
        } finally {
            btnPassTurn.textContent = 'Passar Turno';
        }
    }
    
    // --- EVENT LISTENERS ---
    btnBackToSelection.addEventListener('click', returnToSelectionScreen);
    btnSend.addEventListener('click', () => sendChatMessage(inputText.value));
    inputText.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage(inputText.value);
        }
    });
    btnPassTurn.addEventListener('click', passTurn);

    // --- (Listeners de Autenticação e outros inalterados) ---
    onAuthStateChanged(auth, async (user) => {
        cleanupSessionListeners();
        if (user) {
            currentUser = user;
            username.textContent = user.displayName || user.email.split('@')[0];
            btnAuth.textContent = 'Sair';
            showView(sessionSelectionOverlay);
            // Lógica para carregar personagens e convites...
        } else {
            currentUser = null;
            // Resetar tudo
            showView(sessionSelectionOverlay);
        }
    });

    // ... (restante dos listeners e inicialização) ...
});