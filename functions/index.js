/*
 *  functions/index.js (Versão Estável com Correção de Erro 500)
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { defineSecret } = require("firebase-functions/params");
const cors = require('cors')({origin: true});

// Inicialização do Firebase Admin SDK
try {
  const projectId = process.env.GCLOUD_PROJECT;
  if (projectId) {
    admin.initializeApp({ storageBucket: `${projectId}.appspot.com` });
  } else {
    admin.initializeApp();
  }
} catch (e) {
  console.warn("Falha na inicialização do Admin SDK:", e.message);
}

const geminiApiKey = defineSecret("GEMINI_API_KEY");
const db = admin.firestore();

// ===================================================================================
//  Função Https onRequest: Criar Personagem e Sessão (CORRIGIDA)
// ===================================================================================
// A chamada para a IA foi removida para garantir estabilidade. A função agora apenas
// cria a sessão e envia a mensagem oculta para acionar a IA separadamente.
exports.createAndJoinSession = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {

        const { characterName, attributes } = req.body.data;
        let context = { auth: null };

        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            const idToken = req.headers.authorization.split('Bearer ')[1];
            try {
                const decodedToken = await admin.auth().verifyIdToken(idToken);
                context.auth = decodedToken;
            } catch (error) {
                console.error("Erro ao verificar token de autenticação:", error);
                return res.status(401).send({ error: { message: 'Requisição não autenticada.' } });
            }
        }

        if (!context.auth) {
            return res.status(401).send({ error: { message: 'Autenticação necessária.' } });
        }
        
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

            const newCharacter = {
                name: characterName,
                attributes: attributes,
                uid: uid,
                sessionId: sessionRef.id
            };

            const characterInSessionRef = db.collection('sessions').doc(sessionRef.id).collection('characters').doc(uid);
            const globalCharacterRef = db.collection('characters').doc();
            
            await db.batch()
                .set(characterInSessionRef, newCharacter)
                .set(globalCharacterRef, { ...newCharacter, sessionId: sessionRef.id })
                .commit();
            
            // Reintroduz a mensagem oculta para acionar a função da IA de forma assíncrona
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


// ===================================================================================
//  Função Chamável: Entrar em Sessão por Convite
// ===================================================================================
exports.joinSessionFromInvite = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária para entrar na sessão.');
    }

    const { sessionId } = data;
    if (!sessionId) {
        throw new functions.https.HttpsError('invalid-argument', 'ID da sessão é obrigatório.');
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
                memberUIDs: admin.firestore.FieldValue.arrayUnion(uid)
            });
        });

        return { success: true };

    } catch (error) {
        console.error(`Erro ao tentar entrar na sessão ${sessionId}:`, error);
        throw new functions.https.HttpsError('internal', 'Não foi possível entrar na sessão.');
    }
});


// ===================================================================================
//  Função Https onRequest: Enviar Convite (CORRIGIDA E RENOMEADA)
// ===================================================================================
exports.sendInvite = functions.https.onRequest(async (req, res) => {
    cors(req, res, async () => {

        let context = { auth: null };

        // 1. Autenticação
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            const idToken = req.headers.authorization.split('Bearer ')[1];
            try {
                const decodedToken = await admin.auth().verifyIdToken(idToken);
                context.auth = decodedToken;
            } catch (error) {
                console.error("Erro ao verificar token de autenticação:", error);
                return res.status(401).send({ error: { message: 'Requisição não autenticada.' } });
            }
        }

        if (!context.auth) {
            return res.status(401).send({ error: { message: 'Autenticação necessária.' } });
        }

        // 2. Validação dos dados
        const { email, sessionId } = req.body.data;
        if (!email || !sessionId) {
            return res.status(422).send({ error: { message: 'E-mail e ID da sessão são obrigatórios.' } });
        }

        // 3. Lógica da função
        try {
            const user = await admin.auth().getUserByEmail(email);
            if (user) {
                await db.collection('sessions').doc(sessionId).update({
                    memberUIDs: admin.firestore.FieldValue.arrayUnion(user.uid)
                });
                return res.status(200).send({ data: { success: true, message: `Usuário ${email} adicionado à sessão.` } });
            }
            return res.status(200).send({ data: { success: true, message: `Convite para ${email} pode ser processado.` }});

        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                return res.status(200).send({ data: { success: true, message: `Usuário ${email} não encontrado. Um convite pode ser enviado.` } });
            }
            console.error("Erro ao procurar usuário por e-mail:", error);
            return res.status(500).send({ error: { message: 'Ocorreu um erro ao processar o convite.' } });
        }
    });
});


// ===================================================================================
//  Função do Mestre de Jogo (IA) - Responde às mensagens dos jogadores (MODIFICADA)
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

exports.generateMasterResponse = functions.runWith({ secrets: [geminiApiKey] }).firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const newMessage = snapshot.data();
    const sessionId = context.params.sessionId;

    // Ignora mensagens do próprio mestre
    if (newMessage.from === 'mestre') {
      return null;
    }

    try {
        const genAI = new GoogleGenerativeAI(geminiApiKey.value());
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        const charactersSnapshot = await db.collection('sessions').doc(sessionId).collection('characters').get();
        const characters = charactersSnapshot.docs.map(doc => doc.data());

        let prompt;
        // Lógica CORRIGIDA para iniciar a aventura
        if (newMessage.text === '__START_ADVENTURE__') {
            const character = characters.find(c => c.uid === newMessage.uid);
            prompt = `Meu personagem é ${character.name}. Acabei de criá-lo. Por favor, descreva a cena de abertura da aventura. Onde estou e qual o primeiro desafio ou mistério que encontro?`;
            
            // Deleta a mensagem oculta após usá-la
            await snapshot.ref.delete();

        } else {
            prompt = newMessage.text;
        }

        const historySnapshot = await db.collection('sessions').doc(sessionId).collection('messages').orderBy('createdAt').get();
        const history = historySnapshot.docs.map(doc => {
            const data = doc.data();
            const role = data.from === 'mestre' ? 'model' : 'user';
            return { role, parts: [{ text: data.text }] };
        }).filter(msg => msg.parts[0].text !== '__START_ADVENTURE__'); // Filtra a mensagem oculta do histórico

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
        // Adiciona uma mensagem de erro no chat para o usuário
        await db.collection('sessions').doc(sessionId).collection('messages').add({
            from: 'mestre',
            text: "(O Mestre parece confuso por um momento, talvez a magia selvagem tenha interferido. Por favor, tente sua ação novamente.)",
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return null;
    }
});
