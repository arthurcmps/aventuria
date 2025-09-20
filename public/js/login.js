/*
 *  js/login.js - CORREÇÃO FINAL
 *  Este script inicializa la interfaz de autenticación de FirebaseUI, 
 *  conforme esperado pelo `login.html`.
 */

document.addEventListener('DOMContentLoaded', function() {

    const unregisterAuthObserver = firebase.auth().onAuthStateChanged(user => {
        
        unregisterAuthObserver();

        const ui = new firebaseui.auth.AuthUI(firebase.auth());

        const uiConfig = {
            callbacks: {
                signInSuccessWithAuthResult: function(authResult, redirectUrl) {
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
                firebase.auth.GoogleAuthProvider.PROVIDER_ID,
                firebase.auth.EmailAuthProvider.PROVIDER_ID
            ],
        };

        ui.start('#firebaseui-auth-container', uiConfig);

    }); 

});
