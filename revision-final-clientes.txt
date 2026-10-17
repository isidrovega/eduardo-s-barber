
/* =========================================================
   EDUARDO'S BARBERSHOP
   CUSTOMERS.JS
   CLIENTES CON FIREBASE FIRESTORE
   Sin datos de demostración
========================================================= */

import {
    getCustomers,
    getAppointments,
    getBarbers,
    getServices,
    saveCustomer,
    normalizePhone,
    generateId
} from "./firestore-storage.js";

/* =========================================================
   ESTADO
========================================================= */

let customers = [];
let appointments = [];
let barbers = [];
let services = [];

let selectedCustomerId = null;
let searchTerm = "";
let toastTimer = null;
let isSaving = false;

/* =========================================================
   ELEMENTOS
========================================================= */

const customersGrid =
    document.getElementById("customersGrid");

const customerSearch =
    document.getElementById("customerSearch");

const customerResultCount =
    document.getElementById("customerResultCount");

const customerModal =
    document.getElementById("customerModal");

const newCustomerModal =
    document.getElementById("newCustomerModal");

const closeCustomerModalButton =
    document.getElementById("closeCustomerModal");

const closeNewCustomerModalButton =
    document.getElementById("closeNewCustomerModal");

const newCustomerButton =
    document.getElementById("newCustomerButton");

const cancelNewCustomerButton =
    document.getElementById("cancelNewCustomer");

const saveNewCustomerButton =
    document.getElementById("saveNewCustomer");

const bookCustomerButton =
    document.getElementById("bookCustomerButton");

/* =========================================================
   INICIALIZACIÓN
========================================================= */

async function initialize() {
    configureEvents();

    customersGrid.innerHTML = `
        <div class="panel" style="grid-column: 1 / -1;">
            <div class="empty">
                Cargando clientes...
            </div>
        </div>
    `;

    await loadData();
}

/* =========================================================
   CARGAR DATOS DESDE FIRESTORE
========================================================= */

async function loadData() {
    try {
        const [
            customersData,
            appointmentsData,
            barbersData,
            servicesData
        ] = await Promise.all([
            getCustomers(),
            getAppointments(),
            getBarbers(),
            getServices()
        ]);

        customers = customersData;
        appointments = appointmentsData;
        barbers = barbersData;
        services = servicesData;

        renderCustomers();
        renderStats();

    } catch (error) {
        console.error(
            "Error cargando datos de Firestore:",
            error
        );

        customersGrid.innerHTML = `
            <div class="panel" style="grid-column: 1 / -1;">
                <div class="empty">
                    No se pudieron cargar los clientes.
                    Verifica tu sesión y los permisos de Firebase.
                </div>
            </div>
        `;

        customerResultCount.textContent =
            "Error de conexión";

        showToast(
            "Error al conectar con Firebase."
        );
    }
}

/* =========================================================
   EVENTOS
========================================================= */

function configureEvents() {
    customerSearch.addEventListener("input", event => {
        searchTerm = event.target.value
            .trim()
            .toLowerCase();

        renderCustomers();
    });

    newCustomerButton.addEventListener(
        "click",
        openNewCustomerModal
    );

    closeCustomerModalButton.addEventListener(
        "click",
        event => {
            event.preventDefault();
            event.stopPropagation();
            closeCustomerModal();
        }
    );

    closeNewCustomerModalButton.addEventListener(
        "click",
        event => {
            event.preventDefault();
            event.stopPropagation();
            closeNewCustomerModal();
        }
    );

    cancelNewCustomerButton.addEventListener(
        "click",
        event => {
            event.preventDefault();
            closeNewCustomerModal();
        }
    );

    saveNewCustomerButton.addEventListener(
        "click",
        saveNewCustomer
    );

    bookCustomerButton.addEventListener(
        "click",
        bookSelectedCustomer
    );

    customersGrid.addEventListener(
        "click",
        handleCustomerGridClick
    );

    customerModal.addEventListener(
        "click",
        event => {
            if (event.target === customerModal) {
                closeCustomerModal();
            }
        }
    );

    newCustomerModal.addEventListener(
        "click",
        event => {
            if (event.target === newCustomerModal) {
                closeNewCustomerModal();
            }
        }
    );

    document.addEventListener(
        "keydown",
        event => {
            if (event.key !== "Escape") {
                return;
            }

            if (
                !customerModal.classList.contains("hidden")
            ) {
                closeCustomerModal();
                return;
            }

            if (
                !newCustomerModal.classList.contains("hidden")
            ) {
                closeNewCustomerModal();
            }
        }
    );
}

/* =========================================================
   MODALES
========================================================= */

function openCustomerModalElement() {
    customerModal.classList.remove("hidden");
    document.body.classList.add("modal-open");
}

function closeCustomerModal() {
    customerModal.classList.add("hidden");
    selectedCustomerId = null;
    unlockBodyIfNecessary();
}

function openNewCustomerModal() {
    document.getElementById("newCustomerName").value = "";
    document.getElementById("newCustomerPhone").value = "";

    newCustomerModal.classList.remove("hidden");
    document.body.classList.add("modal-open");

    setTimeout(() => {
        document.getElementById("newCustomerName").focus();
    }, 50);
}

function closeNewCustomerModal() {
    newCustomerModal.classList.add("hidden");
    unlockBodyIfNecessary();
}

function unlockBodyIfNecessary() {
    const customerClosed =
        customerModal.classList.contains("hidden");

    const newCustomerClosed =
        newCustomerModal.classList.contains("hidden");

    if (customerClosed && newCustomerClosed) {
        document.body.classList.remove("modal-open");
    }
}

/* =========================================================
   ESTADÍSTICAS
========================================================= */

function renderStats() {
    const completed = appointments.filter(
        appointment =>
            appointment.status === "completed"
    );

    const frequent = customers.filter(
        customer =>
            Number(customer.visits || 0) >= 3
    );

    const totalVisits = customers.reduce(
        (total, customer) =>
            total + Number(customer.visits || 0),
        0
    );

    document.getElementById("customerStats").innerHTML = [
        statCard("Total clientes", customers.length),
        statCard("Clientes frecuentes", frequent.length),
        statCard("Citas completadas", completed.length),
        statCard("Visitas registradas", totalVisits)
    ].join("");
}

/* =========================================================
   LISTADO DE CLIENTES
========================================================= */

function renderCustomers() {
    const filtered = customers.filter(customer => {
        if (!searchTerm) {
            return true;
        }

        const name = String(customer.name || "")
            .toLowerCase();

        const phone = normalizePhone(customer.phone);

        const normalizedSearch =
            normalizePhone(searchTerm);

        return (
            name.includes(searchTerm) ||
            (
                normalizedSearch.length > 0 &&
                phone.includes(normalizedSearch)
            )
        );
    });

    customerResultCount.textContent =
        `${filtered.length} ${
            filtered.length === 1
                ? "cliente"
                : "clientes"
        }`;

    if (!filtered.length) {
        customersGrid.innerHTML = `
            <div class="panel" style="grid-column: 1 / -1;">
                <div class="empty">
                    ${
                        searchTerm
                            ? "No se encontraron clientes."
                            : "Todavía no hay clientes registrados."
                    }
                </div>
            </div>
        `;

        return;
    }

    customersGrid.innerHTML = filtered.map(customer => {
        const customerAppointments =
            getCustomerAppointments(
                customer,
                appointments
            );

        const lastAppointment =
            getLastAppointment(customerAppointments);

        return `
            <article class="customer-card">
                <div class="customer-card-top">
                    <div class="customer-avatar">
                        ${escapeHTML(
                            getInitials(customer.name)
                        )}
                    </div>

                    <div class="customer-card-name">
                        <h3>
                            ${escapeHTML(customer.name)}
                        </h3>

                        <p>
                            ${escapeHTML(customer.phone)}
                        </p>
                    </div>
                </div>

                <div class="customer-card-info">
                    <div class="customer-info-box">
                        <span>Visitas</span>
                        <strong>
                            ${Number(customer.visits) || 0}
                        </strong>
                    </div>

                    <div class="customer-info-box">
                        <span>Última cita</span>
                        <strong>
                            ${
                                lastAppointment
                                    ? formatDate(
                                        lastAppointment.date
                                    )
                                    : "—"
                            }
                        </strong>
                    </div>
                </div>

                <div class="customer-card-actions">
                    <button
                        type="button"
                        class="btn btn-outline"
                        data-action="view"
                        data-customer-id="${
                            escapeHTML(customer.id)
                        }"
                    >
                        Ver cliente
                    </button>

                    <button
                        type="button"
                        class="btn btn-dark"
                        data-action="book"
                        data-customer-id="${
                            escapeHTML(customer.id)
                        }"
                    >
                        Agendar
                    </button>
                </div>
            </article>
        `;
    }).join("");
}

/* =========================================================
   ACCIONES DE TARJETAS
========================================================= */

function handleCustomerGridClick(event) {
    const button =
        event.target.closest("[data-action]");

    if (!button) {
        return;
    }

    const customerId = button.dataset.customerId;
    const action = button.dataset.action;

    if (action === "view") {
        openCustomerModal(customerId);
        return;
    }

    if (action === "book") {
        selectedCustomerId = customerId;
        bookSelectedCustomer();
    }
}

/* =========================================================
   DETALLE DEL CLIENTE
========================================================= */

function openCustomerModal(customerId) {
    const customer = customers.find(
        item => item.id === customerId
    );

    if (!customer) {
        showToast("No se encontró el cliente.");
        return;
    }

    selectedCustomerId = customer.id;

    const customerAppointments =
        getCustomerAppointments(
            customer,
            appointments
        );

    const completed = customerAppointments.filter(
        appointment =>
            appointment.status === "completed"
    ).length;

    const cancelled = customerAppointments.filter(
        appointment =>
            appointment.status === "cancelled"
    ).length;

    document.getElementById(
        "customerModalName"
    ).textContent = customer.name;

    document.getElementById(
        "customerModalPhone"
    ).textContent = customer.phone;

    document.getElementById(
        "modalVisits"
    ).textContent = Number(customer.visits) || 0;

    document.getElementById(
        "modalAppointments"
    ).textContent = customerAppointments.length;

    document.getElementById(
        "modalCompleted"
    ).textContent = completed;

    document.getElementById(
        "modalCancelled"
    ).textContent = cancelled;

    renderCustomerHistory(customerAppointments);
    openCustomerModalElement();
}

/* =========================================================
   HISTORIAL DE CITAS
========================================================= */

function renderCustomerHistory(customerAppointments) {
    const container =
        document.getElementById("customerHistory");

    if (!customerAppointments.length) {
        container.innerHTML = `
            <div class="empty">
                Este cliente todavía no tiene citas registradas.
            </div>
        `;

        return;
    }

    const sorted = [...customerAppointments].sort(
        (a, b) =>
            `${b.date} ${b.time}`.localeCompare(
                `${a.date} ${a.time}`
            )
    );

    container.innerHTML = sorted.map(appointment => {
        const service = getService(appointment.serviceId);
        const barber = getBarber(appointment.barberId);

        return `
            <div class="history-row">
                <div class="history-date">
                    <strong>
                        ${formatDate(appointment.date)}
                    </strong>

                    <span>
                        ${formatTime(appointment.time)}
                    </span>
                </div>

                <div class="history-service">
                    <strong>
                        ${escapeHTML(service.name)}
                    </strong>

                    <span>
                        $${escapeHTML(service.price)}
                        ·
                        ${escapeHTML(service.duration)} min
                    </span>
                </div>

                <div class="history-barber">
                    ${escapeHTML(barber.name)}
                </div>

                <div class="history-status">
                    ${renderStatus(appointment.status)}
                </div>
            </div>
        `;
    }).join("");
}

/* =========================================================
   AGENDAR CITA
========================================================= */

function bookSelectedCustomer() {
    if (!selectedCustomerId) {
        return;
    }

    const customer = customers.find(
        item => item.id === selectedCustomerId
    );

    if (!customer) {
        showToast("No se encontró el cliente.");
        return;
    }

    sessionStorage.setItem(
        "barbershop_booking_customer",
        JSON.stringify({
            id: customer.id,
            name: customer.name,
            phone: customer.phone
        })
    );

    window.location.href = "citas.html?new=1";
}

/* =========================================================
   REGISTRAR NUEVO CLIENTE
========================================================= */

async function saveNewCustomer() {
    if (isSaving) {
        return;
    }

    const name = document.getElementById(
        "newCustomerName"
    ).value.trim();

    const phone = document.getElementById(
        "newCustomerPhone"
    ).value.trim();

    if (!name) {
        showToast("Ingresa el nombre del cliente.");
        return;
    }

    if (normalizePhone(phone).length < 7) {
        showToast("Ingresa un teléfono válido.");
        return;
    }

    const normalized = normalizePhone(phone);

    const exists = customers.some(
        customer =>
            normalizePhone(customer.phone) === normalized
    );

    if (exists) {
        showToast(
            "Ya existe un cliente con ese teléfono."
        );
        return;
    }

    isSaving = true;
    saveNewCustomerButton.disabled = true;

    try {
        await saveCustomer({
            id: generateId("customer"),
            name,
            phone,
            visits: 0
        });

        await loadData();

        closeNewCustomerModal();

        showToast(
            `${name} fue registrado correctamente.`
        );

    } catch (error) {
        console.error(
            "Error guardando cliente:",
            error
        );

        showToast(
            "No se pudo guardar el cliente en Firebase."
        );

    } finally {
        isSaving = false;
        saveNewCustomerButton.disabled = false;
    }
}

/* =========================================================
   CITAS DEL CLIENTE
========================================================= */

function getCustomerAppointments(
    customer,
    customerAppointments
) {
    const customerPhone =
        normalizePhone(customer.phone);

    return customerAppointments.filter(appointment => {
        if (
            appointment.customerId &&
            appointment.customerId === customer.id
        ) {
            return true;
        }

        return (
            customerPhone.length > 0 &&
            normalizePhone(appointment.phone) ===
                customerPhone
        );
    });
}

/* =========================================================
   ÚLTIMA CITA
========================================================= */

function getLastAppointment(customerAppointments) {
    if (!customerAppointments.length) {
        return null;
    }

    return [...customerAppointments].sort(
        (a, b) =>
            `${b.date} ${b.time}`.localeCompare(
                `${a.date} ${a.time}`
            )
    )[0];
}

/* =========================================================
   INICIALES
========================================================= */

function getInitials(name) {
    return String(name || "")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part =>
            part.charAt(0).toUpperCase()
        )
        .join("");
}

/* =========================================================
   SERVICIO
========================================================= */

function getService(id) {
    return services.find(
        service => service.id === id
    ) || {
        name: "Servicio no disponible",
        price: "—",
        duration: "—"
    };
}

/* =========================================================
   BARBERO
========================================================= */

function getBarber(id) {
    return barbers.find(
        barber => barber.id === id
    ) || {
        name: "Barbero no disponible"
    };
}

/* =========================================================
   FORMATO DE FECHA
========================================================= */

function formatDate(dateString) {
    if (!dateString) {
        return "—";
    }

    const date = new Date(
        `${dateString}T12:00:00`
    );

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return new Intl.DateTimeFormat("es-MX", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    }).format(date);
}

/* =========================================================
   FORMATO DE HORA
========================================================= */

function formatTime(time) {
    if (!time) {
        return "—";
    }

    const [hours, minutes] = String(time)
        .split(":")
        .map(Number);

    if (
        !Number.isFinite(hours) ||
        !Number.isFinite(minutes)
    ) {
        return "—";
    }

    const period = hours >= 12 ? "PM" : "AM";
    const hour = hours % 12 || 12;

    return `${
        hour
    }:${
        String(minutes).padStart(2, "0")
    } ${period}`;
}

/* =========================================================
   ESTADOS
========================================================= */

function renderStatus(status) {
    const labels = {
        pending: "Pendiente",
        confirmed: "Confirmada",
        completed: "Completada",
        cancelled: "Cancelada",
        "no-show": "No asistió"
    };

    const safeStatus = String(status || "pending");

    return `
        <span class="status ${escapeHTML(safeStatus)}">
            ${
                escapeHTML(
                    labels[safeStatus] || safeStatus
                )
            }
        </span>
    `;
}

/* =========================================================
   TARJETA DE ESTADÍSTICA
========================================================= */

function statCard(label, value) {
    return `
        <article class="stat-card">
            <span>
                ${escapeHTML(label)}
            </span>

            <strong>
                ${escapeHTML(value)}
            </strong>
        </article>
    `;
}

/* =========================================================
   SEGURIDAD HTML
========================================================= */

function escapeHTML(value) {
    const element =
        document.createElement("div");

    element.textContent =
        String(value ?? "");

    return element.innerHTML;
}

/* =========================================================
   NOTIFICACIONES
========================================================= */

function showToast(message) {
    const toast =
        document.getElementById("toast");

    if (!toast) {
        console.log(message);
        return;
    }

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2800);
}

/* =========================================================
   INICIAR
========================================================= */

initialize();
