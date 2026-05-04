const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { defineSecret } = require("firebase-functions/params");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const historia = require("./historia.json");

// Importação do Genkit configurado
const { ai } = require('./genkit-config');

// Inicialização do Admin SDK
try { 
    admin.initializeApp(); 
} catch (e) { 
    console.log("admin.initializeApp() falhou, provavelmente já foi inicializado."); 
}

const geminiApiKey = defineSecret("GEMINI_API_KEY");
const db = admin.firestore();

const AI_UID = 'master-ai';
const REGION = 'southamerica-east1';

// --- LÓGICA DO JOGO COM GENKIT ---
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
        if (!snapshot) return;

        const newMessage = snapshot.data();
        const { sessionId, messageId } = event.params;

        // Evita loops infinitos ignorando mensagens do mestre ou de sistema
        if (newMessage.from === 'mestre' || newMessage.isTurnoUpdate) return;
        
        const sessionRef = db.collection('sessions').doc(sessionId);
        const lastPlayerUid = newMessage.uid;

        // Tratamento da mensagem de início de aventura
        if (newMessage.text === '__START_ADVENTURE__') {
            await snapshot.ref.delete();
            return; 
        }

        try {
            // Trava o turno para o Mestre (IA)
            await sessionRef.update({ turnoAtualUid: AI_UID });

            const sessionDoc = await sessionRef.get();
            const sessionData = sessionDoc.data();
            
            if (sessionData.adventureStarted === false) {
                await sessionRef.update({ adventureStarted: true });
            }
            
            const charactersSnapshot = await sessionRef.collection('characters').get();
            const allCharacters = charactersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const playerCharacter = allCharacters.find(c => c.uid === lastPlayerUid);

            if (!playerCharacter) {
                throw new HttpsError('not-found', "Personagem não encontrado.");
            }

            // 1. Consciência de Grupo
            const partyMembers = allCharacters
                .filter(c => c.uid !== AI_UID)
                .map(c => `- Nome: ${c.name}, Gênero: ${c.gender}, Orixá: ${c.orixa.name}`)
                .join('\n');

            // 2. Instrução de Gênero
            const genderInstruction = playerCharacter.gender === 'feminino'
                ? "Use pronomes femininos (ela/dela)."
                : playerCharacter.gender === 'masculino'
                ? "Use pronomes masculinos (ele/dele)."
                : "Use pronomes neutros (elu/delu).";

            // 3. Histórico de Chat para o Genkit
            const historySnapshot = await sessionRef.collection('messages').orderBy('createdAt', 'desc').limit(20).get();
            const chatHistory = historySnapshot.docs
                .filter(doc => !doc.data().isTurnoUpdate && doc.id !== messageId)
                .reverse()
                .map(doc => {
                    const data = doc.data();
                    return {
                        role: data.from === 'mestre' ? 'model' : 'user',
                        content: [{ text: data.from === 'mestre' ? data.text : `${data.characterName}: ${data.text}` }]
                    };
                });

            // 4. Lógica de Atributos do Sistema "O Chamado do Axé"
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

            const saude = playerCharacter.attributes.ara.sub.saude.value;
            const agilidade = playerCharacter.attributes.ara.sub.agilidade.value;
            const energiaVital = playerCharacter.attributes.emi.sub.energia.value;

            const fichaFormatada = {
                PV: 10 + (saude * 2),
                PA: 10 + (energiaVital * 2),
                Defesa: 10 + calcularModificador(agilidade),
                detalhes: ""
            };

            for (const cat in playerCharacter.attributes) {
                const categoria = playerCharacter.attributes[cat];
                fichaFormatada.detalhes += `[${categoria.name}]: `;
                for (const sub in categoria.sub) {
                    const attr = categoria.sub[sub];
                    const mod = calcularModificador(attr.value);
                    fichaFormatada.detalhes += `${attr.name} ${attr.value} (Mod: ${mod >= 0 ? '+' : ''}${mod}), `;
                }
                fichaFormatada.detalhes += '\n';
            }

            // 5. Chamada do Genkit (Usando o prompt definido em mestre.prompt)
            const atoAtual = historia.atos[sessionData.estadoDaHistoria || 'ato1'];
            const mestrePrompt = ai.prompt('mestre');
            
            const result = await mestrePrompt.generate({
                input: {
                    playerAction: newMessage.text,
                    character: {
                        ...playerCharacter,
                        fichaTexto: fichaFormatada.detalhes,
                        pvMax: fichaFormatada.PV,
                        paMax: fichaFormatada.PA,
                        defesa: fichaFormatada.Defesa,
                        genderInstruction: genderInstruction
                    },
                    party: partyMembers,
                    atoAtual: atoAtual
                },
                history: chatHistory,
            });

            const aiResponse = result.text();

            // Salva a resposta do mestre
            await sessionRef.collection('messages').add({
                from: 'mestre',
                characterName: 'Mestre',
                text: aiResponse,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Gerenciamento de Turnos
            const playerUIDs = sessionData.ordemDeTurnos.filter(uid => uid !== AI_UID);
            const lastPlayerIndex = playerUIDs.indexOf(lastPlayerUid);
            const nextPlayerUid = playerUIDs[(lastPlayerIndex + 1) % playerUIDs.length];

            await sessionRef.update({ turnoAtualUid: nextPlayerUid });

            const nextChar = allCharacters.find(c => c.uid === nextPlayerUid);
            if (nextChar) {
                await sessionRef.collection('messages').add({
                    from: 'mestre',
                    text: `É o turno de ${nextChar.name}.`,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    isTurnoUpdate: true
                });
            }

        } catch (error) {
            console.error(`ERRO CRÍTICO:`, error);
            await sessionRef.update({ turnoAtualUid: lastPlayerUid });
            await sessionRef.collection('messages').add({
                from: 'mestre',
                text: '(O Mestre parece confuso. Houve um erro no fluxo do Axé. Tente novamente.)',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    }
);

// --- FUNÇÕES DE SUPORTE (LOGIN E SESSÃO) ---

exports.onUserCreate = functions.region(REGION).auth.user().onCreate(async (user) => {
    if (user.displayName || !user.email) return;
    const newDisplayName = user.email.split('@')[0];
    try {
        await admin.auth().updateUser(user.uid, { displayName: newDisplayName });
    } catch (error) {
        console.error(error);
    }
});

exports.createAndJoinSession = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
    const { characterName, attributes, orixa, gender } = request.data;
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

        const batch = db.batch();
        batch.set(sessionRef.collection('characters').doc(uid), { name: characterName, attributes, orixa, gender, uid, sessionId: sessionRef.id });
        batch.set(sessionRef.collection('characters').doc(AI_UID), { name: "Mestre", attributes: {}, uid: AI_UID, sessionId: sessionRef.id });
        await batch.commit();

        await sessionRef.collection('messages').add({
            from: 'player',
            text: '__START_ADVENTURE__',
            characterName,
            uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, sessionId: sessionRef.id };
    } catch (e) {
        throw new HttpsError('internal', 'Erro ao criar sessão.');
    }
});

exports.passarTurno = onCall({ region: REGION }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login necessário.');
    const { sessionId } = request.data;
    const uid = request.auth.uid;
    const sessionRef = db.collection('sessions').doc(sessionId);
    const doc = await sessionRef.get();
    
    if (doc.data().turnoAtualUid !== uid) throw new HttpsError('permission-denied', 'Não é seu turno.');
    
    await sessionRef.collection('messages').add({
        from: 'player',
        text: '*Passa o turno*',
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
