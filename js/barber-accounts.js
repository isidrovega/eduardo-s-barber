/* =========================================================
   EDUARDO'S BARBERSHOP
   BARBER-ACCOUNTS.JS
========================================================= */

import {
    app,
    auth,
    db
} from "./firebase.js";

import {
    initializeApp,
    getApp,
    getApps,
    deleteApp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";

import {
    getAuth,
    createUserWithEmailAndPassword,
    signOut,
    inMemoryPersistence,
    setPersistence
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const SECONDARY_APP_NAME = "barber-account-creator";

function getSecondaryApp() {
    const existing = getApps().find(
        item => item.name === SECONDARY_APP_NAME
    );

    if (existing) {
        return existing;
    }

    return initializeApp(
        app.options,
        SECONDARY_APP_NAME
    );
}

function validateEmail(email) {
    const normalized = String(email || "")
        .trim()
        .toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw new Error("Ingresa un correo electrónico válido.");
    }

    return normalized;
}

function validatePassword(password) {
    if (typeof password !== "string" || password.length < 12) {
        throw new Error(
            "La contraseña temporal debe tener al menos 12 caracteres."
        );
    }

    return password;
}

export async function createBarberAccount({
    barberId,
    email,
    password
}) {
    await auth.authStateReady();

    if (!auth.currentUser) {
        throw new Error("Debes iniciar sesión como administrador.");
    }

    if (!barberId || typeof barberId !== "string") {
        throw new Error("Primero debes guardar al barbero.");
    }

    const normalizedEmail = validateEmail(email);
    const validatedPassword = validatePassword(password);

    const barberRef = doc(db, "barbers", barberId);
    const barberSnapshot = await getDoc(barberRef);

    if (!barberSnapshot.exists()) {
        throw new Error(
            "El barbero no existe en Firestore. Guárdalo primero."
        );
    }

    const barber = barberSnapshot.data();

    if (barber.authUid) {
        throw new Error(
            "Este barbero ya tiene una cuenta de acceso vinculada."
        );
    }

    const secondaryApp = getSecondaryApp();
    const secondaryAuth = getAuth(secondaryApp);

    await setPersistence(
        secondaryAuth,
        inMemoryPersistence
    );

    let createdUser = null;

    try {
        const credential = await createUserWithEmailAndPassword(
            secondaryAuth,
            normalizedEmail,
            validatedPassword
        );

        createdUser = credential.user;

        await setDoc(
            doc(db, "users", createdUser.uid),
            {
                uid: createdUser.uid,
                email: normalizedEmail,
                barberId,
                role: "barber",
                active: true,
                mustChangePassword: true,
                createdAt: serverTimestamp()
            }
        );

        await updateDoc(barberRef, {
            authUid: createdUser.uid,
            accountEmail: normalizedEmail,
            accountCreatedAt: serverTimestamp()
        });

        return {
            uid: createdUser.uid,
            email: normalizedEmail,
            barberId
        };

    } catch (error) {
        if (createdUser) {
            throw new Error(
                "La cuenta de Authentication se creó, pero no se pudo " +
                "completar su vinculación en Firestore. " +
                "No intentes registrarla otra vez sin revisar Firebase. " +
                `UID creado: ${createdUser.uid}. ` +
                `Detalle: ${error.message}`
            );
        }

        if (error.code === "auth/email-already-in-use") {
            throw new Error(
                "Este correo electrónico ya está registrado en Firebase."
            );
        }

        if (error.code === "auth/operation-not-allowed") {
            throw new Error(
                "Activa Email/Password en Firebase Authentication."
            );
        }

        throw error;

    } finally {
        await signOut(secondaryAuth).catch(() => {});
    }
}