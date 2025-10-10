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
// VERSÃO FINAL CORRIGIDA - SUBSTITUA A FUNÇÃO INTEIRA
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
        if (!snapshot) { return; }

        const newMessage = snapshot.data();
        const { sessionId } = event.params;

        if (newMessage.from === 'mestre' || newMessage.isTurnoUpdate) {
            return;
        }
        
        const sessionRef = db.collection('sessions').doc(sessionId);
        const lastPlayerUid = newMessage.uid;

        try {
            const sessionDoc = await sessionRef.get();
            if (!sessionDoc.exists) { throw new Error("Sessão não encontrada."); }
            const sessionData = sessionDoc.data();
            
            const updates = { turnoAtualUid: AI_UID };
            if (sessionData.adventureStarted === false) {
                updates.adventureStarted = true;
            }
            await sessionRef.update(updates);
            
            const charactersSnapshot = await sessionRef.collection('characters').get();
            const allCharacters = charactersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const playerCharacter = allCharacters.find(c => c.uid === lastPlayerUid);
            if (!playerCharacter) { throw new HttpsError('not-found', `Personagem ${lastPlayerUid} não encontrado.`); }
            
            const historySnapshot = await sessionRef.collection('messages').orderBy('createdAt', 'desc').limit(30).get();
            const chatHistory = historySnapshot.docs
                .filter(doc => !doc.data().isTurnoUpdate && doc.id !== snapshot.id)
                .reverse()
                .map(doc => {
                    const data = doc.data();
                    const role = data.from === 'mestre' ? 'model' : 'user';
                    const text = (role === 'user' && data.characterName) 
                        ? `${data.characterName}: ${data.text}`
                        : data.text;
                    return { role, parts: [{ text }] };
                });
            if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
                chatHistory.pop();
            }

            const atoId = sessionData.estadoDaHistoria || 'ato1';
            const cenaId = sessionData.cenaAtualId || 'cena1_aldeia';
            const atoAtual = historia.atos[atoId];
            const cenaAtual = atoAtual.cenas.find(c => c.id === cenaId);

            if (!cenaAtual) { throw new Error(`Cena com ID '${cenaId}' não encontrada.`); }

            // =================================================================
            // INÍCIO DA CORREÇÃO: Lógica de formatação dos desafios
            // =================================================================
            let desafiosDaCena = "Nenhum desafio específico definido para esta cena.";
            if (cenaAtual.desafios && cenaAtual.desafios.length > 0) {
                desafiosDaCena = cenaAtual.desafios.map(d => {
                    let acoesFormatadas = "";
                    // Verifica se existe o array de habilidades sugeridas
                    if (d.habilidades_sugeridas && d.habilidades_sugeridas.length > 0) {
                        acoesFormatadas = "Opções de Ação:\n" + d.habilidades_sugeridas.map(h => `- Para '${h.acao}', o atributo é ${h.atributo}.`).join('\n');
                    } 
                    // Senão, verifica se existe um atributo direto
                    else if (d.atributo) {
                        acoesFormatadas = `O atributo principal para este desafio é: ${d.atributo}.`;
                    }
                    
                    return `Descrição do Desafio: ${d.descricao}\n${acoesFormatadas}\nA CD para este desafio é: ${d.cd}.\nEm caso de sucesso: ${d.sucesso}\nEm caso de falha: ${d.falha}`;
                }).join('\n\n');
            }
            // =================================================================
            // FIM DA CORREÇÃO
            // =================================================================

            const promptForCurrentTurn = `
### REGRAS GERAIS DO JOGO ###
Fórmula de Teste: ${historia.regras_gerais.formula_teste}
CDs: Fácil(${historia.regras_gerais.tabela_cd.Facil}), Médio(${historia.regras_gerais.tabela_cd.Medio}), Difícil(${historia.regras_gerais.tabela_cd.Dificil}), Heroico(${historia.regras_gerais.tabela_cd.Heroico}).

### CONTEXTO DA AVENTURA ATUAL ###
Ato: ${atoAtual.titulo}
Cena Atual: ${cenaAtual.titulo}
Descrição da Cena: ${cenaAtual.narrativa}

### DESAFIOS DISPONÍVEIS NA CENA ###
${desafiosDaCena}

### PERSONAGEM DO JOGADOR ATUAL ###
Nome: ${playerCharacter.name}
Orixá: ${playerCharacter.orixa.name}

### AÇÃO DO JOGADOR ###
${playerCharacter.name}: ${newMessage.text}

### SUA TAREFA COMO MESTRE ###
1. Analise a 'AÇÃO DO JOGADOR'.
2. Verifique se a ação corresponde a um dos 'DESAFIOS DISPONÍVEIS NA CENA'.
3. Se corresponder, narre a situação e peça ao jogador para fazer o teste de atributo apropriado, informando a CD. Use o formato exato: "Por favor, faça um teste de [Nome do Atributo] (CD [Número])".
4. Se a ação do jogador for uma resposta a um pedido de teste (ex: "rolou 1d20 e tirou 15"), compare o resultado com a CD e narre a consequência de 'sucesso' ou 'falha' descrita no desafio.
5. Se a ação não corresponder a nenhum desafio, narre uma resposta coerente com a cena e os personagens. Termine dando espaço para o próximo jogador agir.
`;
            
            const systemInstruction = `Você é o Mestre de um jogo de RPG de mesa, narrando uma aventura épica baseada na cosmologia dos Orixás. Sua responsabilidade é seguir as regras e o contexto fornecidos, descrever o mundo, interpretar NPCs, apresentar os desafios definidos e reagir às ações dos jogadores. Mantenha um tom narrativo e imersivo. Nunca saia do personagem. Siga estritamente o fluxo de pedir testes e narrar consequências conforme instruído na 'SUA TAREFA'.

Quando uma condição de transição de cena for cumprida, sua narração deve descrever o início da nova jornada e, ao final do seu texto, você DEVE incluir um comando especial para o sistema no seguinte formato exato: [AVANÇAR_CENA:id_da_proxima_cena].`;

            const genAI = new GoogleGenerativeAI(geminiApiKey.value());
            const model = genAI.getGenerativeModel({
                model: "gemini-1.5-flash", 
                systemInstruction: systemInstruction,
            });

            const chat = model.startChat({ history: chatHistory });
            const result = await chat.sendMessage(promptForCurrentTurn);
            let aiResponse = result.response.text();
            
            if (!aiResponse || aiResponse.trim() === '') {
                 throw new Error("A API Gemini retornou uma resposta vazia.");
            }

            const transicaoRegex = /\[AVANÇAR_CENA:(.*?)\]/;
            const transicaoMatch = aiResponse.match(transicaoRegex);

            if (transicaoMatch) {
                const proximaCenaId = transicaoMatch[1];
                await sessionRef.update({ cenaAtualId: proximaCenaId });
                aiResponse = aiResponse.replace(transicaoRegex, '').trim();
            }

            await sessionRef.collection('messages').add({
                from: 'mestre', text: aiResponse, createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            const playerUIDs = sessionData.ordemDeTurnos.filter(uid => uid !== AI_UID);
            const lastPlayerIndex = playerUIDs.indexOf(lastPlayerUid);
            const nextPlayerIndex = (lastPlayerIndex + 1) % playerUIDs.length;
            const nextPlayerUid = playerUIDs[nextPlayerIndex];

            await sessionRef.update({ turnoAtualUid: nextPlayerUid });

            const nextPlayerCharacter = allCharacters.find(c => c.uid === nextPlayerUid);
            if (nextPlayerCharacter) {
                await sessionRef.collection('messages').add({
                    from: 'mestre', text: `É o turno de ${nextPlayerCharacter.name}.`,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(), isTurnoUpdate: true
                });
            }
        } catch (error) {
            console.error(`[handlePlayerAction] - ERRO CRÍTICO:`, error);
            await sessionRef.update({ turnoAtualUid: lastPlayerUid });
            await sessionRef.collection('messages').add({
                from: 'mestre',
                text: '(O Mestre parece confuso por um momento. Houve um erro no fluxo do universo. Por favor, tente sua ação novamente.)',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    });

exports.joinSession = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Autenticação necessária.');
    const { sessionId, characterName, attributes, orixa } = request.data;
    if (!sessionId || !characterName || !attributes || !orixa) throw new HttpsError('invalid-argument', 'Dados incompletos.');
    const uid = request.auth.uid;
    const sessionRef = db.collection('sessions').doc(sessionId);
    try {
        await db.runTransaction(async (transaction) => {
            const sessionDoc = await transaction.get(sessionRef);
            if (!sessionDoc.exists) throw new HttpsError('not-found', 'Sessão não encontrada.');
            transaction.update(sessionRef, { memberUIDs: admin.firestore.FieldValue.arrayUnion(uid), ordemDeTurnos: admin.firestore.FieldValue.arrayUnion(uid) });
            const newCharacter = { name: characterName, attributes, orixa, uid, sessionId };
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
