/*
 *  functions/index.js (Correção Final e Definitiva)
 *  - Ignora rolagens de dados para não acionar a IA desnecessariamente.
 *  - Remove a última mensagem do histórico para evitar duplicatas.
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

// ... (Outras funções permanecem inalteradas) ...
exports.createAndJoinSession = regionalFunctions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).send({ error: { message: 'Método não permitido' } });
        }

        let context = { auth: null };
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            const idToken = req.headers.authorization.split('Bearer ')[1];
            try {
                context.auth = await admin.auth().verifyIdToken(idToken);
            } catch (error) {
                return res.status(401).send({ error: { message: 'Requisição não autenticada.' } });
            }
        }
        if (!context.auth) {
            return res.status(401).send({ error: { message: 'Autenticação necessária.' } });
        }

        const { characterName, attributes } = req.body.data;
        if (!characterName || !attributes) {
             return res.status(422).send({ error: { message: 'Nome do personagem e atributos são obrigatórios.' } });
        }

        const uid = context.auth.uid;
        try {
            const sessionRef = await db.collection("sessions").add({
                owner: uid,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                memberUIDs: [uid]
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

            return res.status(200).send({ data: { success: true, sessionId: sessionRef.id } });

        } catch (error) {
            console.error("Erro em createAndJoinSession:", error);
            return res.status(500).send({ error: { message: 'Não foi possível criar a sessão.' } });
        }
    });
});

exports.sendInvite = regionalFunctions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {
        let context = { auth: null };
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            try {
                const idToken = req.headers.authorization.split('Bearer ')[1];
                context.auth = await admin.auth().verifyIdToken(idToken);
            } catch (error) {
                return res.status(401).send({ error: { message: 'Token inválido.' } });
            }
        }
        if (!context.auth) {
            return res.status(401).send({ error: { message: 'Autenticação necessária.' } });
        }

        const { email, sessionId } = req.body.data;
        if (!email || !sessionId) {
            return res.status(422).send({ error: { message: 'E-mail e ID da sessão são obrigatórios.' } });
        }

        const senderUid = context.auth.uid;
        try {
            const recipientUser = await admin.auth().getUserByEmail(email);
            if (!recipientUser) {
                return res.status(404).send({ error: { message: `Nenhum usuário encontrado com o e-mail ${email}.` } });
            }
            const recipientUid = recipientUser.uid;

            const charDoc = await db.collection('sessions').doc(sessionId).collection('characters').doc(senderUid).get();
            if (!charDoc.exists) {
                return res.status(404).send({ error: { message: 'Seu personagem não foi encontrado nesta sessão.' } });
            }
            const senderCharacterName = charDoc.data().name;

            const invitesRef = db.collection('invites');
            const existingInviteQuery = await invitesRef.where('recipientUid', '==', recipientUid).where('sessionId', '==', sessionId).get();

            if (!existingInviteQuery.empty) {
                 const existing = existingInviteQuery.docs[0].data();
                 if(existing.status === 'pending'){
                    return res.status(200).send({ data: { message: 'Este jogador já tem um convite pendente para esta sessão.' } });
                 }
            }

            await invitesRef.add({
                senderId: senderUid,
                senderCharacterName: senderCharacterName,
                recipientEmail: email,
                recipientUid: recipientUid,
                sessionId: sessionId,
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return res.status(200).send({ data: { success: true, message: `Convite enviado para ${email}.` } });

        } catch (error) {
            console.error("Erro em sendInvite:", error);
            if (error.code === 'auth/user-not-found') {
                 return res.status(404).send({ error: { message: `Nenhum usuário encontrado com o e-mail ${email}.` } });
            }
            return res.status(500).send({ error: { message: 'Ocorreu um erro ao enviar o convite.' } });
        }
    });
});

exports.getPendingInvites = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticação é necessária.');
    }
    try {
        const userUid = context.auth.uid;
        const invitesRef = db.collection('invites');

        const snapshot = await invitesRef
            .where('recipientUid', '==', userUid)
            .where('status', '==', 'pending')
            .get();

        if (snapshot.empty) {
            return [];
        }

        const invites = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return invites;

    } catch (error) {
        console.error("Erro CRÍTICO em getPendingInvites:", error);
        throw new functions.https.HttpsError('internal', 'Não foi possível buscar os convites.');
    }
});

exports.acceptInvite = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    }
    const { inviteId } = data;
    if (!inviteId) {
        throw new functions.https.HttpsError('invalid-argument', 'ID do convite é obrigatório.');
    }

    const uid = context.auth.uid;
    const inviteRef = db.collection('invites').doc(inviteId);

    try {
        let sessionId;
        await db.runTransaction(async (transaction) => {
            const inviteDoc = await transaction.get(inviteRef);
            if (!inviteDoc.exists || inviteDoc.data().status !== 'pending') {
                throw new functions.https.HttpsError('not-found', 'Convite não encontrado ou já foi respondido.');
            }
            if (inviteDoc.data().recipientUid !== uid) {
                throw new functions.https.HttpsError('permission-denied', 'Este convite não é para você.');
            }
            sessionId = inviteDoc.data().sessionId;
            const sessionRef = db.collection('sessions').doc(sessionId);
            transaction.update(sessionRef, { memberUIDs: admin.firestore.FieldValue.arrayUnion(uid) });
            transaction.update(inviteRef, { status: 'accepted', respondedAt: admin.firestore.FieldValue.serverTimestamp() });
        });
        return { success: true, sessionId: sessionId };
    } catch (error) {
        console.error(`Erro ao aceitar convite ${inviteId}:`, error);
        throw error instanceof functions.https.HttpsError ? error : new functions.https.HttpsError('internal', 'Não foi possível aceitar o convite.');
    }
});

exports.declineInvite = regionalFunctions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    }
    const { inviteId } = data;
    if (!inviteId) {
        throw new functions.https.HttpsError('invalid-argument', 'ID do convite é obrigatório.');
    }
    const uid = context.auth.uid;
    const inviteRef = db.collection('invites').doc(inviteId);
    try {
        const inviteDoc = await inviteRef.get();
        if (!inviteDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Convite não encontrado.');
        }

        if (inviteDoc.data().recipientUid !== uid) {
            throw new functions.https.HttpsError('permission-denied', 'Este convite não é para você.');
        }
        await inviteRef.update({ status: 'declined', respondedAt: admin.firestore.FieldValue.serverTimestamp() }); 
        return { success: true };
    } catch (error) {
        console.error(`Erro ao recusar convite ${inviteId}:`, error);
        throw error instanceof functions.https.HttpsError ? error : new functions.https.HttpsError('internal', 'Não foi possível recusar o convite.');
    }
});


// ===================================================================================
//  Função do Mestre de Jogo (IA) - ROBUSTA E CORRIGIDA
// ===================================================================================
const createSystemPrompt = (characters) => {
  let partyRoster = "";
  if (characters && characters.length > 0) {
    partyRoster = "\n## O GRUPO DE AVENTUREIROS\n";
    characters.forEach(char => {
      if (!char.attributes) return;
      const attrs = char.attributes;
      partyRoster += `- **${char.name}**: Força ${attrs.strength}, Destreza ${attrs.dexterity}, Constituição ${attrs.constitution}, Inteligência ${attrs.intelligence}, Sabedoria ${attrs.wisdom}, Carisma ${attrs.charisma}.\n`;
    });
  } else {
      partyRoster = "Ainda não há aventureiros nesta saga.";
  }
  
  return [
      { role: 'user', parts: [{ text: `Você é Aethel, o Mestre de uma partida de RPG de fantasia sombria. O tom é sério e misterioso. Descreva as cenas com detalhes, interprete NPCs e apresente desafios. Termine suas respostas perguntando 'O que vocês fazem?'. ${partyRoster}` }]},
      { role: 'model', parts: [{ text: "Entendido. Estou pronto para mestrar a aventura com base nos personagens fornecidos. Começarei a narração quando receber a primeira mensagem ou comando."}]}
  ];
};

exports.generateMasterResponse = regionalFunctions.runWith({ secrets: [geminiApiKey] }).firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const newMessage = snapshot.data();
    const sessionId = context.params.sessionId;

    // Se a mensagem for do mestre, ou uma mensagem de rolagem de dados, ignora.
    if (newMessage.from === 'mestre' || newMessage.text.includes('rolou um d')) {
        return null;
    }

    try {
        const genAI = new GoogleGenerativeAI(geminiApiKey.value());
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        const charactersSnapshot = await db.collection('sessions').doc(sessionId).collection('characters').get();
        const characters = charactersSnapshot.docs.map(doc => doc.data());

        let prompt;
        if (newMessage.text === '__START_ADVENTURE__') {
            const character = characters.find(c => c.uid === newMessage.uid);
            prompt = `Meu personagem é ${character.name}. Acabei de criá-lo. Descreva a cena de abertura da aventura. Onde estou e qual o primeiro desafio ou mistério que encontro?`;
            await snapshot.ref.delete();
        } else {
            prompt = newMessage.text;
        }

        const historySnapshot = await db.collection('sessions').doc(sessionId).collection('messages').orderBy('createdAt').get();
        
        const historyDocs = historySnapshot.docs;
        if (historyDocs.length > 0) {
            historyDocs.pop(); 
        }

        const history = historyDocs.map(doc => {
            const data = doc.data();
            if (data.text === '__START_ADVENTURE__' || data.text.includes('rolou um d')) return null;
            const role = data.from === 'mestre' ? 'model' : 'user';
            return { role, parts: [{ text: data.text }] };
        }).filter(Boolean);

        const systemInstructions = createSystemPrompt(characters);
        const chat = model.startChat({ history: [...systemInstructions, ...history] });

        const result = await chat.sendMessage(prompt);
        const response = await result.response;
        const masterResponse = response.text();

        if (masterResponse) {
            await db.collection('sessions').doc(sessionId).collection('messages').add({
                from: 'mestre',
                text: masterResponse,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        return null;
    } catch (error) {
        console.error("Erro na IA do Mestre:", error);
        await db.collection('sessions').doc(sessionId).collection('messages').add({
            from: 'mestre',
            text: "(O Mestre parece confuso por um momento. Por favor, tente sua ação novamente.)",
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return null;
    }
});
