// SUBSTITUA com os dados do seu projeto Firebase
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyB4ZMeCQhPIwIolXtW65VZIimkGbTrJZlI",
  authDomain: "md-recebimentos.firebaseapp.com",
  projectId: "md-recebimentos",
  storageBucket: "md-recebimentos.firebasestorage.app",
  messagingSenderId: "1021910555040",
  appId: "1:1021910555040:web:c2f9e6eff7cf57c479ecc5",
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const app = initializeApp(window.FIREBASE_CONFIG);
window.__firebaseAuth = getAuth(app);
