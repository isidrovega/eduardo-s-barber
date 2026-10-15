import {
    initializeApp,
    cert,
    getApps
} from "firebase-admin/app";

import {
    getAuth
} from "firebase-admin/auth";

import {
    getFirestore,
    FieldValue
} from "firebase-admin/firestore";

const ADMIN_UID = "5Dt5IvBhLZgEJ7cgLQ1dIwuQKZx2";

function getFirebaseAdmin() {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

   const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n")
    .trim();

    if (!projectId || !clientEmail || !privateKey) {
        throw new Error(
            "Faltan las credenciales privadas de Firebase."
        );
    }

    const app = getApps()[0] || initializeApp({
      credential: cert({
    projectId,
    clientEmail,
    privateKey
})
    });

    return {
        adminAuth: getAuth(app),
        adminDb: getFirestore(app)
    };
}



function response(statusCode, data) {
    return new Response(
        JSON.stringify(data),
        {
            status: statusCode,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
                "Allow": "POST"
            }
        }
    );
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidBarberId(id) {
    return (
        typeof id === "string" &&
        id.length > 0 &&
        id.length <= 150 &&
        id !== "." &&
        id !== ".." &&
        !id.includes("/")
    );
}

async function reserveBarberAccount(
    adminDb,
    barberId,
    email
) {
    const barberRef = adminDb
        .collection("barbers")
        .doc(barberId);

    const reservationRef = adminDb
        .collection("barberAccountReservations")
        .doc(barberId);

    const reservationId = crypto.randomUUID();

    await adminDb.runTransaction(async transaction => {
        const barberSnapshot = await transaction.get(
            barberRef
        );

        if (!barberSnapshot.exists) {
            const error = new Error(
                "El barbero no existe en Firebase."
            );

            error.statusCode = 404;
            throw error;
        }

        const barber = barberSnapshot.data();

        if (barber.status !== "active") {
            const error = new Error(
                "Activa al barbero antes de crear su cuenta."
            );

            error.statusCode = 409;
            throw error;
        }

        const reservationSnapshot = await transaction.get(
            reservationRef
        );

        if (reservationSnapshot.exists) {
            const error = new Error(
                "Este barbero ya tiene una cuenta o una creación pendiente."
            );

            error.statusCode = 409;
            throw error;
        }

        transaction.create(reservationRef, {
            email,
            status: "pending",
            reservationId,
            createdAt: FieldValue.serverTimestamp()
        });
    });

    return {
        reservationRef,
        reservationId
    };
}

async function releaseReservation(
    adminDb,
    reservationRef,
    reservationId
) {
    await adminDb.runTransaction(async transaction => {
        const snapshot = await transaction.get(
            reservationRef
        );

        if (
            snapshot.exists &&
            snapshot.data().reservationId === reservationId &&
            snapshot.data().status === "pending"
        ) {
            transaction.delete(reservationRef);
        }
    });
}

export default async function handler(request) {
    if (request.method !== "POST") {
        return response(405, {
            error: "Método no permitido."
        });
    }

    let reservation = null;
    let createdUser = null;
    let profileCreated = false;
    let accountCompleted = false;
    let adminAuth;
    let adminDb;

    try {
        const firebase = getFirebaseAdmin();

        adminAuth = firebase.adminAuth;
        adminDb = firebase.adminDb;

        const authorization =
            request.headers.get("authorization") || "";

        if (!authorization.startsWith("Bearer ")) {
            return response(401, {
                error: "Debes iniciar sesión como administrador."
            });
        }

        const idToken = authorization.slice(7).trim();

        if (!idToken) {
            return response(401, {
                error: "No se recibió un token de sesión."
            });
        }

        const decodedToken = await adminAuth.verifyIdToken(
            idToken,
            true
        );

        if (
            decodedToken.uid !== ADMIN_UID ||
            decodedToken.email_verified !== true
        ) {
            return response(403, {
                error: "No tienes permiso para crear cuentas."
            });
        }

        let body;

        try {
            body = await request.json();
        } catch {
            return response(400, {
                error: "Los datos enviados no son válidos."
            });
        }

        const email = String(body.email || "")
            .trim()
            .toLowerCase();

        const password = String(body.password || "");

        const barberId = String(body.barberId || "")
            .trim();

        if (
            !isValidEmail(email) ||
            password.length < 8 ||
            password.length > 128 ||
            !isValidBarberId(barberId)
        ) {
            return response(400, {
                error: "Ingresa un correo válido, una contraseña de 8 a 128 caracteres y un barbero válido."
            });
        }

        reservation = await reserveBarberAccount(
            adminDb,
            barberId,
            email
        );

        createdUser = await adminAuth.createUser({
            email,
            password,
            disabled: false
        });

        const userRef = adminDb
            .collection("users")
            .doc(createdUser.uid);

        await userRef.create({
            email,
            role: "barber",
            barberId,
            active: true,
            createdAt: FieldValue.serverTimestamp()
        });

        profileCreated = true;

        await reservation.reservationRef.update({
            status: "completed",
            uid: createdUser.uid,
            completedAt: FieldValue.serverTimestamp()
        });

        accountCompleted = true;

        return response(201, {
            success: true,
            uid: createdUser.uid,
            email,
            barberId
        });

    } catch (error) {
        console.error(
            "Error creando cuenta de barbero:",
            error
        );

        if (
            !accountCompleted &&
            createdUser &&
            adminAuth &&
            adminDb
        ) {
            try {
                if (profileCreated) {
                    await adminDb
                        .collection("users")
                        .doc(createdUser.uid)
                        .delete();
                }

                await adminAuth.deleteUser(
                    createdUser.uid
                );
            } catch (cleanupError) {
                console.error(
                    "No se pudo revertir completamente la cuenta:",
                    cleanupError
                );

                return response(500, {
                    error: "La creación quedó incompleta. Revisa Firebase antes de reintentar."
                });
            }
        }

        if (
            !accountCompleted &&
            reservation &&
            adminDb
        ) {
            try {
                await releaseReservation(
                    adminDb,
                    reservation.reservationRef,
                    reservation.reservationId
                );
            } catch (cleanupError) {
                console.error(
                    "No se pudo liberar la reserva:",
                    cleanupError
                );

                return response(500, {
                    error: "La creación quedó pendiente. Revisa Firebase antes de reintentar."
                });
            }
        }

        if (error.statusCode) {
            return response(error.statusCode, {
                error: error.message
            });
        }

        if (error.code === "auth/email-already-exists") {
            return response(409, {
                error: "Este correo ya tiene una cuenta."
            });
        }

        if (
            error.code === "auth/id-token-expired" ||
            error.code === "auth/id-token-revoked" ||
            error.code === "auth/argument-error"
        ) {
            return response(401, {
                error: "Tu sesión expiró. Inicia sesión nuevamente."
            });
        }

        return response(500, {
            error: "No se pudo crear la cuenta. Revisa la configuración del servidor."
        });
    }
}
