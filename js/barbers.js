
import {
    getAppointments,
    getServices,
    getBarbers,
    saveBarber,
    generateId
} from "./firestore-storage.js";

import {
    protectPage
} from "./auth.js";

/* =====================================================
   EDUARDO'S BARBERSHOP
   BARBERS.JS

   - Firestore como única fuente de datos.
   - Sin localStorage.
   - Sin barberos predeterminados.
   - Conserva horarios y comisiones.
===================================================== */

/* =====================================================
   ESTADO
===================================================== */

let barbersData = [];
let servicesData = [];
let appointmentsData = [];

let editingBarberId = null;
let savingBarber = false;
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

/* =====================================================
   ELEMENTOS DEL DOM
===================================================== */

const barbersGrid =
    document.getElementById("barbersGrid");

const barberSummary =
    document.getElementById("barberSummary");

const barberModal =
    document.getElementById("barberModal");

const barberName =
    document.getElementById("barberName");

const barberPhone =
    document.getElementById("barberPhone");

const barberActiveSwitch =
    document.getElementById("barberActiveSwitch");

const barberServices =
    document.getElementById("barberServices");

const scheduleEditor =
    document.getElementById("scheduleEditor");

const barberModalAvatar =
    document.getElementById("barberModalAvatar");

const barberCommission =
    document.getElementById("barberCommission");

const commissionPreview =
    document.getElementById("commissionPreview");

const saveBarberButton =
    document.getElementById("saveBarberButton");

/* =====================================================
   INICIALIZACIÓN
===================================================== */

async function initialize() {
    const user = await protectPage("admin");

    if (!user) {
        return;
    }

    configureEvents();

    await loadData();
}

async function loadData() {
    try {
        const [
            barbers,
            services,
            appointments
        ] = await Promise.all([
            getBarbers(),
            getServices(),
            getAppointments()
        ]);

        barbersData = barbers;
        servicesData = services;
        appointmentsData = appointments;

        renderSummary();
        renderBarbers();

        console.info(
            "Barberos cargados desde Firebase:",
            barbersData.length
        );

    } catch (error) {
        console.error(
            "Error cargando datos de Firebase:",
            error
        );

        showToast(
            "No se pudieron cargar los datos de Firebase."
        );
    }
}

/* =====================================================
   HORARIOS PREDETERMINADOS DEL FORMULARIO
===================================================== */

function createSchedule(overrides = {}) {
    return {
        ...structuredClone(defaultSchedule),
        ...structuredClone(overrides)
    };
}

/* =====================================================
   EVENTOS
===================================================== */

function configureEvents() {
    document
        .getElementById("newBarberButton")
        .addEventListener(
            "click",
            openNewBarber
        );

    document
        .getElementById("closeBarberModal")
        .addEventListener(
            "click",
            closeModal
        );

    document
        .getElementById("cancelBarberButton")
        .addEventListener(
            "click",
            closeModal
        );

    saveBarberButton.addEventListener(
        "click",
        () => {
            void saveCurrentBarber();
        }
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
                updateScheduleState(
                    event.target
                );
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
                !barberModal.classList.contains(
                    "hidden"
                )
            ) {
                closeModal();
            }
        }
    );
}

/* =====================================================
   RESUMEN
===================================================== */

function renderSummary() {
    const active = barbersData.filter(
        barber => barber.status === "active"
    );

    const today = active.filter(
        barber => getTodaySchedule(barber)?.enabled
    );

    barberSummary.innerHTML = `
        <div class="barber-summary-item">
            <strong>${barbersData.length}</strong>
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

/* =====================================================
   TARJETAS DE BARBEROS
===================================================== */

function renderBarbers() {
    if (!barbersData.length) {
        barbersGrid.innerHTML = `
            <div
                class="panel"
                style="grid-column: 1 / -1;"
            >
                <div class="empty">
                    No hay barberos registrados.
                </div>
            </div>
        `;

        return;
    }

    barbersGrid.innerHTML = barbersData
        .map(barber => {
            const appointmentsToday =
                getAppointmentsToday(
                    barber.id,
                    appointmentsData
                );

            const todaySchedule =
                getTodaySchedule(barber);

            const serviceList = (
                barber.serviceIds || []
            )
                .map(id =>
                    servicesData.find(
                        service => service.id === id
                    )
                )
                .filter(Boolean);

            const barberId = escapeHTML(
                barber.id
            );

            return `
                <article
                    class="
                        modern-barber-card
                        ${
                            barber.status === "inactive"
                                ? "is-inactive"
                                : ""
                        }
                    "
                >
                    <div class="modern-barber-top">
                        <div class="modern-barber-person">
                            <div class="modern-barber-avatar">
                                ${getInitials(barber.name)}
                            </div>

                            <div class="modern-barber-name">
                                <h3>
                                    ${escapeHTML(barber.name)}
                                </h3>

                                <span>Barbero</span>
                            </div>
                        </div>

                        <div
                            class="
                                modern-status
                                ${
                                    barber.status === "active"
                                        ? "active"
                                        : "inactive"
                                }
                            "
                        >
                            <span></span>

                            ${
                                barber.status === "active"
                                    ? "Activo"
                                    : "Inactivo"
                            }
                        </div>
                    </div>

                    <div class="modern-barber-metrics">
                        <div>
                            <strong>
                                ${appointmentsToday}
                            </strong>

                            <span>Citas hoy</span>
                        </div>

                        <div>
                            <strong>
                                ${serviceList.length}
                            </strong>

                            <span>Servicios</span>
                        </div>
                    </div>

                    <div class="modern-barber-schedule">
                        <span>Horario de hoy</span>

                        <strong>
                            ${
                                barber.status === "inactive"
                                    ? "No disponible"
                                    : formatTodaySchedule(
                                        todaySchedule
                                    )
                            }
                        </strong>
                    </div>

                    <div class="modern-barber-services">
                        ${
                            serviceList.length
                                ? serviceList
                                    .map(service => `
                                        <span>
                                            ${escapeHTML(
                                                service.name
                                            )}
                                        </span>
                                    `)
                                    .join("")
                                : `
                                    <span>
                                        Sin servicios
                                    </span>
                                `
                        }
                    </div>

                    <div class="modern-barber-footer">
                        <span>
                            ${escapeHTML(
                                barber.phone ||
                                "Sin teléfono"
                            )}
                        </span>

                        <button
                            type="button"
                            class="modern-edit-button"
                            data-action="edit"
                            data-id="${barberId}"
                        >
                            Editar
                            <span>→</span>
                        </button>
                    </div>
                </article>
            `;
        })
        .join("");
}

/* =====================================================
   CITAS DE HOY
===================================================== */

function getAppointmentsToday(
    barberId,
    appointments
) {
    const today = getLocalDate();

    return appointments.filter(
        appointment =>
            appointment.barberId === barberId &&
            appointment.date === today &&
            appointment.status !== "cancelled" &&
            appointment.status !== "no-show"
    ).length;
}

/* =====================================================
   ACCIONES DE TARJETAS
===================================================== */

function handleGridAction(event) {
    const button = event.target.closest(
        "[data-action]"
    );

    if (!button) {
        return;
    }

    if (button.dataset.action === "edit") {
        openEditBarber(button.dataset.id);
    }
}

/* =====================================================
   NUEVO BARBERO
===================================================== */

function openNewBarber() {
    editingBarberId = null;

    document.getElementById(
        "barberModalTitle"
    ).textContent = "Nuevo barbero";

    barberName.value = "";
    barberPhone.value = "";
    barberActiveSwitch.checked = true;
    barberModalAvatar.textContent = "NB";

    setCommissionValue(50);

    renderServices([]);

    renderSchedule(
        createSchedule()
    );

    openModal();
}

/* =====================================================
   EDITAR BARBERO
===================================================== */

function openEditBarber(id) {
    const barber = barbersData.find(
        item => item.id === id
    );

    if (!barber) {
        showToast(
            "No se encontró el barbero."
        );

        return;
    }

    editingBarberId = barber.id;

    document.getElementById(
        "barberModalTitle"
    ).textContent = barber.name;

    barberName.value = barber.name;
    barberPhone.value = barber.phone || "";

    barberActiveSwitch.checked =
        barber.status === "active";

    barberModalAvatar.textContent =
        getInitials(barber.name);

    setCommissionValue(
        barber.commission ??
        barber.commissionPercentage ??
        barber.commissionRate ??
        50
    );

    renderServices(
        barber.serviceIds || []
    );

    renderSchedule(
        barber.schedule || createSchedule()
    );

    openModal();
}

/* =====================================================
   MODAL
===================================================== */

function openModal() {
    barberModal.classList.remove(
        "hidden"
    );

    document.body.classList.add(
        "modal-open"
    );

    setTimeout(() => {
        barberName.focus();
    }, 50);
}

function closeModal() {
    if (savingBarber) {
        return;
    }

    barberModal.classList.add(
        "hidden"
    );

    document.body.classList.remove(
        "modal-open"
    );

    editingBarberId = null;
}

/* =====================================================
   AVATAR
===================================================== */

function updateModalAvatar() {
    const value = barberName.value.trim();

    barberModalAvatar.textContent = value
        ? getInitials(value)
        : "NB";
}

/* =====================================================
   COMISIONES
===================================================== */

function getCommissionValue() {
    if (!barberCommission) {
        return null;
    }

    const value = Number(
        barberCommission.value
    );

    if (
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100
    ) {
        return null;
    }

    return value;
}

function setCommissionValue(value) {
    if (!barberCommission) {
        return;
    }

    barberCommission.value = String(value);

    updateCommissionPreview();
}

function updateCommissionPreview() {
    if (
        !barberCommission ||
        !commissionPreview
    ) {
        return;
    }

    const value = getCommissionValue();

    if (value === null) {
        return;
    }

    commissionPreview.textContent =
        `${value}%`;
}

/* =====================================================
   SERVICIOS
===================================================== */

function renderServices(selectedIds = []) {
    const activeServices = servicesData.filter(
        service => service.status === "active"
    );

    if (!activeServices.length) {
        barberServices.innerHTML = `
            <p class="module-empty-state">
                No hay servicios activos registrados.
                Primero crea un servicio en el módulo Servicios.
            </p>
        `;

        return;
    }

    barberServices.innerHTML = activeServices
        .map(service => `
            <label class="modern-service-option">
                <input
                    type="checkbox"
                    value="${escapeHTML(service.id)}"
                    ${
                        selectedIds.includes(service.id)
                            ? "checked"
                            : ""
                    }
                >

                <span class="modern-service-check">
                    ✓
                </span>

                <div>
                    <strong>
                        ${escapeHTML(service.name)}
                    </strong>

                    <small>
                        ${Number(service.duration)} min ·
                        ${formatMoney(service.price)}
                    </small>
                </div>
            </label>
        `)
        .join("");
}

/* =====================================================
   HORARIOS
===================================================== */

function renderSchedule(schedule) {
    scheduleEditor.innerHTML = Object
        .entries(dayLabels)
        .map(([day, label]) => {
            const config =
                schedule[day] ||
                defaultSchedule[day];

            return `
                <div
                    class="
                        modern-schedule-row
                        ${
                            config.enabled
                                ? ""
                                : "disabled"
                        }
                    "
                    data-day="${day}"
                >
                    <div class="modern-schedule-day">
                        <label class="modern-switch small">
                            <input
                                type="checkbox"
                                class="schedule-enabled"
                                ${
                                    config.enabled
                                        ? "checked"
                                        : ""
                                }
                            >

                            <span
                                class="modern-switch-slider"
                            ></span>
                        </label>

                        <strong>${label}</strong>
                    </div>

                    <div class="modern-schedule-times">
                        ${
                            config.enabled
                                ? `
                                    <input
                                        type="time"
                                        class="schedule-start"
                                        value="${config.start}"
                                    >

                                    <span>→</span>

                                    <input
                                        type="time"
                                        class="schedule-end"
                                        value="${config.end}"
                                    >
                                `
                                : `
                                    <span
                                        class="schedule-rest-label"
                                    >
                                        Descanso
                                    </span>

                                    <input
                                        type="time"
                                        class="schedule-start"
                                        value="${config.start}"
                                        hidden
                                    >

                                    <input
                                        type="time"
                                        class="schedule-end"
                                        value="${config.end}"
                                        hidden
                                    >
                                `
                        }
                    </div>
                </div>
            `;
        })
        .join("");
}

function updateScheduleState(checkbox) {
    const schedule = collectSchedule();

    const row = checkbox.closest(
        ".modern-schedule-row"
    );

    const day = row.dataset.day;

    schedule[day].enabled =
        checkbox.checked;

    renderSchedule(schedule);
}

function collectSchedule() {
    const result = {};

    scheduleEditor
        .querySelectorAll(
            ".modern-schedule-row"
        )
        .forEach(row => {
            const day = row.dataset.day;

            const enabled =
                row.querySelector(
                    ".schedule-enabled"
                ).checked;

            const startInput =
                row.querySelector(
                    ".schedule-start"
                );

            const endInput =
                row.querySelector(
                    ".schedule-end"
                );

            result[day] = {
                enabled,

                start:
                    startInput?.value ||
                    defaultSchedule[day].start,

                end:
                    endInput?.value ||
                    defaultSchedule[day].end
            };
        });

    return result;
}

/* =====================================================
   GUARDAR BARBERO EN FIRESTORE
===================================================== */

async function saveCurrentBarber() {
    if (savingBarber) {
        return;
    }

    const name = barberName.value.trim();
    const phone = barberPhone.value.trim();

    if (!name) {
        showToast(
            "Ingresa el nombre del barbero."
        );

        barberName.focus();
        return;
    }

    const selectedServices = Array.from(
        barberServices.querySelectorAll(
            "input[type='checkbox']:checked"
        )
    ).map(checkbox => checkbox.value);

    if (!selectedServices.length) {
        showToast(
            "Selecciona al menos un servicio."
        );
        return;
    }

    const schedule = collectSchedule();

    if (!validateSchedule(schedule)) {
        return;
    }

    const commission = getCommissionValue();

    if (
        barberCommission &&
        commission === null
    ) {
        showToast(
            "La comisión debe estar entre 0 y 100%."
        );

        barberCommission.focus();
        return;
    }

    const status =
        barberActiveSwitch.checked
            ? "active"
            : "inactive";

    const previous = editingBarberId
        ? barbersData.find(
            item => item.id === editingBarberId
        )
        : null;

    if (editingBarberId && !previous) {
        showToast(
            "No se encontró el barbero."
        );
        return;
    }

    const isEditing = Boolean(previous);

    const record = {
        ...(previous || {}),
        id: previous?.id || generateId("barber"),
        name,
        phone,
        status,
        serviceIds: selectedServices,
        schedule,
        commission: commission ??
            previous?.commission ??
            50,
        createdAt: previous?.createdAt ||
            new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    savingBarber = true;
    saveBarberButton.disabled = true;

    const originalButtonText =
        saveBarberButton.textContent;

    saveBarberButton.textContent =
        "Guardando...";

    try {
        await saveBarber(record);

        const [
            updatedBarbers,
            updatedServices,
            updatedAppointments
        ] = await Promise.all([
            getBarbers(),
            getServices(),
            getAppointments()
        ]);

        barbersData = updatedBarbers;
        servicesData = updatedServices;
        appointmentsData = updatedAppointments;

        savingBarber = false;
        closeModal();

        renderSummary();
        renderBarbers();

        showToast(
            isEditing
                ? `${name} actualizado en Firebase.`
                : `${name} agregado a Firebase.`
        );

    } catch (error) {
        console.error(
            "Error guardando barbero:",
            error
        );

        showToast(
            "No se pudo guardar el barbero en Firebase."
        );
    } finally {
        savingBarber = false;
        saveBarberButton.disabled = false;
        saveBarberButton.textContent =
            originalButtonText;
    }
}

/* =====================================================
   VALIDACIÓN DE HORARIOS
===================================================== */

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
                `Revisa el horario de ${dayLabels[day]}.`
            );
            return false;
        }
    }

    return true;
}

/* =====================================================
   HORARIO DE HOY
===================================================== */

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

    const today = days[
        new Date().getDay()
    ];

    return barber.schedule?.[today] || null;
}

function formatTodaySchedule(schedule) {
    if (!schedule || !schedule.enabled) {
        return "Descanso";
    }

    return (
        `${formatTime(schedule.start)} — ` +
        `${formatTime(schedule.end)}`
    );
}

/* =====================================================
   FECHA LOCAL
===================================================== */

function getLocalDate() {
    const now = new Date();

    const year = now.getFullYear();

    const month = String(
        now.getMonth() + 1
    ).padStart(2, "0");

    const day = String(
        now.getDate()
    ).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

/* =====================================================
   FORMATO DE HORA
===================================================== */

function formatTime(time) {
    const [hours, minutes] =
        time.split(":").map(Number);

    const period =
        hours >= 12 ? "PM" : "AM";

    const formattedHour =
        hours % 12 || 12;

    return (
        `${formattedHour}:` +
        `${String(minutes).padStart(2, "0")} ` +
        period
    );
}

/* =====================================================
   FORMATO DE DINERO
===================================================== */

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

/* =====================================================
   INICIALES
===================================================== */

function getInitials(name) {
    return String(name)
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part =>
            part.charAt(0).toUpperCase()
        )
        .join("");
}

/* =====================================================
   SEGURIDAD HTML
===================================================== */

function escapeHTML(value) {
    const element =
        document.createElement("div");

    element.textContent =
        String(value ?? "");

    return element.innerHTML;
}

/* =====================================================
   NOTIFICACIONES
===================================================== */

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

/* =====================================================
   INICIAR
===================================================== */

void initialize();
