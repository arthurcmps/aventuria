/*
 *  public/js/script.js (VERSÃO RESPONSIVA CORRIGIDA)
 */

// --- IMPORTS ---
import { auth, db, functions } from './firebase.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js";
import { onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {

    // --- REFERÊNCIAS DO DOM ---
    const btnMenu = document.getElementById('btn-menu');
    const sidePanel = document.getElementById('side-panel');
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
    const diceRoller = document.getElementById('dice-roller');
    const characterCreationModal = document.getElementById('character-creation-modal');
    const btnCloseCharCreation = document.getElementById('btn-close-char-creation');
    const inviteModal = document.getElementById('invite-modal');
    const btnCancelInvite = document.getElementById('btn-cancel-invite');
    const btnSendInvite = document.getElementById('btn-send-invite');
    const creationLoadingIndicator = document.getElementById('creation-loading-indicator');
    const pointsToDistributeSpan = document.getElementById('points-to-distribute');
    const charNameInput = document.getElementById('char-name');
    const attributesGrid = document.querySelector('.attributes-grid');
    const btnSaveCharacter = document.getElementById('btn-save-character');
    const inviteEmailInput = document.getElementById('invite-email');
    const turnStatus = document.getElementById('turn-status');
    const btnPassTurn = document.getElementById('btn-pass-turn');

    // --- ESTADO DA APLICAÇÃO ---
    let currentUser = null;
    let currentCharacter = null;
    let currentSessionId = null;
    let messagesUnsubscribe = null;
    let partyUnsubscribe = null;
    let sessionUnsubscribe = null;
    const AI_UID = 'master-ai';
    const attributeNames = ['Força', 'Destreza', 'Constituição', 'Inteligência', 'Sabedoria', 'Carisma'];
    const attributeKeys = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    let attributes = {};
    let pointsToDistribute = 27;

    // --- FUNÇÕES CLOUD CALLABLE ---
    const createAndJoinSession = httpsCallable(functions, 'createAndJoinSession');
    const joinSession = httpsCallable(functions, 'joinSession');
    const getPendingInvites = httpsCallable(functions, 'getPendingInvites');
    const acceptInvite = httpsCallable(functions, 'acceptInvite');
    const declineInvite = httpsCallable(functions, 'declineInvite');
    const sendInvite = httpsCallable(functions, 'sendInvite');
    const passarTurno = httpsCallable(functions, 'passarTurno');

    // --- GERENCIAMENTO DE UI ---
    const showView = (view) => {
        sessionSelectionOverlay.style.display = 'none';
        gameView.style.display = 'none';
        gameView.classList.remove('in-game');

        view.style.display = view === gameView ? 'grid' : 'flex';
        const isInGame = view === gameView;
        if (isInGame) {
            gameView.classList.add('in-game');
        }

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
        gameView.classList.remove('in-game'); // Garante que a classe seja removida
        showView(sessionSelectionOverlay);
        if (currentUser) {
            await loadUserCharacters(currentUser.uid);
            await loadPendingInvitesInternal(); 
        }
    };

    const updateTurnUI = async (sessionData) => {
        if (!sessionData || !currentUser || !currentSessionId) return;
        const turnoAtualUid = sessionData.turnoAtualUid;
        const isMyTurn = turnoAtualUid === currentUser.uid;
        
        inputText.disabled = !isMyTurn;
        btnSend.disabled = !isMyTurn;
        btnPassTurn.disabled = !isMyTurn;

        if (isMyTurn) {
            turnStatus.textContent = "É o seu turno!";
            turnStatus.classList.add('my-turn');
        } else if (turnoAtualUid === AI_UID) {
            turnStatus.textContent = "O Mestre está agindo...";
            turnStatus.classList.remove('my-turn');
        } else {
            try {
                const turnPlayerDocRef = doc(db, `sessions/${currentSessionId}/characters`, turnoAtualUid);
                const turnPlayerDoc = await getDoc(turnPlayerDocRef);
                const playerName = turnPlayerDoc.exists() ? turnPlayerDoc.data().name : "outro jogador";
                turnStatus.textContent = `Aguardando o turno de ${playerName}...`;
                turnStatus.classList.remove('my-turn');
            } catch (e) {
                turnStatus.textContent = "Aguardando outro jogador...";
            }
        }
    };

    // --- LÓGICA PRINCIPAL ---

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
                    <div class="invite-info"><p><strong>${invite.senderCharacterName}</strong> convidou você para a aventura <strong>${invite.sessionId.substring(0, 6)}</strong>!</p></div>
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
            if (charSnapshot.empty) {
                throw new Error("Você não tem um personagem nesta sessão. Aceite o convite e crie um.");
            }
            currentCharacter = { id: charSnapshot.docs[0].id, ...charSnapshot.docs[0].data() };
            
            characterSheetName.textContent = currentCharacter.name;
            characterSheetAttributes.innerHTML = '';
            attributeKeys.forEach(key => {
                const attrName = key.charAt(0).toUpperCase() + key.slice(1);
                const li = document.createElement('li');
                li.innerHTML = `<span class="attr-name">${attrName}</span> <span class="attr-value">${currentCharacter.attributes[key] || 10}</span>`;
                characterSheetAttributes.appendChild(li);
            });

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
      messagesUnsubscribe = onSnapshot(q, (snapshot) => {
          narration.innerHTML = '';
          snapshot.docs.forEach(doc => {
              const msg = doc.data();
              const messageElement = document.createElement('div');
              messageElement.classList.add('message');
              const from = msg.from === 'mestre' ? "Mestre" : (msg.characterName || "Jogador");
              const text = msg.text
                  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                  .replace(/\*([^*]+)\*/g, '<em>$1</em>');
              messageElement.innerHTML = `<p class="from">${from}</p><p>${text}</p>`;
              if (msg.isTurnoUpdate) messageElement.classList.add('system-message');
              narration.appendChild(messageElement);
          });
          narration.scrollTop = narration.scrollHeight;
      });
  }

  function listenForPartyChanges(sessionId) {
      const partyQuery = collection(db, 'sessions', sessionId, 'characters');
      partyUnsubscribe = onSnapshot(partyQuery, (snapshot) => {
          partyList.innerHTML = '';
          snapshot.docs.forEach(doc => {
              const character = doc.data();
              if (character.uid !== AI_UID) {
                 partyList.innerHTML += `<li>${character.name}</li>`;
              }
          });
      });
  }

    async function sendChatMessage(text) {
        if (!text.trim() || !currentSessionId || !currentCharacter) return;
        inputText.disabled = true;
        btnSend.disabled = true;
        try {
            await addDoc(collection(db, 'sessions', currentSessionId, 'messages'), {
                from: 'player', text, characterName: currentCharacter.name, uid: currentUser.uid, createdAt: serverTimestamp()
            });
            inputText.value = '';
        } catch (error) {
            console.error("Erro ao enviar mensagem:", error);
            inputText.disabled = false; 
            btnSend.disabled = false;
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
    
    onAuthStateChanged(auth, async (user) => {
        cleanupSessionListeners();
        gameView.classList.remove('in-game');
        if (user) {
            currentUser = user;
            username.textContent = user.displayName || user.email.split('@')[0];
            btnAuth.textContent = 'Sair';
            noCharactersMessage.textContent = 'Você ainda não tem personagens.';
            showView(sessionSelectionOverlay);
            await Promise.all([loadUserCharacters(user.uid), loadPendingInvitesInternal()]);
        } else {
            currentUser = null; currentCharacter = null; currentSessionId = null;
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

    // --- LISTENERS DE EVENTOS ---

    btnMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        sidePanel.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        const isClickInsidePanel = sidePanel.contains(e.target);
        const isClickOnMenuButton = btnMenu.contains(e.target);
        if (sidePanel.classList.contains('open') && !isClickInsidePanel && !isClickOnMenuButton) {
            sidePanel.classList.remove('open');
        }
    });

// Em script.js

/* SUBSTITUA O BLOCO ANTIGO POR ESTE NOVO BLOCO */
btnAuth.addEventListener('click', () => {
    if (currentUser) {
        // Se o usuário está logado, o botão funciona como "Sair"
        signOut(auth).catch(err => console.error("Erro no logout:", err));
    } else {
        // Se não há usuário, o botão abre o pop-up de login do Google
        const provider = new GoogleAuthProvider();
        signInWithPopup(auth, provider)
            .catch((error) => {
                // Se o usuário fechar o pop-up ou houver um erro, ele será mostrado no console.
                console.error("Erro na autenticação com pop-up:", error);
            });
    }
});
    
    btnBackToSelection.addEventListener('click', returnToSelectionScreen);
    btnSend.addEventListener('click', () => sendChatMessage(inputText.value));
    inputText.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(inputText.value); }
    });
    btnPassTurn.addEventListener('click', passTurn);

    characterList.addEventListener('click', (e) => {
        const card = e.target.closest('.character-card');
        if (card && card.dataset.sessionId) { loadSession(card.dataset.sessionId); }
    });

    invitesList.addEventListener('click', async (e) => {
        const button = e.target;
        const card = button.closest('.invite-card');
        if (!card) return;
        const inviteId = card.dataset.inviteId;
        button.disabled = true;
        try {
            if (button.classList.contains('btn-accept')) {
                const result = await acceptInvite({ inviteId });
                sessionStorage.setItem('joiningSessionId', result.data.sessionId);
                resetAndOpenCharacterCreationModal();
            } else if (button.classList.contains('btn-decline')) {
                await declineInvite({ inviteId });
                card.remove();
            }
        } catch (error) {
            console.error("Erro ao responder convite:", error);
            alert(error.message);
            button.disabled = false;
        }
    });

    function resetAndOpenCharacterCreationModal() {
        hideModal(inviteModal);
        charNameInput.value = '';
        pointsToDistribute = 27;
        attributes = { strength: 8, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8 };
        updateCreationUI();
        creationLoadingIndicator.style.display = 'none';
        btnSaveCharacter.style.display = 'block';
        charNameInput.disabled = false;
        showModal(characterCreationModal);
    }

    btnCreateNewCharacter.addEventListener('click', () => {
        sessionStorage.removeItem('joiningSessionId');
        resetAndOpenCharacterCreationModal();
    });

    btnCloseCharCreation.addEventListener('click', () => hideModal(characterCreationModal));
    
    btnSaveCharacter.addEventListener('click', async () => {
        const charName = charNameInput.value.trim();
        if (charName.length < 3) {
            alert('O nome do personagem deve ter pelo menos 3 caracteres.');
            return;
        }
        if (pointsToDistribute > 0) {
            alert('Você ainda tem pontos para distribuir!');
            return;
        }

        creationLoadingIndicator.style.display = 'flex';
        btnSaveCharacter.style.display = 'none';
        charNameInput.disabled = true;

        try {
            const joiningSessionId = sessionStorage.getItem('joiningSessionId');
            let result;
            if (joiningSessionId) {
                result = await joinSession({ sessionId: joiningSessionId, characterName: charName, attributes: attributes });
                sessionStorage.removeItem('joiningSessionId');
                hideModal(characterCreationModal);
                await returnToSelectionScreen();
                alert(`${charName} foi criado e adicionado à sessão!`);
            } else {
                result = await createAndJoinSession({ characterName: charName, attributes: attributes });
                await loadSession(result.data.sessionId);
                hideModal(characterCreationModal);
            }
        } catch (error) {
            alert(`Erro: ${error.message}`);
            creationLoadingIndicator.style.display = 'none';
            btnSaveCharacter.style.display = 'block';
            charNameInput.disabled = false;
        }
    });

    function updateCreationUI() {
        pointsToDistributeSpan.textContent = pointsToDistribute;
        attributesGrid.innerHTML = '';
        attributeKeys.forEach((key, index) => {
            const value = attributes[key];
            const cost = value < 13 ? 1 : 2;
            const div = document.createElement('div');
            div.className = 'attribute-item';
            div.innerHTML = `
                <span>${attributeNames[index]}</span>
                <div class="attribute-controls">
                    <button class="btn-attr" data-attr="${key}" data-op="-" ${value <= 8 ? 'disabled' : ''}>-</button>
                    <span class="attr-value">${value}</span>
                    <button class="btn-attr" data-attr="${key}" data-op="+" ${pointsToDistribute < cost || value >= 15 ? 'disabled' : ''}>+</button>
                </div>
            `;
            attributesGrid.appendChild(div);
        });
    }

    attributesGrid.addEventListener('click', (e) => {
        if (!e.target.matches('.btn-attr')) return;
        const button = e.target;
        const attrKey = button.dataset.attr;
        const operation = button.dataset.op;
        let currentValue = attributes[attrKey];

        if (operation === '+') {
            const cost = currentValue < 13 ? 1 : 2;
            if (pointsToDistribute >= cost && currentValue < 15) {
                attributes[attrKey]++;
                pointsToDistribute -= cost;
            }
        } else if (operation === '-') {
            if (currentValue > 8) {
                const costToRefund = currentValue <= 13 ? 1 : 2;
                attributes[attrKey]--;
                pointsToDistribute += costToRefund;
            }
        }
        updateCreationUI();
    });
    
    updateCreationUI();

    btnInvitePlayer.addEventListener('click', () => {
        if (!currentSessionId) {
            alert("Você precisa estar em uma sessão para convidar jogadores.");
            return;
        }
        inviteEmailInput.value = '';
        showModal(inviteModal);
    });

    btnCancelInvite.addEventListener('click', () => hideModal(inviteModal));

    btnSendInvite.addEventListener('click', async () => {
        const email = inviteEmailInput.value.trim();
        if (!email.includes('@')) {
            alert('Por favor, insira um e-mail válido.');
            return;
        }
        btnSendInvite.disabled = true;
        btnSendInvite.textContent = 'Enviando...';
        try {
            const result = await sendInvite({ email, sessionId: currentSessionId });
            alert(result.data.message);
            hideModal(inviteModal);
        } catch (error) {
            alert(`Erro: ${error.message}`);
        } finally {
            btnSendInvite.disabled = false;
            btnSendInvite.textContent = 'Enviar Convite';
        }
    });

    diceRoller.addEventListener('click', async e => {
        if (e.target.matches('[data-d]')) {
            if (!currentSessionId || !currentCharacter) return;
            const die = e.target.dataset.d;
            const roll = Math.floor(Math.random() * parseInt(die)) + 1;
            const text = `rolou 1d${die} e tirou **${roll}**`;
            await sendChatMessage(text);
        }
    });
});
