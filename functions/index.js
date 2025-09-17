/*
 *  functions/index.js (Versão Segura para Deploy)
 *  O Cérebro do Mestre de Jogo (IA)
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

admin.initializeApp();

// --- CONFIGURAÇÃO DA CHAVE DE API ---
// !!! SUBSTITUA PELA SUA CHAVE DE API REAL ANTES DE FAZER O DEPLOY !!!
const geminiApiKey = "AIzaSyBvnhbaN2IA8kx9bviCNa33p6rgUlSU0yI";


// --- PROMPT (A PERSONALIDADE DA IA) ---
const systemInstruction = {
    role: 'user',
    parts: [{ text: `
# INSTRUÇÃO MESTRE DE RPG - FANTASIA SOMBRIA

## PERSONA
Você é "O Mestre das Sombras", um narrador de RPG de mesa experiente. Seu tom é sério, sua narração é imersiva e o mundo que você descreve é perigoso e envolto em mistério. Você nunca quebra o personagem e narra em português do Brasil.

## MUNDO E CENÁRIO
O mundo se chama Aethel. É um reino caído, assombrado por criaturas corrompidas e magia esquecida.

## REGRAS DE NARRAÇÃO
1.  **DESCRIÇÕES VÍVIDAS:** Descreva o ambiente, os sons e os cheiros. Crie uma atmosfera densa.
2.  **SEJA REATIVO:** Reaja diretamente às ações do jogador.
3.  **APRESENTE ESCOLHAS:** Descreva a situação e os possíveis caminhos ou ações, mas não decida pelo jogador.
4.  **INCORPORE DADOS:** Quando um jogador envia uma rolagem de dados (ex: "Rolagem d20: 18"), use o resultado para determinar o sucesso ou falha da ação e descreva a consequência.
5.  **SEMPRE TERMINE COM UMA PERGUNTA:** Encerre cada narração perguntando ao jogador o que ele faz. Exemplos: "O que você faz?", "Qual o seu próximo movimento?".

## ABERTURA DA AVENTURA (IMPORTANTE)
Se o histórico de chat tiver apenas a sua instrução inicial, sua PRIMEIRA resposta DEVE ser EXATAMENTE esta narração de abertura para iniciar a aventura. Após esta abertura, reaja normalmente.

**Narração de Abertura:**
"Você acorda com o som de água pingando. Sua cabeça dói e seus ossos estão gelados. Você está deitado sobre pedra fria e úmida, em uma escuridão quase total. Um cheiro de poeira antiga e mofo preenche o ar. À medida que seus olhos se ajustam, você distingue as paredes de uma cripta. Um feixe de luar atravessa uma rachadura no teto, iluminando uma porta de pedra maciça a poucos metros de distância. Você não se lembra de como chegou aqui. O que você faz?"
`}]
};

const modelResponseToSystem = {
    role: 'model',
    parts: [{ text: `Entendido. Eu sou o Mestre das Sombras. A escuridão aguarda.` }]
};


exports.generateMasterResponse = functions.firestore
  .document('sessions/{sessionId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {

    // 1. Ignora mensagens que não são de jogadores
    if (snapshot.data().from !== 'player') {
      return null;
    }

    const messagesRef = snapshot.ref.firestore.collection('sessions', context.params.sessionId, 'messages');

    // 2. VERIFICA A CHAVE DE API EM TEMPO DE EXECUÇÃO
    if (geminiApiKey === "COLE_SUA_CHAVE_AQUI_E_SALVE_O_ARQUIVO") {
        console.error("A execução falhou porque a chave da API do Gemini não foi inserida no código.");
        return messagesRef.add({
            from: 'mestre',
            text: `(ERRO DO SISTEMA: A chave da API do Mestre não foi configurada no servidor. O deploy funcionou, mas a função não pode ser executada. Verifique o arquivo functions/index.js.)`,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    try {
        // 3. INICIA A IA (AGORA DENTRO DA FUNÇÃO)
        const genAI = new GoogleGenerativeAI(geminiApiKey);

        // 4. Busca o histórico de mensagens
        const historySnapshot = await messagesRef.orderBy("createdAt", "desc").limit(20).get();
        const history = historySnapshot.docs.map(doc => {
            const role = doc.data().from === 'player' ? 'user' : 'model';
            return { role, parts: [{ text: doc.data().text }] };
        }).reverse();

        // 5. Configura e inicia o chat com a IA
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const chat = model.startChat({
            history: [systemInstruction, modelResponseToSystem, ...history],
            generationConfig: { maxOutputTokens: 400 },
        });

        // 6. Envia a mensagem do jogador para a IA e obtém a resposta
        const playerMessage = snapshot.data().text;
        const result = await chat.sendMessage(playerMessage);
        const masterText = await result.response.text();

        // 7. Salva a resposta do Mestre no banco de dados
        return messagesRef.add({
          from: 'mestre',
          text: masterText,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

    } catch (error) {
        console.error("Erro ao chamar a API do Gemini:", error);
        return messagesRef.add({
            from: 'mestre',
            text: `(O Mestre parece confuso e não consegue se comunicar. Erro: ${error.message})`,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }
});
