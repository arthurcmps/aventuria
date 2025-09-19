/*
 *  functions/index.js (Versão com Funções de Sessão Refatoradas e correção de CORS)
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { defineSecret } = require("firebase-functions/params");
const cors = require('cors')({origin: true}); // Importa e inicializa o CORS

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
//  Função Https onRequest: Criar Personagem e Sessão (com CORS manual)
// ===================================================================================
exports.createAndJoinSession = functions.https.onRequest(async (req, res) => {
    // Envolve a lógica da função com o middleware CORS
    cors(req, res, async () => {

        // O Firebase popula `req.body.data` para requisições do tipo onCall.
        const { characterName, attributes } = req.body.data;
        const context = { auth: null };

        // Verificação de autenticação manual
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
            const idToken = req.headers.authorization.split('Bearer ')[1];
            try {
                const decodedToken = await admin.auth().verifyIdToken(idToken);
                context.auth = decodedToken;
            } catch (error) {
                console.error("Erro ao verificar token de autenticação:", error);
                res.status(401).send({ error: { message: 'Requisição não autenticada.' } });
                return;
            }
        }

        if (!context.auth) {
            res.status(401).send({ error: { message: 'Autenticação necessária.' } });
            return;
        }
        
        if (!characterName || !attributes) {
             res.status(422).send({ error: { message: 'Nome do personagem e atributos são obrigatórios.' } });
             return;
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
            // Corrigido: O personagem na coleção global não precisa do ID da sessão
            const globalCharacterRef = db.collection('characters').doc(); // Cria um ID único
            
            await db.batch()
                .set(characterInSessionRef, newCharacter)
                .set(globalCharacterRef, { ...newCharacter, sessionId: sessionRef.id }) // Garante que a referência exista
                .commit();
            
            await db.collection('sessions').doc(sessionRef.id).collection('messages').add({
              from: 'player',
              text: '__START_ADVENTURE__',
              characterName: newCharacter.name,
              uid: uid,
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Retorna a resposta de sucesso encapsulada em um objeto 'data'
            res.status(200).send({ data: { success: true, sessionId: sessionRef.id } });

        } catch (error) {
            console.error("Erro em createAndJoinSession:", error);
            res.status(500).send({ error: { message: 'Não foi possível criar a sessão.' } });
        }
    });
});


// ===================================================================================
//  NOVA Função Chamável: Entrar em Sessão por Convite
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
            // Adiciona o novo membro à lista da sessão
            transaction.update(sessionRef, {
                memberUIDs: admin.firestore.FieldValue.arrayUnion(uid)
            });
        });

        return { success: true };

    } catch (error) {
        console.error(`Erro ao tentar entrar na sessão ${sessionId}:`, error);
        // Não vaza o erro interno, apenas informa que não foi possível entrar.
        throw new functions.https.HttpsError('internal', 'Não foi possível entrar na sessão.');
    }
});


// ===================================================================================
//  Função Chamável: Convidar Jogador (Atualizada)
// =ame==================================================================================
exports.invitePlayer = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Você precisa estar logado para convidar jogadores.');
  }

  const { email, sessionId } = data;
  if (!email || !sessionId) {
    throw new functions.https.HttpsError('invalid-argument', 'Por favor, forneça um e-mail e um ID de sessão.');
  }

  // A lógica para enviar o e-mail foi removida do lado do servidor
  // O link de login é construído no cliente e o e-mail é enviado via provedor de e-mail do Firebase
  // Esta função agora apenas associa um usuário existente a uma sessão
  try {
    const user = await admin.auth().getUserByEmail(email);
    if (user) {
      await db.collection('sessions').doc(sessionId).update({
        memberUIDs: admin.firestore.FieldValue.arrayUnion(user.uid)
      });
      return { success: true, message: `Usuário ${email} adicionado à sessão.` };
    }
     return { success: true, message: `Convite para ${email} pode ser enviado pelo cliente.` };
  } catch(e) {
      if (e.code === 'auth/user-not-found') {
         return { success: true, message: `Um novo usuário ${email} será convidado.` };
      }
    console.error("Erro ao procurar usuário por e-mail:", e);
    throw new functions.https.HttpsError('internal', 'Ocorreu um erro ao processar o convite.');
  }
});


// ===================================================================================
//  Função do Mestre de Jogo (IA) - Sem alterações
// ===================================================================================
const openingScenarios = [
    "Vocês acordam com o som de água pingando...",
];

const createSystemPrompt = (characters) => {
  let partyRoster = "";
  if (characters && characters.length > 0) {
    partyRoster = "\n## O GRUPO DE AVENTUREIROS\n";
    characters.forEach(char => {
      const attrs = char.attributes;
      partyRoster += `- **${char.name}**: Força ${attrs.strength}, Destreza ${attrs.dexterity}, Constituição ${attrs.constitution}, Inteligência ${attrs.intelligence}, Sabedoria ${attrs.wisdom}, Carisma ${attrs.charisma}.\n`;
    });
  } else {
      partyRoster = "Ainda não há aventureiros nesta saga.";
  }
  return { role: 'user', parts: [{ text: `...INSTRUÇÕES DO MESTRE...` }] };
};

const modelResponseToSystem = { role: 'model', parts: [{ text: `Entendido.` }] };

exports.generateMasterResponse = functions.runWith({ secrets: [geminiApiKey] }).firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
      // LÓGICA DA IA SEM ALTERAÇÕES
  });
