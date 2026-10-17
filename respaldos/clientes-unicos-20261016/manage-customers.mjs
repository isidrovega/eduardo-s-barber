
import {
    initializeApp,
    cert,
    getApps
} from "firebase-admin/app";

import {
    getAuth
} from "firebase-admin/auth";

import {
    getFirestore
} from "firebase-admin/firestore";

/* =====================================================
   CONFIGURACIÓN
===================================================== */

const ADMIN_UID = "5Dt5IvBhLZgEJ7cgLQ1dIwuQKZx2";

const MAX_BODY_BYTES = 4096;

/* =====================================================
   FIREBASE ADMIN
===================================================== */

function getFirebase() {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    const privateKey = (
        process.env.FIREBASE_PRIVATE_KEY || ""
    )
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/\\n/g, "\n")
        .trim();

    if (!projectId || !clientEmail || !privateKey) {
        throw new Error(
            "Falta la configuración privada de Firebase."
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
        auth: getAuth(app),
        db: getFirestore(app)
    };
}

/* =====================================================
   RESPUESTAS
===================================================== */

class AppError extends Error {
    constructor(status, message) {
        super(message);
        this.name = "AppError";
        this.status = status;
    }
}

function json(status, data) {
    return new Response(
        JSON.stringify(data),
        {
            status,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
                "Allow": "POST"
            }
        }
    );
}

/* =====================================================
   VALIDACIONES
===================================================== */

function normalizePhone(phone) {
    if (typeof phone !== "string") {
        throw new AppError(
            400,
            "El teléfono no es válido."
        );
    }

    const normalized = phone.replace(/\D/g, "");

    if (
        normalized.length < 7 ||
        normalized.length > 15
    ) {
        throw new AppError(
            400,
            "El teléfono debe tener entre 7 y 15 dígitos."
        );
    }

    return normalized;
}

function normalizeName(name) {
    if (typeof name !== "string") {
        throw new AppError(
            400,
            "El nombre no es válido."
        );
    }

    const normalized = name.trim();

    if (
        normalized.length < 2 ||
        normalized.length > 120
    ) {
        throw new AppError(
            400,
            "El nombre debe tener entre 2 y 120 caracteres."
        );
    }

    return normalized;
}

/* =====================================================
   AUTENTICACIÓN Y AUTORIZACIÓN
===================================================== */

async function getIdentity(request, auth, db) {
    const authorization =
        request.headers.get("authorization") || "";

    const match = authorization.match(
        /^Bearer\s+(.+)$/i
    );

    if (!match) {
        throw new AppError(
            401,
            "Debes iniciar sesión."
        );
    }

    let decoded;

    try {
        decoded = await auth.verifyIdToken(
            match[1],
            true
        );
    } catch {
        throw new AppError(
            401,
            "La sesión no es válida o ha expirado."
        );
    }

    if (decoded.uid === ADMIN_UID) {
        return {
            uid: decoded.uid,
            role: "admin"
        };
    }

    const profileSnapshot = await db
        .collection("users")
        .doc(decoded.uid)
        .get();

    if (!profileSnapshot.exists) {
        throw new AppError(
            403,
            "No tienes autorización."
        );
    }

    const profile = profileSnapshot.data();

    if (
        profile.role !== "barber" ||
        profile.active !== true ||
        typeof profile.barberId !== "string" ||
        !profile.barberId
    ) {
        throw new AppError(
            403,
            "Tu cuenta de barbero no está activa."
        );
    }

    const barberSnapshot = await db
        .collection("barbers")
        .doc(profile.barberId)
        .get();

    if (
        !barberSnapshot.exists ||
        barberSnapshot.data().status !== "active"
    ) {
        throw new AppError(
            403,
            "El barbero no está activo."
        );
    }

    return {
        uid: decoded.uid,
        role: "barber",
        barberId: profile.barberId
    };
}

/* =====================================================
   BUSCAR CLIENTE
===================================================== */

async function findCustomer(db, phone) {
    const normalizedPhone =
        normalizePhone(phone);

    const snapshot = await db
        .collection("customers")
        .where(
            "normalizedPhone",
            "==",
            normalizedPhone
        )
        .limit(1)
        .get();

    if (snapshot.empty) {
        return null;
    }

    const document = snapshot.docs[0];
    const customer = document.data();

    /*
       Solo devolvemos los datos necesarios
       para el formulario del barbero.
    */

    return {
        id: document.id,
        name: customer.name || "",
        phone: customer.phone || "",
        visits: Number(customer.visits) || 0
    };
}

/* =====================================================
   REGISTRAR CLIENTE
===================================================== */

async function saveCustomer(db, name, phone) {
    const cleanName = normalizeName(name);
    const normalizedPhone =
        normalizePhone(phone);

    const existing = await findCustomer(
        db,
        phone
    );

    if (existing) {
        /*
           No sobrescribimos automáticamente
           los datos del cliente existente.
        */

        return {
            customer: existing,
            created: false
        };
    }

    const reference = db
        .collection("customers")
        .doc();

    const customer = {
        id: reference.id,
        name: cleanName,
        phone: phone.trim(),
        normalizedPhone,
        visits: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    await reference.set(customer);

    return {
        customer: {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            visits: customer.visits
        },
        created: true
    };
}

/* =====================================================
   FUNCIÓN PRINCIPAL
===================================================== */

export default async function handler(request) {
    if (request.method !== "POST") {
        return json(405, {
            error: "Método no permitido."
        });
    }

    try {
        const { auth, db } = getFirebase();

        /*
           Verificamos la identidad antes de
           consultar cualquier información.
        */

        const identity = await getIdentity(
            request,
            auth,
            db
        );

        const rawBody = await request.text();

        if (
            new TextEncoder().encode(rawBody).length >
            MAX_BODY_BYTES
        ) {
            throw new AppError(
                413,
                "La solicitud es demasiado grande."
            );
        }

        let body;

        try {
            body = JSON.parse(rawBody);
        } catch {
            throw new AppError(
                400,
                "La solicitud no contiene JSON válido."
            );
        }

        if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body)
        ) {
            throw new AppError(
                400,
                "La solicitud no es válida."
            );
        }

        if (body.action === "find") {
            const customer = await findCustomer(
                db,
                body.phone
            );

            return json(200, {
                customer
            });
        }

        if (body.action === "save") {
            const result = await saveCustomer(
                db,
                body.name,
                body.phone
            );

            return json(200, result);
        }

        throw new AppError(
            400,
            "Acción no válida."
        );

    } catch (error) {
        if (error instanceof AppError) {
            return json(error.status, {
                error: error.message
            });
        }

        console.error(
            "Error en manage-customers:",
            error
        );

        return json(500, {
            error: "No se pudo procesar el cliente."
        });
    }
}
