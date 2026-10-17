
/* =========================================================
   EDUARDO'S BARBERSHOP
   FIRESTORE-STORAGE.JS

   Almacenamiento en Firebase Firestore.
   Sin localStorage.
   Sin datos de demostración.
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

/* =========================================================
   COLECCIONES PERMITIDAS
========================================================= */

const COLLECTIONS = Object.freeze({
    customers: "customers",
    barbers: "barbers",
    services: "services",
    appointments: "appointments"
});

/* =========================================================
   AUTENTICACIÓN
========================================================= */

export async function waitForAuth() {
    await auth.authStateReady();

    const user = auth.currentUser;

    if (!user) {
        throw new Error(
            "Debes iniciar sesión como administrador."
        );
    }

    return user;
}

/* =========================================================
   UTILIDADES
========================================================= */

export function generateId(prefix = "item") {
    const safePrefix = String(prefix)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, "-") || "item";

    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    ) {
        return `${safePrefix}-${crypto.randomUUID()}`;
    }

    return (
        `${safePrefix}-${Date.now()}-` +
        Math.random().toString(16).slice(2)
    );
}

export function normalizePhone(phone) {
    return String(phone ?? "").replace(/\D/g, "");
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

    return COLLECTIONS[collectionName];
}

function validateId(id) {
    if (
        typeof id !== "string" &&
        typeof id !== "number"
    ) {
        throw new Error("Identificador inválido.");
    }

    const value = String(id).trim();

    if (!value || value.includes("/")) {
        throw new Error("Identificador inválido.");
    }

    return value;
}

function cleanData(value) {
    if (Array.isArray(value)) {
        return value.map(cleanData);
    }

    if (
        value !== null &&
        typeof value === "object" &&
        Object.getPrototypeOf(value) === Object.prototype
    ) {
        const result = {};

        for (const [key, item] of Object.entries(value)) {
            if (item !== undefined) {
                result[key] = cleanData(item);
            }
        }

        return result;
    }

    return value;
}

function validateRecord(record) {
    if (
        !record ||
        typeof record !== "object" ||
        Array.isArray(record)
    ) {
        throw new Error("El registro debe ser un objeto.");
    }

    return record;
}

function snapshotToRecords(snapshot) {
    return snapshot.docs.map(document => ({
        ...document.data(),
        id: document.id
    }));
}

/* =========================================================
   CONSULTAR TODOS LOS REGISTROS
========================================================= */

export async function getAll(collectionName) {
    await waitForAuth();

    const name = validateCollection(collectionName);

    const snapshot = await getDocs(
        collection(db, name)
    );

    return snapshotToRecords(snapshot);
}

/* =========================================================
   CONSULTAR UN REGISTRO
========================================================= */

export async function getOne(collectionName, id) {
    await waitForAuth();

    const name = validateCollection(collectionName);
    const validId = validateId(id);

    const snapshot = await getDoc(
        doc(db, name, validId)
    );

    if (!snapshot.exists()) {
        return null;
    }

    return {
        ...snapshot.data(),
        id: snapshot.id
    };
}

/* =========================================================
   CREAR O REEMPLAZAR UN REGISTRO
========================================================= */

export async function saveOne(collectionName, record) {
    await waitForAuth();

    const name = validateCollection(collectionName);
    const validRecord = validateRecord(record);

    const id = validRecord.id
        ? validateId(validRecord.id)
        : generateId(collectionName);

    const data = cleanData({
        ...validRecord,
        id
    });

    await setDoc(
        doc(db, name, id),
        data
    );

    return data;
}

/* =========================================================
   ACTUALIZAR UN REGISTRO EXISTENTE
========================================================= */

export async function updateOne(
    collectionName,
    id,
    changes
) {
    await waitForAuth();

    const name = validateCollection(collectionName);
    const validId = validateId(id);
    const validChanges = validateRecord(changes);

    const data = cleanData({
        ...validChanges
    });

    delete data.id;

    if (Object.keys(data).length === 0) {
        throw new Error(
            "No hay cambios para actualizar."
        );
    }

    await updateDoc(
        doc(db, name, validId),
        data
    );

    return getOne(collectionName, validId);
}

/* =========================================================
   ELIMINAR UN REGISTRO
========================================================= */

export async function deleteOne(collectionName, id) {
    await waitForAuth();

    const name = validateCollection(collectionName);
    const validId = validateId(id);

    await deleteDoc(
        doc(db, name, validId)
    );

    return true;
}

/* =========================================================
   BUSCAR REGISTROS POR CAMPO
========================================================= */

export async function findByField(
    collectionName,
    field,
    value
) {
    await waitForAuth();

    const name = validateCollection(collectionName);

    const allowedFields = new Set([
        "normalizedPhone",
        "customerId",
        "barberId",
        "serviceId",
        "status"
    ]);

    if (!allowedFields.has(field)) {
        throw new Error(
            "Campo de consulta no permitido."
        );
    }

    const snapshot = await getDocs(
        query(
            collection(db, name),
            where(field, "==", value)
        )
    );

    return snapshotToRecords(snapshot);
}

/* =========================================================
   CLIENTES
========================================================= */

export function getCustomers() {
    return getAll("customers");
}

export function getCustomer(id) {
    return getOne("customers", id);
}

export async function saveCustomer(customer) {
    const record = validateRecord(customer);

    return saveOne("customers", {
        ...record,
        normalizedPhone: normalizePhone(record.phone)
    });
}

export async function updateCustomer(id, changes) {
    const record = validateRecord(changes);
    const data = { ...record };

    if (
        Object.prototype.hasOwnProperty.call(
            data,
            "phone"
        )
    ) {
        data.normalizedPhone = normalizePhone(data.phone);
    }

    return updateOne("customers", id, data);
}

export function deleteCustomer(id) {
    return deleteOne("customers", id);
}

export async function findCustomerByPhone(phone) {
    const normalized = normalizePhone(phone);

    if (!normalized) {
        return null;
    }

    const customers = await findByField(
        "customers",
        "normalizedPhone",
        normalized
    );

    return customers[0] ?? null;
}

export async function getOrCreateCustomer(name, phone) {
    const normalized = normalizePhone(phone);

    if (!normalized) {
        throw new Error(
            "El teléfono del cliente es obligatorio."
        );
    }

    const existing = await findCustomerByPhone(phone);

    if (existing) {
        return updateCustomer(existing.id, {
            name,
            phone
        });
    }

    return saveCustomer({
        id: generateId("customer"),
        name,
        phone,
        visits: 0
    });
}

export async function addCustomerVisit(phone) {
    const customer = await findCustomerByPhone(phone);

    if (!customer) {
        return false;
    }

    await updateCustomer(customer.id, {
        visits: (Number(customer.visits) || 0) + 1
    });

    return true;
}

/* =========================================================
   BARBEROS
========================================================= */

export function getBarbers() {
    return getAll("barbers");
}

export function getBarber(id) {
    return getOne("barbers", id);
}

export function saveBarber(barber) {
    return saveOne("barbers", barber);
}

export function updateBarber(id, changes) {
    return updateOne("barbers", id, changes);
}

export function deleteBarber(id) {
    return deleteOne("barbers", id);
}

/* =========================================================
   SERVICIOS
========================================================= */

export function getServices() {
    return getAll("services");
}

export function getService(id) {
    return getOne("services", id);
}

export function saveService(service) {
    return saveOne("services", service);
}

export function updateService(id, changes) {
    return updateOne("services", id, changes);
}

export function deleteService(id) {
    return deleteOne("services", id);
}

/* =========================================================
   CITAS
========================================================= */

export function getAppointments() {
    return getAll("appointments");
}

export function getAppointment(id) {
    return getOne("appointments", id);
}

export function saveAppointment(appointment) {
    return saveOne("appointments", appointment);
}

export function updateAppointment(id, changes) {
    return updateOne("appointments", id, changes);
}

export function deleteAppointment(id) {
    return deleteOne("appointments", id);
}
