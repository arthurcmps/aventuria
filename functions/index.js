/*
 *  functions/index.js (VERSÃO COM IA ATIVA)
 *  - ADICIONADO: IA (`master-ai`) agora faz parte do ciclo de turnos.
 *  - ADICIONADO: Nova função `executeAITurn` que é acionada quando o turno passa para a IA.
 *  - REVISADO: `createAndJoinSession` e `joinSession` agora incluem a IA na ordem de turnos.
 *  - REVISADO: `generateMasterResponse` e `passarTurno` agora passam o turno para a IA em vez do próximo jogador.
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
            memberUIDs: [uid, AI_UID], // Adiciona o jogador e a IA
            turnoAtualUid: uid, // Começa com o jogador
            ordemDeTurnos: [uid, AI_UID] // Ordem inicial
        });

        const playerCharacter = { name: characterName, attributes, uid, sessionId: sessionRef.id };
        const aiCharacter = { name: "Mestre", attributes: {}, uid: AI_UID, sessionId: sessionRef.id };

        const batch = db.batch();
        
        // Personagem do jogador na sessão e global
        batch.set(db.collection('sessions').doc(sessionRef.id).collection('characters').doc(uid), playerCharacter);
        batch.set(db.collection('characters').doc(), { ...playerCharacter, characterIdInSession: uid });
        
        // Personagem da IA na sessão
        batch.set(db.collection('sessions').doc(sessionRef.id).collection('characters').doc(AI_UID), aiCharacter);

        await batch.commit();

        // Mensagem inicial para disparar a aventura
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
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    }
    const { sessionId, characterName, attributes } = data;
    if (!sessionId || !characterName || !attributes) {
        throw new functions.https.HttpsError('invalid-argument', 'Dados incompletos.');
    }

    const uid = context.auth.uid;
    const sessionRef = db.collection('sessions').doc(sessionId);
    
    try {
        await db.runTransaction(async (transaction) => {
            const sessionDoc = await transaction.get(sessionRef);
            if (!sessionDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'Sessão não encontrada.');
            }
            
            // Adiciona o novo jogador na lista de membros e na ordem de turnos
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

    // Passa o turno para a IA
    await sessionRef.update({ turnoAtualUid: AI_UID }); 

    // Adiciona uma mensagem indicando que o jogador passou o turno
    const playerChar = await sessionRef.collection('characters').doc(uid).get();
    await db.collection('sessions').doc(sessionId).collection('messages').add({
        from: 'mestre',
        text: `**${playerChar.data().name}** observa em silêncio. O turno passa para o mestre.`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isTurnoUpdate: true
    });

    return { success: true, proximoTurno: AI_UID };
});

// --- FUNÇÃO PRINCIPAL DA IA (Disparada por Ação do Jogador) ---
exports.generateMasterResponse = regionalFunctions.runWith({ secrets: [geminiApiKey] }).firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const newMessage = snapshot.data();
    const sessionId = context.params.sessionId;

    // Ignora mensagens do mestre, atualizações de turno ou mensagens de "passar turno"
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

    try {
        // Prepara o prompt para a IA (narração do mestre)
        let promptText = newMessage.text;
        if (newMessage.text === '__START_ADVENTURE__') {
            const character = (await sessionRef.collection('characters').doc(newMessage.uid).get()).data();
            promptText = `Meu personagem é ${character.name}. Acabei de criá-lo. Descreva a cena de abertura da aventura.`;
            await snapshot.ref.delete(); // Apaga a mensagem técnica
        }

        const historySnapshot = await sessionRef.collection('messages').orderBy('createdAt').get();
        const history = historySnapshot.docs.map(doc => {
            const data = doc.data();
            if (data.isTurnoUpdate || data.text === '__START_ADVENTURE__') return null;
            return { role: data.from === 'mestre' ? 'model' : 'user', parts: [{ text: data.text }] };
        }).filter(Boolean);
        
        // Chama a IA para gerar a narração
        const genAI = new GoogleGenerativeAI(geminiApiKey.value());
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const chat = model.startChat({ history });
        const result = await chat.sendMessage(promptText);
        const masterResponse = result.response.text();

        // Salva a resposta do mestre e passa o turno para a IA agir
        await sessionRef.collection('messages').add({
            from: 'mestre',
            text: masterResponse,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await sessionRef.update({ turnoAtualUid: AI_UID });
        return null;

    } catch (error) {
        console.error("Erro em generateMasterResponse:", error);
        // Em caso de erro, devolve o turno ao jogador para que ele possa tentar novamente.
        await db.collection('sessions').doc(sessionId).update({ turnoAtualUid: newMessage.uid });
        return null;
    }
});

// --- NOVA FUNÇÃO (Disparada quando é a Vez da IA) ---
exports.executeAITurn = regionalFunctions.runWith({ secrets: [geminiApiKey] }).firestore
  .document('sessions/{sessionId}')
  .onUpdate(async (change, context) => {
    const sessionDataAfter = change.after.data();
    const sessionDataBefore = change.before.data();
    const sessionId = context.params.sessionId;

    // A função é acionada se o turno MUDOU PARA a IA
    if (sessionDataAfter.turnoAtualUid !== AI_UID || sessionDataBefore.turnoAtualUid === AI_UID) {
        return null;
    }

    const sessionRef = db.collection('sessions').doc(sessionId);

    try {
        // Prepara o histórico para a IA
        const historySnapshot = await sessionRef.collection('messages').orderBy('createdAt').get();
        const history = historySnapshot.docs.map(doc => {
            const data = doc.data();
            if (data.isTurnoUpdate || data.text === '__START_ADVENTURE__') return null;
            return { role: data.from === 'mestre' ? 'model' : 'user', parts: [{ text: data.text }] };
        }).filter(Boolean);

        const charactersSnapshot = await sessionRef.collection('characters').get();
        const characterNames = charactersSnapshot.docs.map(d => d.data().name).filter(name => name !== "Mestre").join(', ');

        const prompt = `Considerando o histórico da conversa, é a sua vez de agir como Mestre do Jogo. Os jogadores são: ${characterNames}. Narre um evento, a ação de um inimigo, ou uma consequência do que acabou de acontecer. Seja breve e impactante.`;

        // Chama a IA para gerar sua ação
        const genAI = new GoogleGenerativeAI(geminiApiKey.value());
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const chat = model.startChat({ history });
        const result = await chat.sendMessage(prompt);
        const aiActionResponse = result.response.text();

        await sessionRef.collection('messages').add({
            from: 'mestre',
            text: aiActionResponse,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Passa o turno para o próximo jogador
        const ordem = sessionDataAfter.ordemDeTurnos;
        const indiceAtualIA = ordem.indexOf(AI_UID);
        const proximoIndice = (indiceAtualIA + 1) % ordem.length;
        const proximoUid = ordem[proximoIndice];

        await sessionRef.update({ turnoAtualUid: proximoUid });
        
        const proximoCharSnapshot = await sessionRef.collection('characters').doc(proximoUid).get();
        if (proximoCharSnapshot.exists) {
            const proximoCharNome = proximoCharSnapshot.data().name;
             await sessionRef.collection('messages').add({
                from: 'mestre',
                text: `É o turno de **${proximoCharNome}**.`,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                isTurnoUpdate: true
            });
        }
        return null;

    } catch (error) {
        console.error("Erro em executeAITurn:", error);
        // Em caso de erro, passa o turno para o próximo jogador para não travar o jogo
        const ordem = sessionDataAfter.ordemDeTurnos;
        const indiceAtualIA = ordem.indexOf(AI_UID);
        const proximoIndice = (indiceAtualIA + 1) % ordem.length;
        const proximoUid = ordem[proximoIndice];
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
