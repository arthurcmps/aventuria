import { auth } from './firebase.js';
import {
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
    const btnGoogle = document.getElementById('btn-google-signin');
    const btnEmailSignIn = document.getElementById('btn-email-signin');
    const btnEmailSignUp = document.getElementById('btn-email-signup');
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const errorMessage = document.getElementById('login-error');

    const handleAuthSuccess = (userCredential) => {
        console.log("Login bem-sucedido, redirecionando...", userCredential.user);
        window.location.href = '/';
    };

    const handleAuthError = (error) => {
        console.error("Erro de autenticação:", error);
        errorMessage.textContent = getFriendlyErrorMessage(error.code);
    };

    // --- LOGIN COM GOOGLE ---
    btnGoogle.addEventListener('click', () => {
        const provider = new GoogleAuthProvider();
        signInWithPopup(auth, provider)
            .then(handleAuthSuccess)
            .catch(handleAuthError);
    });

    // --- LOGIN COM EMAIL/SENHA ---
    btnEmailSignIn.addEventListener('click', () => {
        const email = emailInput.value;
        const password = passwordInput.value;
        if (!email || !password) {
            errorMessage.textContent = "Por favor, preencha email e senha.";
            return;
        }
        signInWithEmailAndPassword(auth, email, password)
            .then(handleAuthSuccess)
            .catch(handleAuthError);
    });

    // --- CRIAÇÃO DE CONTA COM EMAIL/SENHA ---
    btnEmailSignUp.addEventListener('click', () => {
        const email = emailInput.value;
        const password = passwordInput.value;
        if (!email || !password) {
            errorMessage.textContent = "Por favor, preencha email e senha para criar a conta.";
            return;
        }
         if (password.length < 6) {
            errorMessage.textContent = "A senha deve ter pelo menos 6 caracteres.";
            return;
        }
        createUserWithEmailAndPassword(auth, email, password)
            .then(handleAuthSuccess)
            .catch(handleAuthError);
    });

    // Função para traduzir códigos de erro
    function getFriendlyErrorMessage(errorCode) {
        switch (errorCode) {
            case 'auth/user-not-found':
                return 'Nenhum usuário encontrado com este email.';
            case 'auth/wrong-password':
                return 'Senha incorreta. Tente novamente.';
            case 'auth/invalid-email':
                return 'O formato do email é inválido.';
            case 'auth/email-already-in-use':
                return 'Este email já está sendo usado por outra conta.';
             case 'auth/weak-password':
                return 'A senha é muito fraca. Use pelo menos 6 caracteres.';
            default:
                return 'Ocorreu um erro. Por favor, tente novamente.';
        }
    }
});
