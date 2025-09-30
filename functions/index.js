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
const AI_UID = 'master-ai';

// --- FUNÇÕES DE CICLO DE VIDA DE USUÁRIO ---
exports.onUserCreate = regionalFunctions.auth.user().onCreate(async (user) => {
    if (user.displayName || !user.email) return null;
    const newDisplayName = user.email.split('@')[0];
    try {
        await admin.auth().updateUser(user.uid, { displayName: newDisplayName });
    } catch (error) {
        console.error(`Falha ao atualizar o displayName para o usuário ${user.uid}:`, error);
    }
    return null;
});

// --- FUNÇÕES DE SESSÃO E JOGO ---

exports.createAndJoinSession = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    const { characterName, attributes, orixa } = data;
    if (!characterName || !attributes || !orixa) throw new functions.https.HttpsError('invalid-argument', 'Dados do personagem incompletos.');

    const uid = context.auth.uid;
    try {
        const sessionRef = await db.collection("sessions").add({
            owner: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            memberUIDs: [uid, AI_UID],
            turnoAtualUid: uid,
            ordemDeTurnos: [uid, AI_UID],
            estadoDaHistoria: "ato1"
        });

        const playerCharacter = { name: characterName, attributes, orixa, uid, sessionId: sessionRef.id };
        const aiCharacter = { name: "Mestre", attributes: {}, uid: AI_UID, sessionId: sessionRef.id };

        const batch = db.batch();
        batch.set(sessionRef.collection('characters').doc(uid), playerCharacter);
        batch.set(db.collection('characters').doc(), { ...playerCharacter, characterIdInSession: uid });
        batch.set(sessionRef.collection('characters').doc(AI_UID), aiCharacter);
        await batch.commit();

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
        throw new functions.https.HttpsError('internal', 'Não foi possível criar a sessão.');
    }
});


exports.handlePlayerAction = regionalFunctions.runWith({ secrets: [geminiApiKey], timeoutSeconds: 120 }).firestore
    .document('sessions/{sessionId}/messages/{messageId}')
    .onCreate(async (snapshot, context) => {
        const newMessage = snapshot.data();
        const sessionId = context.params.sessionId;

        if (newMessage.from === 'mestre' || newMessage.isTurnoUpdate) return null;
        if (newMessage.text === '__START_ADVENTURE__') await snapshot.ref.delete();

        const sessionRef = db.collection('sessions').doc(sessionId);
        const lastPlayerUid = newMessage.uid;

        try {
            await sessionRef.update({ turnoAtualUid: AI_UID });

            const sessionDoc = await sessionRef.get();
            const sessionData = sessionDoc.data();
            const estadoHistoria = sessionData.estadoDaHistoria || "ato1";
            const atoAtual = historia.atos[estadoHistoria];

            if (!atoAtual) throw new Error(`Estado da história inválido: ${estadoHistoria}`);

            const historySnapshot = await sessionRef.collection('messages').orderBy('createdAt', 'desc').limit(20).get();
            const history = historySnapshot.docs.reverse().map(doc => {
                const data = doc.data();
                if (data.isTurnoUpdate) return null;
                return { role: data.from === 'mestre' ? 'model' : 'user', parts: [{ text: `(${data.characterName}): ${data.text}` }] };
            }).filter(Boolean);

            const systemInstruction = `Você é um mestre de RPG de fantasia narrando uma aventura colaborativa. Nunca saia do personagem. Descreva cenas, interprete NPCs, apresente desafios. Não fale sobre regras, apenas narre a história.`;
            const prompt = `CONTEXTO DA AVENTURA: ${atoAtual.titulo}. ${atoAtual.narrativa_inicio}. Com base no histórico da conversa e neste contexto, reaja à última ação do jogador e continue a história.`;

            const genAI = new GoogleGenerativeAI(geminiApiKey.value());
            // CORREÇÃO: A instrução de sistema é passada aqui
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", systemInstruction });
            // CORREÇÃO: O chat é iniciado apenas com o histórico
            const chat = model.startChat({ history });

            const result = await chat.sendMessage(prompt);
            const aiActionResponse = result.response.text();

            await sessionRef.collection('messages').add({
                from: 'mestre',
                characterName: 'Mestre',
                text: aiActionResponse,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            const ordem = sessionData.ordemDeTurnos.filter(uid => uid !== AI_UID);
            const ultimoIndice = ordem.indexOf(lastPlayerUid);
            const proximoIndice = (ultimoIndice + 1) % ordem.length;
            const proximoUid = ordem[proximoIndice];

            await sessionRef.update({ turnoAtualUid: proximoUid });

            const charactersSnapshot = await sessionRef.collection('characters').get();
            const playerCharacters = charactersSnapshot.docs.map(d => d.data());
            const proximoChar = playerCharacters.find(c => c.uid === proximoUid);
            
            if (proximoChar) {
                await sessionRef.collection('messages').add({
                    from: 'mestre', text: `É o turno de **${proximoChar.name}**.`,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(), isTurnoUpdate: true
                });
            }
            return null;

        } catch (error) {
            console.error(`[handlePlayerAction - ${sessionId}] - ERRO CRÍTICO:`, error);
            await sessionRef.collection('messages').add({
                from: 'mestre', text: '(O Mestre parece confuso por um momento. Por favor, tente sua ação novamente.)',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            await sessionRef.update({ turnoAtualUid: lastPlayerUid });
            return null;
        }
    });

// --- Funções não modificadas (passarTurno, joinSession, convites, etc.) ---

exports.joinSession = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    const { sessionId, characterName, attributes, orixa } = data;
    if (!sessionId || !characterName || !attributes || !orixa) throw new functions.https.HttpsError('invalid-argument', 'Dados incompletos.');
    const uid = context.auth.uid;
    const sessionRef = db.collection('sessions').doc(sessionId);
    try {
        await db.runTransaction(async (transaction) => {
            const sessionDoc = await transaction.get(sessionRef);
            if (!sessionDoc.exists) throw new functions.https.HttpsError('not-found', 'Sessão não encontrada.');
            transaction.update(sessionRef, { memberUIDs: admin.firestore.FieldValue.arrayUnion(uid), ordemDeTurnos: admin.firestore.FieldValue.arrayUnion(uid) });
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
    if (sessionData.turnoAtualUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Não é seu turno.');
    await sessionRef.update({ turnoAtualUid: AI_UID }); 
    return { success: true, proximoTurno: AI_UID };
});

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
        const charDoc = await sessionDoc.ref.collection('characters').doc(senderUid).get();
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

exports.deleteCharacterAndSession = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Você precisa estar logado.');
    const { characterId, sessionId } = data;
    if (!characterId || !sessionId) throw new functions.https.HttpsError('invalid-argument', 'IDs do personagem e da sessão são obrigatórios.');
    const uid = context.auth.uid;
    const characterRef = db.collection('characters').doc(characterId);
    const sessionRef = db.collection('sessions').doc(sessionId);
    try {
        const charDoc = await characterRef.get();
        if (!charDoc.exists || charDoc.data().uid !== uid) throw new functions.https.HttpsError('permission-denied', 'Você não tem permissão para excluir este personagem.');
        await characterRef.delete();
        await deleteCollection(db, `sessions/${sessionId}/messages`, 100);
        await deleteCollection(db, `sessions/${sessionId}/characters`, 100);
        await sessionRef.delete();
        return { success: true, message: 'Personagem e sessão excluídos com sucesso.' };
    } catch (error) {
        console.error("Erro ao excluir personagem e sessão:", error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', 'Ocorreu um erro inesperado no servidor.');
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
