/*
 *  js/login.js - v1.1 - CORRIGIDO
 *  - Adicionado o callback `signInFailure` para lidar com erros de login (ex: senha incorreta)
 *    sem avançar para a tela de criação de conta indevidamente.
 */

document.addEventListener('DOMContentLoaded', function() {

    // Espera a inicialização do Firebase para garantir que `firebase.auth()` esteja disponível.
    const unregisterAuthObserver = firebase.auth().onAuthStateChanged(user => {
        
        unregisterAuthObserver(); // Para o observador para não rodar desnecessariamente.

        const ui = new firebaseui.auth.AuthUI(firebase.auth());

        const uiConfig = {
            callbacks: {
                // Chamado quando o login falha.
                signInFailure: function(error) {
                    // Lida com o erro de senha incorreta ou usuário não encontrado aqui.
                    // Para erros de senha incorreta (wrong-password), nós queremos que o usuário 
                    // tente novamente na mesma tela, em vez de o FirebaseUI o levar para a tela de criação de conta.
                    // O FirebaseUI já exibirá uma mensagem de erro padrão para 'auth/wrong-password' e 'auth/user-not-found'.
                    // Retornando Promise.resolve() informa ao FirebaseUI que já lidamos com o erro e 
                    // ele não precisa fazer mais nada (como redirecionar ou mudar a tela).
                    console.error('FirebaseUI signInFailure:', error);
                    return Promise.resolve();
                },
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
                    // Não força a criação de um displayName na tela de login.
                    // Nossa Cloud Function `onUserCreate` cuidará disso no backend.
                    requireDisplayName: false 
                }
            ],
        };

        // Inicia o FirebaseUI Widget.
        ui.start('#firebaseui-auth-container', uiConfig);

    }); // Fim do onAuthStateChanged

}); // Fim do DOMContentLoaded
