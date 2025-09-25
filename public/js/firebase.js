import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js';

let app, auth, db, functions;
let firebaseConfig;

try {
  // Tenta buscar a configuração automática do Firebase Hosting.
  const response = await fetch('/__/firebase/init.json');
  if (!response.ok) {
    throw new Error('Configuração do Firebase Hosting não encontrada.');
  }
  firebaseConfig = await response.json();
  console.log("Firebase inicializado com a configuração do Hosting.");

} catch (e) {
  console.warn("AVISO: Não foi possível buscar a configuração automática do Firebase. Usando configuração de fallback para ambiente de desenvolvimento/emulador.");
  // Se a busca falhar (o que é esperado no desenvolvimento local/emulado), 
  // usamos uma configuração de fallback. O Project ID é uma suposição baseada no nome do projeto.
  firebaseConfig = {
    projectId: "aventuria", // Usando um nome de projeto genérico para os emuladores
    apiKey: "dummy-key",
    authDomain: "localhost",
  };
}

try {
  // Inicializa o Firebase com a configuração obtida (seja do Hosting ou do fallback)
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  functions = getFunctions(app, 'southamerica-east1');

  // Verifica se estamos em um ambiente de desenvolvimento (localhost ou Cloud Workstations)
  const isDevEnvironment = window.location.hostname === 'localhost' || window.location.hostname.includes('cloudworkstations.dev');

  if (isDevEnvironment) {
    console.log('MODO DE DESENVOLVIMENTO: Conectando aos Emuladores do Firebase.');
    
    // Conecta ao Emulador de Autenticação
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });

    // Conecta ao Emulador do Firestore
    connectFirestoreEmulator(db, '127.0.0.1', 8080);

    // Conecta ao Emulador de Functions
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  }
} catch (error) {
  console.error("ERRO CRÍTICO: Não foi possível inicializar os serviços do Firebase.", error);
  alert("Não foi possível conectar ao Firebase. Verifique o console para mais detalhes.");
}

// Exporta as instâncias para serem usadas em outros módulos
export { app, auth, db, functions };
