
/* =========================================================
   EDUARDO'S BARBERSHOP
   STORAGE.JS
   SIN CLIENTES NI CITAS DE DEMOSTRACIÓN
========================================================= */

const CUSTOMER_KEY = "barbershop_customers";
const APPOINTMENT_KEY = "barbershop_appointments";

/* =========================================================
   UTILIDADES DE ALMACENAMIENTO
========================================================= */

function read(key) {
    const stored = localStorage.getItem(key);

    if (stored === null) {
        return [];
    }

    try {
        const data = JSON.parse(stored);

        if (!Array.isArray(data)) {
            console.warn(
                `Los datos de ${key} no son un arreglo válido.`
            );

            return [];
        }

        return data;
    } catch (error) {
        console.error(
            `Error leyendo ${key}:`,
            error
        );

        return [];
    }
}

function write(key, data) {
    if (!Array.isArray(data)) {
        throw new TypeError(
            "Los datos que se guardan deben ser un arreglo."
        );
    }

    localStorage.setItem(
        key,
        JSON.stringify(data)
    );
}

/* =========================================================
   CLIENTES
========================================================= */

export function getCustomers() {
    return read(CUSTOMER_KEY);
}

export function saveCustomers(customers) {
    write(CUSTOMER_KEY, customers);
}

/* =========================================================
   CITAS
========================================================= */

export function getAppointments() {
    return read(APPOINTMENT_KEY);
}

export function saveAppointments(appointments) {
    write(APPOINTMENT_KEY, appointments);
}

/* =========================================================
   UTILIDADES DE CLIENTES
========================================================= */

export function normalizePhone(phone) {
    return String(phone ?? "").replace(/\D/g, "");
}

export function findCustomerByPhone(phone) {
    const normalized = normalizePhone(phone);

    if (!normalized) {
        return undefined;
    }

    return getCustomers().find(
        customer =>
            normalizePhone(customer.phone) === normalized
    );
}

export function getOrCreateCustomer(name, phone) {
    const customers = getCustomers();
    const normalized = normalizePhone(phone);

    if (!normalized) {
        throw new Error(
            "El cliente debe tener un teléfono válido."
        );
    }

    let customer = customers.find(
        item =>
            normalizePhone(item.phone) === normalized
    );

    if (customer) {
        customer.name = name;
        customer.phone = phone;

        saveCustomers(customers);

        return customer;
    }

    customer = {
        id: generateId("customer"),
        name,
        phone,
        visits: 0
    };

    customers.push(customer);
    saveCustomers(customers);

    return customer;
}

/* =========================================================
   REGISTRAR VISITAS
========================================================= */

export function addCustomerVisit(phone) {
    const customers = getCustomers();
    const normalized = normalizePhone(phone);

    if (!normalized) {
        return false;
    }

    const customer = customers.find(
        item =>
            normalizePhone(item.phone) === normalized
    );

    if (!customer) {
        return false;
    }

    customer.visits =
        (Number(customer.visits) || 0) + 1;

    saveCustomers(customers);

    return true;
}

/* =========================================================
   GENERADOR DE IDENTIFICADORES
========================================================= */

export function generateId(prefix = "item") {
    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    ) {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return (
        `${prefix}-${Date.now()}-` +
        Math.random().toString(16).slice(2)
    );
}
