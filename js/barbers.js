
/* =========================================================
   EDUARDO'S BARBERSHOP
   BARBERS.JS
   FIRESTORE + COMISIONES + CUENTAS DE ACCESO
========================================================= */

import {
    getBarbers,
    getServices,
    getAppointments,
    saveBarber,
    generateId
} from "./firestore-storage.js";

import {
    createBarberAccount
} from "./barber-accounts.js";

import {
    auth,
    db
} from "./firebase.js";

import {
    collection,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

/* =========================================================
   ESTADO
========================================================= */

let barbers = [];
let services = [];
let appointments = [];

let editingBarberId = null;
let saving = false;
let creatingAccount = false;
let toastTimer = null;

const accountStatusByBarber = new Map();

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

const barberServices = $("barberServices");
const scheduleEditor = $("scheduleEditor");

const barberModalAvatar = $("barberModalAvatar");
const barberModalTitle = $("barberModalTitle");

const barberCommission = $("barberCommission");
const commissionPreview = $("commissionPreview");

const saveBarberButton = $("saveBarberButton");

const barberAccountEmail = $("barberAccountEmail");
const barberAccountPassword = $("barberAccountPassword");
const createBarberAccountButton = $(
    "createBarberAccountButton"
);
const barberAccountMessage = $("barberAccountMessage");

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
    barberCommission,
    commissionPreview,
    saveBarberButton,
    barberAccountEmail,
    barberAccountPassword,
    createBarberAccountButton,
    barberAccountMessage
];

/* =========================================================
   INICIALIZACIÓN
========================================================= */

async function initialize() {
    if (requiredElements.some(element => !element)) {
        console.error(
            "Faltan elementos del formulario en barberos.html."
        );
        return;
    }

    configureEvents();

    barberSummary.innerHTML = "";

    barbersGrid.innerHTML = `
        <div class="empty-state">
            <span class="empty-state-icon">✂</span>
            <h3>Cargando barberos...</h3>
            <p>Consultando Firebase.</p>
        </div>
    `;

    await loadData();
}

/* =========================================================
   FIRESTORE
========================================================= */

async function loadData() {
    try {
        const [
            barbersData,
            servicesData,
            appointmentsData
        ] = await Promise.all([
            getBarbers(),
            getServices(),
            getAppointments()
        ]);

        barbers = barbersData;
        services = servicesData;
        appointments = appointmentsData;

        renderSummary();
        renderBarbers();

    } catch (error) {
        console.error(
            "Error cargando barberos:",
            error
        );

        barbersGrid.innerHTML = `
            <div class="empty-state">
                <span class="empty-state-icon">!</span>
                <h3>No se pudieron cargar los barberos</h3>
                <p>
                    Verifica tu sesión y los permisos
                    de Firebase.
                </p>
            </div>
        `;

        showToast(
            "No se pudo conectar con Firebase.",
            "error"
        );
    }
}

/* =========================================================
   EVENTOS
========================================================= */

function configureEvents() {
    $("newBarberButton").addEventListener(
        "click",
        openNewBarber
    );

    $("closeBarberModal").addEventListener(
        "click",
        closeModal
    );

    $("cancelBarberButton").addEventListener(
        "click",
        closeModal
    );

    saveBarberButton.addEventListener(
        "click",
        handleSaveBarber
    );

    createBarberAccountButton.addEventListener(
        "click",
        handleCreateBarberAccount
    );

    barberCommission.addEventListener(
        "input",
        updateCommissionPreview
    );

    barberName.addEventListener(
        "input",
        updateModalAvatar
    );

    barberActiveSwitch.addEventListener(
        "change",
        updateAccountButton
    );

    barberAccountEmail.addEventListener(
        "input",
        updateAccountButton
    );

    barberAccountPassword.addEventListener(
        "input",
        updateAccountButton
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
                barberModal.classList.contains("active")
            ) {
                closeModal();
            }
        }
    );
}

/* =========================================================
   RESUMEN
========================================================= */

function renderSummary() {
    const active = barbers.filter(
        barber => barber.status === "active"
    );

    const workingToday = active.filter(
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
            <strong>${workingToday.length}</strong>
            <span>Trabajando hoy</span>
        </div>
    `;
}

/* =========================================================
   TARJETAS
========================================================= */

function renderBarbers() {
    if (!barbers.length) {
        barbersGrid.innerHTML = `
            <div class="empty-state">
                <span class="empty-state-icon">✂</span>
                <h3>No hay barberos registrados</h3>
                <p>
                    Presiona Nuevo barbero para
                    agregar al primer integrante.
                </p>
            </div>
        `;
        return;
    }

    barbersGrid.innerHTML = barbers.map(barber => {
        const appointmentsToday = getAppointmentsToday(
            barber.id
        );

        const todaySchedule = getTodaySchedule(barber);

        const serviceList = (
            barber.serviceIds || []
        ).map(id => {
            return services.find(
                service => service.id === id
            );
        }).filter(Boolean);

        const active = barber.status === "active";

        const commission = Number(
            barber.commissionPercent ?? 50
        );

        return `
            <article class="modern-barber-card ${
                active ? "" : "is-inactive"
            }">

                <div class="modern-barber-top">

                    <div class="modern-barber-person">

                        <div class="modern-barber-avatar">
                            ${escapeHTML(
                                getInitials(barber.name)
                            )}
                        </div>

                        <div class="modern-barber-name">
                            <h3>
                                ${escapeHTML(barber.name)}
                            </h3>
                            <span>Barbero</span>
                        </div>

                    </div>

                    <div class="modern-status ${
                        active ? "active" : "inactive"
                    }">
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
                        <strong>${serviceList.length}</strong>
                        <span>Servicios</span>
                    </div>

                    <div>
                        <strong>${commission}%</strong>
                        <span>Comisión</span>
                    </div>

                </div>

                <div class="modern-barber-schedule">
                    <span>Horario de hoy</span>

                    <strong>
                        ${
                            active
                                ? formatTodaySchedule(
                                    todaySchedule
                                )
                                : "No disponible"
                        }
                    </strong>
                </div>

                <div class="modern-barber-services">
                    ${
                        serviceList.length
                            ? serviceList.map(service => `
                                <span>
                                    ${escapeHTML(service.name)}
                                </span>
                            `).join("")
                            : "<span>Sin servicios</span>"
                    }
                </div>

                <div class="modern-barber-footer">

                    <span>
                        ${escapeHTML(
                            barber.phone || "Sin teléfono"
                        )}
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
   CITAS DE HOY
========================================================= */

function getAppointmentsToday(barberId) {
    const today = getLocalDate();

    return appointments.filter(appointment => {
        return (
            appointment.barberId === barberId &&
            appointment.date === today &&
            appointment.status !== "cancelled" &&
            appointment.status !== "no-show"
        );
    }).length;
}

/* =========================================================
   ACCIONES DE TARJETAS
========================================================= */

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

/* =========================================================
   NUEVO BARBERO
========================================================= */

function openNewBarber() {
    editingBarberId = null;

    barberModalTitle.textContent = "Nuevo barbero";

    barberName.value = "";
    barberPhone.value = "";

    barberActiveSwitch.checked = true;
    barberCommission.value = "50";

    barberModalAvatar.textContent = "NB";

    renderServices(
        services.map(service => service.id)
    );

    renderSchedule(createSchedule());

    resetAccountForm();

    setAccountMessage(
        "Primero guarda el barbero. Después edítalo para crear su cuenta."
    );

    updateCommissionPreview();
    updateAccountButton();

    openModal();
}

/* =========================================================
   EDITAR BARBERO
========================================================= */

async function openEditBarber(id) {
    const barber = barbers.find(
        item => item.id === id
    );

    if (!barber) {
        showToast(
            "No se encontró el barbero.",
            "error"
        );
        return;
    }

    editingBarberId = barber.id;

    barberModalTitle.textContent = barber.name;

    barberName.value = barber.name;
    barberPhone.value = barber.phone || "";

    barberActiveSwitch.checked =
        barber.status === "active";

    barberCommission.value =
        barber.commissionPercent ?? 50;

    barberModalAvatar.textContent =
        getInitials(barber.name);

    renderServices(barber.serviceIds || []);

    renderSchedule(
        createSchedule(barber.schedule || {})
    );

    resetAccountForm();
    updateCommissionPreview();
    updateAccountButton();

    openModal();

    await loadAccountStatus(barber.id);
}

/* =========================================================
   MODAL
========================================================= */

function openModal() {
    barberModal.classList.remove("hidden");
    barberModal.classList.add("active");

    barberModal.setAttribute(
        "aria-hidden",
        "false"
    );

    document.body.classList.add("modal-open");

    setTimeout(() => barberName.focus(), 50);
}

function closeModal() {
    if (saving || creatingAccount) {
        return;
    }

    barberModal.classList.remove("active");
    barberModal.classList.add("hidden");

    barberModal.setAttribute(
        "aria-hidden",
        "true"
    );

    document.body.classList.remove("modal-open");

    editingBarberId = null;
}

/* =========================================================
   AVATAR
========================================================= */

function updateModalAvatar() {
    barberModalAvatar.textContent =
        getInitials(barberName.value) || "NB";
}

/* =========================================================
   COMISIONES
========================================================= */

function updateCommissionPreview() {
    const percentage = Number(
        barberCommission.value
    );

    if (
        barberCommission.value.trim() === "" ||
        !Number.isFinite(percentage) ||
        percentage < 0 ||
        percentage > 100
    ) {
        commissionPreview.textContent =
            "Ingresa un porcentaje entre 0 y 100.";
        return;
    }

    const examplePrice = 200;

    const earnings =
        examplePrice * percentage / 100;

    commissionPreview.textContent =
        `Ejemplo: de un servicio de $200, ` +
        `el barbero recibe $${earnings.toFixed(2)}.`;
}

/* =========================================================
   SERVICIOS
========================================================= */

function renderServices(selectedIds = []) {
    if (!services.length) {
        barberServices.innerHTML = `
            <div class="empty-state">
                <p>
                    No hay servicios registrados.
                    Crea primero un servicio.
                </p>
            </div>
        `;
        return;
    }

    barberServices.innerHTML = services.map(service => `
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

            <span class="modern-service-check">✓</span>

            <div>
                <strong>
                    ${escapeHTML(service.name)}
                </strong>

                <small>
                    ${escapeHTML(service.duration)} min ·
                    $${escapeHTML(service.price)}
                </small>
            </div>

        </label>
    `).join("");
}

/* =========================================================
   HORARIOS
========================================================= */

function createSchedule(overrides = {}) {
    const result = structuredClone(
        defaultSchedule
    );

    for (const [day, config] of Object.entries(overrides)) {
        if (
            Object.prototype.hasOwnProperty.call(
                result,
                day
            )
        ) {
            result[day] = {
                ...result[day],
                ...config
            };
        }
    }

    return result;
}

function renderSchedule(schedule) {
    scheduleEditor.innerHTML = Object.entries(
        dayLabels
    ).map(([day, label]) => {
        const config =
            schedule[day] || defaultSchedule[day];

        return `
            <div
                class="modern-schedule-row ${
                    config.enabled ? "" : "disabled"
                }"
                data-day="${day}"
            >

                <div class="modern-schedule-day">

                    <label class="modern-switch small">

                        <input
                            type="checkbox"
                            class="schedule-enabled"
                            ${config.enabled ? "checked" : ""}
                        >

                        <span
                            class="modern-switch-slider"
                        ></span>

                    </label>

                    <strong>${label}</strong>

                </div>

                <div class="modern-schedule-times">

                    <input
                        type="time"
                        class="schedule-start"
                        value="${escapeHTML(config.start)}"
                        ${config.enabled ? "" : "hidden"}
                    >

                    ${
                        config.enabled
                            ? "<span>→</span>"
                            : `<span class="schedule-rest-label">
                                Descanso
                               </span>`
                    }

                    <input
                        type="time"
                        class="schedule-end"
                        value="${escapeHTML(config.end)}"
                        ${config.enabled ? "" : "hidden"}
                    >

                </div>

            </div>
        `;
    }).join("");
}

function updateScheduleState(checkbox) {
    const schedule = collectSchedule();

    const row = checkbox.closest(
        ".modern-schedule-row"
    );

    schedule[row.dataset.day].enabled =
        checkbox.checked;

    renderSchedule(schedule);
}

function collectSchedule() {
    const result = {};

    scheduleEditor.querySelectorAll(
        ".modern-schedule-row"
    ).forEach(row => {
        const day = row.dataset.day;

        result[day] = {
            enabled: row.querySelector(
                ".schedule-enabled"
            ).checked,

            start: row.querySelector(
                ".schedule-start"
            ).value || defaultSchedule[day].start,

            end: row.querySelector(
                ".schedule-end"
            ).value || defaultSchedule[day].end
        };
    });

    return result;
}

function validateSchedule(schedule) {
    for (const [day, info] of Object.entries(schedule)) {
        if (!info.enabled) {
            continue;
        }

        if (!info.start || !info.end) {
            showToast(
                `Completa el horario de ${dayLabels[day]}.`,
                "error"
            );
            return false;
        }

        if (info.start >= info.end) {
            showToast(
                `Revisa el horario de ${dayLabels[day]}.`,
                "error"
            );
            return false;
        }
    }

    return true;
}

/* =========================================================
   GUARDAR BARBERO
========================================================= */

async function handleSaveBarber() {
    if (saving || creatingAccount) {
        return;
    }

    const name = barberName.value.trim();
    const phone = barberPhone.value.trim();

    if (!name) {
        showToast(
            "Ingresa el nombre del barbero.",
            "error"
        );
        barberName.focus();
        return;
    }

    const commissionPercent = Number(
        barberCommission.value
    );

    if (
        barberCommission.value.trim() === "" ||
        !Number.isFinite(commissionPercent) ||
        commissionPercent < 0 ||
        commissionPercent > 100
    ) {
        showToast(
            "La comisión debe estar entre 0% y 100%.",
            "error"
        );
        barberCommission.focus();
        return;
    }

    const selectedServices = Array.from(
        barberServices.querySelectorAll(
            "input[type='checkbox']:checked"
        )
    ).map(checkbox => checkbox.value);

    if (!selectedServices.length) {
        showToast(
            "Selecciona al menos un servicio.",
            "error"
        );
        return;
    }

    const schedule = collectSchedule();

    if (!validateSchedule(schedule)) {
        return;
    }

    const existing = editingBarberId
        ? barbers.find(
            item => item.id === editingBarberId
        )
        : null;

    if (editingBarberId && !existing) {
        showToast(
            "No se encontró el barbero.",
            "error"
        );
        return;
    }

    const barber = {
        ...(existing || {}),
        id: editingBarberId || generateId("barber"),
        name,
        phone,
        status: barberActiveSwitch.checked
            ? "active"
            : "inactive",
        commissionPercent,
        serviceIds: selectedServices,
        schedule
    };

    saving = true;
    saveBarberButton.disabled = true;

    updateAccountButton();

    try {
        await saveBarber(barber);

        barbers = await getBarbers();

        renderSummary();
        renderBarbers();

        showToast(
            existing
                ? `${name} actualizado correctamente.`
                : `${name} fue agregado al equipo.`,
            "success"
        );

        // Conservamos abierto el formulario para que
        // el administrador pueda crear la cuenta.
        editingBarberId = barber.id;
        barberModalTitle.textContent = barber.name;

        resetAccountForm();

        setAccountMessage(
            "Barbero guardado. Ahora puedes crear su cuenta de acceso.",
            "success"
        );

        await loadAccountStatus(barber.id);

    } catch (error) {
        console.error(
            "Error guardando barbero:",
            error
        );

        showToast(
            "No se pudo guardar el barbero en Firebase.",
            "error"
        );

    } finally {
        saving = false;
        saveBarberButton.disabled = false;
        updateAccountButton();
    }
}

/* =========================================================
   CUENTAS DE ACCESO
========================================================= */

function resetAccountForm() {
    barberAccountEmail.value = "";
    barberAccountPassword.value = "";

    barberAccountEmail.readOnly = false;

    accountStatusByBarber.delete(
        editingBarberId
    );

    barberAccountMessage.textContent = "";
    barberAccountMessage.style.color = "";

    createBarberAccountButton.textContent =
        "Crear cuenta de acceso";

    updateAccountButton();
}

function setAccountMessage(
    message,
    type = "info"
) {
    barberAccountMessage.textContent = message;

    barberAccountMessage.style.color =
        type === "error"
            ? "#ef9999"
            : type === "success"
                ? "#78c99c"
                : "#e6bd78";
}

function updateAccountButton() {
    const status = editingBarberId
        ? accountStatusByBarber.get(editingBarberId)
        : null;

    const hasSavedBarber = Boolean(
        editingBarberId &&
        barbers.some(
            barber => barber.id === editingBarberId
        )
    );

    const email = barberAccountEmail.value.trim();
    const password = barberAccountPassword.value;

    const validEmail =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    const validPassword =
        password.length >= 8;

    const active = barberActiveSwitch.checked;

    const accountExists =
        status?.exists === true;

    const checking =
        status?.checking === true;

    createBarberAccountButton.disabled = (
        !hasSavedBarber ||
        !active ||
        !validEmail ||
        !validPassword ||
        accountExists ||
        checking ||
        saving ||
        creatingAccount
    );

    if (accountExists) {
        createBarberAccountButton.textContent =
            "Cuenta ya vinculada";
    } else if (creatingAccount) {
        createBarberAccountButton.textContent =
            "Creando cuenta...";
    } else if (checking) {
        createBarberAccountButton.textContent =
            "Verificando cuenta...";
    } else {
        createBarberAccountButton.textContent =
            "Crear cuenta de acceso";
    }
}

async function loadAccountStatus(barberId) {
    accountStatusByBarber.set(
        barberId,
        {
            checking: true,
            exists: false
        }
    );

    updateAccountButton();

    setAccountMessage(
        "Verificando si este barbero ya tiene una cuenta..."
    );

    try {
        const snapshot = await getDocs(
            query(
                collection(db, "users"),
                where("barberId", "==", barberId)
            )
        );

        // Evita que una respuesta anterior modifique
        // el formulario de otro barbero.
        if (editingBarberId !== barberId) {
            return;
        }

        if (!snapshot.empty) {
            const account = snapshot.docs[0].data();

            accountStatusByBarber.set(
                barberId,
                {
                    checking: false,
                    exists: true,
                    uid: snapshot.docs[0].id
                }
            );

            barberAccountEmail.value =
                account.email || "";

            barberAccountEmail.readOnly = true;
            barberAccountPassword.value = "";

            setAccountMessage(
                "Este barbero ya tiene una cuenta vinculada.",
                "success"
            );

        } else {
            accountStatusByBarber.set(
                barberId,
                {
                    checking: false,
                    exists: false
                }
            );

            setAccountMessage(
                "Este barbero aún no tiene cuenta. " +
                "Ingresa su correo y una contraseña temporal."
            );
        }

    } catch (error) {
        console.error(
            "Error verificando cuenta:",
            error
        );

        if (editingBarberId !== barberId) {
            return;
        }

        // Si no podemos comprobar si existe una cuenta,
        // bloqueamos la creación para evitar duplicados.
        accountStatusByBarber.set(
            barberId,
            {
                checking: true,
                exists: false
            }
        );

        setAccountMessage(
            "No se pudo verificar la cuenta existente. " +
            "Revisa tus permisos de Firebase.",
            "error"
        );

    } finally {
        updateAccountButton();
    }
}

async function handleCreateBarberAccount() {
    if (saving || creatingAccount) {
        return;
    }

    const barberId = editingBarberId;

    const barber = barbers.find(
        item => item.id === barberId
    );

    if (!barber) {
        setAccountMessage(
            "Primero guarda el barbero.",
            "error"
        );
        return;
    }

    if (barber.status !== "active") {
        setAccountMessage(
            "Activa y guarda al barbero antes de crear su cuenta.",
            "error"
        );
        return;
    }

    const status = accountStatusByBarber.get(
        barberId
    );

    if (!status || status.checking || status.exists) {
        setAccountMessage(
            "No es posible crear la cuenta hasta verificar su estado.",
            "error"
        );
        return;
    }

    const email = barberAccountEmail.value
        .trim()
        .toLowerCase();

    const password = barberAccountPassword.value;

    if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        setAccountMessage(
            "Ingresa un correo válido.",
            "error"
        );
        return;
    }

    if (password.length < 8) {
        setAccountMessage(
            "La contraseña debe tener al menos 8 caracteres.",
            "error"
        );
        return;
    }

    creatingAccount = true;

    saveBarberButton.disabled = true;
    updateAccountButton();

    setAccountMessage(
        "Creando cuenta en Firebase Authentication..."
    );

    try {
        const result = await createBarberAccount({
            barberId,
            email,
            password
        });

        barberAccountPassword.value = "";

        accountStatusByBarber.set(
            barberId,
            {
                checking: false,
                exists: true,
                uid: result.uid
            }
        );

        barberAccountEmail.readOnly = true;

        setAccountMessage(
            "Cuenta creada correctamente. " +
            "Entrega la contraseña temporal al barbero " +
            "por un medio seguro.",
            "success"
        );

        showToast(
            `Cuenta creada para ${barber.name}.`,
            "success"
        );

    } catch (error) {
        console.error(
            "Error creando cuenta:",
            error
        );

        const message = getAccountErrorMessage(error);

        setAccountMessage(message, "error");

        showToast(message, "error");

        // Si el estado quedó incierto, verificamos de
        // nuevo Firestore antes de permitir reintentar.
        await loadAccountStatus(barberId);

    } finally {
        creatingAccount = false;
        saveBarberButton.disabled = false;
        updateAccountButton();
    }
}

function getAccountErrorMessage(error) {
    switch (error.code) {
        case "auth/email-already-in-use":
            return (
                "Ese correo ya está registrado en Firebase. " +
                "Revisa Authentication antes de continuar."
            );

        case "auth/invalid-email":
            return "El correo electrónico no es válido.";

        case "auth/weak-password":
            return (
                "La contraseña es demasiado débil. " +
                "Utiliza una contraseña más segura."
            );

        case "auth/operation-not-allowed":
            return (
                "Habilita Correo electrónico/contraseña " +
                "en Firebase Authentication."
            );

        case "permission-denied":
            return (
                "Firebase rechazó la operación. " +
                "Verifica los permisos del administrador."
            );

        default:
            return error.message ||
                "No se pudo crear la cuenta.";
    }
}

/* =========================================================
   HORARIO DE HOY
========================================================= */

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

    const today = days[new Date().getDay()];

    return barber.schedule?.[today] || null;
}

function formatTodaySchedule(schedule) {
    if (!schedule?.enabled) {
        return "Descanso";
    }

    return (
        `${formatTime(schedule.start)} — ` +
        `${formatTime(schedule.end)}`
    );
}

/* =========================================================
   FECHA LOCAL
========================================================= */

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

    const period = hours >= 12
        ? "PM"
        : "AM";

    const hour = hours % 12 || 12;

    return (
        `${hour}:` +
        `${String(minutes).padStart(2, "0")} ` +
        period
    );
}

/* =========================================================
   INICIALES
========================================================= */

function getInitials(name) {
    return String(name || "")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part.charAt(0).toUpperCase())
        .join("");
}

/* =========================================================
   SEGURIDAD HTML
========================================================= */

function escapeHTML(value) {
    const element = document.createElement("div");
    element.textContent = String(value ?? "");
    return element.innerHTML;
}

/* =========================================================
   NOTIFICACIONES
========================================================= */

function showToast(
    message,
    type = "info"
) {
    const toast = $("toast");

    if (!toast) {
        console.log(message);
        return;
    }

    toast.textContent = message;

    toast.classList.remove(
        "success",
        "error"
    );

    if (type !== "info") {
        toast.classList.add(type);
    }

    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 3500);
}

/* =========================================================
   INICIAR
========================================================= */

initialize();
