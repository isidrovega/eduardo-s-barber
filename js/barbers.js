
import { services } from "./data.js";

import {
    getAppointments,
    generateId
} from "./storage.js";

import {
    getBarbers as getBarbersFromFirestore,
    saveBarber as saveBarberToFirestore
} from "./firestore-storage.js";

/* =====================================================
   CONFIGURACIÓN
===================================================== */

const STORAGE_KEY = "barbershop_barbers";

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
   ELEMENTOS
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

async function loadBarbersFromFirebase() {
    try {
        const firebaseBarbers =
            await getBarbersFromFirestore();

        if (!Array.isArray(firebaseBarbers)) {
            throw new Error(
                "Firebase no devolvió una lista válida."
            );
        }

        /*
         * Los datos locales se conservan.
         * Firebase tiene prioridad cuando coincide el ID.
         *
         * Esta lectura NO sube automáticamente los
         * barberos antiguos que solo existen localmente.
         */
        const localBarbers = getBarbers();

        const mergedBarbers = new Map(
            localBarbers
                .filter(barber => barber && barber.id)
                .map(barber => [barber.id, barber])
        );

        for (const barber of firebaseBarbers) {
            if (barber && barber.id) {
                mergedBarbers.set(barber.id, barber);
            }
        }

        /*
         * Evitar que una lectura antigua de Firebase
         * sobrescriba cambios realizados mientras
         * estaba abierta la página.
         */
        if (savingBarber || editingBarberId) {
            console.info(
                "Lectura de Firebase aplazada para proteger cambios en curso."
            );
            return;
        }

        saveBarbers(
            Array.from(mergedBarbers.values())
        );

        renderSummary();
        renderBarbers();

        console.info(
            "Barberos cargados desde Firebase:",
            firebaseBarbers.length
        );
    } catch (error) {
        console.error(
            "No se pudieron cargar los barberos desde Firebase:",
            error
        );

        showToast(
            "No se pudo consultar Firebase. Se conservan los datos locales."
        );
    }
}

function initialize() {
    configureEvents();

    // Mostrar inmediatamente los barberos locales.
    renderSummary();
    renderBarbers();

    // Consultar Firebase sin bloquear la interfaz.
    void loadBarbersFromFirebase();
}

/* =====================================================
   ALMACENAMIENTO LOCAL
===================================================== */

function getBarbers() {
    try {
        const stored = JSON.parse(
            localStorage.getItem(STORAGE_KEY)
        );

        return Array.isArray(stored)
            ? stored
            : [];
    } catch (error) {
        console.error(
            "Error al consultar barberos locales:",
            error
        );

        return [];
    }
}

function saveBarbers(barbers) {
    localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(barbers)
    );
}

/* =====================================================
   FIREBASE
===================================================== */

async function syncBarberWithFirestore(barber) {
    try {
        await saveBarberToFirestore(barber);

        console.info(
            "Barbero sincronizado con Firestore:",
            barber.id
        );

        return true;
    } catch (error) {
        console.error(
            "Error al sincronizar barbero con Firestore:",
            error
        );

        return false;
    }
}

/* =====================================================
   HORARIOS BASE
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
        .addEventListener("click", openNewBarber);

    document
        .getElementById("closeBarberModal")
        .addEventListener("click", closeModal);

    document
        .getElementById("cancelBarberButton")
        .addEventListener("click", closeModal);

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
    const barbers = getBarbers();

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

/* =====================================================
   TARJETAS DE BARBEROS
===================================================== */

function renderBarbers() {
    const barbers = getBarbers();
    const appointments = getAppointments();

    if (!barbers.length) {
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

    barbersGrid.innerHTML = barbers
        .map(barber => {
            const appointmentsToday =
                getAppointmentsToday(
                    barber.id,
                    appointments
                );

            const todaySchedule =
                getTodaySchedule(barber);

            const serviceList = (
                barber.serviceIds || []
            )
                .map(id =>
                    services.find(
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

    renderServices(
        services.map(service => service.id)
    );

    renderSchedule(
        createSchedule()
    );

    openModal();
}

/* =====================================================
   EDITAR BARBERO
===================================================== */

function openEditBarber(id) {
    const barber = getBarbers().find(
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

function renderServices(selectedIds) {
    barberServices.innerHTML = services
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
                        ${service.duration} min ·
                        $${service.price}
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
   GUARDAR BARBERO
===================================================== */

async function saveBarber() {
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

    const barbers = getBarbers();

    const status =
        barberActiveSwitch.checked
            ? "active"
            : "inactive";

    const isEditing = Boolean(
        editingBarberId
    );

    let savedBarber;

    if (isEditing) {
        const index = barbers.findIndex(
            item => item.id === editingBarberId
        );

        if (index === -1) {
            showToast(
                "No se encontró el barbero."
            );

            return;
        }

        savedBarber = {
            ...barbers[index],
            name,
            phone,
            status,
            serviceIds: selectedServices,
            schedule
        };

        if (commission !== null) {
            savedBarber.commission = commission;
        }

        barbers[index] = savedBarber;
    } else {
        savedBarber = {
            id: generateId("barber"),
            name,
            phone,
            status,
            serviceIds: selectedServices,
            schedule
        };

        if (commission !== null) {
            savedBarber.commission = commission;
        }

        barbers.push(savedBarber);
    }

    savingBarber = true;

    saveBarberButton.disabled = true;

    const originalButtonText =
        saveBarberButton.textContent;

    saveBarberButton.textContent =
        "Guardando...";

    try {
        /*
         * Primero se conserva el registro local.
         * Después se intenta sincronizar con Firestore.
         */
        saveBarbers(barbers);

        const synced = await syncBarberWithFirestore(
            savedBarber
        );

        if (synced) {
            showToast(
                isEditing
                    ? `${name} actualizado en Firebase.`
                    : `${name} agregado a Firebase.`
            );
        } else {
            showToast(
                "Guardado localmente. Firebase no se sincronizó."
            );
        }

        renderSummary();
        renderBarbers();

        /*
         * Restablecemos el estado antes de cerrar.
         */
        savingBarber = false;
        closeModal();
    } catch (error) {
        console.error(
            "Error al guardar barbero:",
            error
        );

        showToast(
            "No se pudo completar el guardado."
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
    for (
        const [day, info]
        of Object.entries(schedule)
    ) {
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

initialize();
