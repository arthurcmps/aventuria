/*
 *  js/login.js - VERSÃO MODULAR CORRIGIDA
 *  - Usa `import` para carregar o `auth` do firebase.js, garantindo consistência.
 *  - Inicializa o FirebaseUI da maneira moderna, compatível com o resto do app.
 */

// Importa os serviços necessários do firebase.js e dos SDKs
import { auth } from './firebase.js';
import { GoogleAuthProvider, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

// Importa o FirebaseUI. Como é uma biblioteca UI, ela é carregada de forma diferente.
// Precisamos garantir que o objeto `firebaseui` esteja disponível globalmente para o HTML.
import 'https://www.gstatic.com/firebasejs/ui/6.0.1/firebase-ui-auth.js';

document.addEventListener('DOMContentLoaded', function() {
    // A verificação onAuthStateChanged não é mais necessária aqui, 
    // pois o `script.js` principal já cuida disso.
    // Nós só precisamos mostrar a interface de login.

    // Inicializa o FirebaseUI
    const ui = firebaseui.auth.AuthUI.getInstance() || new firebaseui.auth.AuthUI(auth);

    const uiConfig = {
        callbacks: {
            // Chamado quando o login é bem-sucedido.
            signInSuccessWithAuthResult: function(authResult, redirectUrl) {
                // Redireciona para a página principal após o login.
                window.location.href = '/';
                // Retorna `false` para impedir o redirecionamento padrão do FirebaseUI.
                return false;
            },
            // Chamado quando a interface termina de carregar.
            uiShown: function() {
                // Esconde o loader e mostra o container de autenticação.
                document.getElementById('loader').style.display = 'none';
                document.getElementById('firebaseui-auth-container').style.display = 'block';
            }
        },
        signInSuccessUrl: '/', // URL para onde o usuário é redirecionado em alguns casos.
        signInOptions: [
            GoogleAuthProvider.PROVIDER_ID,
            {
                provider: EmailAuthProvider.PROVIDER_ID,
                requireDisplayName: false
            }
        ],
        // Garante que o fluxo de login de um clique (one-tap) não seja usado,
        // pois ele pode conflitar com o nosso redirecionamento customizado.
        credentialHelper: firebaseui.auth.CredentialHelper.NONE
    };

    // Inicia o FirebaseUI Widget.
    ui.start('#firebaseui-auth-container', uiConfig);

});
