/*
 * functions/index.js (VERSÃO COM IA CENTRALIZADA)
 * - REVISADO: A lógica da IA foi unificada na função `executeAITurn` para evitar respostas duplicadas.
 * - `generateMasterResponse` agora apenas valida a mensagem do jogador e passa o turno para a IA.
 * - `executeAITurn` agora analisa o contexto para decidir se reage a uma ação ou avança a história.
 * - `passarTurno` foi simplificado para apenas atualizar o turno, sem enviar mensagens.
 * - CORREÇÃO: Adicionados logs para diagnosticar o problema de salvamento do Orixá.
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { defineSecret } = require("firebase-functions/params");
const deleteCharacterAndSession = httpsCallable(functions, 'deleteCharacterAndSession');

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

    // ADICIONADO LOG DE DIAGNÓSTICO
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

    // ADICIONADO LOG DE DIAGNÓSTICO
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

    await sessionRef.update({ turnoAtualUid: AI_UID }); 

    return { success: true, proximoTurno: AI_UID };
});

exports.generateMasterResponse = regionalFunctions.firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const newMessage = snapshot.data();
    const sessionId = context.params.sessionId;

    if (newMessage.from === 'mestre' || newMessage.isTurnoUpdate) return null;
    
    const sessionRef = db.collection('sessions').doc(sessionId);
    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists) return null;
    const sessionData = sessionDoc.data();

    if (sessionData.turnoAtualUid !== newMessage.uid) {
        console.log(`Mensagem ignorada: Não é o turno do usuário ${newMessage.uid}.`);
        await snapshot.ref.delete();
        return null;
    }
    
    try {
        await sessionRef.update({ turnoAtualUid: AI_UID });
        
        if (newMessage.text === '__START_ADVENTURE__') {
            await snapshot.ref.delete(); 
        }

        return null;

    } catch (error) {
        console.error("Erro ao passar turno para a IA em generateMasterResponse:", error);
        await sessionRef.update({ turnoAtualUid: newMessage.uid });
        return null;
    }
});

exports.executeAITurn = regionalFunctions.runWith({ secrets: [geminiApiKey] }).firestore
  .document('sessions/{sessionId}')
  .onUpdate(async (change, context) => {
    const sessionDataAfter = change.after.data();
    const sessionDataBefore = change.before.data();
    const sessionId = context.params.sessionId;

    if (sessionDataAfter.turnoAtualUid !== AI_UID || sessionDataBefore.turnoAtualUid === AI_UID) {
        return null;
    }

    const sessionRef = db.collection('sessions').doc(sessionId);

    try {
        const historySnapshot = await sessionRef.collection('messages').orderBy('createdAt', 'desc').limit(20).get();
        const history = historySnapshot.docs.reverse().map(doc => {
            const data = doc.data();
            if (data.isTurnoUpdate) return null;
            return { role: data.from === 'mestre' ? 'model' : 'user', parts: [{ text: `(${data.characterName}): ${data.text}` }] };
        }).filter(Boolean);

        const charactersSnapshot = await sessionRef.collection('characters').get();
        const playerCharacters = charactersSnapshot.docs
            .map(d => d.data())
            .filter(c => c.uid !== AI_UID);
        const characterNames = playerCharacters.map(c => c.name).join(', ');
        
        const prompt = `Você é o Mestre de um jogo de RPG de fantasia. Os jogadores são: ${characterNames}. Sua tarefa é continuar a aventura com base no histórico da conversa.
- Se a última mensagem foi de um jogador, reaja à ação dele. Descreva o resultado, as consequências e o que acontece no mundo.
- Se a última mensagem foi sua, ou se o jogo está apenas começando, seja proativo: avance a história, descreva um novo ambiente ou introduza um desafio.
Seja criativo, narre a cena e mantenha a história em movimento.`;
        
        const genAI = new GoogleGenerativeAI(geminiApiKey.value());
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const chat = model.startChat({ 
            history: history,
            systemInstruction: "Você é um mestre de RPG de fantasia. Sua função é narrar uma história colaborativa, reagindo às ações dos jogadores e avançando o enredo. Nunca saia do personagem. Descreva cenas, interprete NPCs e apresente desafios. Não fale sobre regras ou 'o jogo', apenas narre a história."
        });
        const result = await chat.sendMessage(prompt);
        const aiActionResponse = result.response.text();

        await sessionRef.collection('messages').add({
            from: 'mestre',
            characterName: 'Mestre',
            text: aiActionResponse,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const ordem = sessionDataAfter.ordemDeTurnos;
        const indiceIA = ordem.indexOf(AI_UID);
        let proximoIndice = (indiceIA + 1) % ordem.length;
        while(ordem[proximoIndice] === AI_UID) {
            proximoIndice = (proximoIndice + 1) % ordem.length;
        }
        const proximoUid = ordem[proximoIndice];
        
        await sessionRef.update({ turnoAtualUid: proximoUid });
        
        const proximoCharDoc = playerCharacters.find(c => c.uid === proximoUid);
        if (proximoCharDoc) {
             await sessionRef.collection('messages').add({
                from: 'mestre',
                text: `É o turno de **${proximoCharDoc.name}**.`,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                isTurnoUpdate: true
            });
        }
        return null;

    } catch (error) {
        console.error("Erro em executeAITurn:", error);
        
        const lastPlayerUid = sessionDataBefore.turnoAtualUid;
        await sessionRef.collection('messages').add({
            from: 'mestre',
            characterName: 'Mestre',
            text: '(O Mestre parece confuso por um momento. Por favor, tente sua ação novamente.)',
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

 async function deleteCharacter(characterId, sessionId, cardElement) {
    const deleteButton = cardElement.querySelector('.btn-delete-character');
    try {
        deleteButton.disabled = true; // Desabilita para evitar cliques duplos

        // Chama a função de backend
        await deleteCharacterAndSession({ characterId, sessionId });

        alert('Personagem e sessão excluídos com sucesso.');
        cardElement.remove(); // Remove o card da tela

        // Verifica se a lista de personagens ficou vazia
        if (characterList.children.length === 0) {
            noCharactersMessage.style.display = 'block';
        }
    } catch (error) {
        console.error("Erro ao excluir personagem:", error);
        alert(`Erro ao excluir: ${error.message}`);
        deleteButton.disabled = false; // Reabilita em caso de erro
    }
}

/**
 * Exclui um personagem e a sessão de jogo associada a ele.
 * Requer que o usuário esteja autenticado.
 */
exports.deleteCharacterAndSession = functions.https.onCall(async (data, context) => {
    // Verifica se o usuário está autenticado
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Você precisa estar logado para excluir um personagem.');
    }

    const { characterId, sessionId } = data;

    // Validação de entrada
    if (!characterId || !sessionId) {
        throw new functions.https.HttpsError('invalid-argument', 'IDs do personagem e da sessão são obrigatórios.');
    }

    const uid = context.auth.uid;
    const db = getFirestore();
    const characterRef = db.collection('characters').doc(characterId);
    const sessionRef = db.collection('sessions').doc(sessionId);

    try {
        // Inicia um batch de escrita para garantir que ambas as operações ocorram ou falhem juntas
        const batch = db.batch();

        // 1. Verifica se o personagem pertence ao usuário que está fazendo a requisição
        const charDoc = await characterRef.get();
        if (!charDoc.exists || charDoc.data().uid !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Você não tem permissão para excluir este personagem.');
        }

        // 2. Deleta o documento principal do personagem
        batch.delete(characterRef);

        // 3. Deleta a sessão e todas as suas subcoleções (de forma recursiva)
        // O Firebase CLI tem uma função para isso, mas em Cloud Functions,
        // precisamos fazer manualmente ou usar uma extensão.
        // Por simplicidade aqui, vamos deletar o documento da sessão.
        // ATENÇÃO: Subcoleções como 'messages' e 'characters' dentro da sessão NÃO serão excluídas
        // automaticamente com este método. Para uma limpeza completa, seria necessária uma função recursiva.
        // No entanto, para o escopo do projeto, remover a referência principal já torna a sessão inacessível.
        batch.delete(sessionRef);

        // Commita as operações do batch
        await batch.commit();

        return { success: true, message: 'Personagem e sessão excluídos com sucesso.' };

    } catch (error) {
        console.error("Erro ao excluir personagem e sessão:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error; // Re-lança erros HttpsError
        }
        throw new functions.https.HttpsError('internal', 'Ocorreu um erro inesperado no servidor.');
    }
});

