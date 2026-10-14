
import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// Sustituir por el UID de tu cuenta administradora.
// Este mismo UID debe utilizarse en las reglas de Firestore.
export const ADMIN_UID = "5Dt5IvBhLZgEJ7cgLQ1dIwuQKZx2";

export const ROUTES = {
    admin: "index.html",
    barber: "panel-barbero.html",
    login: "login.html"
};

export function waitForUser() {
    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(
            auth,
            user => {
                unsubscribe();
                resolve(user);
            },
            error => {
                unsubscribe();
                reject(error);
            }
        );
    });
}

export async function getUserRole(user) {
    if (!user) {
        return null;
    }

    if (
        ADMIN_UID !== "REEMPLAZAR_CON_UID_ADMIN" &&
        user.uid === ADMIN_UID
    ) {
        return "admin";
    }

    const snapshot = await getDoc(
        doc(db, "users", user.uid)
    );

    if (!snapshot.exists()) {
        return null;
    }

    const profile = snapshot.data();

    if (
        profile.role === "barber" &&
        profile.active === true &&
        typeof profile.barberId === "string" &&
        profile.barberId.length > 0
    ) {
        return "barber";
    }

    return null;
}

export async function login(email, password) {
    const credential = await signInWithEmailAndPassword(
        auth,
        email,
        password
    );

    const role = await getUserRole(credential.user);

    if (!role) {
        await signOut(auth);

        throw new Error(
            "Tu cuenta no tiene acceso autorizado al sistema."
        );
    }

    return {
        user: credential.user,
        role
    };
}

export async function logout() {
    await signOut(auth);
    window.location.replace(ROUTES.login);
}

export async function resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
}

export async function protectPage(requiredRole) {
    const user = await waitForUser();

    if (!user) {
        window.location.replace(ROUTES.login);
        return null;
    }

    const role = await getUserRole(user);

    if (!role) {
        await signOut(auth);
        window.location.replace(ROUTES.login);
        return null;
    }

    if (role !== requiredRole) {
        window.location.replace(ROUTES[role]);
        return null;
    }

    return user;
}
