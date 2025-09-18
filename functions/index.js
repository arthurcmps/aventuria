/*
 *  functions/index.js (Versão com Funções de Sessão Refatoradas)
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { defineSecret } = require("firebase-functions/params");

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
//  NOVA Função Chamável: Criar Personagem e Sessão
// ===================================================================================
exports.createAndJoinSession = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Autenticação necessária.');
    }

    const { characterName, attributes } = data;
    if (!characterName || !attributes) {
        throw new functions.https.HttpsError('invalid-argument', 'Nome do personagem e atributos são obrigatórios.');
    }

    const uid = context.auth.uid;

    try {
        // 1. Criar a nova sessão
        const sessionRef = await db.collection("sessions").add({
            owner: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            memberUIDs: [uid] 
        });

        // 2. Criar o documento do personagem
        const newCharacter = {
            name: characterName,
            attributes: attributes,
            uid: uid,
            sessionId: sessionRef.id
        };

        // 3. Adicionar o personagem na subcoleção da sessão E na coleção global
        const characterInSessionRef = db.collection('sessions').doc(sessionRef.id).collection('characters').doc(uid);
        const globalCharacterRef = db.collection('characters').doc(uid);

        await db.batch()
            .set(characterInSessionRef, newCharacter)
            .set(globalCharacterRef, { ...newCharacter })
            .commit();

        // 4. Iniciar a aventura com uma mensagem especial
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
// ===================================================================================
exports.invitePlayer = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Você precisa estar logado para convidar jogadores.');
  }

  const { email, sessionId } = data;
  if (!email || !sessionId) {
    throw new functions.https.HttpsError('invalid-argument', 'Por favor, forneça um e-mail e um ID de sessão.');
  }

  try {
    const actionCodeSettings = {
      url: `https://aventuria-baeba.web.app/?sessionId=${sessionId}`,
      handleCodeInApp: true,
    };

    // Esta função prepara o link para ser enviado pelo sistema de autenticação do Firebase
    await admin.auth().generateSignInWithEmailLink(email, actionCodeSettings);
    
    // Adiciona o UID de um usuário existente à sessão imediatamente.
    // Se o usuário for novo, ele será adicionado quando clicar no link e chamar `joinSessionFromInvite`.
    try {
      const user = await admin.auth().getUserByEmail(email);
      if (user) {
        await db.collection('sessions').doc(sessionId).update({
          memberUIDs: admin.firestore.FieldValue.arrayUnion(user.uid)
        });
      }
    } catch(e) {
      // Ignora o erro se o usuário não for encontrado. O fluxo de convite tratará disso.
    }

    return { success: true, message: `Um convite para ${email} foi preparado. O envio depende da ativação do provedor de login por e-mail no Firebase.` };

  } catch (error) {
    console.error("Erro ao gerar link de convite:", error);
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
