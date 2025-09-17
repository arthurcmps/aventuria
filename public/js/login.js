// js/login.js
import { auth } from './firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup
} from 'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js';

// ---------- DOM Elements ----------
const showLoginBtn = document.getElementById('btn-show-login');
const showRegisterBtn = document.getElementById('btn-show-register');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const googleLoginBtn = document.getElementById('btn-google-login');
const authError = document.getElementById('auth-error');

// ---------- Toggle Forms ----------
showLoginBtn.addEventListener('click', () => {
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
  showLoginBtn.classList.add('active');
  showRegisterBtn.classList.remove('active');
  authError.textContent = '';
});

showRegisterBtn.addEventListener('click', () => {
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  showLoginBtn.classList.remove('active');
  showRegisterBtn.classList.add('active');
  authError.textContent = '';
});

// ---------- Email/Password Authentication ----------
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = '/'; // Redirect to main page
  } catch (error) {
    authError.textContent = 'Email ou senha inválidos.';
    console.error("Login error:", error);
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  if (password.length < 6) {
    authError.textContent = 'A senha deve ter pelo menos 6 caracteres.';
    return;
  }
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    window.location.href = '/'; // Redirect to main page
  } catch (error) {
    if (error.code === 'auth/email-already-in-use') {
      authError.textContent = 'Este email já está em uso.';
    } else {
      authError.textContent = 'Erro ao criar conta. Tente novamente.';
    }
    console.error("Registration error:", error);
  }
});

// ---------- Google Authentication ----------
googleLoginBtn.addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
    window.location.href = '/'; // Redirect to main page
  } catch (error) {
    authError.textContent = 'Erro ao fazer login com o Google. Tente novamente.';
    console.error("Google login error:", error);
  }
});
