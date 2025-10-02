import { auth, db } from './firebase.js';
import { onAuthStateChanged, signOut, updateProfile, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';
import { doc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- Referências do DOM ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const pageContent = document.getElementById('page-content');
    const usernameDisplay = document.getElementById('username');
    const btnAuth = document.getElementById('btn-auth');
    const profileForm = document.getElementById('profile-form');
    const nameInput = document.getElementById('profile-name');
    const emailInput = document.getElementById('profile-email');
    const dobInput = document.getElementById('profile-dob');
    const btnSaveProfile = document.getElementById('btn-save-profile');
    const btnResetPassword = document.getElementById('btn-reset-password');
    
    let currentUser = null;

    // --- Notificações (reutilizando a função de script.js) ---
    const showNotification = (message, type = 'success') => {
        const container = document.getElementById('notification-container');
        if (!container) return;
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        container.appendChild(notification);
        setTimeout(() => notification.remove(), 5000);
    };

    // --- Lógica Principal ---
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            usernameDisplay.textContent = user.displayName || 'Usuário';
            btnAuth.textContent = 'Sair';

            // Carregar dados do Firestore
            try {
                const userDocRef = doc(db, 'users', user.uid);
                const docSnap = await getDoc(userDocRef);

                if (docSnap.exists()) {
                    const userData = docSnap.data();
                    nameInput.value = userData.fullName || '';
                    emailInput.value = user.email || '';
                    dobInput.value = userData.dateOfBirth || '';
                } else {
                    // Fallback se o documento não existir por algum motivo
                    nameInput.value = user.displayName || '';
                    emailInput.value = user.email || '';
                }
            } catch (error) {
                console.error("Erro ao carregar dados do perfil:", error);
                showNotification("Não foi possível carregar seus dados.", "error");
            }

            loadingOverlay.style.display = 'none';
            pageContent.style.display = 'block';

        } else {
            window.location.href = 'login.html';
        }
    });

    // --- Event Listeners ---
    btnAuth.addEventListener('click', () => {
        if (currentUser) {
            signOut(auth).catch(error => console.error("Erro ao sair:", error));
        }
    });

    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;

        const newName = nameInput.value.trim();
        const newDob = dobInput.value;

        if (newName.length < 3) {
            return showNotification("O nome deve ter pelo menos 3 caracteres.", "error");
        }

        btnSaveProfile.disabled = true;
        btnSaveProfile.textContent = 'Salvando...';

        try {
            const userDocRef = doc(db, 'users', currentUser.uid);
            
            // Atualiza os dois locais em paralelo
            await Promise.all([
                updateProfile(currentUser, { displayName: newName }), // Atualiza no Auth
                updateDoc(userDocRef, { fullName: newName, dateOfBirth: newDob }) // Atualiza no Firestore
            ]);

            showNotification("Perfil atualizado com sucesso!", "success");
            usernameDisplay.textContent = newName; // Atualiza o nome no cabeçalho na hora

        } catch (error) {
            console.error("Erro ao salvar perfil:", error);
            showNotification("Ocorreu um erro ao salvar as alterações.", "error");
        } finally {
            btnSaveProfile.disabled = false;
            btnSaveProfile.textContent = 'Salvar Alterações';
        }
    });

    btnResetPassword.addEventListener('click', () => {
        if (!currentUser || !currentUser.email) return;

        sendPasswordResetEmail(auth, currentUser.email)
            .then(() => {
                showNotification(`E-mail de redefinição enviado para ${currentUser.email}.`, "success");
            })
            .catch((error) => {
                console.error("Erro ao enviar e-mail de redefinição:", error);
                showNotification("Não foi possível enviar o e-mail de redefinição.", "error");
            });
    });
});
