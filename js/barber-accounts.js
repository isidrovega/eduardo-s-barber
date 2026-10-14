
import { auth, db } from "./firebase.js";

import {
    initializeApp,
    getApps,
    getApp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";

import {
    getAuth,
    createUserWithEmailAndPassword,
    signOut,
    deleteUser
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

import {
    doc,
    getDoc,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

import { ADMIN_UID } from "./auth.js";

function requireAdmin() {
    const user = auth.currentUser;

    if (
        !user ||
        ADMIN_UID === "REEMPLAZAR_CON_UID_ADMIN" ||
        user.uid !== ADMIN_UID ||
        !user.emailVerified
    ) {
        throw new Error(
            "Solo el administrador verificado puede crear cuentas."
        );
    }
}

function getSecondaryAuth() {
    const mainApp = getApp();
    const name = "barber-account-registration";

    const secondaryApp = getApps().find(
        app => app.name === name
    ) || initializeApp(mainApp.options, name);

    return getAuth(secondaryApp);
}

function validateAccountData({
    email,
    password,
    barberId
}) {
    if (!barberId || typeof barberId !== "string") {
        throw new Error(
            "Primero debes guardar el barbero."
        );
    }

    if (
        !email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        throw new Error(
            "Introduce un correo electrónico válido."
        );
    }

    if (
        typeof password !== "string" ||
        password.length < 8
    ) {
        throw new Error(
            "La contraseña temporal debe tener al menos 8 caracteres."
        );
    }
}

export async function createBarberAccount({
    barberId,
    email,
    password
}) {
    requireAdmin();

    const normalizedEmail = email.trim().toLowerCase();

    validateAccountData({
        barberId,
        email: normalizedEmail,
        password
    });

    const barberSnapshot = await getDoc(
        doc(db, "barbers", barberId)
    );

    if (!barberSnapshot.exists()) {
        throw new Error(
            "El barbero no existe en Firestore."
        );
    }

    const secondaryAuth = getSecondaryAuth();

    // Limpia cualquier sesión previa de la instancia secundaria.
    if (secondaryAuth.currentUser) {
        await signOut(secondaryAuth);
    }

    let createdUser = null;

    try {
        const credential = await createUserWithEmailAndPassword(
            secondaryAuth,
            normalizedEmail,
            password
        );

        createdUser = credential.user;

        // Esta escritura la realiza la sesión administradora
        // a través de Firestore, no la sesión secundaria.
        await setDoc(
            doc(db, "users", createdUser.uid),
            {
                role: "barber",
                barberId,
                active: true,
                mustChangePassword: true,
                email: normalizedEmail,
                createdAt: new Date().toISOString()
            }
        );

        return {
            uid: createdUser.uid,
            email: normalizedEmail
        };

    } catch (error) {
        // Si Firestore falla, intenta revertir la cuenta
        // creada para evitar usuarios sin perfil.
        if (createdUser) {
            try {
                await deleteUser(createdUser);
            } catch (rollbackError) {
                console.error(
                    "No se pudo revertir la cuenta:",
                    rollbackError
                );

                throw new Error(
                    "La cuenta se creó en Authentication, " +
                    "pero no pudo vincularse al barbero. " +
                    "Revisa Firebase Authentication antes " +
                    "de intentar crearla de nuevo."
                );
            }
        }

        throw error;

    } finally {
        if (secondaryAuth.currentUser) {
            await signOut(secondaryAuth);
        }
    }
}

export async function linkExistingBarberAccount({
    barberId,
    uid,
    email
}) {
    requireAdmin();

    if (!barberId || !uid || !email) {
        throw new Error(
            "Debes proporcionar barbero, UID y correo."
        );
    }

    const barberSnapshot = await getDoc(
        doc(db, "barbers", barberId)
    );

    if (!barberSnapshot.exists()) {
        throw new Error(
            "El barbero seleccionado no existe."
        );
    }

    await setDoc(
        doc(db, "users", uid.trim()),
        {
            role: "barber",
            barberId,
            active: true,
            mustChangePassword: true,
            email: email.trim().toLowerCase(),
            linkedAt: new Date().toISOString()
        }
    );
}
