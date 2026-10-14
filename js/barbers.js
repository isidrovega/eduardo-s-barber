
/* =========================================================
   EDUARDO'S BARBERSHOP
   BARBERS.JS

   Administración de barberos con Firebase Firestore.
   - Crear y editar barberos
   - Comisiones
   - Servicios
   - Horarios
   - Citas del día
   - Cuentas de acceso Firebase Authentication
========================================================= */

import {
    getBarbers,
    getServices,
    getAppointments,
    saveBarber as saveBarberToFirestore,
    updateBarber,
    generateId
} from "./firestore-storage.js";

import {
    createBarberAccount
} from "./barber-accounts.js";

/* =========================================================
   ESTADO
========================================================= */

let barbers = [];
let services = [];
let appointments = [];

let editingBarberId = null;
let isSaving = false;
let isCreatingAccount = false;
let isLoading = false;

let toastTimer = null;

const dayLabels = {
    monday: "Lunes",
    tuesday: "Martes",
    wednesday: "Miércoles",
    thursday: "Jueves",
    friday: "Viernes",
    saturday: "Sábado",
    sunday: "Domingo"
};

const defaultSchedule = {
    monday: {
        enabled: true,
        start: "09:00",
        end: "19:00"
    },
    tuesday: {
        enabled: true,
        start: "09:00",
        end: "19:00"
    },
    wednesday: {
        enabled: true,
        start: "09:00",
        end: "19:00"
    },
    thursday: {
        enabled: true,
        start: "09:00",
        end: "19:00"
    },
    friday: {
        enabled: true,
        start: "09:00",
        end: "19:00"
    },
    saturday: {
        enabled: true,
        start: "09:00",
        end: "17:00"
    },
    sunday: {
        enabled: false,
        start: "09:00",
        end: "17:00"
    }
};

/* =========================================================
   ELEMENTOS
========================================================= */

const $ = id => document.getElementById(id);

const barbersGrid = $("barbersGrid");
const barberSummary = $("barberSummary");
const barberModal = $("barberModal");

const barberName = $("barberName");
const barberPhone = $("barberPhone");
const barberActiveSwitch = $("barberActiveSwitch");
const barberCommission = $("barberCommission");
const commissionPreview = $("commissionPreview");

const barberServices = $("barberServices");
const scheduleEditor = $("scheduleEditor");
const barberModalAvatar = $("barberModalAvatar");
const barberModalTitle = $("barberModalTitle");

const newBarberButton = $("newBarberButton");
const closeBarberModalButton = $("closeBarberModal");
const cancelBarberButton = $("cancelBarberButton");
const saveBarberButton = $("saveBarberButton");

const barberAccountEmail = $("barberAccountEmail");
const barberAccountPassword = $("barberAccountPassword");
const createBarberAccountButton = $("createBarberAccountButton");
const barberAccountStatus = $("barberAccountStatus");

/* =========================================================
   UTILIDADES
========================================================= */

function escapeHTML(value) {
    const element = document.createElement("div");
    element.textContent = String(value ?? "");
    return element.innerHTML;
}

function getInitials(name) {
    return String(name || "")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join("") || "NB";
}

function getLocalDate() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function formatTime(time) {
    if (!time || !/^\d{2}:\d{2}$/.test(time)) {
        return "--:--";
    }

    const [hours, minutes] = time.split(":").map(Number);

    const period = hours >= 12 ? "PM" : "AM";
    const formattedHour = hours % 12 || 12;

    return `${formattedHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatCurrency(value) {
    return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN"
    }).format(Number(value) || 0);
}

function normalizeCommission(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return 50;
    }

    return Math.min(100, Math.max(0, number));
}

function getBarberCommission(barber) {
    return normalizeCommission(
        barber.commission ??
        barber.commissionPercentage ??
        barber.commissionRate ??
        50
    );
}

function createSchedule(overrides = {}) {
    const result = {};

    for (const day of Object.keys(dayLabels)) {
        result[day] = {
            ...defaultSchedule[day],
            ...(overrides?.[day] || {})
        };
    }

    return result;
}

function getTodaySchedule(barber) {
    const days = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday"
    ];

    const day = days[new Date().getDay()];

    return barber.schedule?.[day] || null;
}

function formatTodaySchedule(schedule) {
    if (!schedule || !schedule.enabled) {
        return "Descanso";
    }

    return `${formatTime(schedule.start)} — ${formatTime(schedule.end)}`;
}

function showToast(message) {
    const toast = $("toast");

    if (!toast) {
        console.info(message);
        return;
    }

    toast.textContent = message;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 4500);
}

function getErrorMessage(error) {
    if (error?.code === "permission-denied") {
        return "Firebase rechazó la operación. Revisa los permisos de Firestore.";
    }

    if (error?.code === "unavailable") {
        return "No se pudo conectar con Firebase. Revisa tu conexión.";
    }

    return error?.message || "Ocurrió un error inesperado.";
}

/* =========================================================
   FIREBASE
========================================================= */

async function loadData() {
    if (isLoading) {
        return;
    }

    isLoading = true;

    barbersGrid.innerHTML = `
        <div class="panel" style="grid-column: 1 / -1;">
            <div class="empty">Cargando barberos...</div>
        </div>
    `;

    try {
        const [loadedBarbers, loadedServices, loadedAppointments] =
            await Promise.all([
                getBarbers(),
                getServices(),
                getAppointments()
            ]);

        barbers = Array.isArray(loadedBarbers)
            ? loadedBarbers
            : [];

        services = Array.isArray(loadedServices)
            ? loadedServices
            : [];

        appointments = Array.isArray(loadedAppointments)
            ? loadedAppointments
            : [];

        renderSummary();
        renderBarbers();

    } catch (error) {
        console.error("Error al cargar barberos:", error);

        barbersGrid.innerHTML = `
            <div class="panel" style="grid-column: 1 / -1;">
                <div class="empty">
                    No se pudieron cargar los barberos.
                    Revisa la conexión y los permisos de Firebase.
                </div>
            </div>
        `;

        showToast(getErrorMessage(error));

    } finally {
        isLoading = false;
    }
}

async function refreshBarbers() {
    barbers = await getBarbers();
    renderSummary();
    renderBarbers();
}

/* =========================================================
   RESUMEN
========================================================= */

function renderSummary() {
    const active = barbers.filter(
        barber => barber.status === "active"
    );

    const today = active.filter(
        barber => getTodaySchedule(barber)?.enabled
    );

    barberSummary.innerHTML = `
        <div class="barber-summary-item">
            <strong>${barbers.length}</strong>
            <span>Barberos</span>
        </div>

        <div class="barber-summary-divider"></div>

        <div class="barber-summary-item">
            <strong>${active.length}</strong>
            <span>Activos</span>
        </div>

        <div class="barber-summary-divider"></div>

        <div class="barber-summary-item">
            <strong>${today.length}</strong>
            <span>Trabajando hoy</span>
        </div>
    `;
}

/* =========================================================
   CITAS
========================================================= */

function getAppointmentsToday(barberId) {
    const today = getLocalDate();

    return appointments.filter(appointment => {
        return (
            String(appointment.barberId) === String(barberId) &&
            appointment.date === today &&
            appointment.status !== "cancelled" &&
            appointment.status !== "no-show"
        );
    }).length;
}

/* =========================================================
   TARJETAS
========================================================= */

function renderBarbers() {
    if (!barbers.length) {
        barbersGrid.innerHTML = `
            <div class="panel" style="grid-column: 1 / -1;">
                <div class="empty">
                    No hay barberos registrados en Firestore.
                </div>
            </div>
        `;

        return;
    }

    barbersGrid.innerHTML = barbers.map(barber => {
        const active = barber.status === "active";

        const selectedServiceIds = Array.isArray(barber.serviceIds)
            ? barber.serviceIds
            : [];

        const serviceList = selectedServiceIds
            .map(id => services.find(
                service => String(service.id) === String(id)
            ))
            .filter(Boolean);

        const todaySchedule = getTodaySchedule(barber);
        const appointmentsToday = getAppointmentsToday(barber.id);
        const commission = getBarberCommission(barber);

        const servicesHTML = serviceList.length
            ? serviceList.map(service => `
                <span>${escapeHTML(service.name)}</span>
            `).join("")
            : "<span>Sin servicios</span>";

        return `
            <article
                class="modern-barber-card ${active ? "" : "is-inactive"}"
            >
                <div class="modern-barber-top">
                    <div class="modern-barber-person">
                        <div class="modern-barber-avatar">
                            ${escapeHTML(getInitials(barber.name))}
                        </div>

                        <div class="modern-barber-name">
                            <h3>${escapeHTML(barber.name)}</h3>
                            <span>Barbero</span>
                        </div>
                    </div>

                    <div class="modern-status ${active ? "active" : "inactive"}">
                        <span></span>
                        ${active ? "Activo" : "Inactivo"}
                    </div>
                </div>

                <div class="modern-barber-metrics">
                    <div>
                        <strong>${appointmentsToday}</strong>
                        <span>Citas hoy</span>
                    </div>

                    <div>
                        <strong>${commission}%</strong>
                        <span>Comisión</span>
                    </div>
                </div>

                <div class="modern-barber-schedule">
                    <span>Horario de hoy</span>

                    <strong>
                        ${active
                            ? formatTodaySchedule(todaySchedule)
                            : "No disponible"}
                    </strong>
                </div>

                <div class="modern-barber-services">
                    ${servicesHTML}
                </div>

                <div class="modern-barber-footer">
                    <span>
                        ${escapeHTML(barber.phone || "Sin teléfono")}
                    </span>

                    <button
                        type="button"
                        class="modern-edit-button"
                        data-action="edit"
                        data-id="${escapeHTML(barber.id)}"
                    >
                        Editar <span>→</span>
                    </button>
                </div>
            </article>
        `;
    }).join("");
}

/* =========================================================
   SERVICIOS
========================================================= */

function renderServices(selectedIds = []) {
    if (!services.length) {
        barberServices.innerHTML = `
            <p style="color: #929292;">
                No hay servicios registrados en Firestore.
                Agrega servicios antes de guardar un barbero.
            </p>
        `;

        return;
    }

    const selected = new Set(
        selectedIds.map(id => String(id))
    );

    barberServices.innerHTML = services.map(service => {
        const checked = selected.has(String(service.id));

        return `
            <label class="modern-service-option">
                <input
                    type="checkbox"
                    value="${escapeHTML(service.id)}"
                    ${checked ? "checked" : ""}
                >

                <span class="modern-service-check">✓</span>

                <div>
                    <strong>${escapeHTML(service.name)}</strong>

                    <small>
                        ${Number(service.duration) || 0} min ·
                        ${formatCurrency(service.price)}
                    </small>
                </div>
            </label>
        `;
    }).join("");
}

function collectServices() {
    return Array.from(
        barberServices.querySelectorAll(
            "input[type='checkbox']:checked"
        )
    ).map(input => input.value);
}

/* =========================================================
   HORARIOS
========================================================= */

function renderSchedule(schedule = createSchedule()) {
    const normalized = createSchedule(schedule);

    scheduleEditor.innerHTML = Object.entries(dayLabels)
        .map(([day, label]) => {
            const config = normalized[day];
            const enabled = Boolean(config.enabled);

            return `
                <div
                    class="modern-schedule-row ${enabled ? "" : "disabled"}"
                    data-day="${day}"
                >
                    <div class="modern-schedule-day">
                        <label class="modern-switch small">
                            <input
                                type="checkbox"
                                class="schedule-enabled"
                                aria-label="Trabaja el ${label}"
                                ${enabled ? "checked" : ""}
                            >

                            <span class="modern-switch-slider"></span>
                        </label>

                        <strong>${label}</strong>
                    </div>

                    <div class="modern-schedule-times">
                        ${enabled
                            ? `
                                <input
                                    type="time"
                                    class="schedule-start"
                                    value="${escapeHTML(config.start)}"
                                >

                                <span>→</span>

                                <input
                                    type="time"
                                    class="schedule-end"
                                    value="${escapeHTML(config.end)}"
                                >
                            `
                            : `
                                <span class="schedule-rest-label">
                                    Descanso
                                </span>

                                <input
                                    type="time"
                                    class="schedule-start"
                                    value="${escapeHTML(config.start)}"
                                    hidden
                                >

                                <input
                                    type="time"
                                    class="schedule-end"
                                    value="${escapeHTML(config.end)}"
                                    hidden
                                >
                            `}
                    </div>
                </div>
            `;
        })
        .join("");
}

function collectSchedule() {
    const result = {};

    scheduleEditor.querySelectorAll(
        ".modern-schedule-row"
    ).forEach(row => {
        const day = row.dataset.day;

        const enabled = row.querySelector(
            ".schedule-enabled"
        ).checked;

        const start = row.querySelector(
            ".schedule-start"
        )?.value || defaultSchedule[day].start;

        const end = row.querySelector(
            ".schedule-end"
        )?.value || defaultSchedule[day].end;

        result[day] = {
            enabled,
            start,
            end
        };
    });

    return result;
}

function updateScheduleState(checkbox) {
    const schedule = collectSchedule();
    const row = checkbox.closest(".modern-schedule-row");

    if (!row) {
        return;
    }

    schedule[row.dataset.day].enabled = checkbox.checked;

    renderSchedule(schedule);
}

function validateSchedule(schedule) {
    for (const [day, info] of Object.entries(schedule)) {
        if (!info.enabled) {
            continue;
        }

        if (!info.start || !info.end) {
            showToast(
                `Completa el horario de ${dayLabels[day]}.`
            );

            return false;
        }

        if (info.start >= info.end) {
            showToast(
                `La hora de salida debe ser posterior a la entrada en ${dayLabels[day]}.`
            );

            return false;
        }
    }

    return true;
}

/* =========================================================
   COMISIONES
========================================================= */

function updateCommissionPreview() {
    if (!commissionPreview || !barberCommission) {
        return;
    }

    const commission = normalizeCommission(
        barberCommission.value
    );

    const examplePrice = 200;
    const barberAmount = examplePrice * commission / 100;
    const businessAmount = examplePrice - barberAmount;

    commissionPreview.textContent =
        `Ejemplo: de un servicio de ${formatCurrency(examplePrice)}, ` +
        `el barbero recibe ${formatCurrency(barberAmount)} ` +
        `y la barbería recibe ${formatCurrency(businessAmount)}.`;
}

/* =========================================================
   CUENTAS DE ACCESO
========================================================= */

function updateBarberAccountUI(barber = null) {
    if (
        !barberAccountEmail ||
        !barberAccountPassword ||
        !createBarberAccountButton ||
        !barberAccountStatus
    ) {
        return;
    }

    const alreadyLinked = Boolean(barber?.authUid);
    const saved = Boolean(barber?.id);

    barberAccountEmail.value = barber?.accountEmail || "";
    barberAccountPassword.value = "";

    barberAccountEmail.disabled = alreadyLinked;
    barberAccountPassword.disabled = alreadyLinked;

    createBarberAccountButton.disabled =
        !saved || alreadyLinked || isCreatingAccount;

    if (alreadyLinked) {
        barberAccountStatus.textContent =
            "Cuenta vinculada: " +
            (barber.accountEmail || "correo no disponible");

    } else if (saved) {
        barberAccountStatus.textContent =
            "El barbero está guardado. Puedes crear su cuenta de acceso.";

    } else {
        barberAccountStatus.textContent =
            "Guarda primero al barbero para crear su cuenta.";
    }
}

async function handleCreateBarberAccount() {
    if (isCreatingAccount) {
        return;
    }

    if (!editingBarberId) {
        showToast("Primero guarda al barbero.");
        return;
    }

    if (
        !barberAccountEmail ||
        !barberAccountPassword ||
        !createBarberAccountButton
    ) {
        showToast(
            "Falta agregar la sección de cuenta en barberos.html."
        );

        return;
    }

    const email = barberAccountEmail.value.trim();
    const password = barberAccountPassword.value;

    if (!barberAccountEmail.checkValidity()) {
        showToast("Ingresa un correo electrónico válido.");
        barberAccountEmail.focus();
        return;
    }

    if (password.length < 12) {
        showToast(
            "La contraseña temporal debe tener al menos 12 caracteres."
        );

        barberAccountPassword.focus();
        return;
    }

    const barber = barbers.find(
        item => item.id === editingBarberId
    );

    if (!barber) {
        showToast("No se encontró el barbero en Firestore.");
        return;
    }

    if (barber.authUid) {
        showToast("Este barbero ya tiene una cuenta.");
        return;
    }

    isCreatingAccount = true;

    createBarberAccountButton.disabled = true;
    createBarberAccountButton.textContent = "Creando cuenta...";

    try {
        const account = await createBarberAccount({
            barberId: editingBarberId,
            email,
            password
        });

        barber.authUid = account.uid;
        barber.accountEmail = account.email;

        updateBarberAccountUI(barber);

        showToast(
            `Cuenta creada correctamente para ${barber.name}.`
        );

        renderBarbers();

    } catch (error) {
        console.error("Error al crear cuenta:", error);

        showToast(getErrorMessage(error));

        // Se consulta Firestore para detectar si la cuenta
        // se vinculó antes de que ocurriera el error.
        try {
            await refreshBarbers();

            const updated = barbers.find(
                item => item.id === editingBarberId
            );

            if (updated?.authUid) {
                updateBarberAccountUI(updated);
            } else {
                createBarberAccountButton.disabled = false;
            }

        } catch (refreshError) {
            console.error(
                "No se pudo verificar la vinculación:",
                refreshError
            );

            // Ante incertidumbre, no permitir otro intento
            // hasta recargar y revisar Firebase.
            createBarberAccountButton.disabled = true;
        }

    } finally {
        isCreatingAccount = false;

        createBarberAccountButton.textContent =
            "Crear cuenta de acceso";
    }
}

/* =========================================================
   FORMULARIO
========================================================= */

function updateModalAvatar() {
    barberModalAvatar.textContent = getInitials(
        barberName.value
    );
}

function openModal() {
    barberModal.classList.remove("hidden");
    document.body.classList.add("modal-open");

    setTimeout(() => {
        barberName.focus();
    }, 50);
}

function closeModal() {
    if (isSaving || isCreatingAccount) {
        return;
    }

    barberModal.classList.add("hidden");
    document.body.classList.remove("modal-open");

    editingBarberId = null;
}

function openNewBarber() {
    if (isLoading) {
        showToast("Espera a que termine la carga.");
        return;
    }

    editingBarberId = null;

    barberModalTitle.textContent = "Nuevo barbero";
    barberName.value = "";
    barberPhone.value = "";
    barberActiveSwitch.checked = true;

    barberModalAvatar.textContent = "NB";

    if (barberCommission) {
        barberCommission.value = "50";
    }

    renderServices(
        services.map(service => service.id)
    );

    renderSchedule(createSchedule());
    updateCommissionPreview();
    updateBarberAccountUI();

    saveBarberButton.textContent = "Guardar barbero";

    openModal();
}

function openEditBarber(id) {
    const barber = barbers.find(
        item => String(item.id) === String(id)
    );

    if (!barber) {
        showToast("No se encontró el barbero.");
        return;
    }

    editingBarberId = barber.id;

    barberModalTitle.textContent = barber.name;

    barberName.value = barber.name || "";
    barberPhone.value = barber.phone || "";

    barberActiveSwitch.checked =
        barber.status === "active";

    barberModalAvatar.textContent = getInitials(
        barber.name
    );

    if (barberCommission) {
        barberCommission.value = String(
            getBarberCommission(barber)
        );
    }

    renderServices(
        Array.isArray(barber.serviceIds)
            ? barber.serviceIds
            : []
    );

    renderSchedule(
        createSchedule(barber.schedule)
    );

    updateCommissionPreview();
    updateBarberAccountUI(barber);

    saveBarberButton.textContent = "Guardar cambios";

    openModal();
}

/* =========================================================
   GUARDAR BARBERO EN FIRESTORE
========================================================= */

async function saveBarber() {
    if (isSaving || isCreatingAccount) {
        return;
    }

    const name = barberName.value.trim();
    const phone = barberPhone.value.trim();

    if (!name) {
        showToast("Ingresa el nombre del barbero.");
        barberName.focus();
        return;
    }

    const selectedServices = collectServices();

    if (!selectedServices.length) {
        showToast("Selecciona al menos un servicio.");
        return;
    }

    const schedule = collectSchedule();

    if (!validateSchedule(schedule)) {
        return;
    }

    const commissionValue = barberCommission
        ? barberCommission.value
        : "50";

    if (
        commissionValue === "" ||
        !Number.isFinite(Number(commissionValue)) ||
        Number(commissionValue) < 0 ||
        Number(commissionValue) > 100
    ) {
        showToast("La comisión debe estar entre 0% y 100%.");
        barberCommission?.focus();
        return;
    }

    const commission = Number(commissionValue);

    const status = barberActiveSwitch.checked
        ? "active"
        : "inactive";

    const record = {
        name,
        phone,
        status,
        serviceIds: selectedServices,
        schedule,
        commission
    };

    isSaving = true;

    saveBarberButton.disabled = true;
    saveBarberButton.textContent = "Guardando...";

    try {
        let saved;

        if (editingBarberId) {
            // updateBarber conserva otros campos existentes,
            // incluidos authUid y accountEmail.
            saved = await updateBarber(
                editingBarberId,
                record
            );

            showToast(
                `${name} actualizado correctamente.`
            );

        } else {
            saved = await saveBarberToFirestore({
                id: generateId("barber"),
                ...record
            });

            showToast(
                `${name} fue agregado al equipo.`
            );
        }

        editingBarberId = saved.id;

        await refreshBarbers();

        // Cerrar el modal después de guardar.
        barberModal.classList.add("hidden");
        document.body.classList.remove("modal-open");

        editingBarberId = null;

    } catch (error) {
        console.error("Error al guardar barbero:", error);

        showToast(getErrorMessage(error));

    } finally {
        isSaving = false;

        saveBarberButton.disabled = false;
        saveBarberButton.textContent = "Guardar cambios";
    }
}

/* =========================================================
   EVENTOS
========================================================= */

function handleGridAction(event) {
    const button = event.target.closest("[data-action]");

    if (!button) {
        return;
    }

    if (button.dataset.action === "edit") {
        openEditBarber(button.dataset.id);
    }
}

function configureEvents() {
    newBarberButton.addEventListener(
        "click",
        openNewBarber
    );

    closeBarberModalButton.addEventListener(
        "click",
        closeModal
    );

    cancelBarberButton.addEventListener(
        "click",
        closeModal
    );

    saveBarberButton.addEventListener(
        "click",
        saveBarber
    );

    barbersGrid.addEventListener(
        "click",
        handleGridAction
    );

    scheduleEditor.addEventListener(
        "change",
        event => {
            if (
                event.target.matches(
                    ".schedule-enabled"
                )
            ) {
                updateScheduleState(event.target);
            }
        }
    );

    barberName.addEventListener(
        "input",
        updateModalAvatar
    );

    if (barberCommission) {
        barberCommission.addEventListener(
            "input",
            updateCommissionPreview
        );
    }

    if (createBarberAccountButton) {
        createBarberAccountButton.addEventListener(
            "click",
            handleCreateBarberAccount
        );
    }

    barberModal.addEventListener(
        "click",
        event => {
            if (event.target === barberModal) {
                closeModal();
            }
        }
    );

    document.addEventListener(
        "keydown",
        event => {
            if (
                event.key === "Escape" &&
                !barberModal.classList.contains("hidden")
            ) {
                closeModal();
            }
        }
    );
}

/* =========================================================
   INICIALIZACIÓN
========================================================= */

async function initialize() {
    const requiredElements = [
        barbersGrid,
        barberSummary,
        barberModal,
        barberName,
        barberPhone,
        barberActiveSwitch,
        barberServices,
        scheduleEditor,
        barberModalAvatar,
        barberModalTitle,
        newBarberButton,
        closeBarberModalButton,
        cancelBarberButton,
        saveBarberButton
    ];

    if (requiredElements.some(element => !element)) {
        console.error(
            "Faltan elementos obligatorios en barberos.html."
        );

        return;
    }

    configureEvents();
    updateCommissionPreview();

    await loadData();
}

initialize();
