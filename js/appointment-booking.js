
import { auth } from "./firebase.js";

const ENDPOINT = "/.netlify/functions/manage-appointments";

async function sendAppointmentRequest(payload) {
    const user = auth.currentUser;

    if (!user) {
        throw new Error("Debes iniciar sesión para gestionar citas.");
    }

    const token = await user.getIdToken();

    const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });

    let result;

    try {
        result = await response.json();
    } catch {
        throw new Error("El servidor devolvió una respuesta inválida.");
    }

    if (!response.ok || !result.ok) {
        throw new Error(
            result.error || "No se pudo completar la operación."
        );
    }

    return result;
}

export async function createAppointment(appointment) {
    return sendAppointmentRequest({
        action: "create",
        appointment
    });
}

export async function updateAppointment(id, appointment) {
    return sendAppointmentRequest({
        action: "update",
        id,
        appointment
    });
}

export async function cancelAppointment(id) {
    return sendAppointmentRequest({
        action: "cancel",
        id
    });
}

export async function changeAppointmentStatus(id, status) {
    return sendAppointmentRequest({
        action: "status",
        id,
        status
    });
}
