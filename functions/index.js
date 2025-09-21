/*
 *  functions/index.js (VERSÃO DE REVISÃO COMPLETA)
 *  - ADICIONADO: Função `onUserCreate` para atribuir um `displayName` a novos usuários de email/senha.
 *  - REVISADO: Todas as funções existentes (`createAndJoinSession`, `passarTurno`, `generateMasterResponse`, etc.) foram verificadas e mantidas.
 *  - A lógica de turnos e o fluxo do jogo estão intactos.
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { defineSecret } = require("firebase-functions/params");
const cors = require('cors')({origin: true});

// Inicialização
try { admin.initializeApp(); } catch (e) { console.warn("Falha na inicialização do Admin SDK."); }

const geminiApiKey = defineSecret("GEMINI_API_KEY");
const db = admin.firestore();
const regionalFunctions = functions.region('southamerica-east1');

// --- NOVA FUNÇÃO DE CICLO DE VIDA DE USUÁRIO ---
// Garante que todo novo usuário tenha um nome de exibição.
exports.onUserCreate = regionalFunctions.auth.user().onCreate(async (user) => {
    // Se o usuário já tiver um displayName (ex: login com Google), não faz nada.
    if (user.displayName) {
        console.log(`Usuário ${user.uid} já possui displayName: ${user.displayName}.`);
        return null;
    }

    // Se o usuário não tiver email (ex: login anônimo), não faz nada.
    if (!user.email) {
        console.log(`Usuário ${user.uid} não possui email para gerar um displayName.`);
        return null;
    }

    // Cria um nome a partir do email (ex: "fulano@email.com" -> "fulano")
    const newDisplayName = user.email.split('@')[0];

    try {
        await admin.auth().updateUser(user.uid, { displayName: newDisplayName });
        console.log(`displayName '${newDisplayName}' atribuído ao novo usuário ${user.uid}.`);
        return null;
    } catch (error) {
        console.error(`Falha ao atualizar o displayName para o usuário ${user.uid}:`, error);
        return null;
    }
});


// --- FUNÇÕES DE SESSÃO E JOGO (REVISADAS) ---

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
            memberUIDs: [uid],
            turnoAtualUid: uid,
            ordemDeTurnos: [uid]
        });

        const newCharacter = { name: characterName, attributes, uid, sessionId: sessionRef.id };
        const characterInSessionRef = db.collection('sessions').doc(sessionRef.id).collection('characters').doc(uid);
        const globalCharacterRef = db.collection('characters').doc();

        await db.batch()
            .set(characterInSessionRef, newCharacter)
            .set(globalCharacterRef, { ...newCharacter, characterIdInSession: uid })
            .commit();

        await db.collection('sessions').doc(sessionRef.id).collection('messages').add({
          from: 'player',
          text: '__START_ADVENTURE__',
          characterName: newCharacter.name,
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
        throw new functions.https.HttpsError('invalid-argument', 'ID da sessão, nome e atributos são obrigatórios.');
    }

    const uid = context.auth.uid;
    const sessionRef = db.collection('sessions').doc(sessionId);
    
    try {
        await db.runTransaction(async (transaction) => {
            const sessionDoc = await transaction.get(sessionRef);
            if (!sessionDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'Sessão não encontrada.');
            }
            
            transaction.update(sessionRef, {
                memberUIDs: admin.firestore.FieldValue.arrayUnion(uid),
                ordemDeTurnos: admin.firestore.FieldValue.arrayUnion(uid) 
            });

            const newCharacter = { name: characterName, attributes, uid, sessionId };
            const characterInSessionRef = sessionRef.collection('characters').doc(uid);
            const globalCharacterRef = db.collection('characters').doc();

            transaction.set(characterInSessionRef, newCharacter);
            transaction.set(globalCharacterRef, { ...newCharacter, characterIdInSession: uid });
        });

        return { success: true };

    } catch (error) {
        console.error(`Erro ao entrar na sessão ${sessionId}:`, error);
        throw new functions.https.HttpsError('internal', 'Não foi possível entrar na sessão.');
    }
});

exports.passarTurno = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    }
    
    const { sessionId } = data;
    if (!sessionId) {
        throw new functions.https.HttpsError('invalid-argument', 'O ID da sessão é obrigatório.');
    }

    const uid = context.auth.uid;
    const sessionRef = db.collection('sessions').doc(sessionId);

    try {
        const sessionDoc = await sessionRef.get();
        if (!sessionDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Sessão não encontrada.');
        }

        const sessionData = sessionDoc.data();

        if (sessionData.turnoAtualUid !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Não é seu turno de jogar.');
        }

        const ordem = sessionData.ordemDeTurnos;
        const indiceAtual = ordem.indexOf(uid);
        if (indiceAtual === -1) {
             throw new functions.https.HttpsError('internal', 'Você não está na ordem de turnos desta sessão.');
        }

        const proximoIndice = (indiceAtual + 1) % ordem.length;
        const proximoUid = ordem[proximoIndice];

        await sessionRef.update({ turnoAtualUid: proximoUid });

        const proximoCharSnapshot = await sessionRef.collection('characters').where('uid', '==', proximoUid).get();
        if (!proximoCharSnapshot.empty) {
            const proximoCharNome = proximoCharSnapshot.docs[0].data().name;
             await db.collection('sessions').doc(sessionId).collection('messages').add({
                from: 'mestre',
                text: `É o turno de **${proximoCharNome}**.`,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                isTurnoUpdate: true
            });
        }

        return { success: true, proximoTurno: proximoUid };

    } catch (error) {
        console.error("Erro em passarTurno:", error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', 'Não foi possível passar o turno.');
    }
});

// --- FUNÇÕES DE CONVITE (REVISADAS) ---

exports.sendInvite = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    const { email, sessionId } = data;
    if (!email || !sessionId) throw new functions.https.HttpsError('invalid-argument', 'E-mail e ID da sessão são obrigatórios.');

    const senderUid = context.auth.uid;

    try {
        const recipientUser = await admin.auth().getUserByEmail(email);
        const recipientUid = recipientUser.uid;

        if (senderUid === recipientUid) throw new functions.https.HttpsError('invalid-argument', 'Você não pode enviar um convite para si mesmo.');

        const sessionDoc = await db.collection('sessions').doc(sessionId).get();
        if (!sessionDoc.exists) throw new functions.https.HttpsError('not-found', 'Sessão não encontrada.');
        if (sessionDoc.data().memberUIDs?.includes(recipientUid)) throw new functions.https.HttpsError('already-exists', 'Este usuário já é membro da sessão.');

        const invitesRef = db.collection('invites');
        const existingInviteQuery = await invitesRef.where('recipientUid', '==', recipientUid).where('sessionId', '==', sessionId).limit(1).get();
        if (!existingInviteQuery.empty) throw new functions.https.HttpsError('already-exists', 'Um convite para este jogador nesta sessão já foi enviado.');

        const charDoc = await db.collection('sessions').doc(sessionId).collection('characters').doc(senderUid).get();
        if (!charDoc.exists) throw new functions.https.HttpsError('not-found', 'Seu personagem não foi encontrado nesta sessão.');

        await invitesRef.add({
            senderId: senderUid,
            senderCharacterName: charDoc.data().name,
            recipientEmail: email,
            recipientUid: recipientUid,
            sessionId: sessionId,
            status: 'pending',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, message: `Convite enviado para ${email}.` };

    } catch (error) {
        console.error("Erro em sendInvite:", error);
        if (error.code === 'auth/user-not-found') throw new functions.https.HttpsError('not-found', `Nenhum usuário encontrado com o e-mail ${email}.`);
        throw new functions.https.HttpsError('internal', 'Ocorreu um erro inesperado ao enviar o convite.');
    }
});

exports.getPendingInvites = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação é necessária.');

    const userUid = context.auth.uid;
    const snapshot = await db.collection('invites').where('recipientUid', '==', userUid).where('status', '==', 'pending').get();

    let invites = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    invites.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());

    return invites;
});

exports.acceptInvite = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    
    const { inviteId } = data;
    if (!inviteId) throw new functions.https.HttpsError('invalid-argument', 'ID do convite é obrigatório.');

    const uid = context.auth.uid;
    const inviteRef = db.collection('invites').doc(inviteId);

    try {
        const { sessionId } = await db.runTransaction(async (t) => {
            const inviteDoc = await t.get(inviteRef);
            if (!inviteDoc.exists || inviteDoc.data().status !== 'pending') throw new functions.https.HttpsError('not-found', 'Convite não encontrado ou já foi respondido.');
            if (inviteDoc.data().recipientUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Este convite não pertence a você.');

            const sId = inviteDoc.data().sessionId;
            const sessionRef = db.collection('sessions').doc(sId);
            
            t.update(inviteRef, { status: 'accepted', respondedAt: admin.firestore.FieldValue.serverTimestamp() });
            return { sessionId: sId };
        });

        return { success: true, sessionId: sessionId };

    } catch (error) {
        console.error(`Erro ao aceitar convite ${inviteId}:`, error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', 'Não foi possível aceitar o convite.');
    }
});

exports.declineInvite = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    const { inviteId } = data;
    if (!inviteId) throw new functions.https.HttpsError('invalid-argument', 'ID do convite é obrigatório.');

    const uid = context.auth.uid;
    const inviteRef = db.collection('invites').doc(inviteId);
    const inviteDoc = await inviteRef.get();

    if (!inviteDoc.exists || inviteDoc.data().status !== 'pending' || inviteDoc.data().recipientUid !== uid) {
         throw new functions.https.HttpsError('permission-denied', 'Não é possível recusar este convite.');
    }

    await inviteRef.update({ status: 'declined', respondedAt: admin.firestore.FieldValue.serverTimestamp() }); 
    return { success: true };
});

// --- FUNÇÃO DA IA (REVISADA) ---

exports.generateMasterResponse = regionalFunctions.runWith({ secrets: [geminiApiKey] }).firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const newMessage = snapshot.data();
    const sessionId = context.params.sessionId;

    if (newMessage.from === 'mestre' || newMessage.isTurnoUpdate) {
        return null;
    }

    const sessionRef = db.collection('sessions').doc(sessionId);
    const sessionDoc = await sessionRef.get();
    const sessionData = sessionDoc.data();

    if (sessionData.turnoAtualUid !== newMessage.uid) {
        console.log(`Mensagem ignorada: Não é o turno do usuário ${newMessage.uid}.`);
        await snapshot.ref.delete();
        return null;
    }

    try {
        const genAI = new GoogleGenerativeAI(geminiApiKey.value());
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const charactersSnapshot = await sessionRef.collection('characters').get();
        const characters = charactersSnapshot.docs.map(doc => doc.data());

        let prompt = newMessage.text;
        if (newMessage.text === '__START_ADVENTURE__') {
            const character = characters.find(c => c.uid === newMessage.uid);
            prompt = `Meu personagem é ${character.name}. Acabei de criá-lo. Descreva a cena de abertura da aventura.`;
            await snapshot.ref.delete();
        }

        const historySnapshot = await sessionRef.collection('messages').orderBy('createdAt').get();
        const history = historySnapshot.docs.map(doc => {
            const data = doc.data();
            if (data.isTurnoUpdate || data.text === '__START_ADVENTURE__') return null;
            return { role: data.from === 'mestre' ? 'model' : 'user', parts: [{ text: data.text }] };
        }).filter(Boolean);

        const chat = model.startChat({ history });

        const result = await chat.sendMessage(prompt);
        const masterResponse = result.response.text();

        await sessionRef.collection('messages').add({
            from: 'mestre',
            text: masterResponse,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const ordem = sessionData.ordemDeTurnos;
        const indiceAtual = ordem.indexOf(newMessage.uid);
        const proximoIndice = (indiceAtual + 1) % ordem.length;
        const proximoUid = ordem[proximoIndice];
        await sessionRef.update({ turnoAtualUid: proximoUid });

        const proximoCharSnapshot = await sessionRef.collection('characters').where('uid', '==', proximoUid).get();
        if (!proximoCharSnapshot.empty) {
            const proximoCharNome = proximoCharSnapshot.docs[0].data().name;
             await sessionRef.collection('messages').add({
                from: 'mestre',
                text: `Agora é o turno de **${proximoCharNome}**.`,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                isTurnoUpdate: true
            });
        }

        return null;
    } catch (error) {
        console.error("Erro na IA do Mestre:", error);
    }
});
