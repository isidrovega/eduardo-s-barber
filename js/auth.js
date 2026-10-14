
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

export const ADMIN_UID = "5Dt5IvBhLZgEJ7cgLQ1dIwuQKZx2";

export const ROUTES = {
    admin: "index.html",
    barber: "panel-barbero.html",
    login: "login.html"
};

export async function waitForUser() {
    await auth.authStateReady();
    return auth.currentUser;
}

export async function getUserRole(user) {
    if (!user) {
        return null;
    }

    // El administrador conserva su acceso habitual.
    if (user.uid === ADMIN_UID) {
        return "admin";
    }

    // Verificar el perfil de acceso.
    const profileSnapshot = await getDoc(
        doc(db, "users", user.uid)
    );

    if (!profileSnapshot.exists()) {
        return null;
    }

    const profile = profileSnapshot.data();

    if (
        profile.role !== "barber" ||
        profile.active !== true ||
        typeof profile.barberId !== "string" ||
        !profile.barberId
    ) {
        return null;
    }

    // Verificar también el estado real del barbero.
    const barberSnapshot = await getDoc(
        doc(db, "barbers", profile.barberId)
    );

    if (!barberSnapshot.exists()) {
        return null;
    }

    const barber = barberSnapshot.data();

    if (barber.status !== "active") {
        return null;
    }

    return "barber";
}

export async function login(email, password) {
    const credential = await signInWithEmailAndPassword(
        auth,
        email,
        password
    );

    try {
        const role = await getUserRole(credential.user);

        if (!role) {
            throw new Error(
                "Tu cuenta no tiene acceso autorizado o está desactivada."
            );
        }

        return {
            user: credential.user,
            role
        };

    } catch (error) {
        await signOut(auth);
        throw error;
    }
}

export async function logout() {
    await signOut(auth);
    window.location.replace(ROUTES.login);
}

export async function resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
}

export async function protectPage(requiredRole) {
    try {
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

    } catch (error) {
        console.error(
            "Error verificando permisos:",
            error
        );

        // No conceder acceso si falla la verificación.
        window.location.replace(ROUTES.login);
        return null;
    }
}
