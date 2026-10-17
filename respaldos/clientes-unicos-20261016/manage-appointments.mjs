
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

/* =====================================================
   CONFIGURACIÓN
===================================================== */

const ADMIN_UIDS = new Set([
    "5Dt5IvBhLZgEJ7cgLQ1dIwuQKZx2",
    "KcHcm82nZESqoHy7RrHZdyj1y2p2"
]);

const BUSINESS_TIME_ZONE = "America/Mazatlan";

const SLOT_MINUTES = 15;
const START_INTERVAL_MINUTES = 30;

const DAYS = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"
];

const VALID_ORIGINS = new Set([
    "whatsapp",
    "instagram",
    "facebook",
    "phone",
    "walk-in"
]);

const NON_BLOCKING_STATUSES = new Set([
    "cancelled",
    "no-show"
]);

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
   RESPUESTAS Y ERRORES
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
   VALIDACIONES BÁSICAS
===================================================== */

function validId(value) {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 150 &&
        value !== "." &&
        value !== ".." &&
        !value.includes("/")
    );
}

function requireValidId(value, label) {
    if (!validId(value)) {
        throw new AppError(
            400,
            `${label} inválido.`
        );
    }

    return value;
}

function requireText(value, label, maxLength) {
    if (typeof value !== "string") {
        throw new AppError(
            400,
            `${label} inválido.`
        );
    }

    const normalized = value.trim();

    if (
        normalized.length === 0 ||
        normalized.length > maxLength
    ) {
        throw new AppError(
            400,
            `${label} debe contener entre 1 y ${maxLength} caracteres.`
        );
    }

    return normalized;
}

function optionalText(value, label, maxLength) {
    if (value === undefined || value === null) {
        return "";
    }

    if (typeof value !== "string") {
        throw new AppError(
            400,
            `${label} inválido.`
        );
    }

    const normalized = value.trim();

    if (normalized.length > maxLength) {
        throw new AppError(
            400,
            `${label} supera el máximo de ${maxLength} caracteres.`
        );
    }

    return normalized;
}

/* =====================================================
   FECHAS Y HORAS
===================================================== */

function minutes(time) {
    if (
        typeof time !== "string" ||
        !/^\d{2}:\d{2}$/.test(time)
    ) {
        throw new AppError(
            400,
            "El formato de hora debe ser HH:MM."
        );
    }

    const [hour, minute] = time
        .split(":")
        .map(Number);

    if (
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
    ) {
        throw new AppError(
            400,
            "La hora no es válida."
        );
    }

    return hour * 60 + minute;
}

function timeString(value) {
    const hour = Math.floor(value / 60);
    const minute = value % 60;

    return (
        String(hour).padStart(2, "0") +
        ":" +
        String(minute).padStart(2, "0")
    );
}

function parseDate(date) {
    if (
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
        throw new AppError(
            400,
            "La fecha debe tener el formato AAAA-MM-DD."
        );
    }

    const parsed = new Date(`${date}T12:00:00Z`);

    if (
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== date
    ) {
        throw new AppError(
            400,
            "La fecha no es válida."
        );
    }

    return parsed;
}

function getBusinessDateTime() {
    const formatter = new Intl.DateTimeFormat(
        "en-US",
        {
            timeZone: BUSINESS_TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }
    );

    const parts = formatter.formatToParts(
        new Date()
    );

    const values = Object.fromEntries(
        parts
            .filter(part => part.type !== "literal")
            .map(part => [
                part.type,
                part.value
            ])
    );

    return {
        date: (
            `${values.year}-` +
            `${values.month}-` +
            `${values.day}`
        ),
        time: (
            `${values.hour}:` +
            `${values.minute}`
        )
    };
}

function validateFutureAppointment(appointment) {
    const now = getBusinessDateTime();

    parseDate(appointment.date);

    if (appointment.date < now.date) {
        throw new AppError(
            400,
            "No puedes agendar una cita en una fecha pasada."
        );
    }

    const start = minutes(appointment.time);

    if (
        appointment.date === now.date &&
        start <= minutes(now.time)
    ) {
        throw new AppError(
            400,
            "Selecciona una hora posterior a la actual."
        );
    }

    if (start % START_INTERVAL_MINUTES !== 0) {
        throw new AppError(
            400,
            "Las citas deben comenzar cada 30 minutos."
        );
    }

    if (
        start + appointment.duration >
        24 * 60
    ) {
        throw new AppError(
            400,
            "La cita no puede terminar al día siguiente."
        );
    }
}

/* =====================================================
   BLOQUES DE RESERVA
===================================================== */

function slotsFor(date, time, duration) {
    parseDate(date);

    const start = minutes(time);

    if (
        !Number.isInteger(duration) ||
        duration <= 0 ||
        duration > 480
    ) {
        throw new AppError(
            400,
            "La duración del servicio no es válida."
        );
    }

    if (start + duration > 24 * 60) {
        throw new AppError(
            400,
            "La cita termina fuera del día seleccionado."
        );
    }

    const firstSlot =
        Math.floor(start / SLOT_MINUTES) *
        SLOT_MINUTES;

    const end = start + duration;
    const slots = [];

    for (
        let minute = firstSlot;
        minute < end;
        minute += SLOT_MINUTES
    ) {
        slots.push(
            `${date}_${timeString(minute)}`
        );
    }

    return slots;
}

function reservationRef(db, barberId, slot) {
    requireValidId(barberId, "Barbero");

    if (
        typeof slot !== "string" ||
        !/^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/.test(slot)
    ) {
        throw new AppError(
            409,
            "Se encontró un bloque de reserva inválido."
        );
    }

    return db
        .collection("appointmentReservations")
        .doc(`${barberId}_${slot}`);
}

function getExistingSlots(appointment) {
    if (Array.isArray(appointment.occupiedSlots)) {
        const slots = appointment.occupiedSlots;

       if (
    slots.some(slot =>
        typeof slot !== "string" ||
        !/^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/.test(slot)
    ) ||
    new Set(slots).size !== slots.length
) {
    throw new AppError(
        409,
        "La cita contiene reservas inconsistentes."
    );
}

        return slots;
    }

    return null;
}

/* =====================================================
   IDENTIDAD Y PERMISOS
===================================================== */

async function getIdentity(request, auth, db) {
    const header =
        request.headers.get("authorization") || "";

    const match = /^Bearer\s+(.+)$/i.exec(header);

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
            "Tu sesión no es válida. Inicia sesión nuevamente."
        );
    }

    // Ambos administradores están autorizados.
    if (ADMIN_UIDS.has(decoded.uid)) {
        return {
            uid: decoded.uid,
            role: "admin"
        };
    }

    // Comprobar acceso de barberos.
    const profileSnap = await db
        .collection("users")
        .doc(decoded.uid)
        .get();

    if (!profileSnap.exists) {
        throw new AppError(
            403,
            "Usuario no autorizado."
        );
    }

    const profile = profileSnap.data();

    if (
        profile.role !== "barber" ||
        profile.active !== true ||
        !validId(profile.barberId)
    ) {
        throw new AppError(
            403,
            "La cuenta de barbero está inactiva."
        );
    }

    const barberSnap = await db
        .collection("barbers")
        .doc(profile.barberId)
        .get();

    if (
        !barberSnap.exists ||
        barberSnap.data().status !== "active"
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

function assertCanManage(identity, appointment) {
    if (
        identity.role !== "admin" &&
        appointment.barberId !== identity.barberId
    ) {
        throw new AppError(
            403,
            "No tienes permiso para gestionar esta cita."
        );
    }
}

/* =====================================================
   DATOS DE LA CITA
===================================================== */

function normalizeAppointment(input, identity, service) {
    if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
    ) {
        throw new AppError(
            400,
            "Los datos de la cita no son válidos."
        );
    }

    const barberId =
        identity.role === "admin"
            ? input.barberId
            : identity.barberId;

    requireValidId(barberId, "Barbero");

    const clientName = requireText(
        input.clientName,
        "Nombre del cliente",
        120
    );

    const phone = optionalText(
        input.phone,
        "Teléfono",
        40
    );

    const notes = optionalText(
        input.notes,
        "Notas",
        1000
    );

    const origin = input.origin ?? "phone";

    if (!VALID_ORIGINS.has(origin)) {
        throw new AppError(
            400,
            "El origen de la cita no es válido."
        );
    }

    const serviceId = input.serviceId;

    requireValidId(serviceId, "Servicio");

    if (
        !service ||
        service.status !== "active"
    ) {
        throw new AppError(
            400,
            "El servicio no existe o está inactivo."
        );
    }

    const duration = Number(service.duration);

    if (
        !Number.isInteger(duration) ||
        duration < 5 ||
        duration > 480
    ) {
        throw new AppError(
            400,
            "La duración del servicio no es válida."
        );
    }

    const date = input.date;
    const time = input.time;

    parseDate(date);
    minutes(time);

    return {
        barberId,
        clientName,
        phone,
        notes,
        origin,
        serviceId,
        date,
        time,
        duration
    };
}

/* =====================================================
   HORARIO Y SERVICIOS DEL BARBERO
===================================================== */

function validateSchedule(barber, appointment) {
    if (
        !barber ||
        barber.status !== "active"
    ) {
        throw new AppError(
            400,
            "El barbero está inactivo."
        );
    }

    if (
        !Array.isArray(barber.serviceIds) ||
        !barber.serviceIds.includes(
            appointment.serviceId
        )
    ) {
        throw new AppError(
            400,
            "El barbero no tiene asignado ese servicio."
        );
    }

    const date = parseDate(
        appointment.date
    );

    const day = DAYS[
        date.getUTCDay()
    ];

    const schedule = barber.schedule?.[day];

    if (
        !schedule ||
        schedule.enabled !== true
    ) {
        throw new AppError(
            400,
            "El barbero no trabaja ese día."
        );
    }

    const start = minutes(
        appointment.time
    );

    const opening = minutes(
        schedule.start
    );

    const closing = minutes(
        schedule.end
    );

    if (
        closing <= opening ||
        start < opening ||
        start + appointment.duration > closing
    ) {
        throw new AppError(
            400,
            "La cita está fuera del horario de trabajo."
        );
    }
}

/* =====================================================
   CREAR CITA
===================================================== */

async function createAppointment(
    db,
    identity,
    input
) {
    if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
    ) {
        throw new AppError(
            400,
            "Los datos de la cita no son válidos."
        );
    }

    const serviceId = requireValidId(
        input.serviceId,
        "Servicio"
    );

    const serviceSnap = await db
        .collection("services")
        .doc(serviceId)
        .get();

    const appointment = normalizeAppointment(
        input,
        identity,
        serviceSnap.exists ? serviceSnap.data() : null
    );

    validateFutureAppointment(appointment);

    const appointmentRef = db
        .collection("appointments")
        .doc();

    const barberRef = db
        .collection("barbers")
        .doc(appointment.barberId);

    const slots = slotsFor(
        appointment.date,
        appointment.time,
        appointment.duration
    );

    const slotRefs = slots.map(slot =>
        reservationRef(
            db,
            appointment.barberId,
            slot
        )
    );

    await db.runTransaction(async transaction => {
        const [
            barberSnap,
            ...reservationSnaps
        ] = await Promise.all([
            transaction.get(barberRef),
            ...slotRefs.map(ref =>
                transaction.get(ref)
            )
        ]);

        if (!barberSnap.exists) {
            throw new AppError(
                404,
                "El barbero no existe."
            );
        }

        validateSchedule(
            barberSnap.data(),
            appointment
        );

        validateFutureAppointment(appointment);

        if (
            reservationSnaps.some(
                snapshot => snapshot.exists
            )
        ) {
            throw new AppError(
                409,
                "Ese horario ya está ocupado."
            );
        }

        transaction.create(
            appointmentRef,
            {
                ...appointment,
                id: appointmentRef.id,
                status: "pending",
                occupiedSlots: slots,
                createdBy: identity.uid,
                createdAt:
                    FieldValue.serverTimestamp(),
                updatedAt:
                    FieldValue.serverTimestamp()
            }
        );

        slotRefs.forEach((ref, index) => {
            transaction.create(
                ref,
                {
                    appointmentId:
                        appointmentRef.id,
                    barberId:
                        appointment.barberId,
                    slot: slots[index],
                    createdAt:
                        FieldValue.serverTimestamp()
                }
            );
        });
    });

    return {
        id: appointmentRef.id
    };
}

/* =====================================================
   MODIFICAR CITA
===================================================== */

async function updateAppointment(
    db,
    identity,
    id,
    input
) {
    requireValidId(id, "ID de cita");

    if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
    ) {
        throw new AppError(
            400,
            "Los cambios de la cita no son válidos."
        );
    }

    const appointmentRef = db
        .collection("appointments")
        .doc(id);

    await db.runTransaction(async transaction => {
        const oldSnap = await transaction.get(
            appointmentRef
        );

        if (!oldSnap.exists) {
            throw new AppError(
                404,
                "La cita no existe."
            );
        }

        const old = oldSnap.data();

        assertCanManage(
            identity,
            old
        );

        if (
            NON_BLOCKING_STATUSES.has(old.status)
        ) {
            throw new AppError(
                400,
                "No puedes modificar una cita cancelada o marcada como no asistida."
            );
        }

        const oldSlots = getExistingSlots(old);

        if (oldSlots === null) {
            throw new AppError(
                409,
                "Esta cita es anterior al sistema de reservas. Debe revisarse antes de modificarla."
            );
        }

        const nextInput = {
            ...old,
            ...input,
            barberId:
                identity.role === "admin"
                    ? (
                        input.barberId ??
                        old.barberId
                    )
                    : identity.barberId
        };

        const nextServiceId = requireValidId(
            nextInput.serviceId,
            "Servicio"
        );

        const serviceRef = db
            .collection("services")
            .doc(nextServiceId);

        const serviceSnap =
            await transaction.get(serviceRef);

        const next = normalizeAppointment(
            nextInput,
            identity,
            serviceSnap.exists
                ? serviceSnap.data()
                : null
        );

        validateFutureAppointment(next);

        const newSlots = slotsFor(
            next.date,
            next.time,
            next.duration
        );

        const oldRefs = oldSlots.map(slot =>
            reservationRef(
                db,
                old.barberId,
                slot
            )
        );

        const newRefs = newSlots.map(slot =>
            reservationRef(
                db,
                next.barberId,
                slot
            )
        );

        const barberRef = db
            .collection("barbers")
            .doc(next.barberId);

        const refsByPath = new Map();

        for (const ref of [...oldRefs, ...newRefs]) {
            refsByPath.set(
                ref.path,
                ref
            );
        }

        const refsToRead = Array.from(
            refsByPath.values()
        );

        const [
            barberSnap,
            ...reservationSnaps
        ] = await Promise.all([
            transaction.get(barberRef),
            ...refsToRead.map(ref =>
                transaction.get(ref)
            )
        ]);

        if (!barberSnap.exists) {
            throw new AppError(
                404,
                "El barbero no existe."
            );
        }

        validateSchedule(
            barberSnap.data(),
            next
        );

        const reservationsByPath = new Map(
            refsToRead.map(
                (ref, index) => [
                    ref.path,
                    reservationSnaps[index]
                ]
            )
        );

        for (const ref of oldRefs) {
            const snapshot =
                reservationsByPath.get(ref.path);

            if (
                !snapshot?.exists ||
                snapshot.data().appointmentId !== id
            ) {
                throw new AppError(
                    409,
                    "Las reservas actuales de esta cita están incompletas o pertenecen a otra cita."
                );
            }
        }

        for (const ref of newRefs) {
            const snapshot =
                reservationsByPath.get(ref.path);

            if (
                snapshot?.exists &&
                snapshot.data().appointmentId !== id
            ) {
                throw new AppError(
                    409,
                    "El nuevo horario está ocupado."
                );
            }
        }

        const oldPaths = new Set(
            oldRefs.map(ref => ref.path)
        );

        const newPaths = new Set(
            newRefs.map(ref => ref.path)
        );

        for (const ref of oldRefs) {
            if (!newPaths.has(ref.path)) {
                transaction.delete(ref);
            }
        }

        newRefs.forEach((ref, index) => {
            if (!oldPaths.has(ref.path)) {
                transaction.create(
                    ref,
                    {
                        appointmentId: id,
                        barberId:
                            next.barberId,
                        slot:
                            newSlots[index],
                        createdAt:
                            FieldValue.serverTimestamp()
                    }
                );
            }
        });

        transaction.update(
            appointmentRef,
            {
                ...next,
                occupiedSlots: newSlots,
                updatedAt:
                    FieldValue.serverTimestamp()
            }
        );
    });

    return {
        id
    };
}

/* =====================================================
   CANCELAR CITA
===================================================== */

async function cancelAppointment(
    db,
    identity,
    id
) {
    requireValidId(
        id,
        "ID de cita"
    );

    const appointmentRef = db
        .collection("appointments")
        .doc(id);

    await db.runTransaction(async transaction => {
        const appointmentSnap =
            await transaction.get(
                appointmentRef
            );

        if (!appointmentSnap.exists) {
            throw new AppError(
                404,
                "La cita no existe."
            );
        }

        const appointment =
            appointmentSnap.data();

        assertCanManage(
            identity,
            appointment
        );

        if (
            appointment.status === "cancelled"
        ) {
            return;
        }

        const oldSlots =
            getExistingSlots(
                appointment
            );

        if (oldSlots === null) {
            transaction.update(
                appointmentRef,
                {
                    status: "cancelled",
                    occupiedSlots: [],
                    updatedAt:
                        FieldValue.serverTimestamp()
                }
            );

            return;
        }

        const refs = oldSlots.map(slot =>
            reservationRef(
                db,
                appointment.barberId,
                slot
            )
        );

        const snapshots = await Promise.all(
            refs.map(ref =>
                transaction.get(ref)
            )
        );

        for (const snapshot of snapshots) {
            if (
                !snapshot.exists ||
                snapshot.data().appointmentId !== id
            ) {
                throw new AppError(
                    409,
                    "Las reservas de esta cita son inconsistentes. No se canceló."
                );
            }
        }

        refs.forEach(ref => {
            transaction.delete(ref);
        });

        transaction.update(
            appointmentRef,
            {
                status: "cancelled",
                occupiedSlots: [],
                updatedAt:
                    FieldValue.serverTimestamp()
            }
        );
    });

    return {
        id
    };
}

/* =====================================================
   CAMBIAR ESTADO
===================================================== */

async function changeAppointmentStatus(
    db,
    identity,
    id,
    newStatus
) {
    requireValidId(id, "ID de cita");

    if (identity.role !== "admin") {
        throw new AppError(
            403,
            "Solo el administrador puede cambiar el estado de una cita."
        );
    }

    const allowedStatuses = new Set([
        "pending",
        "confirmed",
        "completed",
        "no-show"
    ]);

    if (!allowedStatuses.has(newStatus)) {
        throw new AppError(
            400,
            "Estado de cita inválido."
        );
    }

    const appointmentRef = db
        .collection("appointments")
        .doc(id);

    await db.runTransaction(async transaction => {
        const appointmentSnap =
            await transaction.get(appointmentRef);

        if (!appointmentSnap.exists) {
            throw new AppError(
                404,
                "La cita no existe."
            );
        }

        const appointment = appointmentSnap.data();
        const previousStatus = appointment.status;

        if (previousStatus === newStatus) {
            return;
        }

        if (previousStatus === "completed") {
            throw new AppError(
                400,
                "Una cita completada no puede cambiar de estado."
            );
        }

        if (newStatus === "pending") {
            throw new AppError(
                400,
                "La restauración requiere reservar nuevamente el horario."
            );
        }

        if (
            previousStatus === "cancelled" ||
            previousStatus === "no-show"
        ) {
            throw new AppError(
                400,
                "Esta cita no puede cambiar de estado sin restaurar su reserva."
            );
        }

        if (
            newStatus === "confirmed" &&
            previousStatus !== "pending"
        ) {
            throw new AppError(
                400,
                "Solo puedes confirmar citas pendientes."
            );
        }

        if (
            (
                newStatus === "completed" ||
                newStatus === "no-show"
            ) &&
            previousStatus !== "confirmed"
        ) {
            throw new AppError(
                400,
                "Primero debes confirmar la cita."
            );
        }

        const slots = getExistingSlots(appointment);

        if (slots === null) {
            throw new AppError(
                409,
                "Esta cita antigua requiere revisión antes de cambiar su estado."
            );
        }

        const refs = slots.map(slot =>
            reservationRef(
                db,
                appointment.barberId,
                slot
            )
        );

        const snapshots = await Promise.all(
            refs.map(ref =>
                transaction.get(ref)
            )
        );

        for (const snapshot of snapshots) {
            if (
                !snapshot.exists ||
                snapshot.data().appointmentId !== id
            ) {
                throw new AppError(
                    409,
                    "Las reservas de esta cita son inconsistentes."
                );
            }
        }

        if (newStatus === "no-show") {
            refs.forEach(ref => {
                transaction.delete(ref);
            });
        }

        transaction.update(
            appointmentRef,
            {
                status: newStatus,
                ...(
                    newStatus === "no-show"
                        ? { occupiedSlots: [] }
                        : {}
                ),
                updatedAt:
                    FieldValue.serverTimestamp()
            }
        );
    });

    return {
        id,
        status: newStatus
    };
}

/* =====================================================
   FUNCIÓN NETLIFY
===================================================== */

export default async function handler(request) {
    if (request.method !== "POST") {
        return json(
            405,
            {
                ok: false,
                error: "Método no permitido."
            }
        );
    }

    try {
        const {
            auth,
            db
        } = getFirebase();

        const identity = await getIdentity(
            request,
            auth,
            db
        );

        let body;

        try {
            body = await request.json();
        } catch {
            throw new AppError(
                400,
                "El cuerpo de la solicitud no contiene JSON válido."
            );
        }

        if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body)
        ) {
            throw new AppError(
                400,
                "Solicitud inválida."
            );
        }

        let result;

        switch (body.action) {
            case "create":
                result = await createAppointment(
                    db,
                    identity,
                    body.appointment
                );
                break;

            case "update":
                result = await updateAppointment(
                    db,
                    identity,
                    body.id,
                    body.appointment
                );
                break;

            case "cancel":
                result = await cancelAppointment(
                    db,
                    identity,
                    body.id
                );
                break;

            case "status":
                result = await changeAppointmentStatus(
                    db,
                    identity,
                    body.id,
                    body.status
                );
                break;

            default:
                throw new AppError(
                    400,
                    "Acción no válida."
                );
        }

        return json(
            200,
            {
                ok: true,
                ...result
            }
        );

    } catch (error) {
        if (error instanceof AppError) {
            return json(
                error.status,
                {
                    ok: false,
                    error: error.message
                }
            );
        }

        console.error(
            "Error interno al gestionar cita:",
            error
        );

        return json(
            500,
            {
                ok: false,
                error:
                    "No se pudo completar la operación."
            }
        );
    }
}
