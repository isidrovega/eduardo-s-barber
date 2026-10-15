
import {
    getServices,
    saveService as saveServiceToFirestore,
    getAppointments,
    generateId
} from "./firestore-storage.js";

/* =========================================================
   EDUARDO'S BARBERSHOP
   SERVICES.JS

   - Firebase Firestore como fuente de datos.
   - Sin localStorage.
   - Sin servicios predeterminados.
   - Conserva el diseño original.
========================================================= */

/* =========================================================
   ESTADO
========================================================= */

let servicesData = [];
let appointmentsData = [];

let editingServiceId = null;
let savingService = false;
let toastTimer = null;

/* =========================================================
   DOM
========================================================= */

const servicesGrid =
    document.getElementById("servicesGrid");

const serviceSummary =
    document.getElementById("serviceSummary");

const serviceModal =
    document.getElementById("serviceModal");

const serviceModalTitle =
    document.getElementById("serviceModalTitle");

const serviceName =
    document.getElementById("serviceName");

const servicePrice =
    document.getElementById("servicePrice");

const serviceDuration =
    document.getElementById("serviceDuration");

const serviceActiveSwitch =
    document.getElementById("serviceActiveSwitch");

const newServiceButton =
    document.getElementById("newServiceButton");

const closeServiceModalButton =
    document.getElementById("closeServiceModal");

const cancelServiceButton =
    document.getElementById("cancelServiceButton");

const saveServiceButton =
    document.getElementById("saveServiceButton");

/* =========================================================
   INICIALIZACIÓN
========================================================= */

async function initialize() {
    configureEvents();
    await loadData();
}

/* =========================================================
   CARGAR DATOS DESDE FIRESTORE
========================================================= */

async function loadData() {
    try {
        const [services, appointments] =
            await Promise.all([
                getServices(),
                getAppointments()
            ]);

        servicesData = services;
        appointmentsData = appointments;

        renderAll();

        console.info(
            "Servicios cargados desde Firebase:",
            servicesData.length
        );

    } catch (error) {
        console.error(
            "Error cargando servicios desde Firebase:",
            error
        );

        showToast(
            "No se pudieron cargar los servicios de Firebase."
        );
    }
}

/* =========================================================
   EVENTOS
========================================================= */

function configureEvents() {
    newServiceButton.addEventListener(
        "click",
        openNewService
    );

    closeServiceModalButton.addEventListener(
        "click",
        closeModal
    );

    cancelServiceButton.addEventListener(
        "click",
        closeModal
    );

    saveServiceButton.addEventListener(
        "click",
        () => {
            void saveCurrentService();
        }
    );

    servicesGrid.addEventListener(
        "click",
        handleServiceAction
    );

    serviceName.addEventListener(
        "input",
        updateModalTitle
    );

    serviceModal.addEventListener(
        "click",
        event => {
            if (event.target === serviceModal) {
                closeModal();
            }
        }
    );

    document.addEventListener(
        "keydown",
        event => {
            if (
                event.key === "Escape" &&
                !serviceModal.classList.contains("hidden")
            ) {
                closeModal();
            }
        }
    );
}

/* =========================================================
   RENDERIZADO GENERAL
========================================================= */

function renderAll() {
    renderSummary();
    renderServices();
}

/* =========================================================
   RESUMEN
========================================================= */

function renderSummary() {
    const activeServices = servicesData.filter(
        service => service.status === "active"
    );

    const completedAppointments =
        appointmentsData.filter(
            appointment =>
                appointment.status === "completed"
        );

    const revenue =
        completedAppointments.reduce(
            (total, appointment) => {
                const service = servicesData.find(
                    item =>
                        item.id === appointment.serviceId
                );

                return total +
                    Number(service?.price || 0);
            },
            0
        );

    serviceSummary.innerHTML = `
        <div class="module-summary-item">
            <strong>${servicesData.length}</strong>
            <span>Servicios</span>
        </div>

        <div class="module-summary-divider"></div>

        <div class="module-summary-item">
            <strong>${activeServices.length}</strong>
            <span>Activos</span>
        </div>

        <div class="module-summary-divider"></div>

        <div class="module-summary-item">
            <strong>${completedAppointments.length}</strong>
            <span>Realizados</span>
        </div>

        <div class="module-summary-divider"></div>

        <div class="module-summary-item">
            <strong>${formatMoney(revenue)}</strong>
            <span>Ingresos</span>
        </div>
    `;
}

/* =========================================================
   LISTA DE SERVICIOS
========================================================= */

function renderServices() {
    if (!servicesData.length) {
        servicesGrid.innerHTML = `
            <div class="module-empty-state">
                <div class="module-empty-icon">
                    ✂
                </div>

                <strong>
                    No hay servicios
                </strong>

                <p>
                    Agrega el primer servicio de la barbería.
                </p>

                <button
                    type="button"
                    class="btn btn-dark"
                    id="emptyNewServiceButton"
                >
                    + Nuevo servicio
                </button>
            </div>
        `;

        document
            .getElementById("emptyNewServiceButton")
            ?.addEventListener(
                "click",
                openNewService
            );

        return;
    }

    servicesGrid.innerHTML = servicesData
        .map(service => {
            const completed =
                appointmentsData.filter(
                    appointment =>
                        appointment.serviceId === service.id &&
                        appointment.status === "completed"
                );

            const revenue =
                completed.length *
                Number(service.price || 0);

            return createServiceCard(
                service,
                completed.length,
                revenue
            );
        })
        .join("");
}

/* =========================================================
   TARJETA DE SERVICIO
========================================================= */

function createServiceCard(
    service,
    completedCount,
    revenue
) {
    const isActive =
        service.status === "active";

    return `
        <article
            class="
                unified-card
                ${isActive ? "" : "is-inactive"}
            "
        >
            <div class="unified-card-header">
                <div class="unified-card-person">
                    <div class="unified-card-avatar">
                        ✂
                    </div>

                    <div class="unified-card-title">
                        <h3>
                            ${escapeHTML(service.name)}
                        </h3>

                        <span>
                            Servicio
                        </span>
                    </div>
                </div>

                <div
                    class="
                        unified-status
                        ${isActive ? "active" : "inactive"}
                    "
                >
                    <span></span>

                    ${
                        isActive
                            ? "Activo"
                            : "Inactivo"
                    }
                </div>
            </div>

            <div class="unified-card-metrics">
                <div>
                    <span>Precio</span>

                    <strong>
                        ${formatMoney(service.price)}
                    </strong>
                </div>

                <div>
                    <span>Duración</span>

                    <strong>
                        ${Number(service.duration)} min
                    </strong>
                </div>
            </div>

            <div class="unified-card-detail">
                <span>Actividad</span>

                <strong>
                    ${completedCount}
                    ${
                        completedCount === 1
                            ? "servicio realizado"
                            : "servicios realizados"
                    }
                </strong>

                <small>
                    ${formatMoney(revenue)}
                    generados
                </small>
            </div>

            <div class="unified-card-footer">
                <span>
                    ${
                        isActive
                            ? "Disponible para citas"
                            : "No disponible para citas"
                    }
                </span>

                <button
                    type="button"
                    class="modern-edit-button"
                    data-action="edit"
                    data-id="${escapeHTML(service.id)}"
                >
                    Editar
                    <span>→</span>
                </button>
            </div>
        </article>
    `;
}

/* =========================================================
   ACCIONES DE TARJETAS
========================================================= */

function handleServiceAction(event) {
    const button = event.target.closest(
        "[data-action]"
    );

    if (!button) {
        return;
    }

    if (button.dataset.action === "edit") {
        openEditService(button.dataset.id);
    }
}

/* =========================================================
   NUEVO SERVICIO
========================================================= */

function openNewService() {
    editingServiceId = null;

    serviceModalTitle.textContent =
        "Nuevo servicio";

    serviceName.value = "";
    servicePrice.value = "";
    serviceDuration.value = "30";
    serviceActiveSwitch.checked = true;

    openModal();
}

/* =========================================================
   EDITAR SERVICIO
========================================================= */

function openEditService(id) {
    const service = servicesData.find(
        item => item.id === id
    );

    if (!service) {
        showToast(
            "No se encontró el servicio."
        );
        return;
    }

    editingServiceId = service.id;

    serviceName.value = service.name;
    servicePrice.value = service.price;
    serviceDuration.value = service.duration;

    serviceActiveSwitch.checked =
        service.status === "active";

    serviceModalTitle.textContent =
        service.name;

    openModal();
}

/* =========================================================
   MODAL
========================================================= */

function openModal() {
    serviceModal.classList.remove(
        "hidden"
    );

    document.body.classList.add(
        "modal-open"
    );

    setTimeout(() => {
        serviceName.focus();
    }, 50);
}

function closeModal() {
    if (savingService) {
        return;
    }

    serviceModal.classList.add(
        "hidden"
    );

    document.body.classList.remove(
        "modal-open"
    );

    editingServiceId = null;
}

/* =========================================================
   TÍTULO DEL MODAL
========================================================= */

function updateModalTitle() {
    if (!editingServiceId) {
        return;
    }

    const name = serviceName.value.trim();

    serviceModalTitle.textContent =
        name || "Editar servicio";
}

/* =========================================================
   GUARDAR SERVICIO EN FIRESTORE
========================================================= */

async function saveCurrentService() {
    if (savingService) {
        return;
    }

    const name = serviceName.value.trim();

    const priceText = servicePrice.value.trim();
    const durationText = serviceDuration.value.trim();

    const price = Number(priceText);
    const duration = Number(durationText);

    if (!name) {
        showToast(
            "Ingresa el nombre del servicio."
        );

        serviceName.focus();
        return;
    }

    if (
        !priceText ||
        !Number.isFinite(price) ||
        price < 0
    ) {
        showToast(
            "Ingresa un precio válido."
        );

        servicePrice.focus();
        return;
    }

    if (
        !durationText ||
        !Number.isFinite(duration) ||
        duration < 5
    ) {
        showToast(
            "La duración debe ser de al menos 5 minutos."
        );

        serviceDuration.focus();
        return;
    }

    const duplicate = servicesData.find(
        service =>
            service.id !== editingServiceId &&
            service.name
                .trim()
                .toLowerCase() ===
                name.toLowerCase()
    );

    if (duplicate) {
        showToast(
            "Ya existe un servicio con ese nombre."
        );

        serviceName.focus();
        return;
    }

    const status =
        serviceActiveSwitch.checked
            ? "active"
            : "inactive";

    const previous = editingServiceId
        ? servicesData.find(
            service =>
                service.id === editingServiceId
        )
        : null;

    if (editingServiceId && !previous) {
        showToast(
            "No se encontró el servicio."
        );
        return;
    }

    const isEditing = Boolean(previous);

    const now = new Date().toISOString();

    const record = {
        ...(previous || {}),
        id: previous?.id || generateId("service"),
        name,
        price,
        duration,
        status,
        createdAt: previous?.createdAt || now,
        updatedAt: now
    };

    savingService = true;

    saveServiceButton.disabled = true;

    const originalButtonText =
        saveServiceButton.textContent;

    saveServiceButton.textContent =
        "Guardando...";

    try {
        await saveServiceToFirestore(record);

        servicesData = await getServices();

        savingService = false;

        closeModal();
        renderAll();

        showToast(
            isEditing
                ? "Servicio actualizado en Firebase."
                : "Servicio agregado a Firebase."
        );

    } catch (error) {
        console.error(
            "Error guardando servicio en Firestore:",
            error
        );

        showToast(
            "No se pudo guardar el servicio en Firebase."
        );

    } finally {
        savingService = false;

        saveServiceButton.disabled = false;

        saveServiceButton.textContent =
            originalButtonText;
    }
}

/* =========================================================
   FORMATO DE DINERO
========================================================= */

function formatMoney(value) {
    return new Intl.NumberFormat(
        "es-MX",
        {
            style: "currency",
            currency: "MXN",
            maximumFractionDigits: 0
        }
    ).format(
        Number(value) || 0
    );
}

/* =========================================================
   ESCAPAR HTML
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
        console.info(message);
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

void initialize();
