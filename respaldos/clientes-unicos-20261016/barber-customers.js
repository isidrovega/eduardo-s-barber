
import { auth } from "./firebase.js";

/* =====================================================
   CLIENTES DEL PANEL DEL BARBERO
   Consultas seguras mediante Netlify
===================================================== */

async function requestCustomer(action, data) {
    await auth.authStateReady();

    const user = auth.currentUser;

    if (!user) {
        throw new Error(
            "Tu sesión ha expirado. Inicia sesión nuevamente."
        );
    }

    const token = await user.getIdToken();

    let response;

    try {
        response = await fetch(
            "/.netlify/functions/manage-customers",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    action,
                    ...data
                })
            }
        );
    } catch {
        throw new Error(
            "No se pudo conectar con el servidor."
        );
    }

    let result;

    try {
        result = await response.json();
    } catch {
        throw new Error(
            "El servidor devolvió una respuesta no válida."
        );
    }

    if (!response.ok) {
        throw new Error(
            result.error ||
            "No se pudo procesar el cliente."
        );
    }

    return result;
}

export async function findBarberCustomerByPhone(
    phone
) {
    const result = await requestCustomer(
        "find",
        { phone }
    );

    return result.customer || null;
}

export async function saveBarberCustomer(
    name,
    phone
) {
    const result = await requestCustomer(
        "save",
        {
            name,
            phone
        }
    );

    return result.customer;
}
