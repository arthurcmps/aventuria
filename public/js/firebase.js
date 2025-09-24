import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js';

// A configuração do Firebase é obtida automaticamente pelo /__/firebase/init.js
// quando hospedado pelo Firebase, mas precisamos dela aqui para o desenvolvimento local.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY", // Substituir pelos seus valores reais
  authDomain: "aventuria-baeba.firebaseapp.com",
  projectId: "aventuria-baeba",
  storageBucket: "aventuria-baeba.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Inicializa o Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

// Conecta aos emuladores se estiver em ambiente de desenvolvimento (localhost)
if (window.location.hostname === 'localhost') {
  console.log('Conectando aos emuladores do Firebase...');
  // Aponta o Auth para o emulador
  connectAuthEmulator(auth, "http://localhost:9099");

  // Aponta o Firestore para o emulador
  connectFirestoreEmulator(db, 'localhost', 8080);

  // Aponta o Functions para o emulador
  connectFunctionsEmulator(functions, "localhost", 5001); 
}

export { app, auth, db, functions };
