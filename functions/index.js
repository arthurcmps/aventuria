/*
 *  functions/index.js (VERSÃO COM IA CENTRALIZADA)
 *  - REVISADO: A lógica da IA foi unificada na função `executeAITurn` para evitar respostas duplicadas.
 *  - `generateMasterResponse` agora apenas valida a mensagem do jogador e passa o turno para a IA.
 *  - `executeAITurn` agora analisa o contexto para decidir se reage a uma ação ou avança a história.
 *  - `passarTurno` foi simplificado para apenas atualizar o turno, sem enviar mensagens.
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { defineSecret } = require("firebase-functions/params");

// Inicialização
try { admin.initializeApp(); } catch (e) { console.warn("Falha na inicialização do Admin SDK."); }

const geminiApiKey = defineSecret("GEMINI_API_KEY");
const db = admin.firestore();
const regionalFunctions = functions.region('southamerica-east1');

// --- CONSTANTES ---
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
    const { characterName, attributes } = data;
    if (!characterName || !attributes) {
        throw new functions.https.HttpsError('invalid-argument', 'Nome e atributos são obrigatórios.');
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

        const playerCharacter = { name: characterName, attributes, uid, sessionId: sessionRef.id };
        const aiCharacter = { name: "Mestre", attributes: {}, uid: AI_UID, sessionId: sessionRef.id };

        const batch = db.batch();
        batch.set(db.collection('sessions').doc(sessionRef.id).collection('characters').doc(uid), playerCharacter);
        batch.set(db.collection('characters').doc(), { ...playerCharacter, characterIdInSession: uid });
        batch.set(db.collection('sessions').doc(sessionRef.id).collection('characters').doc(AI_UID), aiCharacter);
        await batch.commit();

        // Mensagem especial que inicia a aventura. Será processada pela IA.
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
    const { sessionId, characterName, attributes } = data;
    if (!sessionId || !characterName || !attributes) throw new functions.https.HttpsError('invalid-argument', 'Dados incompletos.');

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

            const newCharacter = { name: characterName, attributes, uid, sessionId };
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

    // Apenas passa o turno para a IA. O `executeAITurn` fará o resto.
    await sessionRef.update({ turnoAtualUid: AI_UID }); 

    return { success: true, proximoTurno: AI_UID };
});

// --- GATILHO: VALIDA AÇÃO DO JOGADOR E PASSA O TURNO PARA A IA ---
exports.generateMasterResponse = regionalFunctions.firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const newMessage = snapshot.data();
    const sessionId = context.params.sessionId;

    // Ignora mensagens do mestre ou atualizações de turno
    if (newMessage.from === 'mestre' || newMessage.isTurnoUpdate) return null;
    
    const sessionRef = db.collection('sessions').doc(sessionId);
    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists) return null;
    const sessionData = sessionDoc.data();

    // Valida se era o turno do jogador que enviou a mensagem
    if (sessionData.turnoAtualUid !== newMessage.uid) {
        console.log(`Mensagem ignorada: Não é o turno do usuário ${newMessage.uid}.`);
        await snapshot.ref.delete(); // Apaga a mensagem inválida
        return null;
    }
    
    // Se a mensagem for válida, simplesmente passa o turno para a IA.
    // A IA irá ler esta mensagem e reagir a ela na função `executeAITurn`.
    try {
        await sessionRef.update({ turnoAtualUid: AI_UID });
        
        // Se for a mensagem de início, apaga a mensagem técnica para não poluir o chat.
        if (newMessage.text === '__START_ADVENTURE__') {
            await snapshot.ref.delete(); 
        }

        return null;

    } catch (error) {
        console.error("Erro ao passar turno para a IA em generateMasterResponse:", error);
        // Devolve o turno ao jogador em caso de erro para não travar o jogo.
        await sessionRef.update({ turnoAtualUid: newMessage.uid });
        return null;
    }
});

// --- CÉREBRO DA IA: Executa quando o turno é passado para 'master-ai' ---
exports.executeAITurn = regionalFunctions.runWith({ secrets: [geminiApiKey] }).firestore
  .document('sessions/{sessionId}')
  .onUpdate(async (change, context) => {
    const sessionDataAfter = change.after.data();
    const sessionDataBefore = change.before.data();
    const sessionId = context.params.sessionId;

    // A função só é executada se o turno MUDOU PARA a IA.
    if (sessionDataAfter.turnoAtualUid !== AI_UID || sessionDataBefore.turnoAtualUid === AI_UID) {
        return null;
    }

    const sessionRef = db.collection('sessions').doc(sessionId);

    try {
        // Monta o histórico de mensagens para dar contexto à IA
        const historySnapshot = await sessionRef.collection('messages').orderBy('createdAt', 'desc').limit(20).get();
        const history = historySnapshot.docs.reverse().map(doc => {
            const data = doc.data();
            if (data.isTurnoUpdate) return null; // Ignora mensagens de sistema
            return { role: data.from === 'mestre' ? 'model' : 'user', parts: [{ text: `(${data.characterName}): ${data.text}` }] };
        }).filter(Boolean);

        // Identifica os jogadores na sessão
        const charactersSnapshot = await sessionRef.collection('characters').get();
        const playerCharacters = charactersSnapshot.docs
            .map(d => d.data())
            .filter(c => c.uid !== AI_UID);
        const characterNames = playerCharacters.map(c => c.name).join(', ');
        
        // Decide qual prompt usar
        const lastMessage = history.length > 0 ? history[history.length - 1] : null;
        let prompt;

        if (!lastMessage || lastMessage.role === 'model') {
            // Se não há histórico ou a última mensagem já foi do mestre (ex: um jogador passou o turno),
            // a IA deve ser proativa e avançar a história.
            prompt = `Você é o Mestre de um jogo de RPG. Os jogadores são: ${characterNames}. É a sua vez de agir. Narre um evento, descreva o ambiente, introduza um desafio ou faça um PNJ (personagem não-jogador) agir. Seja criativo e continue a aventura.`;
        } else {
            // Se a última mensagem foi de um jogador, a IA deve reagir àquela ação.
            prompt = `Você é o Mestre de um jogo de RPG. Os jogadores são: ${characterNames}. Reaja à última ação do jogador, descrita no final do histórico. Descreva as consequências, a resposta de PNJs, ou o resultado do que ele tentou fazer. Narre a cena e prepare o próximo momento do jogo.`;
        }
        
        // Chama a IA para gerar sua narração/ação
        const genAI = new GoogleGenerativeAI(geminiApiKey.value());
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const chat = model.startChat({ 
            history: history,
            systemInstruction: "Seja um mestre de RPG criativo, detalhado e imparcial. Nunca fale fora do personagem."
        });
        const result = await chat.sendMessage(prompt);
        const aiActionResponse = result.response.text();

        // Salva a resposta do mestre no chat
        await sessionRef.collection('messages').add({
            from: 'mestre',
            characterName: 'Mestre',
            text: aiActionResponse,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Passa o turno para o próximo jogador na ordem
        const ordem = sessionDataAfter.ordemDeTurnos;
        const indiceIA = ordem.indexOf(AI_UID);

        // Encontra o próximo jogador que não seja a IA
        let proximoIndice = (indiceIA + 1) % ordem.length;
        while(ordem[proximoIndice] === AI_UID) {
            proximoIndice = (proximoIndice + 1) % ordem.length;
        }
        const proximoUid = ordem[proximoIndice];
        
        await sessionRef.update({ turnoAtualUid: proximoUid });
        
        // Anuncia de quem é o próximo turno
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
        // Em caso de erro, passa o turno para o próximo jogador para não travar o jogo.
        const ordem = sessionDataAfter.ordemDeTurnos;
        const indiceIA = ordem.indexOf(AI_UID);
        const proximoIndice = (indiceIA + 1) % ordem.length;
        const proximoUid = ordem[proximoIndice] || ordem[0]; // Garante que alguém receba o turno
        await sessionRef.update({ turnoAtualUid: proximoUid });
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
