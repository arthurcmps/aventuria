
/*
 *  public/js/script.js (VERSÃO COM INTERFACE ACORDEÃO)
 *  - Adicionada estrutura de dados `attributeDetails` com sub-atributos e descrições.
 *  - `updateCreationUI` foi reescrita para gerar um menu sanfona (acordeão).
 *  - Adicionado um novo listener de eventos para o acordeão que controla a abertura/fechamento dos painéis e a distribuição de pontos.
 */

// --- IMPORTS ---
import { auth, db, functions } from './firebase.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, where
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {

    // --- REFERÊNCIAS DO DOM ---
    const pageContent = document.getElementById('page-content');
    const loadingOverlay = document.getElementById('loading-overlay');
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
    const btnSaveCharacter = document.getElementById('btn-save-character');
    const inviteEmailInput = document.getElementById('invite-email');
    const turnStatus = document.getElementById('turn-status');
    const btnPassTurn = document.getElementById('btn-pass-turn');
    const attributeAccordion = document.getElementById('attribute-accordion');

    // --- ESTADO DA APLICAÇÃO ---
    let currentUser = null;
    let currentCharacter = null;
    let currentSessionId = null;
    let messagesUnsubscribe = null;
    let partyUnsubscribe = null;
    let sessionUnsubscribe = null;
    const AI_UID = 'master-ai';
    
    const attributeNames = ['Ara (Corpo)', 'Ori (Cabeça/Destino)', 'Emi (Espírito/Respiração)'];
    const attributeKeys = ['ara', 'ori', 'emi'];
    const oldAttributeKeys = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    const attributeDetails = {
        ara: {
            sub: ['Força', 'Vigor', 'Agilidade', 'Saúde'],
            desc: 'Usado para: Combate físico, testes de resistência, corridas, etc.'
        },
        ori: {
            sub: ['Inteligência', 'Percepção', 'Força de Vontade', 'Conexão com seu Orixá'],
            desc: 'Usado para: Resistir a controle mental, realizar rituais, testes de conhecimento, interação social.'
        },
        emi: {
            sub: ['Energia Vital', 'Carisma', 'Capacidade de Inspirar', 'Sorte'],
            desc: 'Usado para: Testes sociais (persuasão, intimidação) e como base para seus "Pontos de Axé".'
        }
    };

    let attributes = {};
    let pointsToDistribute = 10;

    // --- FUNÇÕES CLOUD CALLABLE ---
    const createAndJoinSession = httpsCallable(functions, 'createAndJoinSession');
    const joinSession = httpsCallable(functions, 'joinSession');
    const getPendingInvites = httpsCallable(functions, 'getPendingInvites');
    const acceptInvite = httpsCallable(functions, 'acceptInvite');
    const declineInvite = httpsCallable(functions, 'declineInvite');
    const sendInvite = httpsCallable(functions, 'sendInvite');
    const passarTurno = httpsCallable(functions, 'passarTurno');

    // --- GERENCIAMENTO DE UI ---
    
    loadingOverlay.style.display = 'flex';
    pageContent.style.display = 'none';

    const showView = (view) => {
        sessionSelectionOverlay.style.display = 'none';
        gameView.style.display = 'none';
        gameView.classList.remove('in-game');
        if (view === gameView) {
            gameView.style.display = 'grid';
            gameView.classList.add('in-game');
        } else {
            view.style.display = 'flex';
        }
        btnBackToSelection.style.display = view === gameView ? 'inline-block' : 'none';
        btnCreateNewCharacter.style.display = view !== gameView && currentUser ? 'inline-block' : 'none';
    };

    const showModal = (modal) => { modal.style.display = 'flex'; };
    const hideModal = (modal) => { modal.style.display = 'none'; };

    const cleanupSessionListeners = () => {
        if (messagesUnsubscribe) messagesUnsubscribe();
        if (partyUnsubscribe) partyUnsubscribe();
        if (sessionUnsubscribe) sessionUnsubscribe();
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
        } else {
            turnStatus.classList.remove('my-turn');
            const playerName = sessionData.personagens[turnoAtualUid]?.name || (turnoAtualUid === AI_UID ? "O Mestre" : "outro jogador");
            turnStatus.textContent = `Aguardando o turno de ${playerName}...`;
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
        const q = query(charactersRef, where("uid", "==", userId), orderBy("createdAt", "desc"));
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
            if (charSnapshot.empty) throw new Error("Personagem não encontrado nesta sessão.");
            
            currentCharacter = { id: charSnapshot.docs[0].id, ...charSnapshot.docs[0].data() };
            
            characterSheetName.textContent = currentCharacter.name;
            characterSheetAttributes.innerHTML = '';
            
            const charAttrs = currentCharacter.attributes;
            const isNewSystem = 'ara' in charAttrs;

            const keys = isNewSystem ? attributeKeys : oldAttributeKeys;
            const names = isNewSystem ? attributeNames : oldAttributeKeys.map(k => k.charAt(0).toUpperCase() + k.slice(1));

            keys.forEach((key, index) => {
                const li = document.createElement('li');
                li.innerHTML = `<span class="attr-name">${names[index]}</span> <span class="attr-value">${charAttrs[key] || (isNewSystem ? 1 : 10)}</span>`;
                characterSheetAttributes.appendChild(li);
            });

            showView(gameView);
            const sessionRef = doc(db, "sessions", sessionId);
            sessionUnsubscribe = onSnapshot(sessionRef, (doc) => updateTurnUI(doc.data()));
            listenForMessages(sessionId);
            listenForPartyChanges(sessionId);
        } catch (error) {
            console.error("Erro ao carregar sessão:", error);
            alert(error.message || "Não foi possível carregar a sessão.");
            await returnToSelectionScreen();
        }
    }

    function listenForMessages(sessionId) {
      const q = query(collection(db, 'sessions', sessionId, 'messages'), orderBy("createdAt"));
      messagesUnsubscribe = onSnapshot(q, (snapshot) => {
          narration.innerHTML = '';
          snapshot.docs.forEach(doc => {
              const msg = doc.data();
              const messageElement = document.createElement('div');
              messageElement.classList.add('message', msg.from === 'mestre' ? 'mestre-msg' : 'player-msg');
              if(msg.isTurnoUpdate) messageElement.classList.add('system-message');

              const from = msg.from === 'mestre' ? "Mestre" : (msg.characterName || "Jogador");
              const text = msg.text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
              messageElement.innerHTML = `<p class="from">${from}</p><p>${text}</p>`;
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
              if (doc.data().uid !== AI_UID) {
                 partyList.innerHTML += `<li>${doc.data().name}</li>`;
              }
          });
      });
    }

    async function sendChatMessage(text) {
        if (!text.trim() || !currentSessionId || !currentCharacter) return;
        inputText.disabled = true; btnSend.disabled = true;
        try {
            await addDoc(collection(db, 'sessions', currentSessionId, 'messages'), {
                from: 'player', text, characterName: currentCharacter.name, uid: currentUser.uid, createdAt: serverTimestamp()
            });
            inputText.value = '';
        } catch (error) {
            console.error("Erro ao enviar mensagem:", error);
        } finally {
           // O estado do turno reabilitará se necessário
        }
    }

    async function passTurn() {
        if (!currentSessionId) return;
        btnPassTurn.disabled = true;
        try {
            await passarTurno({ sessionId: currentSessionId });
        } catch (error) {
            alert(error.message);
            btnPassTurn.disabled = false; 
        }
    }
    
    onAuthStateChanged(auth, async (user) => {
        cleanupSessionListeners();
        showView(sessionSelectionOverlay); 
        if (user) {
            currentUser = user;
            username.textContent = user.displayName || user.email.split('@')[0];
            btnAuth.textContent = 'Sair';
            noCharactersMessage.textContent = 'Você ainda não tem personagens.';
            await Promise.all([loadUserCharacters(user.uid), loadPendingInvitesInternal()]);
        } else {
            currentUser = null;
            window.location.href = 'login.html';
        }
        loadingOverlay.style.display = 'none';
        pageContent.style.display = 'block';
    });

    // --- LISTENERS DE EVENTOS ---

    btnMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        sidePanel.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        if (sidePanel.classList.contains('open') && !sidePanel.contains(e.target) && !btnMenu.contains(e.target)) {
            sidePanel.classList.remove('open');
        }
    });

    btnAuth.addEventListener('click', () => {
        if (currentUser) signOut(auth);
        else window.location.href = 'login.html';
    });
    
    btnBackToSelection.addEventListener('click', returnToSelectionScreen);
    btnSend.addEventListener('click', () => sendChatMessage(inputText.value));
    inputText.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(inputText.value); }});
    btnPassTurn.addEventListener('click', passTurn);

    characterList.addEventListener('click', (e) => {
        const card = e.target.closest('.character-card');
        if (card) loadSession(card.dataset.sessionId);
    });

    invitesList.addEventListener('click', async (e) => {
        const button = e.target.closest('button');
        const card = e.target.closest('.invite-card');
        if (!button || !card) return;
        
        button.disabled = true;
        try {
            if (button.classList.contains('btn-accept')) {
                const result = await acceptInvite({ inviteId: card.dataset.inviteId });
                sessionStorage.setItem('joiningSessionId', result.data.sessionId);
                resetAndOpenCharacterCreationModal();
            } else if (button.classList.contains('btn-decline')) {
                await declineInvite({ inviteId: card.dataset.inviteId });
                card.remove();
            }
        } catch (error) {
            alert(error.message);
            button.disabled = false;
        }
    });
    
    function resetAndOpenCharacterCreationModal() {
        hideModal(inviteModal);
        charNameInput.value = '';
        pointsToDistribute = 10;
        attributes = { ara: 1, ori: 1, emi: 1 };
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
        if (charNameInput.value.trim().length < 3) return alert('O nome do personagem deve ter pelo menos 3 caracteres.');
        if (pointsToDistribute > 0) return alert('Você ainda tem pontos para distribuir!');

        creationLoadingIndicator.style.display = 'flex';
        btnSaveCharacter.style.display = 'none';
        charNameInput.disabled = true;

        try {
            const joiningSessionId = sessionStorage.getItem('joiningSessionId');
            const characterData = { characterName: charNameInput.value.trim(), attributes };
            
            if (joiningSessionId) {
                await joinSession({ ...characterData, sessionId: joiningSessionId });
                sessionStorage.removeItem('joiningSessionId');
                alert(`${characterData.characterName} foi criado e adicionado à sessão!`);
                await returnToSelectionScreen();
            } else {
                const result = await createAndJoinSession(characterData);
                await loadSession(result.data.sessionId);
            }
            hideModal(characterCreationModal);
        } catch (error) {
            alert(`Erro: ${error.message}`);
            creationLoadingIndicator.style.display = 'none';
            btnSaveCharacter.style.display = 'block';
            charNameInput.disabled = false;
        }
    });
    
    function updateCreationUI() {
        pointsToDistributeSpan.textContent = pointsToDistribute;
        attributeAccordion.innerHTML = '';
        attributeKeys.forEach((key, index) => {
            const value = attributes[key];
            const details = attributeDetails[key];
            const subItems = details.sub.map(s => `<li>${s}</li>`).join('');

            const itemDiv = document.createElement('div');
            itemDiv.className = 'attribute-item';
            itemDiv.innerHTML = `
                <div class="attribute-header" data-attr="${key}">
                    <span class="attribute-title">${attributeNames[index]}</span>
                    <span class="attribute-value-display">${value}</span>
                </div>
                <div class="attribute-details">
                    <div class="sub-attributes">
                        <h5>Componentes:</h5>
                        <ul>${subItems}</ul>
                    </div>
                    <div class="usage-description">
                        <h5>Uso Principal:</h5>
                        <p>${details.desc}</p>
                    </div>
                    <div class="attribute-controls">
                        <button class="btn btn-attr" data-attr-op="-" data-attr-key="${key}" ${value <= 1 ? 'disabled' : ''}>-</button>
                        <span class="attr-value">${value}</span>
                        <button class="btn btn-attr" data-attr-op="+" data-attr-key="${key}" ${pointsToDistribute < 1 ? 'disabled' : ''}>+</button>
                    </div>
                </div>
            `;
            attributeAccordion.appendChild(itemDiv);
        });
    }
    
    attributeAccordion.addEventListener('click', (e) => {
        const header = e.target.closest('.attribute-header');
        if (header) {
            header.nextElementSibling.classList.toggle('open');
            return;
        }

        const button = e.target.closest('.btn-attr');
        if (button) {
            const attrKey = button.dataset.attrKey;
            const operation = button.dataset.attrOp;
            if (operation === '+' && pointsToDistribute >= 1) {
                attributes[attrKey]++;
                pointsToDistribute--;
            } else if (operation === '-' && attributes[attrKey] > 1) {
                attributes[attrKey]--;
                pointsToDistribute++;
            }
            updateCreationUI();
        }
    });
    
    btnInvitePlayer.addEventListener('click', () => {
        if (!currentSessionId) return alert("Você precisa estar em uma sessão para convidar jogadores.");
        inviteEmailInput.value = '';
        showModal(inviteModal);
    });

    btnCancelInvite.addEventListener('click', () => hideModal(inviteModal));

    btnSendInvite.addEventListener('click', async () => {
        const email = inviteEmailInput.value.trim();
        if (!email.includes('@')) return alert('Por favor, insira um e-mail válido.');
        
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
        if (e.target.matches('[data-d]') && currentSessionId && currentCharacter) {
            const die = e.target.dataset.d;
            const roll = Math.floor(Math.random() * parseInt(die)) + 1;
            await sendChatMessage(`rolou 1d${die} e tirou **${roll}**`);
        }
    });
});
