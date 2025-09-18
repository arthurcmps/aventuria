/*
 *  functions/index.js (Versão com Suporte a Múltiplas Sessões)
 *  O Cérebro do Mestre de Jogo (IA)
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { defineSecret } = require("firebase-functions/params");

// Inicialização do Firebase Admin SDK
try {
  const projectId = process.env.GCLOUD_PROJECT;
  if (projectId) {
    admin.initializeApp({
      storageBucket: `${projectId}.appspot.com`,
    });
  } else {
    admin.initializeApp();
  }
} catch (e) {
  console.warn("Falha na inicialização do Admin SDK (esperado em ambiente local sem config):", e.message);
}

// Definição do segredo da API Key
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Narração de abertura para novas aventuras
const openingNarration = "Você acorda com o som de água pingando. Sua cabeça dói e seus ossos estão gelados. Você está deitado sobre pedra fria e úmida, em uma escuridão quase total. Um cheiro de poeira antiga e mofo preenche o ar. À medida que seus olhos se ajustam, você distingue as paredes de uma cripta. Um feixe de luar atravessa uma rachadura no teto, iluminando uma porta de pedra maciça a poucos metros de distância. Você não se lembra de como chegou aqui. O que você faz?";

// Função para criar o prompt do sistema da IA
const createSystemPrompt = (character) => {
  let characterPromptPart = "";
  if (character && character.name && character.attributes) {
    const attrs = character.attributes;
    characterPromptPart = `
## PERSONAGEM DO JOGADOR
Você está narrando para o seguinte personagem. Leve seus atributos em consideração ao descrever os resultados das ações dele.
- **Nome:** ${character.name}
- **Atributos:** Força ${attrs.strength}, Destreza ${attrs.dexterity}, Constituição ${attrs.constitution}, Inteligência ${attrs.intelligence}, Sabedoria ${attrs.wisdom}, Carisma ${attrs.charisma}.
`;
  } else {
      characterPromptPart = "O jogador ainda não tem um personagem definido para esta sessão.";
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

// Resposta padrão do modelo para confirmar o entendimento do prompt
const modelResponseToSystem = {
    role: 'model',
    parts: [{ text: `Entendido. Eu sou o Mestre das Sombras. A escuridão aguarda a história do jogador.` }]
};

// --- Cloud Function Principal ---
exports.generateMasterResponse = functions.runWith({ secrets: [geminiApiKey] }).firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {

    const messagesRef = snapshot.ref.parent;
    const sessionRef = messagesRef.parent; // Referência ao documento da sessão

    try {
        const messageData = snapshot.data();

        // Ignora qualquer mensagem que não seja do jogador
        if (!messageData || messageData.from !== 'player') {
            return null;
        }

        // Se for a mensagem especial de início, envia a narração de abertura
        if (messageData.text && messageData.text.trim() === '__START_ADVENTURE__') {
            return messagesRef.add({
                from: 'mestre',
                text: openingNarration,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        
        // *** A LÓGICA CORRIGIDA PARA SESSÕES ***
        // 1. Carrega os dados da sessão, que contém o personagem
        const sessionDoc = await sessionRef.get();
        if (!sessionDoc.exists) throw new Error(`Sessão com ID ${context.params.sessionId} não encontrada.`);
        const characterData = sessionDoc.data().character;

        // 2. Cria o prompt do sistema com os dados do personagem da sessão
        const systemInstruction = createSystemPrompt(characterData);
        const genAI = new GoogleGenerativeAI(geminiApiKey.value());

        // 3. Busca o histórico de mensagens da sessão atual
        const historySnapshot = await messagesRef.orderBy("createdAt").limitToLast(20).get();
        const history = historySnapshot.docs.map(doc => {
            const data = doc.data();
            if (data.text === '__START_ADVENTURE__') return null;
            const role = data.from === 'player' ? 'user' : 'model';
            return { role, parts: [{ text: data.text }] };
        }).filter(item => item !== null);

        // 4. Configura e chama o modelo de IA
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const chat = model.startChat({
            history: [systemInstruction, modelResponseToSystem, ...history],
            generationConfig: { maxOutputTokens: 600 },
        });

        const result = await chat.sendMessage(messageData.text);
        const masterText = await result.response.text();

        // 5. Salva a resposta do mestre na mesma sessão
        return messagesRef.add({
          from: 'mestre',
          text: masterText,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

    } catch (error) {
        console.error(`Erro na Cloud Function para sessão ${context.params.sessionId}:`, error);
        return messagesRef.add({
            from: 'mestre',
            text: `(O Mestre tropeça na escuridão. Um erro grave e inesperado ocorreu. Por favor, reporte este detalhe ao desenvolvedor: ${error.message})`,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
});
