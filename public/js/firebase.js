// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD9hHsMbf2c8Y8WvofRlAIF6D02idQ3qjI",
  authDomain: "aventuria-baeba.firebaseapp.com",
  projectId: "aventuria-baeba",
  storageBucket: "aventuria-baeba.firebasestorage.app",
  messagingSenderId: "852403801659",
  appId: "1:852403801659:web:8f471f230523fc8a78961e",
  measurementId: "G-JW94CRNV5K"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize and export Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
