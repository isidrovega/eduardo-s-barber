
/* =========================================================
   EDUARDO'S BARBERSHOP
   FIRESTORE-STORAGE.JS

   - Lecturas desde Firebase Firestore
   - Sin localStorage
   - Sin datos de demostración
   - Clientes mediante Netlify
   - Citas mediante Netlify
   - customerId permanente
   - Teléfono opcional
   - Protección contra escrituras directas
========================================================= */

import {
    db,
    auth
} from "./firebase.js";

import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

import {
    createAppointment as createSecureAppointment,
    updateAppointment as updateSecureAppointment,
    cancelAppointment as cancelSecureAppointment
} from "./appointment-booking.js";

/* =========================================================
   CONFIGURACIÓN
========================================================= */

const COLLECTIONS = Object.freeze({
    customers: "customers",
    barbers: "barbers",
    services: "services",
    appointments: "appointments"
});

const CUSTOMER_ENDPOINT =
    "/.netlify/functions/manage-customers";

const PROTECTED_COLLECTIONS = new Set([
    "customers",
    "appointments"
]);

const ALLOWED_QUERY_FIELDS = new Set([
    "normalizedPhone",
    "customerId",
    "barberId",
    "serviceId",
    "status"
]);

/* =========================================================
   AUTENTICACIÓN
========================================================= */

export async function waitForAuth() {
    await auth.authStateReady();

    const user = auth.currentUser;

    if (!user) {
        throw new Error(
            "Debes iniciar sesión para continuar."
        );
    }

    return user;
}

/* =========================================================
   UTILIDADES
========================================================= */

export function generateId(prefix = "item") {
    const safePrefix =
        String(prefix)
            .trim()
            .replace(
                /[^a-zA-Z0-9_-]/g,
                "-"
            ) || "item";

    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    ) {
        return (
            `${safePrefix}-` +
            crypto.randomUUID()
        );
    }

    return (
        `${safePrefix}-${Date.now()}-` +
        Math.random()
            .toString(16)
            .slice(2)
    );
}

export function normalizePhone(phone) {
    return String(
        phone ?? ""
    ).replace(/\D/g, "");
}

function validateCollection(collectionName) {
    if (
        !Object.prototype.hasOwnProperty.call(
            COLLECTIONS,
            collectionName
        )
    ) {
        throw new Error(
            `Colección no permitida: ${collectionName}`
        );
    }

    return COLLECTIONS[
        collectionName
    ];
}

function validateId(id) {
    if (
        typeof id !== "string" &&
        typeof id !== "number"
    ) {
        throw new Error(
            "Identificador inválido."
        );
    }

    const value =
        String(id).trim();

    if (
        !value ||
        value.length > 150 ||
        value === "." ||
        value === ".." ||
        value.includes("/")
    ) {
        throw new Error(
            "Identificador inválido."
        );
    }

    return value;
}

function validateRecord(record) {
    if (
        !record ||
        typeof record !== "object" ||
        Array.isArray(record)
    ) {
        throw new Error(
            "El registro debe ser un objeto."
        );
    }

    return record;
}

function cleanData(value) {
    if (
        Array.isArray(value)
    ) {
        return value.map(
            cleanData
        );
    }

    if (
        value !== null &&
        typeof value === "object" &&
        Object.getPrototypeOf(value) ===
            Object.prototype
    ) {
        const result = {};

        for (
            const [key, item]
            of Object.entries(value)
        ) {
            if (
                item !== undefined
            ) {
                result[key] =
                    cleanData(item);
            }
        }

        return result;
    }

    return value;
}

function snapshotToRecords(snapshot) {
    return snapshot.docs.map(
        document => ({
            ...document.data(),
            id: document.id
        })
    );
}

function assertDirectWriteAllowed(collectionName) {
    if (
        PROTECTED_COLLECTIONS.has(
            collectionName
        )
    ) {
        throw new Error(
            `No se permite modificar "${collectionName}" ` +
            "directamente desde el navegador. " +
            "Utiliza la función segura de Netlify."
        );
    }
}

function validateCustomerName(name) {
    if (
        typeof name !== "string"
    ) {
        throw new Error(
            "Ingresa el nombre del cliente."
        );
    }

    const normalized = name
        .trim()
        .replace(/\s+/g, " ");

    if (
        normalized.length < 2 ||
        normalized.length > 120
    ) {
        throw new Error(
            "El nombre debe tener entre 2 y 120 caracteres."
        );
    }

    return normalized;
}

function validateCustomerPhone(phone) {
    if (
        phone === undefined ||
        phone === null ||
        phone === ""
    ) {
        return "";
    }

    if (
        typeof phone !== "string"
    ) {
        throw new Error(
            "El teléfono no es válido."
        );
    }

    const normalized =
        normalizePhone(phone);

    if (!normalized) {
        return "";
    }

    if (
        normalized.length < 7 ||
        normalized.length > 15
    ) {
        throw new Error(
            "El teléfono debe tener entre 7 y 15 dígitos."
        );
    }

    return phone.trim();
}

/* =========================================================
   SOLICITUDES SEGURAS DE CLIENTES
========================================================= */

async function requestCustomers(payload) {
    const user =
        await waitForAuth();

    const token =
        await user.getIdToken();

    let response;

    try {
        response = await fetch(
            CUSTOMER_ENDPOINT,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json",
                    Authorization:
                        `Bearer ${token}`
                },
                body:
                    JSON.stringify(payload)
            }
        );
    } catch {
        throw new Error(
            "No se pudo conectar con el servidor de clientes."
        );
    }

    let result;

    try {
        result =
            await response.json();
    } catch {
        throw new Error(
            "El servidor de clientes devolvió una respuesta inválida."
        );
    }

    if (
        !result ||
        typeof result !== "object" ||
        Array.isArray(result)
    ) {
        throw new Error(
            "La respuesta del servidor de clientes no es válida."
        );
    }

    if (
        !response.ok ||
        result.ok !== true
    ) {
        throw new Error(
            result.error ||
            "No se pudo completar la operación de clientes."
        );
    }

    return result;
}

/* =========================================================
   CONSULTAS GENÉRICAS
========================================================= */

export async function getAll(collectionName) {
    await waitForAuth();

    const name =
        validateCollection(
            collectionName
        );

    const snapshot =
        await getDocs(
            collection(
                db,
                name
            )
        );

    return snapshotToRecords(
        snapshot
    );
}

export async function getOne(
    collectionName,
    id
) {
    await waitForAuth();

    const name =
        validateCollection(
            collectionName
        );

    const validId =
        validateId(id);

    const snapshot =
        await getDoc(
            doc(
                db,
                name,
                validId
            )
        );

    if (
        !snapshot.exists()
    ) {
        return null;
    }

    return {
        ...snapshot.data(),
        id: snapshot.id
    };
}

/* =========================================================
   ESCRITURAS GENÉRICAS

   Clientes y citas quedan protegidos.
   Barberos y servicios conservan las
   operaciones originales.

   Las reglas de Firestore deben imponer
   los permisos correspondientes.
========================================================= */

export async function saveOne(
    collectionName,
    record
) {
    await waitForAuth();

    const name =
        validateCollection(
            collectionName
        );

    assertDirectWriteAllowed(
        name
    );

    const validRecord =
        validateRecord(
            record
        );

    const id = validRecord.id
        ? validateId(
            validRecord.id
        )
        : generateId(
            collectionName
        );

    const data =
        cleanData({
            ...validRecord,
            id
        });

    await setDoc(
        doc(
            db,
            name,
            id
        ),
        data
    );

    return data;
}

export async function updateOne(
    collectionName,
    id,
    changes
) {
    await waitForAuth();

    const name =
        validateCollection(
            collectionName
        );

    assertDirectWriteAllowed(
        name
    );

    const validId =
        validateId(id);

    const validChanges =
        validateRecord(
            changes
        );

    const data =
        cleanData({
            ...validChanges
        });

    delete data.id;

    if (
        Object.keys(data).length === 0
    ) {
        throw new Error(
            "No hay cambios para actualizar."
        );
    }

    await updateDoc(
        doc(
            db,
            name,
            validId
        ),
        data
    );

    return getOne(
        collectionName,
        validId
    );
}

export async function deleteOne(
    collectionName,
    id
) {
    await waitForAuth();

    const name =
        validateCollection(
            collectionName
        );

    assertDirectWriteAllowed(
        name
    );

    const validId =
        validateId(id);

    await deleteDoc(
        doc(
            db,
            name,
            validId
        )
    );

    return true;
}

/* =========================================================
   BUSCAR POR CAMPO
========================================================= */

export async function findByField(
    collectionName,
    field,
    value
) {
    await waitForAuth();

    const name =
        validateCollection(
            collectionName
        );

    if (
        !ALLOWED_QUERY_FIELDS.has(
            field
        )
    ) {
        throw new Error(
            "Campo de consulta no permitido."
        );
    }

    const snapshot =
        await getDocs(
            query(
                collection(
                    db,
                    name
                ),
                where(
                    field,
                    "==",
                    value
                )
            )
        );

    return snapshotToRecords(
        snapshot
    );
}

/* =========================================================
   CLIENTES
========================================================= */

export function getCustomers() {
    return getAll(
        "customers"
    );
}

export function getCustomer(id) {
    return getOne(
        "customers",
        id
    );
}

/*
 * Crear cliente:
 * - Teléfono opcional.
 * - El servidor asigna customerId.
 * - No se permite inventar un ID
 *   para una ficha nueva.
 *
 * Actualizar cliente:
 * - Reutiliza su ID permanente.
 * - El servidor conserva el nombre
 *   original y protege el teléfono.
 */
export async function saveCustomer(customer) {
    const record =
        validateRecord(
            customer
        );

    const name =
        validateCustomerName(
            record.name
        );

    const phone =
        validateCustomerPhone(
            record.phone
        );

    const customerId =
        record.id ||
        record.customerId ||
        null;

    const payload = {
        action: "save",
        name,
        phone
    };

    if (customerId) {
        payload.customerId =
            validateId(
                customerId
            );
    }

    const result =
        await requestCustomers(
            payload
        );

    if (
        !result.customer?.id
    ) {
        throw new Error(
            "El servidor no devolvió una ficha de cliente válida."
        );
    }

    return result.customer;
}

export async function updateCustomer(
    id,
    changes
) {
    const customerId =
        validateId(id);

    const record =
        validateRecord(
            changes
        );

    const existing =
        await getCustomer(
            customerId
        );

    if (!existing) {
        throw new Error(
            "El cliente no existe."
        );
    }

    /*
     * manage-customers valida el nombre,
     * pero no permite cambiarlo desde
     * este flujo de citas.
     */
    const name =
        validateCustomerName(
            existing.name
        );

    const phone =
        validateCustomerPhone(
            Object.prototype.hasOwnProperty.call(
                record,
                "phone"
            )
                ? record.phone
                : existing.phone
        );

    const result =
        await requestCustomers({
            action: "save",
            customerId,
            name,
            phone
        });

    if (
        !result.customer?.id
    ) {
        throw new Error(
            "No se pudo actualizar el cliente."
        );
    }

    return result.customer;
}

export async function deleteCustomer(id) {
    validateId(id);

    throw new Error(
        "La eliminación de clientes está deshabilitada " +
        "hasta implementar una operación administrativa " +
        "segura que preserve el historial de citas."
    );
}

export async function findCustomerByPhone(phone) {
    const normalized =
        normalizePhone(phone);

    if (!normalized) {
        return null;
    }

    validateCustomerPhone(
        phone
    );

    const result =
        await requestCustomers({
            action: "find",
            phone:
                String(phone)
        });

    return result.customer || null;
}

export async function getOrCreateCustomer(
    name,
    phone = ""
) {
    const normalizedName =
        validateCustomerName(
            name
        );

    const validatedPhone =
        validateCustomerPhone(
            phone
        );

    /*
     * Si existe un teléfono, primero
     * recuperar la ficha registrada.
     */
    if (validatedPhone) {
        const existing =
            await findCustomerByPhone(
                validatedPhone
            );

        if (existing) {
            return existing;
        }
    }

    /*
     * Sin teléfono, el servidor decidirá
     * si puede registrar la ficha.
     *
     * No asignamos customerId localmente.
     */
    return saveCustomer({
        name:
            normalizedName,
        phone:
            validatedPhone
    });
}

export async function addCustomerVisit(phone) {
    const normalized =
        normalizePhone(
            phone
        );

    if (!normalized) {
        return false;
    }

    const customer =
        await findCustomerByPhone(
            normalized
        );

    if (!customer) {
        return false;
    }

    /*
     * No incrementar visitas con
     * updateDoc desde el navegador.
     *
     * La operación requiere una acción
     * transaccional en el servidor para
     * evitar incrementos duplicados.
     */
    throw new Error(
        "El incremento de visitas requiere " +
        "una operación segura en el servidor. " +
        "No se modificó el historial del cliente."
    );
}

/* =========================================================
   BARBEROS
========================================================= */

export function getBarbers() {
    return getAll(
        "barbers"
    );
}

export function getBarber(id) {
    return getOne(
        "barbers",
        id
    );
}

export function saveBarber(barber) {
    return saveOne(
        "barbers",
        barber
    );
}

export function updateBarber(
    id,
    changes
) {
    return updateOne(
        "barbers",
        id,
        changes
    );
}

export function deleteBarber(id) {
    return deleteOne(
        "barbers",
        id
    );
}

/* =========================================================
   SERVICIOS
========================================================= */

export function getServices() {
    return getAll(
        "services"
    );
}

export function getService(id) {
    return getOne(
        "services",
        id
    );
}

export function saveService(service) {
    return saveOne(
        "services",
        service
    );
}

export function updateService(
    id,
    changes
) {
    return updateOne(
        "services",
        id,
        changes
    );
}

export function deleteService(id) {
    return deleteOne(
        "services",
        id
    );
}

/* =========================================================
   CITAS
========================================================= */

export function getAppointments() {
    return getAll(
        "appointments"
    );
}

export function getAppointment(id) {
    return getOne(
        "appointments",
        id
    );
}

/*
 * saveAppointment conserva su nombre
 * público, pero delega la escritura
 * a manage-appointments.
 *
 * Las citas nuevas requieren customerId.
 * Las existentes se actualizan por ID.
 */
export async function saveAppointment(
    appointment
) {
    const record =
        validateRecord(
            appointment
        );

    if (
        record.id
    ) {
        return updateAppointment(
            record.id,
            record
        );
    }

    const result =
        await createSecureAppointment(
            record
        );

    return {
        ...record,
        id: result.id
    };
}

/*
 * Permite cambios parciales al recuperar
 * la cita actual antes de enviar la
 * solicitud de actualización.
 */
export async function updateAppointment(
    id,
    changes
) {
    const appointmentId =
        validateId(id);

    const record =
        validateRecord(
            changes
        );

    const existing =
        await getAppointment(
            appointmentId
        );

    if (!existing) {
        throw new Error(
            "La cita no existe."
        );
    }

    /*
     * No permitir cambiar customerId
     * si la cita ya está vinculada.
     */
    if (
        existing.customerId &&
        record.customerId &&
        record.customerId !==
            existing.customerId
    ) {
        throw new Error(
            "No puedes cambiar el cliente asociado a esta cita."
        );
    }

    const appointment =
        cleanData({
            ...existing,
            ...record,
            id: appointmentId,
            customerId:
                existing.customerId ||
                record.customerId
        });

    const result =
        await updateSecureAppointment(
            appointmentId,
            appointment
        );

    return {
        ...appointment,
        id: result.id
    };
}

/*
 * Eliminar físicamente una cita rompería
 * el control de reservas y el historial.
 *
 * Por compatibilidad, esta función
 * cancela la cita mediante Netlify.
 */
export async function deleteAppointment(id) {
    const appointmentId =
        validateId(id);

    await cancelSecureAppointment(
        appointmentId
    );

    return true;
}
