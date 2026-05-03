const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { defineSecret } = require("firebase-functions/params");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const historia = require("./historia.json");

// Inicialização
try { admin.initializeApp(); } catch (e) { console.log("admin.initializeApp() falhou, provavelmente já foi inicializado."); }

const geminiApiKey = defineSecret("GEMINI_API_KEY");
const db = admin.firestore();

const AI_UID = 'master-ai';
const REGION = 'southamerica-east1';

// --- LÓGICA DO JOGO (V2) ---
exports.handlePlayerAction = onDocumentCreated(
    {
        document: 'sessions/{sessionId}/messages/{messageId}',
        region: REGION,
        secrets: [geminiApiKey],
        timeoutSeconds: 180,
        memory: "1GB"
    },
    async (event) => {
        const snapshot = event.data;
        if (!snapshot) {
            console.log("Nenhum dado associado ao evento. Saindo.");
            return;
        }
        const newMessage = snapshot.data();
        const { sessionId, messageId } = event.params;

        if (newMessage.from === 'mestre' || newMessage.isTurnoUpdate) {
            return;
        }
        
        const sessionRef = db.collection('sessions').doc(sessionId);
        const lastPlayerUid = newMessage.uid;

        if (newMessage.text === '__START_ADVENTURE__') {
            await snapshot.ref.delete();
            console.log("Mensagem inicial de aventura deletada. A IA não será acionada por este evento.");
            return; 
        }

        try {
            await sessionRef.update({ turnoAtualUid: AI_UID });

            const sessionDoc = await sessionRef.get();
            const sessionData = sessionDoc.data();
            const updates = {
                turnoAtualUid: AI_UID // Sempre passamos o turno para a IA
            };

            // Se for a primeira ação, adicionamos a flag ao objeto de atualização
            if (sessionData.adventureStarted === false) {
                updates.adventureStarted = true;
            }

            // Realizamos UMA ÚNICA operação de escrita com todas as atualizações
            await sessionRef.update(updates);
            
            const charactersSnapshot = await sessionRef.collection('characters').get();
            const allCharacters = charactersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const playerCharacter = allCharacters.find(c => c.uid === lastPlayerUid);

            if (!playerCharacter) {
                throw new HttpsError('not-found', `Personagem do jogador com UID ${lastPlayerUid} não encontrado.`);
            }

           // --- INÍCIO DA NOVA LÓGICA: CONSCIÊNCIA DE GRUPO ---

           // 1. Criar a string de "Consciência de Grupo"
           const partyMembers = allCharacters
               .filter(c => c.uid !== AI_UID) // Filtrar o Mestre
               .map(c => {
                   // Mapear os dados de cada personagem
                   return `- Nome: ${c.name}, Gênero: ${c.gender}, Orixá: ${c.orixa.name}`;
               })
               .join('\n'); // Juntar com quebra de linha

           // 2. Adicionar a instrução de gênero para o jogador ATUAL (que já tínhamos feito)
           const genderInstruction = playerCharacter.gender === 'feminino'
               ? "A personagem se identifica com o gênero feminino. Use pronomes e adjetivos femininos (ela/dela)."
               : playerCharacter.gender === 'masculino'
               ? "O personagem se identifica com o gênero masculino. Use pronomes e adjetivos masculinos (ele/dele)."
               : "O personagem se identifica como não-binário. Use pronomes e adjetivos neutros (elu/delu).";

           // --- FIM DA NOVA LÓGICA ---
            
            // 1. Construir histórico de chat estruturado
            const historySnapshot = await sessionRef.collection('messages').orderBy('createdAt', 'desc').limit(30).get();
            const chatHistory = historySnapshot.docs
                .filter(doc => !doc.data().isTurnoUpdate && doc.id !== messageId)
                .reverse() // Do mais antigo para o mais novo
                .map(doc => {
                    const data = doc.data();
                    const role = data.from === 'mestre' ? 'model' : 'user';
                    const text = (role === 'user' && data.characterName) 
                        ? `${data.characterName}: ${data.text}`
                        : data.text;
                    return { role, parts: [{ text }] };
                });

            // 2. Garantir que o histórico comece com uma mensagem de 'user'
            const firstUserIndex = chatHistory.findIndex(msg => msg.role === 'user');
            if (firstUserIndex > 0) {
                chatHistory.splice(0, firstUserIndex);
            } else if (firstUserIndex === -1 && chatHistory.length > 0) {
                chatHistory.length = 0; // Limpar se não houver mensagens de usuário
            }
            
            if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
                console.log("O histórico terminava com 'user', removendo a última mensagem para evitar conflito de papéis.");
                chatHistory.pop();
            }

            // 3. Definir a persona da IA (Instrução do Sistema)
            const systemInstruction = `Você é o Mestre do RPG 'Aventuria', um cenário de Afro-fantasia épica. 

                REGRAS DO SISTEMA "O CHAMADO DO AXÉ":
                - O jogo usa a mecânica de d20 + Modificador do Atributo contra uma Classe de Dificuldade (CD).
                - Tabela de CD: Fácil (10), Médio (15), Difícil (20), Heroico (25).
                - NUNCA decida o resultado de uma ação incerta, difícil ou que envolva conflito sem pedir um teste.
                - Se o jogador tentar algo arriscado, PARE a narração e diga exatamente: "Role um d20 para testar seu [Nome do Atributo]. A CD é [Valor]". Aguarde o jogador enviar a rolagem.
                - Vantagem: O jogador rola 2d20 e usa o maior. Desvantagem: Rola 2d20 e usa o menor. Peça isso quando as condições exigirem.
                - Avaliação de Dano: Em combate, se o ataque superar a Defesa (CD), descreva o impacto.
                - Quizilas (Ewós): Monitore as ações do jogador. Se ele violar uma Quizila sagrada do seu Orixá, anuncie a quebra do tabu, reduza seu Axé e aplique Desvantagem em testes futuros até que ele se purifique.

                REGRA DE OURO: Você narra o ambiente e as reações, mas NUNCA joga pelo jogador.`;

            const genAI = new GoogleGenerativeAI(geminiApiKey.value());
            const model = genAI.getGenerativeModel({
                model: "gemini-2.5-flash",
                systemInstruction: systemInstruction,
            });

            // 4. Iniciar o chat com o histórico limpo
            const chat = model.startChat({
                history: chatHistory,
            });
            
            // 5. Construir o prompt para a rodada atual
            const estadoHistoria = sessionData.estadoDaHistoria || 'ato1';
            const atoAtual = historia.atos[estadoHistoria];

            // Função auxiliar para calcular o modificador segundo a tabela do sistema
            const calcularModificador = (valor) => {
                if (valor <= 1) return -2;
                if (valor <= 3) return -1;
                if (valor <= 5) return 0;
                if (valor <= 7) return 1;
                if (valor <= 9) return 2;
                if (valor <= 11) return 3;
                if (valor <= 13) return 4;
                if (valor <= 15) return 5;
                return 6;
            };

            // Extraindo atributos base
            const saude = playerCharacter.attributes.ara.sub.saude.value;
            const agilidade = playerCharacter.attributes.ara.sub.agilidade.value;
            const energiaVital = playerCharacter.attributes.emi.sub.energia.value;

            // Calculando atributos derivados
            const PV = 10 + (saude * 2);
            const PA = 10 + (energiaVital * 2);
            const Defesa = 10 + calcularModificador(agilidade);

            // Montando a ficha formatada com modificadores para a IA
            let fichaFormatada = `Pontos de Vida (PV): ${PV} | Pontos de Axé (PA): ${PA} | Defesa: ${Defesa}\n`;
            for (const cat in playerCharacter.attributes) {
                const categoria = playerCharacter.attributes[cat];
                fichaFormatada += `[${categoria.name}]: `;
                for (const sub in categoria.sub) {
                    const attr = categoria.sub[sub];
                    const mod = calcularModificador(attr.value);
                    const sinal = mod >= 0 ? '+' : '';
                    fichaFormatada += `${attr.name} ${attr.value} (Mod: ${sinal}${mod}), `;
                }
                fichaFormatada += '\n';
            }

            const promptForCurrentTurn = `
                ### CONTEXTO DA AVENTURA ###
                Título do Ato: ${atoAtual.titulo}
                Cenário atual: ${atoAtual.narrativa_inicio}

                ### MEMBROS DO GRUPO PRESENTES NA CENA ###
                ${partyMembers}

                ### FICHA DO JOGADOR ATUAL ###
                Nome: ${playerCharacter.name} (${playerCharacter.gender}) - ${genderInstruction}
                Orixá: ${playerCharacter.orixa.name}
                Quizilas (Ewós): ${playerCharacter.orixa.ewos.join('; ')}
                Atributos:
                ${fichaFormatada}

                ### AÇÃO DO JOGADOR ###
                ${playerCharacter.name}: ${newMessage.text}

                ### SUA TAREFA ###
                1. Se a ação for um teste de dado (ex: "rolou 1d20 e tirou 15"): Some o Modificador adequado da ficha ao valor do dado, compare com a CD da tarefa e narre o sucesso ou falha com base nisso.
                2. Se a ação for comum ou narrativa, apenas descreva o resultado e as reações dos NPCs e do cenário.
                3. Se a ação for arriscada ou iniciar um conflito, EXIJA O TESTE e PARE DE FALAR. Ex: "Role 1d20 + seu modificador de Agilidade (CD 15) para esquivar".
                `;

            // 6. Enviar a mensagem e obter a resposta
            const result = await chat.sendMessage(promptForCurrentTurn);
            const aiResponse = result.response.text();
            
            if (!aiResponse || aiResponse.trim() === '') {
                 throw new Error("A API Gemini retornou uma resposta vazia.");
            }

            await sessionRef.collection('messages').add({
                from: 'mestre',
                characterName: 'Mestre',
                text: aiResponse,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            const playerUIDs = sessionData.ordemDeTurnos.filter(uid => uid !== AI_UID);
            const lastPlayerIndex = playerUIDs.indexOf(lastPlayerUid);
            const nextPlayerIndex = (lastPlayerIndex + 1) % playerUIDs.length;
            const nextPlayerUid = playerUIDs[nextPlayerIndex];

            await sessionRef.update({ turnoAtualUid: nextPlayerUid });

            const nextPlayerCharacter = allCharacters.find(c => c.uid === nextPlayerUid);
            if (nextPlayerCharacter) {
                await sessionRef.collection('messages').add({
                    from: 'mestre',
                    text: `É o turno de ${nextPlayerCharacter.name}.`,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    isTurnoUpdate: true
                });
            }
        } catch (error) {
            console.error(`[handlePlayerAction - ${sessionId}] - ERRO CRÍTICO:`, error);
            await sessionRef.update({ turnoAtualUid: lastPlayerUid });
            await sessionRef.collection('messages').add({
                from: 'mestre',
                text: '(O Mestre parece confuso por um momento. Houve um erro no fluxo do universo. Por favor, tente sua ação novamente.)',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    });

// --- FUNÇÕES DE CICLO DE VIDA DE USUÁRIO (V1) ---
exports.onUserCreate = functions.region(REGION).auth.user().onCreate(async (user) => {
    if (user.displayName || !user.email) {
        console.log(`Usuário ${user.uid} já possui um displayName ou não tem e-mail. Ignorando.`);
        return;
    }
    const newDisplayName = user.email.split('@')[0];
    try {
        await admin.auth().updateUser(user.uid, { displayName: newDisplayName });
        console.log(`DisplayName atualizado para ${newDisplayName} para o usuário ${user.uid}.`);
    } catch (error) {
        console.error(`Falha ao atualizar o displayName para o usuário ${user.uid}:`, error);
    }
});

// --- FUNÇÕES DE SESSÃO E JOGO (V2) ---
exports.createAndJoinSession = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação necessária.');
    const { characterName, attributes, orixa, gender } = request.data; //
    if (!characterName || !attributes || !orixa || !gender) throw new HttpsError('invalid-argument', 'Dados do personagem incompletos.'); //
    
    const uid = request.auth.uid;
    try {
        const sessionRef = await db.collection("sessions").add({
            owner: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            memberUIDs: [uid, AI_UID],
            turnoAtualUid: uid,
            ordemDeTurnos: [uid, AI_UID],
            estadoDaHistoria: "ato1",
            adventureStarted: false
        });

        const playerCharacter = { name: characterName, attributes, orixa, gender, uid, sessionId: sessionRef.id }; //
        const aiCharacter = { name: "Mestre", attributes: {}, uid: AI_UID, sessionId: sessionRef.id };

        const batch = db.batch();
        batch.set(sessionRef.collection('characters').doc(uid), playerCharacter);
        batch.set(db.collection('characters').doc(), { ...playerCharacter, characterIdInSession: uid });
        batch.set(sessionRef.collection('characters').doc(AI_UID), aiCharacter);
        await batch.commit();

        // ADICIONE ESTE BLOCO DE VOLTA
        await sessionRef.collection('messages').add({
            from: 'player',
            text: '__START_ADVENTURE__',
            characterName: playerCharacter.name,
            uid: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, sessionId: sessionRef.id };
    } catch (error) {
        console.error("Erro em createAndJoinSession:", error);
        throw new HttpsError('internal', 'Não foi possível criar a sessão.', error);
    }
});

exports.joinSession = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação necessária.');
    const { sessionId, characterName, attributes, orixa, gender } = request.data; //
    if (!sessionId || !characterName || !attributes || !orixa || !gender) throw new HttpsError('invalid-argument', 'Dados incompletos.');
    const uid = request.auth.uid;
    const sessionRef = db.collection('sessions').doc(sessionId);
    try {
        await db.runTransaction(async (transaction) => {
            const sessionDoc = await transaction.get(sessionRef);
            if (!sessionDoc.exists) throw new HttpsError('not-found', 'Sessão não encontrada.');
            transaction.update(sessionRef, { memberUIDs: admin.firestore.FieldValue.arrayUnion(uid), ordemDeTurnos: admin.firestore.FieldValue.arrayUnion(uid) });
            const newCharacter = { name: characterName, attributes, orixa, gender, uid, sessionId }; //
            transaction.set(sessionRef.collection('characters').doc(uid), newCharacter);
            transaction.set(db.collection('characters').doc(), { ...newCharacter, characterIdInSession: uid });
        });
        return { success: true };
    } catch (error) {
        console.error(`Erro ao entrar na sessão ${sessionId}:`, error);
        throw new HttpsError('internal', 'Não foi possível entrar na sessão.', error);
    }
});

exports.passarTurno = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação necessária.');
    const { sessionId } = request.data;
    if (!sessionId) throw new HttpsError('invalid-argument', 'ID da sessão obrigatório.');
    const uid = request.auth.uid;
    const sessionRef = db.collection('sessions').doc(sessionId);
    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists) throw new HttpsError('not-found', 'Sessão não encontrada.');
    const sessionData = sessionDoc.data();
    if (sessionData.turnoAtualUid !== uid) throw new HttpsError('permission-denied', 'Não é seu turno.');
    
    await sessionRef.collection('messages').add({
        from: 'player',
        text: '*Passa o turno para o Mestre*',
        characterName: 'Sistema',
        uid: uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return { success: true };
});

exports.sendInvite = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação necessária.');
    const { email, sessionId } = request.data; 
    if (!email || !sessionId) throw new HttpsError('invalid-argument', 'Dados incompletos.');
    const senderUid = request.auth.uid; 
    try {
        const recipientUser = await admin.auth().getUserByEmail(email);
        if (senderUid === recipientUser.uid) throw new HttpsError('invalid-argument', 'Você não pode convidar a si mesmo.');
        const sessionDoc = await db.collection('sessions').doc(sessionId).get();
        if (!sessionDoc.exists || sessionDoc.data().memberUIDs?.includes(recipientUser.uid)) throw new HttpsError('already-exists', 'Usuário já está na sessão.');
        const charDoc = await sessionDoc.ref.collection('characters').doc(senderUid).get();
        if (!charDoc.exists) throw new HttpsError('not-found', 'Seu personagem não foi encontrado.');
        await db.collection('invites').add({
            senderId: senderUid, senderCharacterName: charDoc.data().name, recipientEmail: email,
            recipientUid: recipientUser.uid, sessionId: sessionId, status: 'pending', createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: true, message: `Convite enviado para ${email}.` };
    } catch (error) {
        if (error.code === 'auth/user-not-found') throw new HttpsError('not-found', `Usuário com e-mail ${email} não encontrado.`);
        throw new HttpsError('internal', 'Erro ao enviar convite.', error);
    }
});

exports.getPendingInvites = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação necessária.');
    const snapshot = await db.collection('invites').where('recipientUid', '==', request.auth.uid).where('status', '==', 'pending').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});

exports.acceptInvite = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação necessária.');
    const { inviteId } = request.data;
    if (!inviteId) throw new HttpsError('invalid-argument', 'ID do convite obrigatório.');
    const inviteRef = db.collection('invites').doc(inviteId);
    try {
        const { sessionId } = await db.runTransaction(async (t) => {
            const inviteDoc = await t.get(inviteRef);
            if (!inviteDoc.exists || inviteDoc.data().recipientUid !== request.auth.uid) throw new HttpsError('permission-denied', 'Convite inválido.');
            t.update(inviteRef, { status: 'accepted' });
            return { sessionId: inviteDoc.data().sessionId };
        });
        return { success: true, sessionId };
    } catch (error) {
        throw new HttpsError('internal', 'Erro ao aceitar convite.', error);
    }
});

exports.declineInvite = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação necessária.');
    const { inviteId } = request.data;
    if (!inviteId) throw new HttpsError('invalid-argument', 'ID do convite obrigatório.');
    const inviteRef = db.collection('invites').doc(inviteId);
    const inviteDoc = await inviteRef.get();
    if (!inviteDoc.exists || inviteDoc.data().recipientUid !== request.auth.uid) throw new HttpsError('permission-denied', 'Convite inválido.');
    await inviteRef.update({ status: 'declined' }); 
    return { success: true };
});

exports.deleteCharacterAndSession = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Você precisa estar logado.');
    const { characterId, sessionId } = request.data;
    if (!characterId || !sessionId) throw new HttpsError('invalid-argument', 'IDs do personagem e da sessão são obrigatórios.');
    const uid = request.auth.uid;
    const characterRef = db.collection('characters').doc(characterId);
    const sessionRef = db.collection('sessions').doc(sessionId);
    try {
        const charDoc = await characterRef.get();
        if (!charDoc.exists || charDoc.data().uid !== uid) throw new HttpsError('permission-denied', 'Você não tem permissão para excluir este personagem.');
        await characterRef.delete();
        await deleteCollection(db, `sessions/${sessionId}/messages`, 100);
        await deleteCollection(db, `sessions/${sessionId}/characters`, 100);
        await sessionRef.delete();
        return { success: true, message: 'Personagem e sessão excluídos com sucesso.' };
    } catch (error) {
        console.error("Erro ao excluir personagem e sessão:", error);
        throw new HttpsError('internal', 'Ocorreu um erro inesperado no servidor.', error);
    }
});

async function deleteCollection(db, collectionPath, batchSize) {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.orderBy('__name__').limit(batchSize);
    return new Promise((resolve, reject) => deleteQueryBatch(db, query, resolve, reject));
}

async function deleteQueryBatch(db, query, resolve, reject) {
    try {
        const snapshot = await query.get();
        if (snapshot.size === 0) return resolve();
        const batch = db.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        process.nextTick(() => deleteQueryBatch(db, query, resolve, reject));
    } catch (err) {
        reject(err);
    }
}
