/*
 *  js/login.js - v1.2 - CORREÇÃO CRÍTICA
 *  - REMOVIDO o callback `signInFailure` que estava causando um erro 400 (Bad Request) e 
 *    quebrando completamente o fluxo de login e criação de conta.
 *  - A lógica retorna ao padrão do FirebaseUI, que é estável e funcional.
 */

document.addEventListener('DOMContentLoaded', function() {

    // Espera a inicialização do Firebase para garantir que `firebase.auth()` esteja disponível.
    const unregisterAuthObserver = firebase.auth().onAuthStateChanged(user => {
        
        unregisterAuthObserver(); // Para o observador para não rodar desnecessariamente.

        const ui = new firebaseui.auth.AuthUI(firebase.auth());

        const uiConfig = {
            callbacks: {
                // NENHUM `signInFailure` aqui. Deixa o FirebaseUI lidar com os erros.
                
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
            signInSuccessUrl: '/', // URL para onde o usuário será redirecionado se fechar e abrir a aba.
            signInOptions: [
                firebase.auth.GoogleAuthProvider.PROVIDER_ID,
                {
                    provider: firebase.auth.EmailAuthProvider.PROVIDER_ID,
                    // Nossa Cloud Function `onUserCreate` cuidará de criar um displayName no backend.
                    requireDisplayName: false 
                }
            ],
        };

        // Inicia o FirebaseUI Widget.
        ui.start('#firebaseui-auth-container', uiConfig);

    }); // Fim do onAuthStateChanged

}); // Fim do DOMContentLoaded
