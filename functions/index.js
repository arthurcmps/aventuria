/*
 *  functions/index.js
 *  O Cérebro do Mestre de Jogo (IA)
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

admin.initializeApp();

// --- CONFIGURAÇÃO DA CHAVE DE API (MÉTODO INSEGURO PARA TESTE) ---
// !!! RISCO DE SEGURANÇA: Cole sua chave de API aqui APENAS para teste. !!!
// !!! NÃO ENVIE ESTE ARQUIVO COM A CHAVE PARA UM GITHUB PÚBLICO. !!!
const geminiApiKey = "AIzaSyDe0XOGu2NFUvd3FJOpbi7RKQ85PDPmKgE"; // <--- SUBSTITUA ISTO PELA SUA CHAVE

// const geminiApiKey = functions.config().gemini.key; // Jeito seguro (desativado)

if (geminiApiKey === "AIzaSyDe0XOGu2NFUvd3FJOpbi7RKQ85PDPmKgE") {
    throw new Error("API Key do Gemini não foi configurada. Insira a chave na linha 13 do functions/index.js");
}

const genAI = new GoogleGenerativeAI(geminiApiKey);

/**
 * Esta função é acionada sempre que uma nova mensagem é criada em QUALQUER sessão.
 */
exports.generateMasterResponse = functions.firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const newMessage = snapshot.data();

    if (newMessage.from !== 'player') {
      console.log("Mensagem ignorada (não é de um jogador).");
      return null;
    }

    const sessionId = context.params.sessionId;
    const messagesRef = admin.firestore().collection('sessions', sessionId, 'messages');

    const historySnapshot = await messagesRef.orderBy("createdAt", "desc").limit(10).get();
    const history = historySnapshot.docs.map(doc => {
        const role = doc.data().from === 'player' ? 'user' : 'model';
        const text = doc.data().text;
        return { role, parts: [{ text }] };
    }).reverse();

    const systemInstruction = {
        role: 'user',
        parts: [{ text: `INSTRUÇÃO: Você é um Mestre de um jogo de RPG de fantasia sombria. Responda de forma curta, descritiva e misteriosa. Incorpore os resultados das rolagens de dados (ex: "Rolagem d20: 18") nas suas respostas. Sempre narre em português do Brasil.` }]
    };
    const modelResponseToSystem = {
        role: 'model',
        parts: [{ text: `Entendido. Assumo o papel do Mestre das Sombras e guiarei os jogadores nesta jornada.` }]
    };

    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const chat = model.startChat({
        history: [systemInstruction, modelResponseToSystem, ...history],
        generationConfig: {
            maxOutputTokens: 250,
        },
    });

    console.log("Enviando para a IA:", newMessage.text);
    const result = await chat.sendMessage(newMessage.text);
    const response = await result.response;
    const masterText = response.text();
    console.log("Resposta da IA:", masterText);

    await messagesRef.add({
      from: 'mestre',
      uid: 'mestre-ai',
      text: masterText,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return null;
});
