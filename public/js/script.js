
/*
 *  script.js - Correção DEFINITIVA do bug da tela de rolagem de dados
 */

// --- IMPORTS --- //
import { auth, db, functions } from './firebase.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js";
import { onAuthStateChanged, signOut, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {

    // ===================================================================================
    //  1. DOM ELEMENT REFERENCES
    // ===================================================================================
    const username = document.getElementById('username');
    const btnAuth = document.getElementById('btn-auth');

    const gameView = document.getElementById('game-view');
    const sessionSelectionOverlay = document.getElementById('session-selection-overlay');
    const characterList = document.getElementById('character-list');
    const noCharactersMessage = document.getElementById('no-characters-message');
    const btnCreateNewCharacter = document.getElementById('btn-create-new-character');

    const invitesPanel = document.getElementById('invites-panel');
    const invitesList = document.getElementById('invites-list');

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

    let pointsToDistribute = 27;
    const baseAttributes = { strength: 8, dexterity: 8, constitution: 8, intelligence: 8, wisdom: 8, charisma: 8 };
    let attributes = { ...baseAttributes };

    // ===================================================================================
    //  3. UI MANAGEMENT
    // ===================================================================================
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
        for (const attr in attributes) {
            const attrElement = document.getElementById(`attr-${attr}`);
            if(attrElement) attrElement.textContent = attributes[attr];
        }
    };

    // ===================================================================================
    //  4. CORE APP LOGIC
    // ===================================================================================

    async function loadPendingInvites() {
        if (!currentUser) return;
        const getInvites = httpsCallable(functions, 'getPendingInvites');
        try {
            const result = await getInvites();
            const pendingInvites = result.data;
            invitesList.innerHTML = '';
            if (pendingInvites && pendingInvites.length > 0) {
                invitesPanel.style.display = 'block';
                pendingInvites.forEach(invite => {
                    const inviteElement = document.createElement('div');
                    inviteElement.className = 'invite-item';
                    inviteElement.innerHTML = `
                        <span><strong>${invite.senderCharacterName}</strong> te convidou para uma sessão.</span>
                        <div class="invite-actions">
                            <button class="btn btn-accept" data-invite-id="${invite.id}">Aceitar</button>
                            <button class="btn btn-decline" data-invite-id="${invite.id}">Recusar</button>
                        </div>
                    `;
                    invitesList.appendChild(inviteElement);
                });
            } else {
                invitesPanel.style.display = 'none';
            }
        } catch (error) {
            console.error("Erro ao buscar convites:", error);
            invitesPanel.style.display = 'none';
        }
    }

    async function loadSessionList(userId) {
        const charactersRef = collection(db, "characters");
        const q = query(charactersRef, where("uid", "==", userId));
        
        try {
            const querySnapshot = await getDocs(q);
            characterList.innerHTML = '';
            if (querySnapshot.empty) {
                noCharactersMessage.style.display = 'block';
                noCharactersMessage.textContent = 'Você ainda não tem personagens.';
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
        } catch (error) {
            console.error("Erro CRÍTICO ao carregar a lista de personagens:", error);
            characterList.innerHTML = `<p class="error-message">Não foi possível carregar seus personagens.</p>`;
        }
        
        showSessionSelection();
    }

    async function loadSession(sessionId) {
        if (messagesUnsubscribe) messagesUnsubscribe();
        if (partyUnsubscribe) partyUnsubscribe();
        if (sessionUnsubscribe) sessionUnsubscribe();

        currentSessionId = sessionId;

        const charInSessionRef = doc(db, 'sessions', sessionId, 'characters', currentUser.uid);
        const charDoc = await getDoc(charInSessionRef);

        if (charDoc.exists()) {
            currentCharacter = charDoc.data();
            updateCharacterSheet(currentCharacter);
        } else {
            console.error("Personagem não encontrado na sessão para o usuário logado.");
            showSessionSelection();
            return;
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
        }, error => {
            console.error("Erro ao ouvir mensagens:", error);
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
            if(sidePanelDivider) sidePanelDivider.style.display = 'block';
            if(sidePanelDivider2) sidePanelDivider2.style.display = 'block';
        }, error => {
            console.error("Erro ao ouvir mudanças no grupo:", error);
        });
    }

    function listenForSessionChanges(sessionId) {
        const sessionRef = doc(db, 'sessions', sessionId);
        sessionUnsubscribe = onSnapshot(sessionRef, (doc) => {
            const sessionData = doc.data();
            if (!sessionData) return;
            const diceRoll = sessionData.latestDiceRoll;
            if (diceRoll && diceRoll.timestamp?.toMillis() > lastRollTimestamp) {
                lastRollTimestamp = diceRoll.timestamp.toMillis();
                // Anima apenas se a rolagem não for do próprio jogador que está vendo
                if (diceRoll.uid !== currentUser.uid) { 
                    triggerDiceAnimation(diceRoll.rollerName, diceRoll.dieType, diceRoll.result);
                }
            }
        }, error => {
            console.error("Erro ao ouvir mudanças na sessão:", error);
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
    //  5. DICE ROLLING LOGIC (CORRIGIDO)
    // ===================================================================================

    function triggerDiceAnimation(rollerName, dieType, result) {
        if (isDiceRolling || !d20Animation || !diceAnimationOverlay) return;
        
        isDiceRolling = true;
        d20Animation.innerHTML = `<div class="roller-text">${rollerName} rola um d${dieType}...</div>`;
        diceAnimationOverlay.style.display = 'flex';
        
        // 1. Fade In
        setTimeout(() => {
            diceAnimationOverlay.classList.add('visible');
            d20Animation.classList.add('rolling');
        }, 10);

        // 2. Mostra o resultado
        setTimeout(() => {
            d20Animation.innerHTML = `<div class="result-text">${result}</div>`;
        }, 800);

        // 3. Inicia o Fade Out (A PEÇA QUE FALTAVA)
        setTimeout(() => {
            diceAnimationOverlay.classList.remove('visible');
        }, 2000); // Mantém o resultado na tela por 1.2s (2000ms - 800ms)
    }

    async function handleLocalDiceRoll(dieType) {
        if (isDiceRolling || !currentSessionId || !currentCharacter) return;

        const result = Math.floor(Math.random() * dieType) + 1;
        localRollData = { name: currentCharacter.name, type: dieType, result: result };
        
        // A animação agora é acionada para o jogador local também
        triggerDiceAnimation(localRollData.name, localRollData.type, localRollData.result);
        
        const diceRollPayload = { 
            rollerName: currentCharacter.name, 
            dieType: dieType, 
            result: result, 
            uid: currentUser.uid,
            timestamp: serverTimestamp() 
        };
        await updateDoc(doc(db, 'sessions', currentSessionId), { latestDiceRoll: diceRollPayload });
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

    btnCloseCharCreation.addEventListener('click', resetAndCloseCharacterCreationModal);

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
        updateAttributesUI();
        pointsToDistributeSpan.textContent = pointsToDistribute;
    });

    btnSaveCharacter.addEventListener('click', async () => {
        const charName = charNameInput.value.trim();
        if (!charName) { alert('Por favor, dê um nome ao seu personagem.'); return; }
        if (!currentUser) { alert('Você precisa estar logado para criar um personagem.'); return; }

        creationLoadingIndicator.style.display = 'flex';
        btnSaveCharacter.style.display = 'none';
        btnSaveCharacter.disabled = true;

        try {
            const createAndJoin = httpsCallable(functions, 'createAndJoinSession');
            const result = await createAndJoin({ characterName: charName, attributes: attributes });
            const { sessionId } = result.data;
            resetAndCloseCharacterCreationModal();
            await loadSession(sessionId);
        } catch (error) {
            console.error("Erro ao salvar personagem: ", error);
            alert(`Erro ao criar sessão: ${error.message}`);
            creationLoadingIndicator.style.display = 'none';
            btnSaveCharacter.style.display = 'block';
            btnSaveCharacter.disabled = false;
        }
    });

    btnInvitePlayer.addEventListener('click', () => { inviteModal.style.display = 'flex'; });
    btnCancelInvite.addEventListener('click', () => { inviteModal.style.display = 'none'; inviteEmailInput.value = ''; });

    btnSendInvite.addEventListener('click', async () => {
        const email = inviteEmailInput.value.trim();
        if (!email) return alert('Digite um e-mail.');
        if (!currentUser || !currentSessionId) return alert('Sessão ou usuário inválido.');

        const button = btnSendInvite;
        button.disabled = true;
        button.textContent = 'Enviando...';

        try {
            const sendInvite = httpsCallable(functions, 'sendInvite');
            const result = await sendInvite({ email: email, sessionId: currentSessionId });
            alert(result.data.message);
            inviteModal.style.display = 'none';
            inviteEmailInput.value = '';
        } catch (error) {
            console.error("Erro ao convidar jogador:", error);
            alert(`Erro: ${error.message}`);
        } finally {
            button.disabled = false;
            button.textContent = 'Enviar Convite';
        }
    });

    invitesList.addEventListener('click', async (e) => {
        if (!e.target.dataset.inviteId) return;
        const button = e.target;
        const inviteId = button.dataset.inviteId;
        
        const actionsDiv = button.closest('.invite-actions');
        if(actionsDiv) actionsDiv.querySelectorAll('button').forEach(btn => btn.disabled = true);
        button.textContent = '...';

        if (button.classList.contains('btn-accept')) {
            try {
                const accept = httpsCallable(functions, 'acceptInvite');
                const result = await accept({ inviteId });
                if (result.data.success) {
                    alert("Convite aceito! Agora crie seu personagem para entrar na sessão.");
                    window.location.reload(); 
                }
            } catch (error) {
                console.error("Erro ao aceitar convite:", error);
                alert(`Erro: ${error.message}`);
                if(actionsDiv) actionsDiv.querySelectorAll('button').forEach(btn => btn.disabled = false);
                button.textContent = 'Aceitar';
            }
        } else if (button.classList.contains('btn-decline')) {
            try {
                const decline = httpsCallable(functions, 'declineInvite');
                await decline({ inviteId });
                const item = button.closest('.invite-item');
                if(item) item.remove();
                if (invitesList.children.length === 0) { invitesPanel.style.display = 'none'; }
            } catch (error) {
                console.error("Erro ao recusar convite:", error);
                alert(`Erro: ${error.message}`);
                if(actionsDiv) actionsDiv.querySelectorAll('button').forEach(btn => btn.disabled = false);
                button.textContent = 'Recusar';
            }
        }
    });

    btnSend.addEventListener('click', () => sendChatMessage(inputText.value));
    inputText.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(inputText.value); }
    });

    if(diceRoller) {
        diceRoller.addEventListener('click', (e) => {
            if (e.target.matches('.btn[data-d]')) {
                const dieType = parseInt(e.target.dataset.d);
                handleLocalDiceRoll(dieType);
            }
        });
    }
    
    // Listener que fecha a tela e envia a mensagem após a animação de fade-out
    if(diceAnimationOverlay) {
        diceAnimationOverlay.addEventListener('transitionend', async (e) => {
            if (e.target !== diceAnimationOverlay) return;

            if (!diceAnimationOverlay.classList.contains('visible')) {
                diceAnimationOverlay.style.display = 'none';
                d20Animation.classList.remove('rolling');
                isDiceRolling = false;
                
                if (localRollData) {
                    const { name, type, result } = localRollData;
                    const message = `${name} rolou um d${type} e tirou: **${result}**`;
                    await sendChatMessage(message);
                    localRollData = null;
                }
            }
        });
    }


    // ===================================================================================
    //  7. APP INITIALIZATION & AUTHENTICATION
    // ===================================================================================

    const handleAuthState = async (user) => {
        if (user) {
            currentUser = user;
            username.textContent = user.displayName || user.email;
            btnAuth.textContent = 'Sair';
            btnCreateNewCharacter.style.display = 'block';

            await loadPendingInvites();
            await loadSessionList(user.uid);

        } else {
            currentUser = null;
            currentCharacter = null;
            currentSessionId = null;
            if(messagesUnsubscribe) messagesUnsubscribe();
            if(partyUnsubscribe) partyUnsubscribe();
            if(sessionUnsubscribe) sessionUnsubscribe();

            username.textContent = 'Visitante';
            btnAuth.textContent = 'Login';
            showSessionSelection();
            characterList.innerHTML = '';
            noCharactersMessage.style.display = 'block';
            noCharactersMessage.textContent = 'Faça login para ver ou criar personagens.';
            btnCreateNewCharacter.style.display = 'none';
            invitesPanel.style.display = 'none';
        }
    };

    const initializeApp = () => {
        const attributeNames = Object.keys(baseAttributes);
        attributeNames.forEach(attr => {
            const div = document.createElement('div');
            div.className = 'attribute-control';
            div.innerHTML = `
                <span>${attr.charAt(0).toUpperCase() + attr.slice(1)}</span>
                <div class="buttons">
                    <button class="btn-sm" data-action="decrease" data-attribute="${attr}">-</button>
                    <span id="attr-${attr}">8</span>
                    <button class="btn-sm" data-action="increase" data-attribute="${attr}">+</button>
                </div>
            `;
            if(attributesGrid) attributesGrid.appendChild(div);
        });
        updateAttributesUI();
        pointsToDistributeSpan.textContent = pointsToDistribute;

        const url = window.location.href;
        if (isSignInWithEmailLink(auth, url)) {
            let email = window.localStorage.getItem('emailForSignIn');
            if (!email) {
                email = window.prompt('Por favor, confirme seu e-mail para completar o login.');
            }
            if (email) {
                signInWithEmailLink(auth, email, url)
                    .then(() => { window.localStorage.removeItem('emailForSignIn'); })
                    .catch(err => {
                        console.error("Erro no login com link:", err);
                        alert("Falha ao fazer login com o link. Pode ter expirado ou o e-mail está incorreto.");
                        window.localStorage.removeItem('emailForSignIn');
                    });
            }
        }
        
        onAuthStateChanged(auth, handleAuthState);
    };

    // Inicia o aplicativo
    initializeApp();
});
