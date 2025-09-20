
/*
 *  script.js - Implementação da Seção de Notificações de Convite
 *  - Busca e exibe convites pendentes ao carregar a página.
 *  - Permite aceitar ou recusar convites diretamente da interface.
 *  - Redireciona para criação de personagem ao aceitar um convite para uma nova sessão.
 */

// --- IMPORTS --- //
import { auth, db, functions } from './firebase.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js";
import { onAuthStateChanged, signOut, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {

    // --- DOM ELEMENT REFERENCES --- //
    const username = document.getElementById('username');
    const btnAuth = document.getElementById('btn-auth');

    const gameView = document.getElementById('game-view');
    const sessionSelectionOverlay = document.getElementById('session-selection-overlay');
    
    // -- Seção de Notificações --
    const notificationsSection = document.getElementById('notifications-section');
    const invitesList = document.getElementById('invites-list');

    const characterList = document.getElementById('character-list');
    const noCharactersMessage = document.getElementById('no-characters-message');
    const btnCreateNewCharacter = document.getElementById('btn-create-new-character');

    const narration = document.getElementById('narration');
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
    const diceAnimationOverlay = document.getElementById('dice-animation-overlay');
    const d20Animation = document.getElementById('d20-animation');

    // --- APP STATE --- //
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

    let pointsToDistribute = 27;
    const baseAttributes = { strength: 8, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8 };
    let attributes = { ...baseAttributes };
    
    // --- UI MANAGEMENT --- //
    const showNarrationView = () => {
        sessionSelectionOverlay.style.display = 'none';
        gameView.style.display = 'grid';
    };

    const showSessionSelection = () => {
        sessionSelectionOverlay.style.display = 'flex';
        gameView.style.display = 'none';
    };

    const resetAndCloseCharacterCreationModal = () => {
        attributes = { ...baseAttributes };
        pointsToDistribute = 27;
        pointsToDistributeSpan.textContent = pointsToDistribute;
        charNameInput.value = '';
        updateAttributesUI();

        if(creationLoadingIndicator) creationLoadingIndicator.style.display = 'none';
        btnSaveCharacter.style.display = 'block';
        btnSaveCharacter.disabled = false;
        characterCreationModal.style.display = 'none';
    };

    const updateAttributesUI = () => {
        attributeNames.forEach(attr => {
             const valueSpan = document.getElementById(`attr-${attr}-value`);
             if(valueSpan) valueSpan.textContent = attributes[attr];
        });
        pointsToDistributeSpan.textContent = pointsToDistribute;
    };

    // ===================================================================================
    //  INVITE & NOTIFICATION LOGIC
    // ===================================================================================

    async function loadPendingInvites() {
        if (!currentUser) return;
        const getInvites = httpsCallable(functions, 'getPendingInvites');
        try {
            const result = await getInvites();
            const pendingInvites = result.data;
            
            invitesList.innerHTML = ''; // Limpa a lista antiga
            if (pendingInvites && pendingInvites.length > 0) {
                notificationsSection.style.display = 'block'; // Mostra a seção de notificações
                pendingInvites.forEach(renderInviteCard);
            } else {
                notificationsSection.style.display = 'none'; // Esconde se não houver convites
            }
        } catch (error) {
            console.error("Erro ao buscar convites pendentes:", error);
            notificationsSection.style.display = 'none';
        }
    }

    function renderInviteCard(invite) {
        const card = document.createElement('div');
        card.className = 'invite-card';
        card.dataset.inviteId = invite.id;
        card.innerHTML = `
            <div class="invite-info">
                <p><strong>${invite.senderCharacterName}</strong> convidou você para uma aventura!</p>
            </div>
            <div class="invite-actions">
                <button class="btn btn-sm btn-accept" data-invite-id="${invite.id}">Aceitar</button>
                <button class="btn btn-sm btn-decline" data-invite-id="${invite.id}">Recusar</button>
            </div>
        `;
        invitesList.appendChild(card);
    }

    async function handleAcceptInvite(inviteId) {
        const acceptInvite = httpsCallable(functions, 'acceptInvite');
        try {
            const result = await acceptInvite({ inviteId: inviteId });
            if (result.data.success) {
                alert('Convite aceito! Você será levado para criar seu personagem para esta nova aventura.');
                // Guarda o ID da sessão para usar na criação do personagem
                sessionStorage.setItem('joiningSessionId', result.data.sessionId);
                // Abre o modal de criação de personagem
                characterCreationModal.style.display = 'flex';
                // Recarrega a lista de convites em segundo plano
                loadPendingInvites();
            }
        } catch (error) {
            console.error("Erro ao aceitar convite:", error);
            alert(`Falha ao aceitar o convite: ${error.message}`);
        }
    }

    async function handleDeclineInvite(inviteId) {
        const declineInvite = httpsCallable(functions, 'declineInvite');
        try {
            const result = await declineInvite({ inviteId: inviteId });
            if (result.data.success) {
                // Remove o card da UI
                const cardToRemove = document.querySelector(`.invite-card[data-invite-id='${inviteId}']`);
                if (cardToRemove) cardToRemove.remove();
                // Se não houver mais convites, esconde a seção
                if (invitesList.children.length === 0) {
                    notificationsSection.style.display = 'none';
                }
            }
        } catch (error) {
            console.error("Erro ao recusar convite:", error);
            alert(`Falha ao recusar o convite: ${error.message}`);
        }
    }

    // ===================================================================================
    //  SESSION & CORE APP LOGIC
    // ===================================================================================

    async function loadUserCharacters(userId) {
        const charactersRef = collection(db, "characters");
        const q = query(charactersRef, where("uid", "==", userId));
        
        try {
            const querySnapshot = await getDocs(q);
            characterList.innerHTML = '';
            if (querySnapshot.empty) {
                noCharactersMessage.style.display = 'block';
            } else {
                noCharactersMessage.style.display = 'none';
                querySnapshot.forEach(doc => {
                    const character = doc.data();
                    const charElement = document.createElement('div');
                    charElement.className = 'character-card';
                    charElement.innerHTML = `<h4>${character.name}</h4><p>Sessão: ${character.sessionId.substring(0, 6)}...</p>`;
                    charElement.dataset.characterId = doc.id;
                    charElement.dataset.sessionId = character.sessionId;
                    characterList.appendChild(charElement);
                });
            }
        } catch (error) {
            console.error("Erro ao carregar personagens:", error);
            characterList.innerHTML = `<p style="color: var(--error-color);">Não foi possível carregar seus personagens.</p>`;
        }
        
        showSessionSelection();
    }

    async function loadSession(sessionId) {
        // ... (código existente sem alteração)
    }

    async function sendChatMessage(text) {
        // ... (código existente sem alteração)
    }

    // ... (outras funções de listen e update UI sem alteração)

    // ===================================================================================
    //  EVENT LISTENERS
    // ===================================================================================

    btnAuth.addEventListener('click', () => {
        if (currentUser) {
            signOut(auth);
        } else {
            window.location.href = '/login.html';
        }
    });

    // Ação ao clicar nos botões de Aceitar/Recusar na lista de convites
    invitesList.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('btn-accept')) {
            const inviteId = target.dataset.inviteId;
            target.textContent = '...';
            target.disabled = true;
            handleAcceptInvite(inviteId);
        } else if (target.classList.contains('btn-decline')) {
            const inviteId = target.dataset.inviteId;
            target.textContent = '...';
            target.disabled = true;
            handleDeclineInvite(inviteId);
        }
    });

    characterList.addEventListener('click', (e) => {
        const card = e.target.closest('.character-card');
        if (card) {
            const sessionId = card.dataset.sessionId;
            if (sessionId) {
                loadSession(sessionId);
            }
        }
    });

    btnCreateNewCharacter.addEventListener('click', () => {
      // Limpa a sessão de entrada, caso o usuário esteja criando um personagem do zero.
      sessionStorage.removeItem('joiningSessionId');
      characterCreationModal.style.display = 'flex';
    });

    btnCloseCharCreation.addEventListener('click', resetAndCloseCharacterCreationModal);

    // ... (lógica de criação de personagem e outros listeners)

    // ===================================================================================
    //  AUTH & INITIALIZATION
    // ===================================================================================

    const handleAuthState = async (user) => {
        if (user) {
            currentUser = user;
            username.textContent = user.displayName || user.email;
            btnAuth.textContent = 'Sair';
            btnCreateNewCharacter.style.display = 'block';

            // Carrega convites e personagens do usuário
            await loadPendingInvites(); 
            await loadUserCharacters(user.uid);

        } else {
            currentUser = null;
            username.textContent = 'Visitante';
            btnAuth.textContent = 'Login';
            showSessionSelection();
            characterList.innerHTML = '';
            noCharactersMessage.style.display = 'block';
            noCharactersMessage.textContent = 'Faça login para ver ou criar personagens.';
            btnCreateNewCharacter.style.display = 'none';
            notificationsSection.style.display = 'none';
        }
    };
    
    const attributeNames = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

    const initializeApp = () => {
        // Popula o grid de atributos na criação de personagem
        attributesGrid.innerHTML = ''; // Limpa para evitar duplicatas
        attributeNames.forEach(attr => {
            const div = document.createElement('div');
            div.className = 'attribute-control';
            const attrNameCapitalized = attr.charAt(0).toUpperCase() + attr.slice(1);
            div.innerHTML = `
                <label>${attrNameCapitalized}</label>
                <div class="attr-value" id="attr-${attr}-value">8</div>
                <div class="attr-buttons">
                    <button class="btn btn-sm" data-action="decrease" data-attribute="${attr}">-</button>
                    <button class="btn btn-sm" data-action="increase" data-attribute="${attr}">+</button>
                </div>
            `;
            attributesGrid.appendChild(div);
        });
        updateAttributesUI();

        onAuthStateChanged(auth, handleAuthState);
    };

    // Inicia o aplicativo
    initializeApp();
});
