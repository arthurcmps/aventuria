/*
 *  public/js/script.js (v3.5 - SELEÇÃO DE ORIXÁ)
 *  - Adicionado `orixasData` para armazenar informações sobre os Orixás.
 *  - `resetAndOpenCharacterCreationModal` agora popula o <select> de Orixás.
 *  - Novo listener para `orixa-select` que exibe dinamicamente as informações do Orixá escolhido.
 *  - `btnSaveCharacter` agora valida a seleção de um Orixá e salva a informação no personagem.
 *  - `loadSession` foi atualizada para exibir os detalhes do Orixá do personagem na ficha do jogo.
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
    const characterSheet = document.getElementById('character-sheet');
    const characterSheetAttributes = document.getElementById('character-sheet-attributes');
    const diceRoller = document.getElementById('dice-roller');
    const characterCreationModal = document.getElementById('character-creation-modal');
    const btnCloseCharCreation = document.getElementById('btn-close-char-creation');
    const inviteModal = document.getElementById('invite-modal');
    const btnCancelInvite = document.getElementById('btn-cancel-invite');
    const btnSendInvite = document.getElementById('btn-send-invite');
    const creationLoadingIndicator = document.getElementById('creation-loading-indicator');
    const charNameInput = document.getElementById('char-name');
    const btnSaveCharacter = document.getElementById('btn-save-character');
    const inviteEmailInput = document.getElementById('invite-email');
    const turnStatus = document.getElementById('turn-status');
    const btnPassTurn = document.getElementById('btn-pass-turn');
    const attributeAccordion = document.getElementById('attribute-accordion');
    const orixaSelect = document.getElementById('orixa-select');
    const orixaDetailsContainer = document.getElementById('orixa-details-container');
    const orixaName = document.getElementById('orixa-name');
    const orixaDescription = document.getElementById('orixa-description');
    const orixaHabilidades = document.getElementById('orixa-habilidades');
    const orixaEwos = document.getElementById('orixa-ewos');


    // --- ESTADO DA APLICAÇÃO ---
    let currentUser = null;
    let currentCharacter = null;
    let currentSessionId = null;
    let messagesUnsubscribe = null;
    let partyUnsubscribe = null;
    let sessionUnsubscribe = null;
    const AI_UID = 'master-ai';
    
    // ESTRUTURA DE ATRIBUTOS
    const attributeConfig = {
        ara: { name: 'Ara (Corpo)', points: 16, sub: { forca: { name: 'Força', value: 1 }, vigor: { name: 'Vigor', value: 1 }, agilidade: { name: 'Agilidade', value: 1 }, saude: { name: 'Saúde', value: 1 } } },
        ori: { name: 'Orí (Cabeça/Destino)', points: 16, sub: { inteligencia: { name: 'Inteligência', value: 1 }, percepcao: { name: 'Percepção', value: 1 }, vontade: { name: 'Força de Vontade', value: 1 }, conexao: { name: 'Conexão com Orixá', value: 1 } } },
        emi: { name: 'Emi (Espírito/Respiração)', points: 16, sub: { energia: { name: 'Energia Vital', value: 1 }, carisma: { name: 'Carisma', value: 1 }, inspirar: { name: 'Capacidade de Inspirar', value: 1 }, sorte: { name: 'Sorte', value: 1 } } }
    };
    let attributes = {};

    // --- DADOS DOS ORIXÁS (NOVO) ---
    const orixasData = {
        exu: {
            name: "Exu",
            description: "O mensageiro, guardião das encruzilhadas e da comunicação. É o Orixá que abre e fecha os caminhos.",
            habilidades: ["Comunicação Aprimorada (rolagens sociais com vantagem)", "Sentir Passagens Secretas"],
            ewos: ["Não pode ignorar um pedido de ajuda", "Evita a cor branca"]
        },
        ogum: {
            name: "Ogum",
            description: "O senhor da guerra, do ferro e da tecnologia. Desbravador que avança sem medo.",
            habilidades: ["Maestria com Armas (dano extra com armas de metal)", "Forja Rápida (pode reparar itens de metal)"],
            ewos: ["Não pode recusar um desafio para combate honrado", "Não come caracóis"]
        },
        oxossi: {
            name: "Oxóssi",
            description: "O caçador, rei das matas e da fartura. Conhecedor dos segredos da floresta e dos animais.",
            habilidades: ["Rastreamento Infalível", "Mira Certeira (vantagem em ataques à distância)"],
            ewos: ["Não caça por esporte", "Não come mel"]
        },
        xango: {
            name: "Xangô",
            description: "O rei da justiça, senhor dos raios, do trovão e do fogo. Imoderado e justo.",
            habilidades: ["Senso de Justiça (percebe mentiras)", "Resistência ao Fogo"],
            ewos: ["Não tolera injustiça", "Não come carne de carneiro"]
        }
    };


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
                charElement.innerHTML = `<h4>${character.name}</h4><p>${character.orixa.name || 'Sem Orixá'}</p>`;
                characterList.appendChild(charElement);
            });
        } catch (error) {
            console.error("Erro ao carregar personagens:", error);
        }
    }
    
    // ATUALIZADO PARA EXIBIR ORIXÁ NA FICHA
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

            // Renderiza Atributos
            for (const mainAttrKey in currentCharacter.attributes) {
                const mainAttrData = currentCharacter.attributes[mainAttrKey];
                const groupLi = document.createElement('li');
                groupLi.className = 'main-attribute-group';
                const subList = Object.keys(mainAttrData.sub).map(subAttrKey => {
                    const subAttr = mainAttrData.sub[subAttrKey];
                    return `<li><span class="attr-name">${subAttr.name}</span> <span class="attr-value">${subAttr.value}</span></li>`;
                }).join('');
                groupLi.innerHTML = `<div class="group-header">${mainAttrData.name}</div><ul class="sub-attribute-list">${subList}</ul>`;
                characterSheetAttributes.appendChild(groupLi);
            }

            // Renderiza Orixá (NOVO)
            const oldOrixaSheet = document.getElementById('character-sheet-orixa');
            if(oldOrixaSheet) oldOrixaSheet.remove();

            if (currentCharacter.orixa) {
                const orixa = currentCharacter.orixa;
                const orixaSheetDiv = document.createElement('div');
                orixaSheetDiv.id = 'character-sheet-orixa';
                orixaSheetDiv.innerHTML = `
                    <h4>${orixa.name}</h4>
                    <h5>Habilidades</h5>
                    <ul>${orixa.habilidades.map(h => `<li>${h}</li>`).join('')}</ul>
                    <h5>Ewós</h5>
                    <ul>${orixa.ewos.map(e => `<li>${e}</li>`).join('')}</ul>
                `;
                characterSheet.appendChild(orixaSheetDiv);
            }

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
        
        if (user) {
            currentUser = user; 
            username.textContent = user.displayName || user.email.split('@')[0];
            btnAuth.textContent = 'Sair';
            noCharactersMessage.textContent = 'Você ainda não tem personagens.';
            showView(sessionSelectionOverlay);
            await Promise.all([loadUserCharacters(user.uid), loadPendingInvitesInternal()]);
        } else {
            currentUser = null;
            window.location.href = 'login.html';
        }
        loadingOverlay.style.display = 'none';
        pageContent.style.display = 'block';
    });

    // --- LISTENERS DE EVENTOS ---

    btnMenu.addEventListener('click', (e) => { e.stopPropagation(); sidePanel.classList.toggle('open'); });
    document.addEventListener('click', (e) => { if (sidePanel.classList.contains('open') && !sidePanel.contains(e.target) && !btnMenu.contains(e.target)) { sidePanel.classList.remove('open'); } });
    btnAuth.addEventListener('click', () => { if (currentUser) signOut(auth); else window.location.href = 'login.html'; });
    btnBackToSelection.addEventListener('click', returnToSelectionScreen);
    btnSend.addEventListener('click', () => sendChatMessage(inputText.value));
    inputText.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(inputText.value); }});
    btnPassTurn.addEventListener('click', passTurn);
    characterList.addEventListener('click', (e) => { const card = e.target.closest('.character-card'); if (card) loadSession(card.dataset.sessionId); });

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
        } catch (error) { alert(error.message); button.disabled = false; }
    });
    
    // ATUALIZADO PARA INCLUIR ORIXÁS
    function resetAndOpenCharacterCreationModal() {
        hideModal(inviteModal);
        charNameInput.value = '';
        attributes = JSON.parse(JSON.stringify(attributeConfig));
        
        // Populando o seletor de Orixás (NOVO)
        orixaSelect.innerHTML = '<option value="">-- Escolha seu Orixá --</option>';
        for (const key in orixasData) {
            orixaSelect.innerHTML += `<option value="${key}">${orixasData[key].name}</option>`;
        }
        orixaSelect.value = '';
        orixaDetailsContainer.style.display = 'none';

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
    
    // ATUALIZADO PARA INCLUIR ORIXÁ NA CRIAÇÃO
    btnSaveCharacter.addEventListener('click', async () => {
        if (charNameInput.value.trim().length < 3) return alert('O nome do personagem deve ter pelo menos 3 caracteres.');
        for (const key in attributes) {
            if (attributes[key].points > 0) return alert(`Você ainda tem ${attributes[key].points} pontos para distribuir em ${attributes[key].name}!`);
        }
        const selectedOrixaKey = orixaSelect.value;
        if (!selectedOrixaKey) return alert('Você precisa escolher um Orixá!');

        creationLoadingIndicator.style.display = 'flex';
        btnSaveCharacter.style.display = 'none';
        charNameInput.disabled = true;

        try {
            const joiningSessionId = sessionStorage.getItem('joiningSessionId');
            const characterData = {
                characterName: charNameInput.value.trim(),
                attributes: attributes,
                orixa: orixasData[selectedOrixaKey] // Adiciona o objeto do Orixá
            };
            
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
    
    // LÓGICA DE CRIAÇÃO DE ATRIBUTOS (SEM MUDANÇAS)
    function updateCreationUI() {
        attributeAccordion.innerHTML = '';
        for (const mainAttrKey in attributes) {
            const mainAttrData = attributes[mainAttrKey];
            const subItemsHTML = Object.keys(mainAttrData.sub).map(subAttrKey => {
                const subAttr = mainAttrData.sub[subAttrKey];
                return `<li class="sub-attribute-item"><span class="sub-attr-name">${subAttr.name}</span><div class="attribute-controls"><button class="btn btn-attr" data-op="-" data-main-key="${mainAttrKey}" data-sub-key="${subAttrKey}" ${subAttr.value <= 1 ? 'disabled' : ''}>-</button><span class="attr-value">${subAttr.value}</span><button class="btn btn-attr" data-op="+" data-main-key="${mainAttrKey}" data-sub-key="${subAttrKey}" ${mainAttrData.points <= 0 ? 'disabled' : ''}>+</button></div></li>`;
            }).join('');
            const itemDiv = document.createElement('div');
            itemDiv.className = 'attribute-item';
            itemDiv.innerHTML = `<div class="attribute-header" data-main-key="${mainAttrKey}"><span class="attribute-title">${mainAttrData.name}</span><span class="points-counter">Pontos: <span class="points-left">${mainAttrData.points}</span></span></div><div class="attribute-details"><ul class="sub-attribute-list">${subItemsHTML}</ul></div>`;
            attributeAccordion.appendChild(itemDiv);
        }
    }
    
    attributeAccordion.addEventListener('click', (e) => {
        const header = e.target.closest('.attribute-header');
        if (header) { const details = header.nextElementSibling; if (!details.classList.contains('open')) { document.querySelectorAll('.attribute-details.open').forEach(el => el.classList.remove('open')); details.classList.add('open'); } return; }
        const button = e.target.closest('.btn-attr');
        if (button) {
            const mainKey = button.dataset.mainKey; const subKey = button.dataset.subKey; const op = button.dataset.op; const mainAttr = attributes[mainKey]; const subAttr = mainAttr.sub[subKey];
            if (op === '+' && mainAttr.points > 0) { subAttr.value++; mainAttr.points--; } else if (op === '-' && subAttr.value > 1) { subAttr.value--; mainAttr.points++; }
            updateCreationUI();
            const activeHeader = attributeAccordion.querySelector(`.attribute-header[data-main-key="${mainKey}"]`);
            if(activeHeader) activeHeader.nextElementSibling.classList.add('open');
        }
    });

    // NOVO LISTENER PARA SELEÇÃO DE ORIXÁ
    orixaSelect.addEventListener('change', (e) => {
        const selectedOrixaKey = e.target.value;
        if (selectedOrixaKey && orixasData[selectedOrixaKey]) {
            const data = orixasData[selectedOrixaKey];
            orixaName.textContent = data.name;
            orixaDescription.textContent = data.description;
            orixaHabilidades.innerHTML = data.habilidades.map(h => `<li>${h}</li>`).join('');
            orixaEwos.innerHTML = data.ewos.map(ew => `<li>${ew}</li>`).join('');
            orixaDetailsContainer.style.display = 'block';
        } else {
            orixaDetailsContainer.style.display = 'none';
        }
    });
    
    btnInvitePlayer.addEventListener('click', () => { if (!currentSessionId) return alert("Você precisa estar em uma sessão para convidar jogadores."); inviteEmailInput.value = ''; showModal(inviteModal); });
    btnCancelInvite.addEventListener('click', () => hideModal(inviteModal));

    btnSendInvite.addEventListener('click', async () => {
        const email = inviteEmailInput.value.trim();
        if (!email.includes('@')) return alert('Por favor, insira um e-mail válido.');
        btnSendInvite.disabled = true; btnSendInvite.textContent = 'Enviando...';
        try {
            const result = await sendInvite({ email, sessionId: currentSessionId });
            alert(result.data.message);
            hideModal(inviteModal);
        } catch (error) {
            alert(`Erro: ${error.message}`);
        } finally {
            btnSendInvite.disabled = false; btnSendInvite.textContent = 'Enviar Convite';
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
