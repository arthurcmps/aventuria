import { auth, db } from './firebase.js'; // Importar 'db' do firestore
import {
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    updateProfile // Importar 'updateProfile'
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { doc, setDoc } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js'; // Importar 'doc' e 'setDoc'

document.addEventListener('DOMContentLoaded', () => {
    // --- Referências dos Elementos do DOM ---

    // Formulário de Login Principal
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const btnGoogleSignIn = document.getElementById('btn-google-signin');
    const loginError = document.getElementById('login-error');
    const signupLink = document.getElementById('signup-link');
    const forgotPasswordLink = document.getElementById('forgot-password-link');

    // Modal de Cadastro (Atualizado)
    const signupModal = document.getElementById('signup-modal');
    const signupForm = document.getElementById('signup-form');
    const signupNameInput = document.getElementById('signup-name');
    const signupEmailInput = document.getElementById('signup-email');
    const signupPasswordInput = document.getElementById('signup-password');
    const signupPasswordConfirmInput = document.getElementById('signup-password-confirm');
    const signupDobInput = document.getElementById('signup-dob');
    const signupError = document.getElementById('signup-error');

    // Modal de Recuperação de Senha
    const resetPasswordModal = document.getElementById('reset-password-modal');
    const resetPasswordForm = document.getElementById('reset-password-form');
    const resetEmailInput = document.getElementById('reset-email');
    const resetError = document.getElementById('reset-error');
    
    // Botões de fechar modais
    const closeButtons = document.querySelectorAll('.modal-close');

    // --- Funções de Controle dos Modais ---
    const openModal = (modal) => {
        if (modal) modal.style.display = 'flex';
    };

    const closeModal = (modal) => {
        if (modal) modal.style.display = 'none';
    };

    // --- Gerenciamento de Erros ---
    const displayError = (message, element) => {
        if (element) element.textContent = message;
    };

    const clearAllErrors = () => {
        if (loginError) loginError.textContent = '';
        if (signupError) signupError.textContent = '';
        if (resetError) resetError.textContent = '';
    };

    // --- Event Listeners ---

    // Listener para o formulário de login principal
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            clearAllErrors();
            const email = emailInput.value;
            const password = passwordInput.value;

            signInWithEmailAndPassword(auth, email, password)
                .then(() => { window.location.href = 'index.html'; })
                .catch((error) => {
                    let message = 'Ocorreu um erro ao tentar fazer login.';
                    if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(error.code)) {
                        message = 'E-mail ou senha inválidos.';
                    } else if (error.code === 'auth/invalid-email') {
                        message = 'O formato do e-mail é inválido.';
                    }
                    displayError(message, loginError);
                });
        });
    }

    // Listener para login com Google
    if (btnGoogleSignIn) {
        btnGoogleSignIn.addEventListener('click', () => {
            const provider = new GoogleAuthProvider();
            signInWithPopup(auth, provider)
                .then(() => { window.location.href = 'index.html'; })
                .catch((error) => {
                    console.error("Erro no login com Google:", error);
                    displayError('Não foi possível fazer login com o Google.', loginError);
                });
        });
    }

    // Links para abrir os modais
    if (signupLink) {
        signupLink.addEventListener('click', (e) => {
            e.preventDefault();
            clearAllErrors();
            openModal(signupModal);
        });
    }

    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            clearAllErrors();
            openModal(resetPasswordModal);
        });
    }

    // MODIFICADO: Listener para o formulário de cadastro com validação e salvamento de dados extras
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearAllErrors();
            const name = signupNameInput.value;
            const email = signupEmailInput.value;
            const password = signupPasswordInput.value;
            const passwordConfirm = signupPasswordConfirmInput.value;
            const dob = signupDobInput.value;

            // Validação dos novos campos
            if (!name || !email || !password || !passwordConfirm || !dob) {
                return displayError('Por favor, preencha todos os campos.', signupError);
            }
            if (password.length < 6) {
                return displayError('A senha deve ter pelo menos 6 caracteres.', signupError);
            }
            if (password !== passwordConfirm) {
                return displayError('As senhas não coincidem.', signupError);
            }

            try {
                // 1. Criar usuário no serviço de autenticação
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // 2. Atualizar o perfil de autenticação e salvar dados no Firestore
                // Estas duas ações rodam em paralelo para maior eficiência
                await Promise.all([
                    updateProfile(user, {
                        displayName: name
                    }),
                    setDoc(doc(db, "users", user.uid), {
                        fullName: name,
                        dateOfBirth: dob,
                        email: email
                    })
                ]);

                // 3. Sucesso
                alert('Conta criada com sucesso! Você será redirecionado.');
                window.location.href = 'index.html';

            } catch (error) {
                let message = 'Erro ao criar a conta.';
                if (error.code === 'auth/email-already-in-use') {
                    message = 'Este e-mail já está em uso.';
                } else if (error.code === 'auth/invalid-email') {
                    message = 'O e-mail fornecido é inválido.';
                }
                console.error("Erro ao criar conta:", error);
                displayError(message, signupError);
            }
        });
    }

    // Listener para o formulário de recuperação de senha
    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', (e) => {
            e.preventDefault();
            clearAllErrors();
            const email = resetEmailInput.value;

            if (!email) {
                return displayError('Por favor, insira seu e-mail.', resetError);
            }

            sendPasswordResetEmail(auth, email)
                .then(() => {
                    closeModal(resetPasswordModal);
                    alert('Um e-mail de redefinição de senha foi enviado para ' + email);
                })
                .catch((error) => {
                    displayError('Não foi possível enviar o e-mail de redefinição. Verifique o endereço digitado.', resetError);
                });
        });
    }

    // Listeners para fechar os modais
    closeButtons.forEach(button => {
        button.addEventListener('click', () => {
            const modalId = button.getAttribute('data-target-modal');
            closeModal(document.getElementById(modalId));
        });
    });

    window.addEventListener('click', (e) => {
        if (e.target === signupModal) closeModal(signupModal);
        if (e.target === resetPasswordModal) closeModal(resetPasswordModal);
    });
});