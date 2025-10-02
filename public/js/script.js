/*
 * public/js/script.js (v3.6 - Notificações Personalizadas)
 * - Adicionada a função `showNotification` para criar toasts de sucesso/erro.
 * - Substituídos os `alert()` na função de exclusão de personagem pela nova `showNotification`.
 * - Pequena melhoria visual no estado de "carregando" do botão de excluir.
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
    const confirmDeleteModal = document.getElementById('confirm-delete-modal');
    const btnConfirmDelete = document.getElementById('btn-confirm-delete');
    const btnCancelDelete = document.getElementById('btn-cancel-delete');


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
            description: "O mensageiro, o guardião das encruzilhadas, aquele que abre e fecha os caminhos. Ele é a ponte entre os seres humanos e os Orixás. Seus filhos são comunicativos, inteligentes, astutos e imprevisíveis.",
            habilidades: ["Senhor das Encruzilhadas: Habilidade de encontrar passagens, atalhos e soluções inesperadas.", "Ver a Verdade: Capacidade de perceber as verdadeiras intenções e mentiras.", "Elo de Comunicação: Facilidade sobrenatural para aprender idiomas e se comunicar."],
            ewos: ["Não pode se recusar a entregar uma mensagem.", "Não pode passar por uma encruzilhada sem uma saudação.", "É proibido de se vestir de branco em certas tradições."]
        },
        ogum: {
            name: "Ogum",
            description: "O Ferreiro, O Guerreiro, O Desbravador. Rege o ferro, a tecnologia e as estradas. Seus filhos são impulsivos, diretos, protetores e pioneiros.",
            habilidades: ["Maestria em Batalha: Bônus em combate com armas de metal.", "Forja Abençoada: Capacidade de criar ou consertar itens de metal com velocidade ou qualidade sobrenatural.", "Abrir Caminhos: Habilidade de superar obstáculos físicos ou burocráticos."],
            ewos: ["Não pode ser injusto ou negar ajuda a quem pede proteção.", "Não pode deixar suas 'ferramentas' (armas) enferrujarem.", "Pode ser proibido de comer certos alimentos (ex: quiabo)."]
        },
        oxossi: {
            name: "Oxóssi",
            description: "O caçador, o rei das matas, Orixá da fartura e do conhecimento. Seus filhos são curiosos, ágeis, observadores e provedores para sua comunidade.",
            habilidades: ["Mira Certeira: Bônus excepcionais ao usar armas de longo alcance.", "Mestre das Matas: Habilidade de se mover silenciosamente pela selva e rastrear.", "Bênção da Fartura: Sorte para encontrar comida e recursos."],
            ewos: ["Não pode caçar por esporte ou matar animais de forma cruel.", "Não pode negar comida a quem tem fome.", "Deve evitar o mel de abelha."]
        },
        ossain: {
            name: "Ossain",
            description: "O senhor das folhas sagradas, da cura e dos segredos da floresta. Seus filhos são reservados, estudiosos, pacientes e extremamente ligados à natureza.",
            habilidades: ["Conhecimento Herbal: Capacidade de identificar qualquer planta e suas propriedades.", "Mestre da Cura: Habilidade de criar poções e rituais que curam ferimentos e doenças.", "Invocar a Floresta: Capacidade de pedir auxílio aos espíritos da mata."],
            ewos: ["Não pode colher uma folha sem antes pedir licença.", "Não pode revelar os segredos das folhas a quem não for digno.", "Deve evitar fofocas e conversas frívolas."]
        },
        omolu: {
            name: "Omolu",
            description: "Omolu (ou Obaluaiê) é o senhor da terra, que rege a saúde e a doença. Seus filhos são sérios, introspectivos, resilientes e empáticos com a dor alheia",
            habilidades: ["Resistência à Dor: Capacidade de suportar ferimentos e doenças.", "Mão que Cura, Mão que Fere: Habilidade de estancar doenças ou lançar pragas.", "Diálogo com os Espíritos: Capacidade de conversar com os espíritos dos mortos."],
            ewos: ["Não pode ter medo da doença ou da morte.", "Deve sempre respeitar os mais velhos.", "Deve evitar a claridade excessiva do sol do meio-dia."]
        },
        oxumare: {
            name: "Oxumaré",
            description: "O Orixá do arco-íris e da serpente, representando o movimento, a riqueza e a renovação. Seus filhos são perseverantes, enigmáticos, adaptáveis e artísticos.",
            habilidades: ["Caminho do Arco-Íris: Habilidade de se teletransportar entre dois pontos visíveis.", "Pele de Serpente: Capacidade de se regenerar de ferimentos.", "Bênção da Riqueza Cíclica: Grande sorte em negócios, com a condição de que a riqueza deve circular."],
            ewos: ["Não pode matar serpentes.", "Deve evitar comidas que se arrastam no chão, como caranguejos.", "Não pode se prender a um único lugar, devendo abraçar a mudança."]
        },
        ewa: {
            name: "Ewá",
            description: "A Orixá da beleza, da vidência e dos horizontes. Suas filhas são extremamente sensíveis, sonhadoras, tímidas e com grande intuição.",
            habilidades: ["Visão do Inatingível: Capacidade de ver o futuro e o mundo espiritual com clareza.", "Manto de Neblina: Habilidade de criar uma névoa densa para se ocultar.", "Beleza Encantadora: Uma aura que acalma feras e inspira bondade."],
            ewos: ["Não pode se casar ou ter relações sexuais.", "Não pode frequentar lugares sujos ou tumultuados.", "Deve evitar o contato com os mortos."]
        },
        logunede: {
            name: "Logun Edé",
            description: "O príncipe dos Orixás, filho de Oxóssi e Oxum. Une a astúcia do caçador com a beleza e o encanto do ouro. Seus filhos são belos, carismáticos, charmosos e adaptáveis.",
            habilidades: ["Caçador das Águas: Proficiência em combate tanto na mata quanto nos rios.", "Encanto do Príncipe: Carisma sobrenatural em negociações.", "Sorte Dupla: Sorte tanto na busca por fartura quanto na busca por riquezas."],
            ewos: ["Não pode comer carne e peixe na mesma refeição.", "Deve evitar mentiras e traições.", "Não tolera grosseria e desorganização."]
        },
        xango: {
            name: "Xangô",
            description: "O Orixá da Justiça, dos raios, do trovão e do fogo. Seus filhos têm uma postura real e orgulhosa, são líderes natos, justos e carismáticos",
            habilidades: ["Julgamento Real: Habilidade de perceber mentiras e injustiças.", "Fúria do Trovão: Capacidade de invocar poder elemental de raios ou fogo.", "Voz de Comando: Bônus em testes de Intimidação e Liderança."],
            ewos: ["Não pode mentir, quebrar um juramento ou cometer injustiça.", "Não pode agir de forma covarde.", "Deve evitar quiabo e carne de carneiro."]
        },
        oxum: {
            name: "Oxum",
            description: "A Dama dos Rios, do Ouro e do Amor. Rege a água doce, a riqueza, a beleza e a diplomacia. Suas filhas são vaidosas, diplomáticas, estrategistas e sedutoras.",
            habilidades: ["Voz Encantadora: Bônus massivos em testes sociais.", "Visão do Futuro: Capacidade de usar búzios ou um espelho para ter vislumbres do futuro.", "Bênção da Riqueza: Sorte para encontrar recursos valiosos ou em negociações."],
            ewos: ["Não pode ser suja ou desleixada com sua aparência.", "Não pode agir com avareza.", "Proibida de comer feijão."]
        },
        oya: {
            name: "Oyá",
            description: "A Orixá dos ventos, das tempestades e senhora dos espíritos dos mortos. Suas filhas são guerreiras valentes, audaciosas, passionais e de temperamento forte.",
            habilidades: ["Fúria da Tempestade: Capacidade de invocar ventos fortes ou raios.", "Senhora dos Eguns: Habilidade de comandar ou afugentar espíritos de mortos.", "Passo Veloz: Pode se mover com a velocidade de um vendaval."],
            ewos: ["Não pode temer tempestades ou a morte.", "Não pode usar roupas de lã ou comer carne de carneiro.", "Deve ser leal em seus relacionamentos."]
        },
        oba: {
            name: "Obá",
            description: "Orixá guerreira das águas revoltas. Representa a força feminina que luta. Suas filhas são guerreiras, sérias, focadas e de pouca vaidade.",
            habilidades: ["Força da Pororoca: Manifesta força física descomunal em momentos de fúria.", "Dança do Redemoinho: Técnica de luta giratória que a torna difícil de ser atingida.", "Coração de Pedra: Alta resistência a testes sociais de sedução ou controle emocional."],
            ewos: ["Não pode comer caranguejo ou quiabo.", "Não pode demonstrar vaidade excessiva.", "Evita mostrar suas fragilidades, especialmente as amorosas"]
        },
        nana: {
            name: "Nanã",
            description: "A Orixá mais antiga, senhora da lama, dos pântanos e da morte. A avó sábia. Suas filhas são calmas, pacientes, sábias e por vezes ranzinzas.",
            habilidades: ["Toque do Pântano: Capacidade de transformar o chão em lama.", "Sabedoria Ancestral: Pode acessar memórias de seus antepassados.", "Passagem Serena: Habilidade de acalmar espíritos atormentados."],
            ewos: ["Não pode usar objetos de metal, especialmente ferro.", "Não pode agir com pressa ou impaciência.", "Deve evitar ambientes barulhentos."]
        },
        oxala: {
            name: "Oxalá",
            description: "O Orixá maior, criador do mundo e da humanidade. Representa a paz, a sabedoria e a pureza. Seus filhos são calmos, sábios, respeitados e agem como pacificadores.",
            habilidades: ["Manto da Paz: Capacidade de criar uma aura de tranquilidade que impede combates.", "Toque Purificador: Habilidade de limpar venenos, maldições e impurezas.", "Palavra de Sabedoria: Suas palavras são carregadas de axé e podem inspirar ou convencer."],
            ewos: ["Deve se vestir de branco, especialmente nas sextas-feiras.", "Não pode frequentar lugares sujos, barulhentos ou violentos.", "Não pode consumir bebidas alcoólicas, dendê e sal em excesso."]
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
    const deleteCharacterAndSession = httpsCallable(functions, 'deleteCharacterAndSession');

    // --- GERENCIAMENTO DE UI ---

    loadingOverlay.style.display = 'flex';
    pageContent.style.display = 'none';

    /**
     * Exibe uma notificação estilo "toast" no canto da tela.
     * @param {string} message A mensagem a ser exibida.
     * @param {'success' | 'error'} type O tipo de notificação ('success' ou 'error').
     */
    const showNotification = (message, type = 'success') => {
        const container = document.getElementById('notification-container');
        if (!container) {
            console.error('Notification container not found!');
            return;
        }

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        container.appendChild(notification);

        // A animação CSS já cuida do desaparecimento, mas removemos o elemento
        // do DOM após a animação para manter o HTML limpo.
        setTimeout(() => {
            notification.remove();
        }, 5000); // 5 segundos, igual à animação CSS
    };

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
            
            // --- LÓGICA CORRIGIDA ---
            // Simplesmente verificamos se o turno é da IA. 
            // Se não for, exibimos "outro jogador", pois carregar o nome exato aqui é complexo e desnecessário.
            const playerName = (turnoAtualUid === AI_UID) ? "O Mestre" : "outro jogador";
            
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
                charElement.dataset.characterId = doc.id;
                charElement.dataset.sessionId = character.sessionId;
                charElement.innerHTML = `
                    <div class="character-card-info">
                        <h4>${character.name}</h4>
                         <p>${character.orixa?.name || 'Sem Orixá'}</p>
                    </div>
                    <button class="btn-delete-character" title="Excluir Personagem">&times;</button>
                `;
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
            
            // MODIFICADO: Cria a ficha de atributos como um acordeão.
            characterSheetAttributes.innerHTML = '';
            characterSheetAttributes.className = 'attribute-accordion'; 

            for (const mainAttrKey in currentCharacter.attributes) {
                const mainAttrData = currentCharacter.attributes[mainAttrKey];
                
                const subListHTML = Object.keys(mainAttrData.sub).map(subAttrKey => {
                    const subAttr = mainAttrData.sub[subAttrKey];
                    return `<li class="sub-attribute-item"><span class="sub-attr-name">${subAttr.name}</span> <span class="attr-value">${subAttr.value}</span></li>`;
                }).join('');

                const itemDiv = document.createElement('div');
                itemDiv.className = 'attribute-item';
                itemDiv.innerHTML = `
                    <div class="attribute-header">
                        <span class="attribute-title">${mainAttrData.name}</span>
                    </div>
                    <div class="attribute-details">
                        <ul class="sub-attribute-list">${subListHTML}</ul>
                    </div>
                `;
                characterSheetAttributes.appendChild(itemDiv);
            }

            const oldOrixaSheet = document.getElementById('character-sheet-orixa');
            if (oldOrixaSheet) oldOrixaSheet.remove();

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
            showNotification(error.message || "Não foi possível carregar a sessão.", "error");
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
                if (msg.isTurnoUpdate) messageElement.classList.add('system-message');

                const from = msg.from === 'mestre' ? "Mestre" : (msg.characterName || "Jogador");
                const text = msg.text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
                messageElement.innerHTML = `<p class="from">${from}</p><p>${text}</p>`;
                narration.appendChild(messageElement);
            });
            narration.scrollTop = narration.scrollHeight;
        });
    }

    // MODIFICADO: Cria a lista de membros do grupo como um acordeão.
    function listenForPartyChanges(sessionId) {
        const partyQuery = collection(db, 'sessions', sessionId, 'characters');
        
        if (partyUnsubscribe) partyUnsubscribe();

        partyUnsubscribe = onSnapshot(partyQuery, (snapshot) => {
            partyList.innerHTML = '';
            snapshot.docs.forEach(doc => {
                const character = doc.data();
                if (character.uid === AI_UID || character.uid === currentUser.uid) return;

                let attributesHTML = '';
                for (const mainAttrKey in character.attributes) {
                    const mainAttrData = character.attributes[mainAttrKey];
                    attributesHTML += `<strong>${mainAttrData.name}:</strong><ul class="sub-attribute-list">`;
                    for (const subAttrKey in mainAttrData.sub) {
                        const subAttr = mainAttrData.sub[subAttrKey];
                        attributesHTML += `<li><span class="sub-attr-name">${subAttr.name}</span><span class="attr-value">${subAttr.value}</span></li>`;
                    }
                    attributesHTML += `</ul>`;
                }

                const memberCard = document.createElement('li');
                memberCard.className = 'party-member-card';
                memberCard.innerHTML = `
                    <div class="party-member-header">
                        <span class="party-member-name">${character.name}</span>
                        <span class="party-member-orixa">${character.orixa?.name || 'Sem Orixá'}</span>
                    </div>
                    <div class="party-member-details">
                        ${attributesHTML}
                    </div>
                `;
                partyList.appendChild(memberCard);
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
        }
    }

    async function passTurn() {
        if (!currentSessionId) return;
        btnPassTurn.disabled = true;
        try {
            await passarTurno({ sessionId: currentSessionId });
        } catch (error) {
            showNotification(error.message, "error");
            btnPassTurn.disabled = false;
        }
    }

    onAuthStateChanged(auth, async (user) => {
        cleanupSessionListeners();
    
        // LÓGICA DO BOTÃO "MEU PERFIL" IMPLEMENTADA AQUI
        const profileLink = document.getElementById('profile-link');
    
        if (user) {
            currentUser = user;
            username.textContent = user.displayName || user.email.split('@')[0];
            btnAuth.textContent = 'Sair';
            noCharactersMessage.textContent = 'Você ainda não tem personagens.';
            
            // EXIBE O LINK QUANDO O USUÁRIO ESTÁ LOGADO
            if (profileLink) profileLink.style.display = 'inline';
    
            showView(sessionSelectionOverlay);
            await Promise.all([loadUserCharacters(user.uid), loadPendingInvitesInternal()]);
        } else {
            currentUser = null;
            
            // ESCONDE O LINK QUANDO O USUÁRIO NÃO ESTÁ LOGADO
            if (profileLink) profileLink.style.display = 'none';
    
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
    inputText.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(inputText.value); } });
    btnPassTurn.addEventListener('click', passTurn);

    characterList.addEventListener('click', (e) => {
        const deleteButton = e.target.closest('.btn-delete-character');
        const card = e.target.closest('.character-card');
    
        if (deleteButton && card) {
            e.stopPropagation(); 
            const characterId = card.dataset.characterId;
            const sessionId = card.dataset.sessionId;
    
            showModal(confirmDeleteModal);
    
            const handleConfirm = async () => {
                hideModal(confirmDeleteModal);
                deleteButton.disabled = true;
                const originalContent = deleteButton.innerHTML;
                deleteButton.innerHTML = '...';
    
                try {
                    await deleteCharacterAndSession({ characterId, sessionId });
                    showNotification('Personagem e sessão excluídos com sucesso.', 'success');
                    card.remove();
    
                    if (characterList.children.length === 0) {
                        noCharactersMessage.style.display = 'block';
                    }
                } catch (error) {
                    console.error("Erro ao excluir personagem:", error);
                    showNotification(`Erro ao excluir: ${error.message}`, 'error');
                    deleteButton.disabled = false;
                    deleteButton.innerHTML = originalContent;
                }
            };
    
            const handleCancel = () => {
                hideModal(confirmDeleteModal);
                btnConfirmDelete.removeEventListener('click', handleConfirm);
                btnCancelDelete.removeEventListener('click', handleCancel);
            };
    
            btnConfirmDelete.addEventListener('click', handleConfirm, { once: true });
            btnCancelDelete.addEventListener('click', handleCancel, { once: true });
    
        } else if (card && card.dataset.sessionId) {
            loadSession(card.dataset.sessionId);
        }
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
            showNotification(error.message, "error"); 
            button.disabled = false; 
        }
    });

    function resetAndOpenCharacterCreationModal() {
        hideModal(inviteModal);
        charNameInput.value = '';
        attributes = JSON.parse(JSON.stringify(attributeConfig));

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

    btnSaveCharacter.addEventListener('click', async () => {
        if (charNameInput.value.trim().length < 3) {
            return showNotification('O nome do personagem deve ter pelo menos 3 caracteres.', 'error');
        }
        for (const key in attributes) {
            if (attributes[key].points > 0) {
                return showNotification(`Você ainda tem ${attributes[key].points} pontos para distribuir em ${attributes[key].name}!`, 'error');
            }
        }
        const selectedOrixaKey = orixaSelect.value;
        if (!selectedOrixaKey) {
            return showNotification('Você precisa escolher um Orixá!', 'error');
        }

        creationLoadingIndicator.style.display = 'flex';
        btnSaveCharacter.style.display = 'none';
        charNameInput.disabled = true;

        try {
            const joiningSessionId = sessionStorage.getItem('joiningSessionId');
            const characterData = {
                characterName: charNameInput.value.trim(),
                attributes: attributes,
                orixa: orixasData[selectedOrixaKey]
            };

            if (joiningSessionId) {
                await joinSession({ ...characterData, sessionId: joiningSessionId });
                sessionStorage.removeItem('joiningSessionId');
                showNotification(`${characterData.characterName} foi criado e adicionado à sessão!`, 'success');
                await returnToSelectionScreen();
            } else {
                const result = await createAndJoinSession(characterData);
                await loadSession(result.data.sessionId);
            }
            hideModal(characterCreationModal);
        } catch (error) {
            showNotification(`Erro: ${error.message}`, 'error');
            creationLoadingIndicator.style.display = 'none';
            btnSaveCharacter.style.display = 'block';
            charNameInput.disabled = false;
        }
    });

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
            if (activeHeader) activeHeader.nextElementSibling.classList.add('open');
        }
    });

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

    btnInvitePlayer.addEventListener('click', () => { if (!currentSessionId) return showNotification("Você precisa estar em uma sessão para convidar jogadores.", "error"); inviteEmailInput.value = ''; showModal(inviteModal); });
    btnCancelInvite.addEventListener('click', () => hideModal(inviteModal));

    btnSendInvite.addEventListener('click', async () => {
        const email = inviteEmailInput.value.trim();
        if (!email.includes('@')) return showNotification('Por favor, insira um e-mail válido.', "error");
        btnSendInvite.disabled = true; btnSendInvite.textContent = 'Enviando...';
        try {
            const result = await sendInvite({ email, sessionId: currentSessionId });
            showNotification(result.data.message, "success");
            hideModal(inviteModal);
        } catch (error) {
            showNotification(`Erro: ${error.message}`, "error");
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
    
    // Listeners para os novos acordeões do Side Panel
    characterSheetAttributes.addEventListener('click', (e) => {
        const header = e.target.closest('.attribute-header');
        if (header) {
            const details = header.nextElementSibling;
            details.classList.toggle('open');
        }
    });

    partyList.addEventListener('click', (e) => {
        const header = e.target.closest('.party-member-header');
        if (header) {
            const details = header.nextElementSibling;
            details.classList.toggle('open');
        }
    });
});