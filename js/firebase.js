
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC92q1VsZCy3osQlBE5oiQg3iMRwOGPgzs",
  authDomain: "eduardos-barbershop.firebaseapp.com",
  projectId: "eduardos-barbershop",
  storageBucket: "eduardos-barbershop.firebasestorage.app",
  messagingSenderId: "1052213118139",
  appId: "1:1052213118139:web:eff976e2a8990f52bbd59e"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
