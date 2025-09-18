/*
 *  functions/index.js (Versão com Correção de Inicialização)
 *  O Cérebro do Mestre de Jogo (IA)
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { defineSecret } = require("firebase-functions/params");

// --- INICIALIZAÇÃO CORRIGIDA ---
// Força a inicialização a encontrar o bucket de storage padrão,
// resolvendo a falha silenciosa de "bucket not found".
const projectId = process.env.GCLOUD_PROJECT;
try {
  if (projectId) {
    admin.initializeApp({
      storageBucket: `${projectId}.appspot.com`,
    });
  } else {
    admin.initializeApp();
  }
} catch (e) {
  // Este erro acontecerá localmente se as credenciais não estiverem setadas,
  // mas é seguro ignorar aqui, pois o que importa é o ambiente de deploy.
  console.warn("Falha na inicialização do Admin SDK (esperado em ambiente local sem config):", e.message);
}

const geminiApiKey = defineSecret("GEMINI_API_KEY");

const openingNarration = "Você acorda com o som de água pingando. Sua cabeça dói e seus ossos estão gelados. Você está deitado sobre pedra fria e úmida, em uma escuridão quase total. Um cheiro de poeira antiga e mofo preenche o ar. À medida que seus olhos se ajustam, você distingue as paredes de uma cripta. Um feixe de luar atravessa uma rachadura no teto, iluminando uma porta de pedra maciça a poucos metros de distância. Você não se lembra de como chegou aqui. O que você faz?";

const createSystemPrompt = (character) => {
  let characterPromptPart = "";
  if (character) {
    const attrs = character.attributes;
    characterPromptPart = `
## PERSONAGEM DO JOGADOR
Você está narrando para o seguinte personagem. Leve seus atributos em consideração ao descrever os resultados das ações dele.
- **Nome:** ${character.name}
- **Atributos:** Força ${attrs.strength}, Destreza ${attrs.dexterity}, Constituição ${attrs.constitution}, Inteligência ${attrs.intelligence}, Sabedoria ${attrs.wisdom}, Carisma ${attrs.charisma}.
`;
  } else {
      characterPromptPart = "O jogador ainda não criou um personagem.";
  }

  return {
    role: 'user',
    parts: [{ text: `
# INSTRUÇÃO MESTRE DE RPG - FANTASIA SOMBRIA

## PERSONA
Você é "O Mestre das Sombras", um narrador de RPG de mesa experiente. Seu tom é sério, sua narração é imersiva e o mundo que você descreve é perigoso e envolto em mistério. Você nunca quebra o personagem e narra em português do Brasil.

## MUNDO E CENÁRIO
O mundo se chama Aethel. É um reino caído, assombrado por criaturas corrompidas e magia esquecida.

${characterPromptPart}

## REGRAS DE NARRAÇÃO
1.  **DESCRIÇÕES VÍVIDAS:** Descreva o ambiente, os sons e os cheiros. Crie uma atmosfera densa.
2.  **SEJA REATIVO:** Reaja diretamente às ações do jogador, considerando seus atributos.
3.  **APRESENTE ESCOLHAS:** Descreva a situação e os possíveis caminhos ou ações.
4.  **INCORPORE DADOS:** Quando um jogador envia uma rolagem (ex: "Rolagem d20: 18"), use o resultado e os atributos do personagem para determinar o sucesso ou falha e descrever a consequência.
5.  **SEMPRE TERMINE COM UMA PERGUNTA:** Encerre cada narração perguntando ao jogador o que ele faz. Exemplos: "O que você faz?", "Qual o seu próximo movimento?".
`}]
  };
};

const modelResponseToSystem = {
    role: 'model',
    parts: [{ text: `Entendido. Eu sou o Mestre das Sombras. A escuridão aguarda a história do jogador.` }]
};

exports.generateMasterResponse = functions.runWith({ secrets: [geminiApiKey] }).firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {

    // Código simplificado e mais seguro para obter a referência da coleção
    const messagesRef = snapshot.ref.parent;

    try {
        const messageData = snapshot.data();

        if (!messageData || messageData.from !== 'player') {
            return null;
        }

        if (messageData.text && messageData.text.trim() === '__START_ADVENTURE__') {
            return messagesRef.add({
                from: 'mestre',
                text: openingNarration,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }

        const db = admin.firestore();
        const playerUid = messageData.uid;
        if (!playerUid) throw new Error("UID do jogador ausente na mensagem.");

        const charDoc = await db.collection('characters').doc(playerUid).get();
        const characterData = charDoc.exists ? charDoc.data() : null;
        
        const systemInstruction = createSystemPrompt(characterData);
        const genAI = new GoogleGenerativeAI(geminiApiKey.value());

        const historySnapshot = await messagesRef.orderBy("createdAt").limitToLast(20).get();
        const history = historySnapshot.docs.map(doc => {
            if (doc.data().text === '__START_ADVENTURE__') return null;
            const role = doc.data().from === 'player' ? 'user' : 'model';
            return { role, parts: [{ text: doc.data().text }] };
        }).filter(item => item !== null);

        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const chat = model.startChat({
            history: [systemInstruction, modelResponseToSystem, ...history],
            generationConfig: { maxOutputTokens: 500 },
        });

        const result = await chat.sendMessage(messageData.text);
        const masterText = await result.response.text();

        return messagesRef.add({
          from: 'mestre',
          text: masterText,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

    } catch (error) {
        console.error("Erro crítico na Cloud Function generateMasterResponse:", error);
        return messagesRef.add({
            from: 'mestre',
            text: `(O Mestre tropeça na escuridão. Um erro grave e inesperado ocorreu. Por favor, reporte este detalhe ao desenvolvedor: ${error.message})`,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
});
