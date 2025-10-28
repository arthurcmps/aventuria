
import {genkit, z} from "genkit";
import {googleAI, gemini20Flash} from "@genkit-ai/googleai";
import {onCallGenkit} from "firebase-functions/https";
import * as admin from "firebase-admin";

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

// Constants
const AI_UID = "npc-mestre";

// Configure Genkit
const ai = genkit({
  plugins: [googleAI()],
});

// Define the input schema for the flow
const gameMasterInputSchema = z.object({
  sessionId: z.string(),
  playerAction: z.string(),
});

// Define the main Game Master flow
export const gameMasterFlow = ai.defineFlow(
  {
    name: "gameMasterFlow",
    inputSchema: gameMasterInputSchema,
    outputSchema: z.string(),
  },
  async ({sessionId, playerAction}) => {
    // 1. Fetch context from Firestore
    const sessionRef = db.collection("sessions").doc(sessionId);
    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists) {
      throw new Error(`Session with ID ${sessionId} not found.`);
    }
    const sessionData = sessionDoc.data();
    if (!sessionData) {
      throw new Error(`Session data for ID ${sessionId} is empty.`);
    }

    const messagesRef = sessionRef
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(10);
    const messagesSnapshot = await messagesRef.get();
    const recentMessages = messagesSnapshot.docs.map((doc) => {
      const data = doc.data();
      return `${data.characterName || data.uid}: ${data.text}`;
    }).reverse().join("\n");

    // 2. Define the AI persona (System Instruction)
    const systemInstruction = "Você é o Mestre de um jogo de RPG de mesa, " +
      "narrando uma aventura de fantasia épica, baseado na cultura e " +
      "cosmologia dos Orixás, para um grupo de jogadores. Sua " +
      "responsabilidade é descrever o mundo, interpretar NPCs, " +
      "apresentar desafios e reagir às ações dos jogadores de forma " +
      "criativa e coerente. Mantenha um tom narrativo e imersivo. " +
      "Nunca saia do personagem.";

    // 3. Construct the prompt
    const prompt = "Contexto da História: O estado atual da aventura é " +
      `'${sessionData.estadoDaHistoria}'.\n` +
      `Mensagens Recentes:\n${recentMessages}\n\n` +
      `Ação do Jogador: ${playerAction}\n\n` +
      "Com base em tudo isso, narre o que acontece a seguir. Seja " +
      "descritivo, criativo e continue a história.";

    // 4. Call the AI model
    const llmResponse = await ai.generate({
      model: gemini20Flash,
      prompt: prompt,
      config: {
        temperature: 0.8,
      },
      system: systemInstruction,
    });

    const responseText = llmResponse.text;

    // 5. Save AI response back to Firestore
    await sessionRef.collection("messages").add({
      text: responseText,
      uid: AI_UID,
      characterName: "Mestre de Jogo",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return responseText;
  }
);

// 6. Expose the flow as a callable Cloud Function
export const gameMaster = onCallGenkit({}, gameMasterFlow);
