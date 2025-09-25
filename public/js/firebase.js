import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js';

let app, auth, db, functions;

// Verifica se estamos em um ambiente de desenvolvimento (localhost ou Cloud Workstations)
const isDevEnvironment = window.location.hostname === 'localhost' || window.location.hostname.includes('cloudworkstations.dev');

// Ação: Se for ambiente de desenvolvimento, usa a configuração do emulador.
if (isDevEnvironment) {
    console.log('MODO DE DESENVOLVIMENTO: Forçando conexão com os Emuladores do Firebase.');
    const firebaseConfig = {
        projectId: "aventuria",
        apiKey: "dummy-key",
        authDomain: window.location.hostname,
    };

    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        functions = getFunctions(app, 'southamerica-east1');

        // Conecta aos Emuladores
        connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
        connectFirestoreEmulator(db, '127.0.0.1', 8080);
        connectFunctionsEmulator(functions, "127.0.0.1", 5001);

    } catch (error) {
        console.error("ERRO CRÍTICO (Dev): Não foi possível inicializar ou conectar aos emuladores do Firebase.", error);
    }

// Ação: Se não for ambiente de desenvolvimento (produção), busca a configuração do Hosting.
} else {
    console.log("MODO DE PRODUÇÃO: Inicializando com a configuração do Firebase Hosting.");
    (async () => {
        try {
            const response = await fetch('/__/firebase/init.json');
            const firebaseConfig = await response.json();

            app = initializeApp(firebaseConfig);
            auth = getAuth(app);
            db = getFirestore(app);
            functions = getFunctions(app, 'southamerica-east1');

        } catch (e) {
            console.error("ERRO CRÍTICO (Prod): Não foi possível buscar a configuração automática do Firebase.", e);
        }
    })();
}

// Exporta as instâncias para serem usadas em outros módulos
export { app, auth, db, functions };
