import {
    demoCustomers,
    createDemoAppointments
} from "./data.js";


const CUSTOMER_KEY =
    "barbershop_customers";


const APPOINTMENT_KEY =
    "barbershop_appointments";


function clone(data) {

    return JSON.parse(
        JSON.stringify(data)
    );

}


function read(key, fallback) {

    const stored =
        localStorage.getItem(key);


    if (!stored) {

        const initialData =
            typeof fallback === "function"
                ? fallback()
                : clone(fallback);


        localStorage.setItem(
            key,
            JSON.stringify(initialData)
        );


        return initialData;

    }


    try {

        return JSON.parse(stored);

    } catch (error) {

        console.error(
            `Error leyendo ${key}`,
            error
        );


        const initialData =
            typeof fallback === "function"
                ? fallback()
                : clone(fallback);


        localStorage.setItem(
            key,
            JSON.stringify(initialData)
        );


        return initialData;

    }

}


function write(key, data) {

    localStorage.setItem(
        key,
        JSON.stringify(data)
    );

}


export function getCustomers() {

    return read(
        CUSTOMER_KEY,
        demoCustomers
    );

}


export function saveCustomers(customers) {

    write(
        CUSTOMER_KEY,
        customers
    );

}


export function getAppointments() {

    return read(
        APPOINTMENT_KEY,
        createDemoAppointments
    );

}


export function saveAppointments(
    appointments
) {

    write(
        APPOINTMENT_KEY,
        appointments
    );

}


export function normalizePhone(phone) {

    return String(
        phone || ""
    ).replace(
        /\D/g,
        ""
    );

}


export function findCustomerByPhone(
    phone
) {

    const normalized =
        normalizePhone(phone);


    return getCustomers().find(
        customer =>
            normalizePhone(
                customer.phone
            ) === normalized
    );

}


export function getOrCreateCustomer(
    name,
    phone
) {

    const customers =
        getCustomers();


    const normalized =
        normalizePhone(phone);


    let customer =
        customers.find(
            item =>
                normalizePhone(
                    item.phone
                ) === normalized
        );


    if (customer) {

        customer.name =
            name;


        saveCustomers(
            customers
        );


        return customer;

    }


    customer = {

        id:
            generateId(
                "customer"
            ),

        name,

        phone,

        visits: 0

    };


    customers.push(
        customer
    );


    saveCustomers(
        customers
    );


    return customer;

}


export function addCustomerVisit(
    phone
) {

    const customers =
        getCustomers();


    const normalized =
        normalizePhone(phone);


    const customer =
        customers.find(
            item =>
                normalizePhone(
                    item.phone
                ) === normalized
        );


    if (!customer) {
        return false;
    }


    customer.visits += 1;


    saveCustomers(
        customers
    );


    return true;

}


export function generateId(prefix) {

    return `${prefix}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;

}