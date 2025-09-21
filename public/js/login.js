/*
 *  js/login.js - v2.2 - CORREÇÃO DE PERSISTÊNCIA
 *  - Força o Firebase Auth a usar `browserLocalPersistence` ANTES de o FirebaseUI iniciar.
 *  - Isso garante que o estado de login seja salvo de forma robusta e sobreviva ao 
 *    redirecionamento da página de login para a página principal.
 */

// Importa os serviços necessários do firebase.js e dos SDKs modulares
import { auth } from './firebase.js';
import { 
    GoogleAuthProvider, 
    EmailAuthProvider, 
    setPersistence, 
    browserLocalPersistence // Importa o tipo de persistência
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

// NOTA: O objeto `firebaseui` já está disponível globalmente.

document.addEventListener('DOMContentLoaded', async function() {
    try {
        // --- CORREÇÃO CRUCIAL ---
        // Define a persistência para LOCAL. Isso garante que o login sobreviva ao F5 e redirecionamentos.
        // Esta chamada deve ser feita ANTES de qualquer outra operação de auth, incluindo a UI.
        await setPersistence(auth, browserLocalPersistence);

        // Agora, com a persistência garantida, inicializa a UI
        const ui = firebaseui.auth.AuthUI.getInstance() || new firebaseui.auth.AuthUI(auth);

        const uiConfig = {
            callbacks: {
                signInSuccessWithAuthResult: function(authResult, redirectUrl) {
                    // A persistência já está garantida, então o redirecionamento deve funcionar.
                    window.location.href = '/';
                    return false;
                },
                uiShown: function() {
                    document.getElementById('loader').style.display = 'none';
                    document.getElementById('firebaseui-auth-container').style.display = 'block';
                }
            },
            signInSuccessUrl: '/',
            signInOptions: [
                GoogleAuthProvider.PROVIDER_ID,
                {
                    provider: EmailAuthProvider.PROVIDER_ID,
                    requireDisplayName: false
                }
            ],
            credentialHelper: firebaseui.auth.CredentialHelper.NONE
        };

        // Inicia o FirebaseUI Widget.
        ui.start('#firebaseui-auth-container', uiConfig);

    } catch (error) {
        console.error("Erro ao inicializar a página de login:", error);
        document.getElementById('loader').textContent = "Erro ao carregar. Tente recarregar a página.";
    }
});
