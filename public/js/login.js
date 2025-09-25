import { auth } from './firebase.js';
import {
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const btnGoogleSignIn = document.getElementById('btn-google-signin');
    const loginError = document.getElementById('login-error');
    const signupLink = document.getElementById('signup-link');
    const forgotPasswordLink = document.getElementById('forgot-password-link');

    // --- Error Handling ---
    const displayError = (message) => {
        if (loginError) loginError.textContent = message;
    };
    const clearError = () => {
        if (loginError && loginError.textContent) loginError.textContent = '';
    };

    // --- Event Listeners ---

    // Add listeners only if elements exist to prevent crashes
    if (emailInput) emailInput.addEventListener('input', clearError);
    if (passwordInput) passwordInput.addEventListener('input', clearError);

    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!emailInput || !passwordInput) return;
            const email = emailInput.value;
            const password = passwordInput.value;

            signInWithEmailAndPassword(auth, email, password)
                .then(() => {
                    window.location.href = 'index.html';
                })
                .catch((error) => {
                    switch (error.code) {
                        case 'auth/user-not-found':
                        case 'auth/wrong-password':
                        case 'auth/invalid-credential':
                            displayError('E-mail ou senha inválidos.');
                            break;
                        case 'auth/invalid-email':
                            displayError('O formato do e-mail é inválido.');
                            break;
                        default:
                            displayError('Ocorreu um erro ao tentar fazer login.');
                            break;
                    }
                });
        });
    }

    if (btnGoogleSignIn) {
        btnGoogleSignIn.addEventListener('click', () => {
            const provider = new GoogleAuthProvider();
            signInWithPopup(auth, provider)
                .then(() => {
                    window.location.href = 'index.html';
                })
                .catch((error) => {
                    console.error("Erro no login com Google:", error);
                    displayError('Não foi possível fazer login com o Google.');
                });
        });
    }

    if (signupLink) {
        signupLink.addEventListener('click', (e) => {
            e.preventDefault();
            clearError();
            if (!emailInput || !passwordInput) return;

            const email = emailInput.value;
            const password = passwordInput.value;

            if (!email || !password) {
                displayError('Por favor, preencha e-mail e senha para criar uma conta.');
                return;
            }
            if (password.length < 6) {
                displayError('A senha deve ter pelo menos 6 caracteres.');
                return;
            }

            createUserWithEmailAndPassword(auth, email, password)
                .then(() => {
                    alert('Conta criada com sucesso! Você será redirecionado.');
                    window.location.href = 'index.html';
                })
                .catch((error) => {
                    switch (error.code) {
                        case 'auth/email-already-in-use':
                            displayError('Este e-mail já está em uso.');
                            break;
                        case 'auth/invalid-email':
                            displayError('O e-mail fornecido é inválido.');
                            break;
                        default:
                            displayError('Erro ao criar a conta.');
                            break;
                    }
                });
        });
    }

    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            clearError();
            if (!emailInput) return;
            const email = emailInput.value;

            if (!email) {
                displayError('Por favor, insira seu e-mail para redefinir a senha.');
                return;
            }

            sendPasswordResetEmail(auth, email)
                .then(() => {
                    alert('Um e-mail de redefinição de senha foi enviado para ' + email);
                })
                .catch((error) => {
                    displayError('Não foi possível enviar o e-mail de redefinição.');
                });
        });
    }
});
