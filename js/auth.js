
import { auth, db } from "./firebase.js";

import {
    signInWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

/* =====================================================
   ADMINISTRADORES AUTORIZADOS
===================================================== */

export const ADMIN_UID = "5Dt5IvBhLZgEJ7cgLQ1dIwuQKZx2";

export const ADMIN_UIDS = new Set([
    ADMIN_UID,
    "KcHcm82nZESqoHy7RrHZdyj1y2p2"
]);

/* =====================================================
   RUTAS
===================================================== */

export const ROUTES = {
    admin: "index.html",
    barber: "panel-barbero.html",
    login: "login.html"
};

/* =====================================================
   USUARIO ACTUAL
===================================================== */

export async function waitForUser() {
    await auth.authStateReady();
    return auth.currentUser;
}

/* =====================================================
   IDENTIFICAR ROL
===================================================== */

export async function getUserRole(user) {
    if (!user) {
        return null;
    }

    // Los administradores se autorizan por UID.
    if (ADMIN_UIDS.has(user.uid)) {
        return "admin";
    }

    // Los demás usuarios deben tener un perfil válido.
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

    // Verificar el estado real del barbero.
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

/* =====================================================
   INICIAR SESIÓN
===================================================== */

export async function login(email, password) {
    const credential = await signInWithEmailAndPassword(
        auth,
        email,
        password
    );

    try {
        const role = await getUserRole(
            credential.user
        );

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

/* =====================================================
   CERRAR SESIÓN
===================================================== */

export async function logout() {
    await signOut(auth);
    window.location.replace(ROUTES.login);
}

/* =====================================================
   RESTABLECER CONTRASEÑA
===================================================== */

export async function resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
}

/* =====================================================
   PROTEGER PÁGINAS
===================================================== */

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

        // Ante errores, no conceder acceso.
        window.location.replace(ROUTES.login);
        return null;
    }
}
