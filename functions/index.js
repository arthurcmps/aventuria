/*
 *  functions/index.js (Versão com Convites para Multiplayer)
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

// ===================================================================================
//  Função Chamável: Convidar Jogador
// ===================================================================================
exports.invitePlayer = functions.https.onCall(async (data, context) => {
  // Verifica se o usuário que chama a função está autenticado
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Você precisa estar logado para convidar jogadores.');
  }

  const { email, sessionId } = data;
  if (!email || !sessionId) {
    throw new functions.https.HttpsError('invalid-argument', 'Por favor, forneça um e-mail e um ID de sessão.');
  }

  const db = admin.firestore();
  const sessionRef = db.collection('sessions').doc(sessionId);
  const sessionDoc = await sessionRef.get();

  // Verifica se a sessão existe e se o usuário atual é o dono
  if (!sessionDoc.exists || sessionDoc.data().owner !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'Você não tem permissão para convidar jogadores para esta sessão.');
  }

  const currentMembers = sessionDoc.data().memberUIDs || [];
  if (currentMembers.length >= 6) { // Dono + 5 amigos
      throw new functions.https.HttpsError('resource-exhausted', 'Esta sessão já atingiu o limite de 6 jogadores.');
  }

  try {
    // Busca o usuário pelo e-mail fornecido
    const userRecord = await admin.auth().getUserByEmail(email);
    const inviteeUid = userRecord.uid;

    if (currentMembers.includes(inviteeUid)) {
         throw new functions.https.HttpsError('already-exists', 'Este jogador já está na sessão.');
    }

    // Adiciona o UID do usuário convidado ao array de membros da sessão
    await sessionRef.update({
      memberUIDs: admin.firestore.FieldValue.arrayUnion(inviteeUid)
    });

    return { success: true, message: `Jogador com e-mail ${email} foi convidado com sucesso!` };

  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      throw new functions.https.HttpsError('not-found', 'Nenhum jogador encontrado com este e-mail.');
    }
    console.error("Erro ao convidar jogador:", error);
    throw new functions.https.HttpsError('internal', 'Ocorreu um erro inesperado ao tentar convidar o jogador.');
  }
});

// ===================================================================================
//  Função do Mestre de Jogo (IA)
// ===================================================================================

const openingScenarios = [
    "Vocês acordam com o som de água pingando. Suas cabeças doem e seus ossos estão gelados. Vocês estão deitados sobre pedra fria e úmida, em uma escuridão quase total. Um cheiro de poeira antiga e mofo preenche o ar. À medida que seus olhos se ajustam, vocês distinguem as paredes de uma cripta. Um feixe de luar atravessa uma rachadura no teto, iluminando uma porta de pedra maciça a poucos metros de distância. Nenhum de vocês se lembra de como chegou aqui. O que vocês fazem?",
    "O cheiro de cerveja barata e fumaça de cachimbo enche o ar. Vocês estão sentados em uma taverna movimentada, o som de conversas e risadas ao redor. Canecas de hidromel estão meio vazias na mesa e suas bolsas de moedas parecem um pouco mais leves do que se lembram. Um homem encapuzado em um canto escuro parece estar observando o grupo. O que vocês fazem?",
    "Um vento frio uiva através das árvores retorcidas. Vocês estão perdidos em uma floresta escura e antiga, a luz do dia mal penetrando a copa densa. Cada estalar de galho soa como uma ameaça. À distância, vocês veem uma luz bruxuleante, talvez de uma fogueira ou de uma tocha. Ninguém sabe como chegou aqui, apenas que um sentimento de pavor os consome. O que vocês fazem?",
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

  return {
    role: 'user',
    parts: [{ text: `
# INSTRUÇÃO MESTRE DE RPG - FANTASIA SOMBRIA (MULTIPLAYER)

## PERSONA
Você é "O Mestre das Sombras", um narrador de RPG para um grupo de jogadores. Seu tom é sério e imersivo. Você nunca quebra o personagem e narra em português do Brasil.

## MUNDO E CENÁRIO
O mundo se chama Aethel. É um reino caído, assombrado por criaturas corrompidas e magia esquecida.

${partyRoster}

## REGRAS DE NARRAÇÃO MULTIPLAYER
1.  **NARRATIVA COLETIVA:** Dirija-se ao grupo como "vocês", mas reaja às ações individuais nomeando o personagem que agiu.
2.  **REATIVIDADE INDIVIDUAL:** Quando um jogador age (Ex: Kael age), descreva o resultado da ação dele, mas também como o resto do grupo percebe isso.
3.  **GERENCIE O FOCO:** Dê a todos a chance de agir. Se um jogador está quieto, você pode perguntar o que seu personagem está fazendo.
4.  **AÇÕES EM PARALELO:** Os jogadores podem agir ao mesmo tempo. Sua narração deve refletir isso.
5.  **SEMPRE TERMINE COM UMA PERGUNTA ABERTA AO GRUPO:** Encerre cada narração perguntando "O que vocês fazem?" ou "Qual o próximo movimento do grupo?", para incentivar a colaboração.
`}]
  };
};

const modelResponseToSystem = {
    role: 'model',
    parts: [{ text: `Entendido. Eu sou o Mestre das Sombras. A escuridão aguarda a história do grupo.` }]
};

exports.generateMasterResponse = functions.runWith({ secrets: [geminiApiKey] }).firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {

    const { sessionId } = context.params;
    const messagesRef = admin.firestore().collection('sessions').doc(sessionId).collection('messages');

    try {
        const messageData = snapshot.data();
        if (!messageData || messageData.from !== 'player') return null;

        if (messageData.text.trim() === '__START_ADVENTURE__') {
            const randomIndex = Math.floor(Math.random() * openingScenarios.length);
            return messagesRef.add({ from: 'mestre', text: openingScenarios[randomIndex], createdAt: admin.firestore.FieldValue.serverTimestamp() });
        }

        const charactersRef = admin.firestore().collection('sessions').doc(sessionId).collection('characters');
        const charactersSnapshot = await charactersRef.get();
        const party = charactersSnapshot.docs.map(doc => doc.data());

        if (party.length === 0) return null; // Não gera resposta se não houver personagens

        const systemInstruction = createSystemPrompt(party);
        const genAI = new GoogleGenerativeAI(geminiApiKey.value());

        const historySnapshot = await messagesRef.orderBy("createdAt").limitToLast(30).get();
        const history = historySnapshot.docs.map(doc => {
            const data = doc.data();
            if (data.text === '__START_ADVENTURE__') return null;
            const role = data.from === 'player' ? 'user' : 'model';
            const text = (role === 'user' && data.characterName) ? `${data.characterName}: ${data.text}` : data.text;
            return { role, parts: [{ text }] };
        }).filter(item => item !== null);
        
        const currentMessageText = `${messageData.characterName || 'Um jogador'}: ${messageData.text}`;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const chat = model.startChat({
            history: [systemInstruction, modelResponseToSystem, ...history],
            generationConfig: { maxOutputTokens: 700 },
        });

        const result = await chat.sendMessage(currentMessageText);
        const masterText = await result.response.text();

        return messagesRef.add({ from: 'mestre', text: masterText, createdAt: admin.firestore.FieldValue.serverTimestamp() });

    } catch (error) {
        console.error(`Erro na Cloud Function para sessão ${sessionId}:`, error);
        return messagesRef.add({
            from: 'mestre',
            text: `(O Mestre tropeça na escuridão e encara o grupo. Um erro inesperado ocorreu: ${error.message})`,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
});
