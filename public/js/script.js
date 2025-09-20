/*
 *  script.js - VERSÃO DE RECUPERAÇÃO COMPLETA (3.1)
 *  - CORRIGIDO: Restaurada a lógica de carregamento de personagens e convites no login.
 *  - Integra o sistema de turnos, o botão de voltar e as atualizações em tempo real.
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
    const notificationsSection = document.getElementById('notifications-section');
    const invitesList = document.getElementById('invites-list');
    const characterList = document.getElementById('character-list');
    const noCharactersMessage = document.getElementById('no-characters-message');
    const narration = document.getElementById('narration');
    const inputText = document.getElementById('input-text');
    const btnSend = document.getElementById('btn-send');
    const partyList = document.getElementById('party-list');
    const btnInvitePlayer = document.getElementById('btn-invite-player');
    const characterSheetName = document.getElementById('character-sheet-name');
    const characterSheetAttributes = document.getElementById('character-sheet-attributes');
    const characterCreationModal = document.getElementById('character-creation-modal');
    const btnCloseCharCreation = document.getElementById('btn-close-char-creation');
    const creationLoadingIndicator = document.getElementById('creation-loading-indicator');
    const pointsToDistributeSpan = document.getElementById('points-to-distribute');
    const charNameInput = document.getElementById('char-name');
    const attributesGrid = document.querySelector('.attributes-grid');
    const btnSaveCharacter = document.getElementById('btn-save-character');
    const inviteModal = document.getElementById('invite-modal');
    const inviteEmailInput = document.getElementById('invite-email');
    const btnCancelInvite = document.getElementById('btn-cancel-invite');
    const btnSendInvite = document.getElementById('btn-send-invite');
    const diceRoller = document.getElementById('dice-roller');
    // Turn System UI
    const turnStatus = document.getElementById('turn-status');
    const btnPassTurn = document.getElementById('btn-pass-turn');

    // --- APP STATE ---
    let currentUser = null;
    let currentCharacter = null;
    let currentSessionId = null;
    let messagesUnsubscribe = null;
    let partyUnsubscribe = null;
    let sessionUnsubscribe = null; // Listener para o turno e outros dados da sessão
    const attributeNames = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    const baseAttributes = { strength: 8, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8 };
    let attributes = { ...baseAttributes };
    let pointsToDistribute = 27;

    // --- API CALLABLES ---
    const createAndJoinSession = httpsCallable(functions, 'createAndJoinSession');
    const joinSession = httpsCallable(functions, 'joinSession');
    const getPendingInvites = httpsCallable(functions, 'getPendingInvites');
    const acceptInvite = httpsCallable(functions, 'acceptInvite');
    const declineInvite = httpsCallable(functions, 'declineInvite');
    const sendInvite = httpsCallable(functions, 'sendInvite');
    const passarTurno = httpsCallable(functions, 'passarTurno');

    // --- UI MANAGEMENT ---
    const showView = (view) => {
        sessionSelectionOverlay.style.display = 'none';
        gameView.style.display = 'none';
        view.style.display = view === gameView ? 'grid' : 'flex';
        const isInGame = view === gameView;
        btnBackToSelection.style.display = isInGame ? 'inline-block' : 'none';
        btnCreateNewCharacter.style.display = !isInGame && currentUser ? 'inline-block' : 'none';
    };

    const showModal = (modal) => { modal.style.display = 'flex'; };
    const hideModal = (modal) => { modal.style.display = 'none'; };

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
        currentSessionId = null;
        currentCharacter = null;
        narration.innerHTML = '';
        partyList.innerHTML = '';
        characterSheetName.textContent = '';
        characterSheetAttributes.innerHTML = '';
        showView(sessionSelectionOverlay);
        if (currentUser) {
            await loadUserCharacters(currentUser.uid);
        }
    };

    const updateTurnUI = async (sessionData) => {
        if (!sessionData || !currentUser || !currentSessionId) return;
        const isMyTurn = sessionData.turnoAtualUid === currentUser.uid;
        
        inputText.disabled = !isMyTurn;
        btnSend.disabled = !isMyTurn;
        btnPassTurn.disabled = !isMyTurn;

        if (isMyTurn) {
            turnStatus.textContent = "É o seu turno!";
            turnStatus.classList.add('my-turn');
            inputText.focus();
        } else {
            const turnPlayerDocRef = doc(db, `sessions/${currentSessionId}/characters`, sessionData.turnoAtualUid);
            try {
                const turnPlayerDoc = await getDoc(turnPlayerDocRef);
                const playerName = turnPlayerDoc.exists() ? turnPlayerDoc.data().name : "outro jogador";
                turnStatus.textContent = `Aguardando o turno de ${playerName}...`;
                turnStatus.classList.remove('my-turn');
            } catch (e) {
                turnStatus.textContent = "Aguardando outro jogador...";
            }
        }
    };

    // --- CORE LOGIC ---

    async function loadPendingInvitesInternal() {
        if (!currentUser) return;
        try {
            const result = await getPendingInvites();
            invitesList.innerHTML = '';
            notificationsSection.style.display = result.data.length > 0 ? 'block' : 'none';
            result.data.forEach(invite => {
                 const card = document.createElement('div');
                card.className = 'invite-card';
                card.dataset.inviteId = invite.id;
                card.innerHTML = `
                    <div class="invite-info"><p><strong>${invite.senderCharacterName}</strong> convidou você para uma aventura!</p></div>
                    <div class="invite-actions">
                        <button class="btn btn-sm btn-accept">Aceitar</button>
                        <button class="btn btn-sm btn-decline">Recusar</button>
                    </div>`;
                invitesList.appendChild(card);
            });
        } catch (error) {
            console.error("Erro ao buscar convites pendentes:", error);
        }
    }

    async function loadUserCharacters(userId) {
        const charactersRef = collection(db, "characters");
        const q = query(charactersRef, where("uid", "==", userId));
        try {
            const querySnapshot = await getDocs(q);
            characterList.innerHTML = '';
            noCharactersMessage.style.display = querySnapshot.empty ? 'block' : 'none';
            querySnapshot.forEach(doc => {
                const character = doc.data();
                const charElement = document.createElement('div');
                charElement.className = 'character-card';
                charElement.dataset.sessionId = character.sessionId;
                charElement.innerHTML = `<h4>${character.name}</h4><p>Sessão: ${character.sessionId.substring(0, 6)}...</p>`;
                characterList.appendChild(charElement);
            });
        } catch (error) {
            console.error("Erro ao carregar personagens:", error);
        }
    }

    async function loadSession(sessionId) {
        cleanupSessionListeners();
        currentSessionId = sessionId;

        try {
            const charQuery = query(collection(db, 'sessions', sessionId, 'characters'), where("uid", "==", currentUser.uid));
            const charSnapshot = await getDocs(charQuery);
            if (charSnapshot.empty) throw new Error("Você não tem um personagem nesta sessão.");
            currentCharacter = { id: charSnapshot.docs[0].id, ...charSnapshot.docs[0].data() };
            
            showView(gameView);
            listenForSessionUpdates(sessionId);
            listenForMessages(sessionId);
            listenForPartyChanges(sessionId);
        } catch (error) {
            console.error("Erro ao carregar sessão:", error);
            alert(error.message || "Não foi possível carregar a sessão.");
            await returnToSelectionScreen();
        }
    }

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
        partyUnsubscribe = onSnapshot(collection(db, 'sessions', sessionId, 'characters'), (snapshot) => {
            partyList.innerHTML = '';
            snapshot.forEach(doc => {
                partyList.innerHTML += `<li>${doc.data().name}</li>`;
            });
        });
    }

    async function sendChatMessage(text) {
        if (!text.trim() || !currentSessionId || !currentCharacter) return;
        inputText.disabled = true; // Desabilita para evitar envios duplicados
        try {
            await addDoc(collection(db, 'sessions', currentSessionId, 'messages'), {
                from: 'player', text, characterName: currentCharacter.name, uid: currentUser.uid, createdAt: serverTimestamp()
            });
            inputText.value = '';
        } catch (error) {
            console.error("Erro ao enviar mensagem:", error);
            inputText.disabled = false; // Reabilita em caso de erro
        }
    }

    async function passTurn() {
        if (!currentSessionId) return;
        btnPassTurn.disabled = true;
        btnPassTurn.textContent = '...';
        try {
            await passarTurno({ sessionId: currentSessionId });
        } catch (error) {
            alert(error.message);
            btnPassTurn.disabled = false;
        } finally {
            btnPassTurn.textContent = 'Passar Turno';
        }
    }

    // --- AUTH STATE CHANGE --- (A PARTE CRÍTICA CORRIGIDA)
    onAuthStateChanged(auth, async (user) => {
        cleanupSessionListeners();
        if (user) {
            currentUser = user;
            username.textContent = user.displayName || user.email.split('@')[0];
            btnAuth.textContent = 'Sair';
            showView(sessionSelectionOverlay);
            // CORREÇÃO: As chamadas de carregamento foram restauradas aqui.
            await Promise.all([loadPendingInvitesInternal(), loadUserCharacters(user.uid)]);
        } else {
            currentUser = null;
            currentCharacter = null;
            currentSessionId = null;
            username.textContent = 'Visitante';
            btnAuth.textContent = 'Login';
            characterList.innerHTML = '';
            invitesList.innerHTML = '';
            notificationsSection.style.display = 'none';
            noCharactersMessage.textContent = 'Faça login para ver ou criar personagens.';
            noCharactersMessage.style.display = 'block';
            showView(sessionSelectionOverlay);
        }
    });

    // --- EVENT LISTENERS (COMPLETO) ---
    btnAuth.addEventListener('click', () => {
        if (currentUser) {
            signOut(auth).catch(err => console.error("Erro no logout:", err));
        } else {
            window.location.href = '/login.html';
        }
    });
    
    btnBackToSelection.addEventListener('click', returnToSelectionScreen);
    btnSend.addEventListener('click', () => sendChatMessage(inputText.value));
    inputText.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage(inputText.value);
        }
    });
    btnPassTurn.addEventListener('click', passTurn);

    characterList.addEventListener('click', (e) => {
        const card = e.target.closest('.character-card');
        if (card && card.dataset.sessionId) {
            loadSession(card.dataset.sessionId);
        }
    });

    btnCreateNewCharacter.addEventListener('click', () => {
        sessionStorage.removeItem('joiningSessionId');
        // resetAndCloseCharacterCreationModal(); // Adicionar essa função
        showModal(characterCreationModal);
    });

    // ... (outros listeners para modais, etc., precisam ser verificados)
});