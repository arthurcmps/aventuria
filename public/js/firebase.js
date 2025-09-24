import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js';

let app, auth, db, functions;

try {
  // Busca a configuração que o Firebase Hosting provê automaticamente
  const response = await fetch('/__/firebase/init.json');
  const firebaseConfig = await response.json();

  // Inicializa o Firebase com a configuração correta
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  functions = getFunctions(app, 'southamerica-east1');

  // Se estiver em ambiente de desenvolvimento, conecta aos emuladores
  if (window.location.hostname === 'localhost') {
    console.log('DEV MODE: Conectando aos Emuladores do Firebase.');
    
    // Emulador de Autenticação
    connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });

    // Emulador do Firestore
    connectFirestoreEmulator(db, 'localhost', 8080);

    // Emulador de Functions
    connectFunctionsEmulator(functions, "localhost", 5001);
  }
} catch (e) {
  console.error("Erro ao inicializar o Firebase: ", e);
  console.error("Certifique-se de que os serviços do Firebase estão em execução e que a configuração está acessível.");
}

// Exporta as instâncias para serem usadas em outros módulos
export { app, auth, db, functions };
