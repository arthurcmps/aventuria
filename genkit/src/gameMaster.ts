// functions/src/gameMaster.ts (CORRIGIDO)

import { genkit, z } from "genkit";
import { googleAI, gemini20Flash } from "@genkit-ai/googleai";
import { onCallGenkit } from "firebase-functions/https";
import * as admin from "firebase-admin";

// CORREÇÃO 1: Importar o JSON usando a sintaxe ES6.
// (Certifique-se de que 'historia.json' está na mesma pasta e
// 'resolveJsonModule' está 'true' no seu tsconfig.json)
import * as historia from "./historia.json";

// === DEFINIÇÃO DE TIPOS PARA O LINTER ===
interface RollRequest {
  attribute: string;
  cd: number;
  label: string;
}

interface Desafio {
  trigger: string;
  label: string;
  attribute: string;
  cd: number;
}

// Usamos Record<string, any> para side_quests para evitar o erro 'any'
// mas manter a flexibilidade.
interface Cena {
  titulo: string;
  narrativa_inicio: string;
  desafios_possiveis?: Desafio[];
  side_quests?: Record<string, unknown>;
}

interface Ato {
  titulo: string;
  cenas: Record<string, Cena>;
}

interface Historia {
  atos: Record<string, Ato>;
}
// ==========================================

// Inicializar o Firebase Admin SDK (se ainda não estiver inicializado)
try {
  admin.initializeApp();
} catch (e) {
  /* O app já foi inicializado */
}
const db = admin.firestore();

// Constantes
const AI_UID = "npc-mestre";
const REGION = "southamerica-east1";

// Configurar o Genkit
const ai = genkit({
  plugins: [googleAI()],
});

// === ESQUEMA DE DADOS ===
const rollResultSchema = z.object({
  attribute: z.string(),
  cd: z.number(),
  d20: z.number(),
  modifier: z.number(),
  total: z.number(),
  success: z.boolean(),
});

const gameMasterInputSchema = z.object({
  sessionId: z.string(),
  playerAction: z.string().optional(),
  rollResult: rollResultSchema.optional(),
  character: z.object({
    name: z.string(),
    gender: z.string(),
    orixa: z.object({
      name: z.string(),
      description: z.string(),
    }),
  }),
});

/**
 * Encontra os dados de uma cena específica no historia.json com base na chave.
 * @param {string} estadoKey A chave da cena (ex: "ato1_cenas_cena1_aldeia").
 * @return {Cena | null} O objeto da cena ou null se não for encontrado.
 */
function getSceneData(estadoKey: string): Cena | null {
  try {
    const historiaData = historia as Historia;
    const [atoKey, , cenaKey] = estadoKey.split('_');
    const ato = historiaData.atos[atoKey];
    if (!ato) return null;
    const cena = ato.cenas[cenaKey];
    return cena || null;
  } catch (e) {
    console.error(`Falha ao parsear o estado da história: ${estadoKey}`, e);
    return null;
  }
}

// === FLUXO GENKIT ATUALIZADO ===
export const gameMasterFlow = ai.defineFlow(
  {
    name: "gameMasterFlow",
    inputSchema: gameMasterInputSchema,
    outputSchema: z.string(),
  },
  async (input) => {
    const { sessionId, playerAction, rollResult, character } = input;

    // 1. Obter contexto do Firestore
    const sessionRef = db.collection("sessions").doc(sessionId);
    const sessionDoc = await sessionRef.get();
    if (!sessionDoc.exists) {
      throw new Error(`Sessão ${sessionId} não encontrada.`);
    }
    // CORREÇÃO: Remover '!' e adicionar verificação
    const sessionData = sessionDoc.data();
    if (!sessionData) {
      throw new Error(`Dados da sessão ${sessionId} estão vazios.`);
    }

    // 2. Obter dados da Cena Atual do historia.json
    const estadoAtualKey =
      sessionData.estadoDaHistoria || "ato1_cenas_cena1_aldeia";
    const cenaAtual = getSceneData(estadoAtualKey);
    const desafiosCena = cenaAtual ?
      JSON.stringify(cenaAtual.desafios_possiveis, null, 2) :
      "Nenhum desafio específico listado.";

    // 3. Obter histórico de mensagens
    const messagesRef = sessionRef
      .collection("messages")
      .orderBy("createdAt", "desc")
      .limit(10);
    const messagesSnapshot = await messagesRef.get();
    const recentMessages = messagesSnapshot.docs
      .map((doc) => {
        const data = doc.data();
        return `${data.characterName || data.uid}: ${data.text}`;
      })
      .reverse()
      .join("\n");

    // 4. Definir a Persona da IA (Instrução de Sistema)
    const systemInstruction =
      "Você é o Mestre de um jogo de RPG de mesa, narrando uma " +
      "aventura de fantasia épica, baseado na cultura e cosmologia dos " +
      "Orixás. Sua responsabilidade é descrever o mundo, interpretar NPCs, " +
      "apresentar desafios e reagir às ações dos jogadores. Mantenha um " +
      "tom narrativo e imersivo. Nunca saia do personagem. Siga as " +
      "regras do sistema 'O Chamado do Axé' e use os CDs (Classes de " +
      "Dificuldade) fornecidos no contexto da cena.";

    // 5. Construir o Prompt
    let prompt: string;
    const genderInstruction =
      character.gender === "feminino" ?
        "Use pronomes e adjetivos femininos (ela/dela)." :
        character.gender === "masculino" ?
          "Use pronomes e adjetivos masculinos (ele/dele)." :
          "Use pronomes e adjetivos neutros (elu/delu).";

    if (rollResult) {
      // CENÁRIO 1: O JOGADOR ENVIOU O RESULTADO DE UMA ROLAGEM
      const resultText = rollResult.success ? "SUCESSO" : "FALHA";
      prompt =
        "### PERSONAGEM ###\n" +
        `Nome: ${character.name}\n` +
        `Gênero: ${character.gender} (${genderInstruction})\n\n` +
        "### CONTEXTO DA AÇÃO ###\n" +
        `O personagem ${character.name} tentou uma ação que exigiu um ` +
        `teste de ${rollResult.attribute} (CD ${rollResult.cd}).\n\n` +
        "### RESULTADO DA ROLAGEM ###\n" +
        `O resultado foi: ${resultText} (Total: ${rollResult.total} | ` +
        `Dado: ${rollResult.d20} | Bónus: ${rollResult.modifier}).\n\n` +
        "### SUA TAREFA ###\n" +
        `Narre a consequência desse ${resultText} de forma criativa e imersiva.\n` +
        "- Se foi SUCESSO, descreva como o personagem superou o desafio.\n" +
        "- Se foi FALHA, descreva a consequência negativa.\n" +
        "Termine a sua narração de forma a dar espaço para o próximo " +
        "jogador agir (não mencione a passagem de turno, apenas termine " +
        "a narração).\n";
    } else if (playerAction) {
      // CENÁRIO 2: O JOGADOR ENVIOU UMA AÇÃO DE TEXTO
      prompt =
        "### CONTEXTO DA CENA ATUAL ###\n" +
        `Título: ${cenaAtual?.titulo || "Cena Desconhecida"}\n` +
        `Descrição: ${cenaAtual?.narrativa_inicio || ""}\n` +
        "Desafios Conhecidos (Para sua referência de CDs):\n" +
        `${desafiosCena}\n\n` +
        "### PERSONAGEM ATUAL ###\n" +
        `Nome: ${character.name}\n` +
        `Gênero: ${character.gender} (${genderInstruction})\n` +
        `Orixá: ${character.orixa.name}\n\n` +
        "### HISTÓRICO RECENTE ###\n" +
        `${recentMessages}\n\n` +
        "### AÇÃO DO JOGADOR ###\n" +
        `${character.name}: ${playerAction}\n\n` +
        "### SUA TAREFA ###\n" +
        `1. Reaja à ação do jogador ${character.name}.\n` +
        "2. **DECISÃO (Regra do Jogo):** Esta ação exige um teste de " +
        "habilidade (d20)? (ex: atacar, escalar, mentir, procurar pistas, " +
        "resistir a medo).\n" +
        "   - **Se NÃO (ex: apenas conversar):** Apenas narre o resultado e " +
        "a reação do mundo.\n" +
        "   - **Se SIM (requer teste):** Narre o início da ação e, em vez " +
        "de dar o resultado, PEÇA UM TESTE.\n\n" +
        "3. **COMO PEDIR UM TESTE (IMPORTANTE):**\n" +
        "   Para pedir um teste, termine a sua narração e adicione um " +
        "objeto JSON especial **na última linha** da sua resposta, " +
        "formatado exatamente assim:\n" +
        "[ROLL_REQUEST:{\"attribute\":\"NomeDoSubTopico\"," +
        "\"cd\":NumeroDaCD,\"label\":\"Descrição do Teste\"}]\n" +
        "   (Use os CDs de \"Desafios Conhecidos\" como base. Se a ação não " +
        "estiver listada, use a Tabela de CDs: Fácil 10, Médio 15, " +
        "Difícil 20, Heroico 25)\n\n" +
        "4. **COMO MUDAR DE CENA (IMPORTANTE):**\n" +
        "   Se a ação do jogador (ou o resultado de uma rolagem) mover a " +
        "história para a PRÓXIMA cena (ex: \"saem da aldeia para a " +
        "trilha\"), a sua resposta DEVE ser um JSON especial formatado assim:\n" +
        "[STATE_UPDATE:{\"newEstado\":\"chave_da_proxima_cena\"," +
        "\"narration\":\"Vocês deixam a aldeia para trás...\"}]\n" +
        "   (Ex: \"newEstado\":\"ato1_cenas_cena2_trilha\")\n";
    } else {
      throw new Error(
        "Input inválido: nem playerAction nem rollResult foram fornecidos."
      );
    }

    // 6. Chamar a IA
    const llmResponse = await ai.generate({
      model: gemini20Flash,
      prompt: prompt,
      config: {
        temperature: 0.8,
      },
      system: systemInstruction,
    });

    let responseText = llmResponse.text;

    // 7. Processar a resposta e guardar no Firestore
    let rollRequest: RollRequest | null = null;
    let stateUpdate = null;

    // CORREÇÃO: Substituir /s por [\s\S] para evitar erros de ES2018
    const stateRegex = /\[STATE_UPDATE:([\s\S]+)\]/;
    const rollRegex = /\[ROLL_REQUEST:([\s\S]+)\]/;

    const stateMatch = responseText.match(stateRegex);
    const rollMatch = responseText.match(rollRegex);

    if (stateMatch && stateMatch[1]) {
      try {
        stateUpdate = JSON.parse(stateMatch[1]);
        responseText = stateUpdate.narration;
        await sessionRef.update({ estadoDaHistoria: stateUpdate.newEstado });
      } catch (e) {
        console.error("Erro ao fazer parse do JSON do STATE_UPDATE:", e);
      }
    } else if (rollMatch && rollMatch[1]) {
      try {
        rollRequest = JSON.parse(rollMatch[1]) as RollRequest;
        responseText = responseText.replace(rollRegex, "").trim();
      } catch (e) {
        console.error("Erro ao fazer parse do JSON do ROLL_REQUEST:", e);
      }
    }

    // 8. Guardar a mensagem da IA no Firestore
    const aiMessage: {
      text: string;
      uid: string;
      characterName: string;
      createdAt: admin.firestore.FieldValue;
      rollRequest?: RollRequest; // CORREÇÃO: Usar o tipo RollRequest
    } = {
      text: responseText,
      uid: AI_UID,
      characterName: "Mestre",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (rollRequest) {
      aiMessage.rollRequest = rollRequest;
    }

    await sessionRef.collection("messages").add(aiMessage);

    // 9. Passar o Turno (APENAS se não for um pedido de rolagem)
    if (!rollRequest && sessionData.ordemDeTurnos) {
      const currentPlayerUid = sessionData.turnoAtualUid;
      const playerUIDs = (sessionData.ordemDeTurnos as string[]).filter(
        (uid: string) => uid !== AI_UID
      );
      const lastPlayerIndex = playerUIDs.indexOf(currentPlayerUid);
      const nextPlayerIndex = (lastPlayerIndex + 1) % playerUIDs.length;
      const nextPlayerUid = playerUIDs[nextPlayerIndex];

      await sessionRef.update({ turnoAtualUid: nextPlayerUid });

      const nextCharDoc = await sessionRef.collection("characters")
        .doc(nextPlayerUid)
        .get();

      // CORREÇÃO: Mudar de 'exists()' para 'exists' e verificar 'data'
      const nextCharData = nextCharDoc.data();
      if (nextCharDoc.exists && nextCharData && nextCharData.name) {
        await sessionRef.collection("messages").add({
          text: `É o turno de ${nextCharData.name}.`,
          uid: "system",
          isTurnoUpdate: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    return responseText;
  }
);

// 10. Expor o fluxo Genkit
export const gameMaster = onCallGenkit(
  {
    region: REGION,
    secrets: [/* Adicione os seus secrets aqui, ex: geminiApiKey */],
    timeoutSeconds: 120,
    memory: "1GiB",
  },
  gameMasterFlow
);