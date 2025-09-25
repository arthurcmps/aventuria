import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-functions.js';

let app;
let auth;
let db;
let functions;

try {
    const isDevEnvironment = window.location.hostname === 'localhost' || window.location.hostname.includes('cloudworkstations.dev');
    let firebaseConfig;

    if (isDevEnvironment) {
        console.log('MODO DE DESENVOLVIMENTO: Usando configuração do emulador.');
        firebaseConfig = {
            projectId: "aventuria",
            apiKey: "dummy-key",
            authDomain: window.location.hostname,
        };
        
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        functions = getFunctions(app, 'southamerica-east1');

        console.log('Conectando aos emuladores...');
        connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
        connectFirestoreEmulator(db, '127.0.0.1', 8080);
        connectFunctionsEmulator(functions, "127.0.0.1", 5001);
        console.log('Conectado aos emuladores.');

    } else {
        console.log("MODO DE PRODUÇÃO: Buscando configuração do Firebase Hosting via requisição síncrona.");
        const request = new XMLHttpRequest();
        request.open('GET', '/__/firebase/init.json', false); // 'false' torna a requisição síncrona
        request.send(null);

        if (request.status === 200) {
            firebaseConfig = JSON.parse(request.responseText);
            app = initializeApp(firebaseConfig);
            auth = getAuth(app);
            db = getFirestore(app);
            functions = getFunctions(app, 'southamerica-east1');
            console.log("Firebase inicializado com sucesso em modo de produção.");
        } else {
            throw new Error('Falha ao buscar a configuração do Firebase Hosting.');
        }
    }
} catch (error) {
    console.error("ERRO CRÍTICO AO INICIALIZAR FIREBASE:", error);
    app = null;
    auth = null;
    db = null;
    functions = null;
    alert("Falha crítica na inicialização do Firebase. O aplicativo não pode continuar.");
}

// Exporta as instâncias inicializadas (ou nulas, em caso de erro)
export { app, auth, db, functions };
