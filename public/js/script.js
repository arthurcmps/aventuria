/*
 *  script.js - VERSÃO DE RECUPERAÇÃO COMPLETA (2.0)
 *  - Restaura TODAS as funcionalidades principais que foram acidentalmente removidas.
 *  - Mantém o sistema de notificação de convites e o novo design.
 *  - Corrige o bug dos seletores de atributos na criação de personagem.
 *  - Garante que todos os modais funcionem e estejam ocultos por padrão.
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
    const gameView = document.getElementById('game-view');
    const sessionSelectionOverlay = document.getElementById('session-selection-overlay');
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
    const partyManagementPanel = document.getElementById('party-management-panel');
    const partyList = document.getElementById('party-list');
    const btnInvitePlayer = document.getElementById('btn-invite-player');
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

    // --- APP STATE ---
    let currentUser = null;
    let currentCharacter = null;
    let currentSessionId = null;
    let messagesUnsubscribe = null;
    let partyUnsubscribe = null;
    let sessionUnsubscribe = null;
    const attributeNames = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    const baseAttributes = { strength: 8, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8 };
    let attributes = { ...baseAttributes };
    let pointsToDistribute = 27;

    // --- UI MANAGEMENT ---
    const showView = (view) => {
        sessionSelectionOverlay.style.display = 'none';
        gameView.style.display = 'none';
        view.style.display = view === gameView ? 'grid' : 'flex';
    };

    const showModal = (modal) => { modal.style.display = 'flex'; };
    const hideModal = (modal) => { modal.style.display = 'none'; };

    const resetAndCloseCharacterCreationModal = () => {
        attributes = { ...baseAttributes };
        pointsToDistribute = 27;
        charNameInput.value = '';
        updateAttributesUI();
        creationLoadingIndicator.style.display = 'none';
        btnSaveCharacter.style.display = 'block';
        btnSaveCharacter.disabled = false;
        hideModal(characterCreationModal);
    };

    const updateAttributesUI = () => {
        attributeNames.forEach(attr => {
            const valueSpan = document.getElementById(`attr-${attr}-value`);
            if (valueSpan) valueSpan.textContent = attributes[attr];
        });
        pointsToDistributeSpan.textContent = pointsToDistribute;
    };

    // --- NOTIFICATION / INVITE LOGIC ---
    async function loadPendingInvites() {
        if (!currentUser) return;
        const getInvites = httpsCallable(functions, 'getPendingInvites');
        try {
            const result = await getInvites();
            invitesList.innerHTML = '';
            notificationsSection.style.display = result.data.length > 0 ? 'block' : 'none';
            result.data.forEach(renderInviteCard);
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
            <div class="invite-info"><p><strong>${invite.senderCharacterName}</strong> convidou você para uma aventura!</p></div>
            <div class="invite-actions">
                <button class="btn btn-sm btn-accept">Aceitar</button>
                <button class="btn btn-sm btn-decline">Recusar</button>
            </div>`;
        invitesList.appendChild(card);
    }

    async function handleAcceptInvite(inviteId, button) {
        button.textContent = '...';
        button.disabled = true;
        const acceptInvite = httpsCallable(functions, 'acceptInvite');
        try {
            const result = await acceptInvite({ inviteId });
            if (result.data.success) {
                alert('Convite aceito! Crie seu personagem para entrar na sessão.');
                sessionStorage.setItem('joiningSessionId', result.data.sessionId);
                resetAndCloseCharacterCreationModal();
                showModal(characterCreationModal);
                const cardToRemove = document.querySelector(`.invite-card[data-invite-id='${inviteId}']`);
                if (cardToRemove) cardToRemove.remove();
                if (invitesList.children.length === 0) {
                    notificationsSection.style.display = 'none';
                }
            }
        } catch (error) {
            console.error("Erro ao aceitar convite:", error);
            alert(`Falha ao aceitar: ${error.message}`);
            button.textContent = 'Aceitar';
            button.disabled = false;
        }
    }

    async function handleDeclineInvite(inviteId, button) {
        button.textContent = '...';
        button.disabled = true;
        const declineInvite = httpsCallable(functions, 'declineInvite');
        try {
            await declineInvite({ inviteId });
            const cardToRemove = document.querySelector(`.invite-card[data-invite-id='${inviteId}']`);
            if (cardToRemove) cardToRemove.remove();
            if (invitesList.children.length === 0) {
                notificationsSection.style.display = 'none';
            }
        } catch (error) {
            console.error("Erro ao recusar convite:", error);
            alert(`Falha ao recusar: ${error.message}`);
            button.textContent = 'Recusar';
            button.disabled = false;
        }
    }

    // --- SESSION & CORE APP LOGIC ---
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
                charElement.innerHTML = `<h4>${character.name}</h4><p>Sessão: ${character.sessionId.substring(0, 6)}...</p>`;
                charElement.dataset.sessionId = character.sessionId;
                characterList.appendChild(charElement);
            });
        } catch (error) {
            console.error("Erro ao carregar personagens:", error);
            characterList.innerHTML = `<p style="color: var(--error-color);">Não foi possível carregar.</p>`;
        }
    }

    async function loadSession(sessionId) {
        if (messagesUnsubscribe) messagesUnsubscribe();
        if (partyUnsubscribe) partyUnsubscribe();
        if (sessionUnsubscribe) sessionUnsubscribe();

        currentSessionId = sessionId;
        showView(gameView);

        const charQuery = query(collection(db, 'sessions', sessionId, 'characters'), where("uid", "==", currentUser.uid));
        const charSnapshot = await getDocs(charQuery);

        if (!charSnapshot.empty) {
            const characterDoc = charSnapshot.docs[0];
            currentCharacter = characterDoc.data();
            updateCharacterSheet(currentCharacter);
        } else {
            console.error("Personagem não encontrado nesta sessão para o usuário.");
            showView(sessionSelectionOverlay);
            return;
        }

        listenForMessages(sessionId);
        listenForPartyChanges(sessionId);
    }

    function updateCharacterSheet(character) {
        if (!character) return;
        characterSheetName.textContent = character.name;
        characterSheetAttributes.innerHTML = '';
        for (const [attr, value] of Object.entries(character.attributes)) {
            const capitalizedAttr = attr.charAt(0).toUpperCase() + attr.slice(1);
            characterSheetAttributes.innerHTML += `<li><span class="attr-name">${capitalizedAttr}</span><span class="attr-value">${value}</span></li>`;
        }
        characterSheet.style.display = 'block';
    }

    function listenForMessages(sessionId) {
        const q = query(collection(db, 'sessions', sessionId, 'messages'), orderBy("createdAt"));
        messagesUnsubscribe = onSnapshot(q, (snapshot) => {
            narration.innerHTML = '';
            snapshot.forEach(doc => {
                const msg = doc.data();
                const from = msg.from === 'mestre' ? "Mestre" : (msg.characterName || "Jogador");
                const text = msg.text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); // Suporte para negrito
                narration.innerHTML += `<div class="message"><p class="from">${from}</p><p>${text}</p></div>`;
            });
            if(narration.scrollTop + narration.clientHeight >= narration.scrollHeight - 50){
                narration.scrollTop = narration.scrollHeight;
            }
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
            console.error("Erro ao enviar mensagem:", error);
        }
    }
    async function handleLocalDiceRoll(dieType) {
        if (!currentSessionId || !currentCharacter) return;
        const result = Math.floor(Math.random() * dieType) + 1;
        const message = `${currentCharacter.name} rolou um d${dieType} e tirou: **${result}**`;
        await sendChatMessage(message);
    }

    async function saveCharacterAndEnterSession() {
        const charName = charNameInput.value.trim();
        if (!charName) return alert('Por favor, dê um nome ao seu personagem.');
        if (!currentUser) return alert('Você precisa estar logado.');

        creationLoadingIndicator.style.display = 'flex';
        btnSaveCharacter.style.display = 'none';
        btnSaveCharacter.disabled = true;

        try {
            const joiningSessionId = sessionStorage.getItem('joiningSessionId');
            let targetSessionId;
            const characterData = { characterName: charName, attributes: attributes };

            if (joiningSessionId) {
                const joinSession = httpsCallable(functions, 'joinSession');
                await joinSession({ ...characterData, sessionId: joiningSessionId });
                targetSessionId = joiningSessionId;
                sessionStorage.removeItem('joiningSessionId');
            } else {
                const createAndJoin = httpsCallable(functions, 'createAndJoinSession');
                const result = await createAndJoin(characterData);
                targetSessionId = result.data.sessionId;
            }
            
            resetAndCloseCharacterCreationModal();
            await loadUserCharacters(currentUser.uid); // Recarrega a lista de personagens
            await loadSession(targetSessionId); // Entra direto na sessão

        } catch (error) {
            console.error("Erro ao salvar personagem:", error);
            alert(`Erro: ${error.message}`);
            creationLoadingIndicator.style.display = 'none';
            btnSaveCharacter.style.display = 'block';
            btnSaveCharacter.disabled = false;
        }
    }

    // --- EVENT LISTENERS ---
    btnAuth.addEventListener('click', () => {
        if (currentUser) {
            signOut(auth).catch(err => console.error("Erro no logout:", err));
        } else {
            window.location.href = '/login.html';
        }
    });

    invitesList.addEventListener('click', (e) => {
        const button = e.target;
        const card = button.closest('.invite-card');
        if (!card) return;
        const inviteId = card.dataset.inviteId;
        if (button.classList.contains('btn-accept')) {
            handleAcceptInvite(inviteId, button);
        } else if (button.classList.contains('btn-decline')) {
            handleDeclineInvite(inviteId, button);
        }
    });

    characterList.addEventListener('click', (e) => {
        const card = e.target.closest('.character-card');
        if (card && card.dataset.sessionId) {
            loadSession(card.dataset.sessionId);
        }
    });

    btnCreateNewCharacter.addEventListener('click', () => {
        sessionStorage.removeItem('joiningSessionId');
        resetAndCloseCharacterCreationModal();
        showModal(characterCreationModal);
    });

    btnCloseCharCreation.addEventListener('click', resetAndCloseCharacterCreationModal);

    attributesGrid.addEventListener('click', (e) => {
        const target = e.target;
        if (target.tagName !== 'BUTTON' || target.closest('.attr-buttons') === null) return;

        const action = target.dataset.action;
        const attribute = target.closest('.attribute-control').querySelector('label').textContent.toLowerCase();
        
        let currentValue = attributes[attribute];
        const cost = (currentValue >= 13) ? 2 : 1;

        if (action === 'increase' && pointsToDistribute >= cost && currentValue < 15) {
            attributes[attribute]++;
            pointsToDistribute -= cost;
        } else if (action === 'decrease' && currentValue > 8) {
            const refund = (currentValue > 13) ? 2 : 1;
            attributes[attribute]--;
            pointsToDistribute += refund;
        }
        updateAttributesUI();
    });

    btnSaveCharacter.addEventListener('click', saveCharacterAndEnterSession);

    btnInvitePlayer.addEventListener('click', () => showModal(inviteModal));
    btnCancelInvite.addEventListener('click', () => {
        hideModal(inviteModal);
        inviteEmailInput.value = '';
    });

    btnSendInvite.addEventListener('click', async () => {
        const email = inviteEmailInput.value.trim();
        if (!email) return alert('Digite um e-mail.');
        btnSendInvite.disabled = true;
        btnSendInvite.textContent = 'Enviando...';
        try {
            const sendInvite = httpsCallable(functions, 'sendInvite');
            const result = await sendInvite({ email, sessionId: currentSessionId });
            alert(result.data.message);
            hideModal(inviteModal);
            inviteEmailInput.value = '';
        } catch (error) {
            console.error("Erro ao convidar jogador:", error);
            alert(`Erro: ${error.message}`);
        } finally {
            btnSendInvite.disabled = false;
            btnSendInvite.textContent = 'Enviar Convite';
        }
    });

    btnSend.addEventListener('click', () => sendChatMessage(inputText.value));
    inputText.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage(inputText.value);
        }
    });

    diceRoller.addEventListener('click', (e) => {
        if (e.target.matches('.btn[data-d]')) {
            handleLocalDiceRoll(parseInt(e.target.dataset.d));
        }
    });

    // --- AUTH & INITIALIZATION ---
    const handleAuthState = async (user) => {
        if (user) {
            currentUser = user;
            username.textContent = user.displayName || user.email.split('@')[0];
            btnAuth.textContent = 'Sair';
            btnCreateNewCharacter.style.display = 'block';
            showView(sessionSelectionOverlay);
            await Promise.all([loadPendingInvites(), loadUserCharacters(user.uid)]);
        } else {
            currentUser = null;
            currentCharacter = null;
            currentSessionId = null;
            if (messagesUnsubscribe) messagesUnsubscribe();
            if (partyUnsubscribe) partyUnsubscribe();
            if (sessionUnsubscribe) sessionUnsubscribe();

            username.textContent = 'Visitante';
            btnAuth.textContent = 'Login';
            characterList.innerHTML = '';
            noCharactersMessage.textContent = 'Faça login para ver ou criar personagens.';
            noCharactersMessage.style.display = 'block';
            btnCreateNewCharacter.style.display = 'none';
            notificationsSection.style.display = 'none';
            showView(sessionSelectionOverlay);
        }
    };

    const initializeApp = () => {
        attributesGrid.innerHTML = '';
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
                </div>`;
            attributesGrid.appendChild(div);
        });
        updateAttributesUI();
        onAuthStateChanged(auth, handleAuthState);
    };

    initializeApp();
});
