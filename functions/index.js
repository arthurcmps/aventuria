
/*
 * functions/index.js (VERSÃO UNIFICADA E CORRIGIDA)
 * - As funções `generateMasterResponse` e `executeAITurn` foram removidas.
 * - Adicionada a nova função `handlePlayerAction` que centraliza a lógica da IA, 
 * eliminando condições de corrida e tornando o fluxo de turnos mais estável.
 * - A lógica de `passarTurno` foi mantida para permitir que um jogador passe a vez sem agir.
 * A IA será acionada pela mudança de turno.
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { defineSecret } = require("firebase-functions/params");
const historia = require("./historia.json");

// Inicialização
try { admin.initializeApp(); } catch (e) { console.warn("Falha na inicialização do Admin SDK."); }

const geminiApiKey = defineSecret("GEMINI_API_KEY");
const db = admin.firestore();
const regionalFunctions = functions.region('southamerica-east1');

// --- CONSTANTES --
const AI_UID = 'master-ai'; // UID especial para o Mestre/IA

// --- FUNÇÕES DE CICLO DE VIDA DE USUÁRIO ---
exports.onUserCreate = regionalFunctions.auth.user().onCreate(async (user) => {
    if (user.displayName || !user.email) return null;
    const newDisplayName = user.email.split('@')[0];
    try {
        await admin.auth().updateUser(user.uid, { displayName: newDisplayName });
        console.log(`displayName '${newDisplayName}' atribuído ao novo usuário ${user.uid}.`);
    } catch (error) {
        console.error(`Falha ao atualizar o displayName para o usuário ${user.uid}:`, error);
    }
    return null;
});

// --- FUNÇÕES DE SESSÃO E JOGO ---

exports.createAndJoinSession = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    }
    const { characterName, attributes, orixa } = data;

    console.log("createAndJoinSession: Dados do personagem recebidos:", JSON.stringify(data, null, 2));

    if (!characterName || !attributes || !orixa) {
        throw new functions.https.HttpsError('invalid-argument', 'Nome, atributos e orixá são obrigatórios.');
    }

    const uid = context.auth.uid;
    try {
        const sessionRef = await db.collection("sessions").add({
            owner: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            memberUIDs: [uid, AI_UID],
            turnoAtualUid: uid, 
            ordemDeTurnos: [uid, AI_UID] 
        });

        const playerCharacter = { name: characterName, attributes, orixa, uid, sessionId: sessionRef.id };
        const aiCharacter = { name: "Mestre", attributes: {}, uid: AI_UID, sessionId: sessionRef.id };

        const batch = db.batch();
        batch.set(db.collection('sessions').doc(sessionRef.id).collection('characters').doc(uid), playerCharacter);
        batch.set(db.collection('characters').doc(), { ...playerCharacter, characterIdInSession: uid });
        batch.set(db.collection('sessions').doc(sessionRef.id).collection('characters').doc(AI_UID), aiCharacter);
        await batch.commit();

        // Envia a mensagem especial para acionar a primeira narração da IA
        await db.collection('sessions').doc(sessionRef.id).collection('messages').add({
          from: 'player', 
          text: '__START_ADVENTURE__',
          characterName: playerCharacter.name,
          uid: uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, sessionId: sessionRef.id };

    } catch (error) {
        console.error("Erro em createAndJoinSession:", error);
        throw new functions.https.HttpsError('internal', 'Não foi possível criar a sessão.');
    }
});

exports.joinSession = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    const { sessionId, characterName, attributes, orixa } = data;

    console.log("joinSession: Dados do personagem recebidos:", JSON.stringify(data, null, 2));

    if (!sessionId || !characterName || !attributes || !orixa) throw new functions.https.HttpsError('invalid-argument', 'Dados incompletos.');

    const uid = context.auth.uid;
    const sessionRef = db.collection('sessions').doc(sessionId);
    
    try {
        await db.runTransaction(async (transaction) => {
            const sessionDoc = await transaction.get(sessionRef);
            if (!sessionDoc.exists) throw new functions.https.HttpsError('not-found', 'Sessão não encontrada.');
            
            transaction.update(sessionRef, {
                memberUIDs: admin.firestore.FieldValue.arrayUnion(uid),
                ordemDeTurnos: admin.firestore.FieldValue.arrayUnion(uid) 
            });

            const newCharacter = { name: characterName, attributes, orixa, uid, sessionId };
            transaction.set(sessionRef.collection('characters').doc(uid), newCharacter);
            transaction.set(db.collection('characters').doc(), { ...newCharacter, characterIdInSession: uid });
        });
        return { success: true };
    } catch (error) {
        console.error(`Erro ao entrar na sessão ${sessionId}:`, error);
        throw new functions.https.HttpsError('internal', 'Não foi possível entrar na sessão.');
    }
});

exports.passarTurno = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    const { sessionId } = data;
    if (!sessionId) throw new functions.https.HttpsError('invalid-argument', 'ID da sessão obrigatório.');

    const uid = context.auth.uid;
    const sessionRef = db.collection('sessions').doc(sessionId);

    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists) throw new functions.https.HttpsError('not-found', 'Sessão não encontrada.');
    const sessionData = sessionDoc.data();
    if (sessionData.turnoAtualUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Não é seu turno.');
    }

    // Apenas passa o turno para a IA. A função handlePlayerAction será acionada pela mudança.
    await sessionRef.update({ turnoAtualUid: AI_UID }); 

    return { success: true, proximoTurno: AI_UID };
});


/**
 * Função unificada que lida com a ação de um jogador e executa o turno da IA.
 * Substitui `generateMasterResponse` e `executeAITurn`.
 */
exports.handlePlayerAction = regionalFunctions.runWith({ secrets: [geminiApiKey], timeoutSeconds: 120 }).firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const newMessage = snapshot.data();
    const sessionId = context.params.sessionId;

    if (newMessage.from === 'mestre' || newMessage.isTurnoUpdate) {
        return null;
    }
    
    if (newMessage.text === '__START_ADVENTURE__') {
        await snapshot.ref.delete(); 
    }

    const sessionRef = db.collection('sessions').doc(sessionId);
    const lastPlayerUid = newMessage.uid; 
    
    try {
        console.log(`[handlePlayerAction - ${sessionId}] - Turno do jogador ${lastPlayerUid} recebido. Passando turno para a IA.`);
        await sessionRef.update({ turnoAtualUid: AI_UID });

        const historySnapshot = await sessionRef.collection('messages').orderBy('createdAt', 'desc').limit(20).get();
        const history = historySnapshot.docs.reverse().map(doc => {
            const data = doc.data();
            if (data.isTurnoUpdate) return null;
            return { role: data.from === 'mestre' ? 'model' : 'user', parts: [{ text: `(${data.characterName}): ${data.text}` }] };
        }).filter(Boolean);

        const charactersSnapshot = await sessionRef.collection('characters').get();
        const playerCharacters = charactersSnapshot.docs.map(d => d.data()).filter(c => c.uid !== AI_UID);
        const characterNames = playerCharacters.map(c => c.name).join(', ');
        
        const prompt = `Você é o Mestre de um jogo de RPG de fantasia. Os jogadores são: ${characterNames}. Reaja à última ação no histórico da conversa e avance a história. Seja criativo, narre a cena e mantenha a aventura em movimento.`;
        
        // --- LOG DE DIAGNÓSTICO ADICIONADO ---
        console.log(`[handlePlayerAction - ${sessionId}] - Preparando para chamar a API do Gemini.`);
        console.log(`[handlePlayerAction - ${sessionId}] - Histórico enviado:`, JSON.stringify(history, null, 2));
        console.log(`[handlePlayerAction - ${sessionId}] - Prompt final: ${prompt}`);

        const genAI = new GoogleGenerativeAI(geminiApiKey.value());
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const chat = model.startChat({ 
            history: history,
            systemInstruction: `Você é um mestre de RPG de fantasia. Sua função é narrar uma história colaborativa baseada no seguinte roteiro: ${JSON.stringify(historia)}. Nunca saia do personagem. Descreva cenas, interprete NPCs e apresente desafios. Não fale sobre regras, apenas narre a história.`
        });
        const result = await chat.sendMessage(prompt);
        const aiActionResponse = result.response.text();

        console.log(`[handlePlayerAction - ${sessionId}] - Resposta da IA recebida com sucesso.`);

        await sessionRef.collection('messages').add({
            from: 'mestre',
            characterName: 'Mestre',
            text: aiActionResponse,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        const sessionData = (await sessionRef.get()).data();
        const ordem = sessionData.ordemDeTurnos.filter(uid => uid !== AI_UID);
        const ultimoIndice = ordem.indexOf(lastPlayerUid);
        const proximoIndice = (ultimoIndice + 1) % ordem.length;
        const proximoUid = ordem[proximoIndice];
        
        await sessionRef.update({ turnoAtualUid: proximoUid });
        
        const proximoChar = playerCharacters.find(c => c.uid === proximoUid);
        if (proximoChar) {
             await sessionRef.collection('messages').add({
                from: 'mestre', text: `É o turno de **${proximoChar.name}**.`,
                createdAt: admin.firestore.FieldValue.serverTimestamp(), isTurnoUpdate: true
            });
        }
        return null;

    } catch (error) {
        // --- LOG DE DIAGNÓSTICO MELHORADO ---
        console.error(`[handlePlayerAction - ${sessionId}] - ERRO CRÍTICO no bloco try/catch.`);
        console.error(`[handlePlayerAction - ${sessionId}] - Mensagem do Erro: ${error.message}`);
        console.error(`[handlePlayerAction - ${sessionId}] - Stack do Erro: ${error.stack}`);
        console.error(`[handlePlayerAction - ${sessionId}] - Objeto de Erro Completo:`, JSON.stringify(error, null, 2));

        await sessionRef.collection('messages').add({
            from: 'mestre', text: '(O Mestre parece confuso por um momento. Por favor, tente sua ação novamente.)',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await sessionRef.update({ turnoAtualUid: lastPlayerUid });
        return null;
    }
});


// --- FUNÇÕES DE CONVITE (Sem alterações) ---
exports.sendInvite = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    const { email, sessionId } = data; 
    if (!email || !sessionId) throw new functions.https.HttpsError('invalid-argument', 'Dados incompletos.');
    const senderUid = context.auth.uid; 
    try {
        const recipientUser = await admin.auth().getUserByEmail(email);
        if (senderUid === recipientUser.uid) throw new functions.https.HttpsError('invalid-argument', 'Você não pode convidar a si mesmo.');
        const sessionDoc = await db.collection('sessions').doc(sessionId).get();
        if (!sessionDoc.exists || sessionDoc.data().memberUIDs?.includes(recipientUser.uid)) throw new functions.https.HttpsError('already-exists', 'Usuário já está na sessão.');
        const charDoc = await db.collection('sessions').doc(sessionId).collection('characters').doc(senderUid).get();
        if (!charDoc.exists) throw new functions.https.HttpsError('not-found', 'Seu personagem não foi encontrado.');
        await db.collection('invites').add({
            senderId: senderUid, senderCharacterName: charDoc.data().name, recipientEmail: email,
            recipientUid: recipientUser.uid, sessionId: sessionId, status: 'pending', createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: true, message: `Convite enviado para ${email}.` };
    } catch (error) {
        if (error.code === 'auth/user-not-found') throw new functions.https.HttpsError('not-found', `Usuário com e-mail ${email} não encontrado.`);
        throw new functions.https.HttpsError('internal', 'Erro ao enviar convite.');
    }
});
exports.getPendingInvites = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    const snapshot = await db.collection('invites').where('recipientUid', '==', context.auth.uid).where('status', '==', 'pending').get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
});
exports.acceptInvite = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    const { inviteId } = data;
    if (!inviteId) throw new functions.https.HttpsError('invalid-argument', 'ID do convite obrigatório.');
    const inviteRef = db.collection('invites').doc(inviteId);
    try {
        const { sessionId } = await db.runTransaction(async (t) => {
            const inviteDoc = await t.get(inviteRef);
            if (!inviteDoc.exists || inviteDoc.data().recipientUid !== context.auth.uid) throw new functions.https.HttpsError('permission-denied', 'Convite inválido.');
            t.update(inviteRef, { status: 'accepted' });
            return { sessionId: inviteDoc.data().sessionId };
        });
        return { success: true, sessionId };
    } catch (error) {
        throw new functions.https.HttpsError('internal', 'Erro ao aceitar convite.');
    }
});
exports.declineInvite = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    const { inviteId } = data;
    if (!inviteId) throw new functions.https.HttpsError('invalid-argument', 'ID do convite obrigatório.');
    const inviteRef = db.collection('invites').doc(inviteId);
    const inviteDoc = await inviteRef.get();
    if (!inviteDoc.exists || inviteDoc.data().recipientUid !== context.auth.uid) throw new functions.https.HttpsError('permission-denied', 'Convite inválido.');
    await inviteRef.update({ status: 'declined' }); 
    return { success: true };
});


/**
 * Exclui um personagem e a sessão de jogo associada a ele.
 */
exports.deleteCharacterAndSession = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Você precisa estar logado para excluir um personagem.');
    }
    const { characterId, sessionId } = data;
    if (!characterId || !sessionId) {
        throw new functions.https.HttpsError('invalid-argument', 'IDs do personagem e da sessão são obrigatórios.');
    }
    const uid = context.auth.uid;
    const characterRef = db.collection('characters').doc(characterId);
    const sessionRef = db.collection('sessions').doc(sessionId);
    try {
        const charDoc = await characterRef.get();
        if (!charDoc.exists || charDoc.data().uid !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Você não tem permissão para excluir este personagem.');
        }
        await characterRef.delete();
        await deleteCollection(db, `sessions/${sessionId}/messages`, 100);
        await deleteCollection(db, `sessions/${sessionId}/characters`, 100);
        await sessionRef.delete();
        return { success: true, message: 'Personagem e sessão excluídos com sucesso.' };
    } catch (error) {
        console.error("Erro ao excluir personagem e sessão:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Ocorreu um erro inesperado no servidor.');
    }
});

// Funções auxiliares para exclusão em massa
async function deleteCollection(db, collectionPath, batchSize) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(batchSize);
  return new Promise((resolve, reject) => {
    deleteQueryBatch(db, query, resolve, reject);
  });
}
async function deleteQueryBatch(db, query, resolve, reject) {
  const snapshot = await query.get();
  if (snapshot.size === 0) {
    return resolve();
  }
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  process.nextTick(() => {
    deleteQueryBatch(db, query, resolve, reject);
  });
}
