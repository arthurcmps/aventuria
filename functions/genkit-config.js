const { genkit } = require('genkit');
const googleAIPkg = require('@genkit-ai/googleai');
const dotpromptPkg = require('@genkit-ai/dotprompt');

// 🛡️ O "Escudo do Mestre": 
// Garante que a função seja encontrada independentemente de como o Node.js a empacotou (ESM vs CommonJS)
const googleAI = googleAIPkg.googleAI || googleAIPkg.default || googleAIPkg;
const dotprompt = dotpromptPkg.dotprompt || dotpromptPkg.default || dotpromptPkg;

const ai = genkit({
  plugins: [
    googleAI(),
    dotprompt(),
  ],
});

module.exports = { ai };