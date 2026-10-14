
/* =========================================================
   EDUARDO'S BARBERSHOP
   FIRESTORE STORAGE
   Sin localStorage y sin datos de demostración
========================================================= */

import { db, auth } from "./firebase.js";

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
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";

/* COLECCIONES */

const COLLECTIONS = Object.freeze({
    customers: "customers",
    barbers: "barbers",
    services: "services",
    appointments: "appointments"
});

/* AUTENTICACIÓN */

export function waitForAuth() {
    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(
            auth,
            user => {
                unsubscribe();

                if (user) {
                    resolve(user);
                } else {
                    reject(
                        new Error(
                            "Debes iniciar sesión como administrador."
                        )
                    );
                }
            },
            reject
        );
    });
}

/* UTILIDADES */

export function generateId(prefix = "item") {
    return `${prefix}-${crypto.randomUUID()}`;
}

export function normalizePhone(phone) {
    return String(phone ?? "").replace(/\D/g, "");
}

function validateCollection(collectionName) {
    if (!Object.hasOwn(COLLECTIONS, collectionName)) {
        throw new Error(
            `Colección no permitida: ${collectionName}`
        );
    }

    return COLLECTIONS[collectionName];
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

/* CONSULTAR TODOS */

export async function getAll(collectionName) {
    await waitForAuth();

    const name = validateCollection(collectionName);
    const snapshot = await getDocs(collection(db, name));

    return snapshot.docs.map(item => ({
        ...item.data(),
        id: item.id
    }));
}

/* CONSULTAR UNO */

export async function getOne(collectionName, id) {
    await waitForAuth();

    const name = validateCollection(collectionName);
    const snapshot = await getDoc(doc(db, name, String(id)));

    return snapshot.exists()
        ? { ...snapshot.data(), id: snapshot.id }
        : null;
}

/* CREAR O REEMPLAZAR */

export async function saveOne(collectionName, record) {
    await waitForAuth();

    const name = validateCollection(collectionName);

    if (!record || typeof record !== "object") {
        throw new Error("Registro inválido.");
    }

    const id = String(
        record.id || generateId(collectionName)
    );

    const data = cleanData({
        ...record,
        id
    });

    await setDoc(doc(db, name, id), data);

    return data;
}

/* ACTUALIZAR */

export async function updateOne(
    collectionName,
    id,
    changes
) {
    await waitForAuth();

    const name = validateCollection(collectionName);

    const data = cleanData({ ...changes });
    delete data.id;

    await updateDoc(
        doc(db, name, String(id)),
        data
    );

    return getOne(collectionName, id);
}

/* ELIMINAR */

export async function deleteOne(collectionName, id) {
    await waitForAuth();

    const name = validateCollection(collectionName);

    await deleteDoc(
        doc(db, name, String(id))
    );

    return true;
}

/* CONSULTAS POR CAMPO */

export async function findByField(
    collectionName,
    field,
    value
) {
    await waitForAuth();

    const name = validateCollection(collectionName);

    const allowedFields = [
        "normalizedPhone",
        "customerId",
        "barberId",
        "serviceId",
        "status"
    ];

    if (!allowedFields.includes(field)) {
        throw new Error("Campo de consulta no permitido.");
    }

    const snapshot = await getDocs(
        query(
            collection(db, name),
            where(field, "==", value)
        )
    );

    return snapshot.docs.map(item => ({
        ...item.data(),
        id: item.id
    }));
}

/* CLIENTES */

export const getCustomers = () => getAll("customers");

export const getCustomer = id =>
    getOne("customers", id);

export async function saveCustomer(customer) {
    return saveOne("customers", {
        ...customer,
        normalizedPhone: normalizePhone(customer.phone)
    });
}

export const deleteCustomer = id =>
    deleteOne("customers", id);

/* BARBEROS */

export const getBarbers = () => getAll("barbers");

export const saveBarber = barber =>
    saveOne("barbers", barber);

export const deleteBarber = id =>
    deleteOne("barbers", id);

/* SERVICIOS */

export const getServices = () => getAll("services");

export const saveService = service =>
    saveOne("services", service);

export const deleteService = id =>
    deleteOne("services", id);

/* CITAS */

export const getAppointments = () =>
    getAll("appointments");

export const saveAppointment = appointment =>
    saveOne("appointments", appointment);

export const deleteAppointment = id =>
    deleteOne("appointments", id);
