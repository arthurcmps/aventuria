/*
 *  functions/index.js
 *  O Cérebro do Mestre de Jogo (IA)
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Inicializa o Firebase Admin para que a função possa interagir com o Firestore
admin.initializeApp();

// Pega sua Chave de API da IA do Google do ambiente da função
// Você precisa configurar isso no console do Firebase ou via terminal
const geminiApiKey = functions.config().gemini.key;
const genAI = new GoogleGenerativeAI(geminiApiKey);

/**
 * Esta função é acionada sempre que uma nova mensagem é criada em QUALQUER sessão.
 */
exports.generateMasterResponse = functions.firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const newMessage = snapshot.data();

    // --- Etapa 1: Filtrar --- 
    // Ignora mensagens que não são de jogadores para evitar loops infinitos.
    if (newMessage.from !== 'player') {
      console.log("Mensagem ignorada (não é de um jogador).");
      return null;
    }

    // --- Etapa 2: Preparar para a IA ---
    const sessionId = context.params.sessionId;
    const messagesRef = admin.firestore().collection('sessions', sessionId, 'messages');

    // Monta um histórico simples para dar contexto à IA
    const historySnapshot = await messagesRef.orderBy("createdAt", "desc").limit(10).get();
    const history = historySnapshot.docs.map(doc => {
        const role = doc.data().from === 'player' ? 'user' : 'model';
        const text = doc.data().text;
        return { role, parts: [{ text }] };
    }).reverse(); // inverte para a ordem cronológica correta

    const model = genAI.getGenerativeModel({ model: "gemini-pro"});
    const chat = model.startChat({
        history: history,
        generationConfig: {
            maxOutputTokens: 200, // Limita o tamanho da resposta
        },
        // Define o "caráter" do Mestre de Jogo
        systemInstruction: `Você é um Mestre de um jogo de RPG de fantasia sombria. Responda de forma curta, descritiva e misteriosa. Incorpore os resultados das rolagens de dados (ex: "Rolagem d20: 18") nas suas respostas. Sempre narre em português do Brasil.`
    });

    // --- Etapa 3: Chamar a IA ---
    console.log("Enviando para a IA:", newMessage.text);
    const result = await chat.sendMessage(newMessage.text);
    const response = await result.response;
    const masterText = response.text();
    console.log("Resposta da IA:", masterText);

    // --- Etapa 4: Salvar a Resposta no Chat ---
    await messagesRef.add({
      from: 'mestre',
      uid: 'mestre-ai',
      text: masterText,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return null;
});
