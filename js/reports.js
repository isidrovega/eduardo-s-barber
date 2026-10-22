
import {
    origins
} from "./data.js";

import {
    getAppointments,
    getServices,
    getBarbers
} from "./firestore-storage.js";

import {
    protectPage
} from "./auth.js";

/* =========================================================
   EDUARDO'S BARBERSHOP
   REPORTES CON RANGO PERSONALIZADO DE FECHAS

   Características:
   - Fecha de inicio y fecha de fin.
   - Fechas inclusivas.
   - Filtros aplicados a todos los reportes.
   - Datos obtenidos desde Firebase Firestore.
   - Ingresos basados en el importe real cobrado.
   - Compatibilidad con citas históricas.
   - Importes con dos decimales.
   - Sin modificar la base de datos.
========================================================= */

const TIME_ZONE = "America/Mazatlan";

const MONEY_FORMATTER = new Intl.NumberFormat(
    "es-MX",
    {
        style: "currency",
        currency: "MXN",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }
);

let appointmentsData = [];
let servicesData = [];
let barbersData = [];

let startDateInput = null;
let endDateInput = null;
let dateErrorElement = null;
let reportsLoaded = false;

const reportSummary =
    document.getElementById("reportSummary");

const reportDateRange =
    document.getElementById("reportDateRange");

const revenueReport =
    document.getElementById("revenueReport");

const statusReport =
    document.getElementById("statusReport");

const servicesReport =
    document.getElementById("servicesReport");

const barbersReport =
    document.getElementById("barbersReport");

const originsReport =
    document.getElementById("originsReport");

/* =========================================================
   FECHAS
========================================================= */

function getToday() {
    const parts = new Intl.DateTimeFormat(
        "en-US",
        {
            timeZone: TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }
    ).formatToParts(new Date());

    const values = Object.fromEntries(
        parts
            .filter(part => part.type !== "literal")
            .map(part => [part.type, part.value])
    );

    return [
        values.year,
        values.month,
        values.day
    ].join("-");
}

function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
        return false;
    }

    const date = new Date(`${value}T12:00:00Z`);

    if (Number.isNaN(date.getTime())) {
        return false;
    }

    return (
        date.getUTCFullYear() === Number(value.slice(0, 4)) &&
        date.getUTCMonth() + 1 === Number(value.slice(5, 7)) &&
        date.getUTCDate() === Number(value.slice(8, 10))
    );
}

function getMonthStart(value) {
    return `${value.slice(0, 7)}-01`;
}

function formatDate(value) {
    if (!isValidDate(value)) {
        return value || "";
    }

    return new Intl.DateTimeFormat(
        "es-MX",
        {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC"
        }
    ).format(
        new Date(`${value}T12:00:00Z`)
    );
}

/* =========================================================
   ELEMENTOS
========================================================= */

function createElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text !== undefined) {
        element.textContent = String(text);
    }

    return element;
}

function installDateFilterStyles() {
    if (
        document.getElementById(
            "reports-custom-date-styles"
        )
    ) {
        return;
    }

    const style = document.createElement("style");

    style.id = "reports-custom-date-styles";

    style.textContent = `
        .reports-custom-date-filter {
            display: flex;
            flex-wrap: wrap;
            align-items: flex-end;
            gap: 14px;
            width: 100%;
            margin: 12px 0 18px;
        }

        .reports-custom-date-field {
            display: flex;
            flex-direction: column;
            gap: 7px;
            flex: 1 1 190px;
            min-width: 0;
        }

        .reports-custom-date-field label {
            font-size: 13px;
            font-weight: 600;
        }

        .reports-custom-date-field input {
            display: block;
            width: 100%;
            min-height: 43px;
            box-sizing: border-box;
            padding: 9px 11px;
            border: 1px solid #888;
            border-radius: 8px;
            background: #fff;
            color: #222;
            font: inherit;
            color-scheme: light;
        }

        .reports-custom-date-field input:focus-visible {
            outline: 2px solid #c49a45;
            outline-offset: 2px;
        }

        .reports-custom-date-error {
            display: none;
            flex-basis: 100%;
            margin: 0;
            color: #c0392b;
            font-size: 13px;
            font-weight: 600;
        }

        .reports-custom-date-error.is-visible {
            display: block;
        }

        @media (max-width: 480px) {
            .reports-custom-date-filter {
                gap: 10px;
            }

            .reports-custom-date-field {
                flex-basis: 100%;
            }
        }
    `;

    document.head.append(style);
}

/* =========================================================
   CREAR FILTROS DE FECHA

   Reemplaza los botones existentes [data-period]
   sin requerir cambios en el archivo HTML.
========================================================= */

function initializeDateFilters() {
    installDateFilterStyles();

    const oldButtons = Array.from(
        document.querySelectorAll("[data-period]")
    );

    const existingFilter = document.getElementById(
        "reportsCustomDateFilter"
    );

    if (existingFilter) {
        startDateInput = document.getElementById(
            "reportStartDate"
        );

        endDateInput = document.getElementById(
            "reportEndDate"
        );

        dateErrorElement = document.getElementById(
            "reportDateError"
        );

        if (
            startDateInput &&
            endDateInput &&
            dateErrorElement
        ) {
            const today = getToday();

            if (!startDateInput.value) {
                startDateInput.value =
                    getMonthStart(today);
            }

            if (!endDateInput.value) {
                endDateInput.value = today;
            }

            startDateInput.addEventListener(
                "change",
                renderReports
            );

            endDateInput.addEventListener(
                "change",
                renderReports
            );

            return;
        }

        existingFilter.remove();
    }

    const container = createElement(
        "div",
        "reports-custom-date-filter"
    );

    container.id = "reportsCustomDateFilter";

    const startField = createElement(
        "div",
        "reports-custom-date-field"
    );

    const startLabel = createElement(
        "label",
        "",
        "Fecha de inicio"
    );

    startLabel.htmlFor = "reportStartDate";

    startDateInput = createElement("input");

    startDateInput.id = "reportStartDate";
    startDateInput.type = "date";
    startDateInput.required = true;

    startField.append(
        startLabel,
        startDateInput
    );

    const endField = createElement(
        "div",
        "reports-custom-date-field"
    );

    const endLabel = createElement(
        "label",
        "",
        "Fecha de fin"
    );

    endLabel.htmlFor = "reportEndDate";

    endDateInput = createElement("input");

    endDateInput.id = "reportEndDate";
    endDateInput.type = "date";
    endDateInput.required = true;

    endField.append(
        endLabel,
        endDateInput
    );

    dateErrorElement = createElement(
        "p",
        "reports-custom-date-error"
    );

    dateErrorElement.id = "reportDateError";

    dateErrorElement.setAttribute(
        "role",
        "alert"
    );

    container.append(
        startField,
        endField,
        dateErrorElement
    );

    const today = getToday();

    startDateInput.value = getMonthStart(today);
    endDateInput.value = today;

    /*
     * Ubicar los campos donde estaban
     * los botones de período.
     */
    if (oldButtons.length) {
        const firstButton = oldButtons[0];

        const parent = firstButton.parentElement;

        if (parent) {
            parent.parentNode.insertBefore(
                container,
                parent
            );

            for (const button of oldButtons) {
                button.remove();
            }

            /*
             * Si el contenedor anterior solamente
             * tenía botones y espacios, eliminarlo.
             */
            if (
                parent.children.length === 0 &&
                parent.textContent.trim() === ""
            ) {
                parent.remove();
            }
        }

    } else if (reportDateRange?.parentElement) {
        reportDateRange.insertAdjacentElement(
            "afterend",
            container
        );

    } else if (reportSummary?.parentElement) {
        reportSummary.parentElement.insertBefore(
            container,
            reportSummary
        );

    } else {
        document.body.prepend(container);
    }

    startDateInput.addEventListener(
        "change",
        renderReports
    );

    endDateInput.addEventListener(
        "change",
        renderReports
    );
}

/* =========================================================
   INICIALIZACIÓN
========================================================= */

async function initialize() {
    try {
        const user = await protectPage("admin");

        if (!user) {
            return;
        }

        initializeDateFilters();

        await loadData();

    } catch (error) {
        console.error(
            "Error al iniciar reportes:",
            error
        );

        if (reportDateRange) {
            reportDateRange.textContent =
                "No se pudo iniciar el módulo de reportes.";
        }

        showEmptyReports();
    }
}

async function loadData() {
    try {
        const [
            appointments,
            services,
            barbers
        ] = await Promise.all([
            getAppointments(),
            getServices(),
            getBarbers()
        ]);

        appointmentsData = appointments;
        servicesData = services;
        barbersData = barbers;

        reportsLoaded = true;

        renderReports();

    } catch (error) {
        console.error(
            "Error cargando reportes:",
            error
        );

        reportsLoaded = false;

        if (reportDateRange) {
            reportDateRange.textContent =
                "Error al cargar información de Firebase";
        }

        showEmptyReports();
    }
}

/* =========================================================
   VALIDACIÓN DEL RANGO
========================================================= */

function getDateRange() {
    const start = startDateInput?.value || "";
    const end = endDateInput?.value || "";

    if (!isValidDate(start) || !isValidDate(end)) {
        return {
            valid: false,
            start,
            end,
            message: "Selecciona ambas fechas."
        };
    }

    if (start > end) {
        return {
            valid: false,
            start,
            end,
            message:
                "La fecha de inicio no puede ser posterior " +
                "a la fecha de fin."
        };
    }

    return {
        valid: true,
        start,
        end,
        message: ""
    };
}

function showDateError(message) {
    if (!dateErrorElement) {
        return;
    }

    dateErrorElement.textContent = message;

    dateErrorElement.classList.toggle(
        "is-visible",
        Boolean(message)
    );
}

/* =========================================================
   FILTRADO POR RANGO DE FECHAS

   Se comparan fechas YYYY-MM-DD.
   Tanto inicio como fin son inclusivos.
========================================================= */

function getFilteredAppointments(range) {
    if (!range.valid) {
        return [];
    }

    return appointmentsData.filter(
        appointment => {
            const date = appointment.date;

            return (
                isValidDate(date) &&
                date >= range.start &&
                date <= range.end
            );
        }
    );
}

/* =========================================================
   RENDERIZADO GENERAL
========================================================= */

function renderReports() {
    if (!reportsLoaded) {
        return;
    }

    const range = getDateRange();

    showDateError(range.message);

    if (!range.valid) {
        if (reportDateRange) {
            reportDateRange.textContent =
                "Selecciona un rango de fechas válido.";
        }

        showEmptyReports();
        return;
    }

    const appointments =
        getFilteredAppointments(range);

    renderPeriod(range);
    renderSummary(appointments);
    renderRevenue(appointments);
    renderStatuses(appointments);
    renderServices(appointments);
    renderBarbers(appointments);
    renderOrigins(appointments);
}

function renderPeriod(range) {
    if (!reportDateRange) {
        return;
    }

    reportDateRange.textContent =
        `Del ${formatDate(range.start)} ` +
        `al ${formatDate(range.end)}`;
}

function showEmptyReports() {
    if (reportSummary) {
        reportSummary.innerHTML = emptyReport();
    }

    if (revenueReport) {
        revenueReport.innerHTML = emptyReport();
    }

    if (statusReport) {
        statusReport.innerHTML = emptyReport();
    }

    if (servicesReport) {
        servicesReport.innerHTML = emptyReport();
    }

    if (barbersReport) {
        barbersReport.innerHTML = emptyReport();
    }

    if (originsReport) {
        originsReport.innerHTML = emptyReport();
    }
}

/* =========================================================
   INGRESOS POR CITA

   Prioridad:
   1. amountCharged registrado en Firebase.
   2. Precio original del servicio para citas antiguas.

   Se respeta amountCharged = 0.
   Solo las citas completadas generan ingresos.
========================================================= */

function getAppointmentRevenue(appointment) {
    if (
        appointment.status !== "completed"
    ) {
        return 0;
    }

    const amountCharged =
        appointment.amountCharged;

    if (
        typeof amountCharged === "number" &&
        Number.isFinite(amountCharged) &&
        amountCharged >= 0
    ) {
        return Math.round(
            amountCharged * 100
        ) / 100;
    }

    /*
     * Compatibilidad con citas anteriores
     * que todavía no tienen amountCharged.
     */
    const service = servicesData.find(
        item =>
            item.id === appointment.serviceId
    );

    const originalPrice = Number(
        service?.price
    );

    if (
        !Number.isFinite(originalPrice) ||
        originalPrice < 0
    ) {
        return 0;
    }

    return Math.round(
        originalPrice * 100
    ) / 100;
}

/* =========================================================
   CALCULAR INGRESOS REALES

   Suma en centavos para evitar errores
   de precisión con números decimales.
========================================================= */

function calculateRevenue(appointments) {
    const totalInCents = appointments.reduce(
        (total, appointment) => {
            return total + Math.round(
                getAppointmentRevenue(
                    appointment
                ) * 100
            );
        },
        0
    );

    return totalInCents / 100;
}

/* =========================================================
   RESUMEN
========================================================= */

function renderSummary(appointments) {
    if (!reportSummary) {
        return;
    }

    const completed = appointments.filter(
        appointment =>
            appointment.status === "completed"
    );

    const cancelled = appointments.filter(
        appointment =>
            appointment.status === "cancelled" ||
            appointment.status === "no-show"
    );

    const revenue = calculateRevenue(completed);

    /*
     * Se conserva el cálculo de clientes
     * utilizado en el reporte original.
     */
    const customers = new Set(
        completed
            .map(appointment =>
                normalizePhone(appointment.phone)
            )
            .filter(Boolean)
    ).size;

    reportSummary.innerHTML = `
        <div class="module-summary-item">
            <strong>${formatMoney(revenue)}</strong>
            <span>Ingresos</span>
        </div>

        <div class="module-summary-divider"></div>

        <div class="module-summary-item">
            <strong>${appointments.length}</strong>
            <span>Citas</span>
        </div>

        <div class="module-summary-divider"></div>

        <div class="module-summary-item">
            <strong>${completed.length}</strong>
            <span>Completadas</span>
        </div>

        <div class="module-summary-divider"></div>

        <div class="module-summary-item">
            <strong>${customers}</strong>
            <span>Clientes</span>
        </div>

        <div class="module-summary-divider"></div>

        <div class="module-summary-item">
            <strong>${cancelled.length}</strong>
            <span>Canceladas / no-show</span>
        </div>
    `;
}

/* =========================================================
   INGRESOS
========================================================= */

function renderRevenue(appointments) {
    if (!revenueReport) {
        return;
    }

    const completed = appointments.filter(
        appointment =>
            appointment.status === "completed"
    );

    const revenue = calculateRevenue(completed);

    const ticket = completed.length
        ? revenue / completed.length
        : 0;

    revenueReport.innerHTML = `
        <div class="report-primary-value">
            <span>Total</span>
            <strong>${formatMoney(revenue)}</strong>
        </div>

        <div class="report-info-row">
            <span>Servicios completados</span>
            <strong>${completed.length}</strong>
        </div>

        <div class="report-info-row">
            <span>Ticket promedio</span>
            <strong>${formatMoney(ticket)}</strong>
        </div>
    `;
}

/* =========================================================
   ESTADOS DE CITAS
========================================================= */

function renderStatuses(appointments) {
    if (!statusReport) {
        return;
    }

    const statuses = [
        ["completed", "Completadas"],
        ["confirmed", "Confirmadas"],
        ["pending", "Pendientes"],
        ["cancelled", "Canceladas"],
        ["no-show", "No asistió"]
    ];

    statusReport.innerHTML = statuses
        .map(([id, label]) => {
            const count = appointments.filter(
                appointment =>
                    appointment.status === id
            ).length;

            return `
                <div class="report-info-row">
                    <span>${label}</span>
                    <strong>${count}</strong>
                </div>
            `;
        })
        .join("");
}

/* =========================================================
   SERVICIOS

   Cada servicio suma el importe real
   de sus citas completadas.
========================================================= */

function renderServices(appointments) {
    if (!servicesReport) {
        return;
    }

    const completed = appointments.filter(
        appointment =>
            appointment.status === "completed"
    );

    const data = servicesData
        .map(service => {
            const serviceAppointments =
                completed.filter(
                    appointment =>
                        appointment.serviceId === service.id
                );

            return {
                ...service,
                count: serviceAppointments.length,
                revenue:
                    calculateRevenue(serviceAppointments)
            };
        })
        .filter(service => service.count > 0)
        .sort((a, b) => b.count - a.count);

    if (!data.length) {
        servicesReport.innerHTML = emptyReport();
        return;
    }

    servicesReport.innerHTML = data
        .map(service => `
            <div class="report-entity-row">
                <div>
                    <strong>${escapeHTML(service.name)}</strong>
                    <span>
                        ${service.count}
                        ${service.count === 1
                            ? "servicio"
                            : "servicios"}
                    </span>
                </div>

                <strong>
                    ${formatMoney(service.revenue)}
                </strong>
            </div>
        `)
        .join("");
}

/* =========================================================
   BARBEROS

   Cada barbero suma el importe real
   de las citas que completó.
========================================================= */

function renderBarbers(appointments) {
    if (!barbersReport) {
        return;
    }

    const completed = appointments.filter(
        appointment =>
            appointment.status === "completed"
    );

    const data = barbersData
        .map(barber => {
            const barberAppointments =
                completed.filter(
                    appointment =>
                        appointment.barberId === barber.id
                );

            return {
                ...barber,
                count: barberAppointments.length,
                revenue:
                    calculateRevenue(barberAppointments)
            };
        })
        .filter(barber => barber.count > 0)
        .sort((a, b) => b.count - a.count);

    if (!data.length) {
        barbersReport.innerHTML = emptyReport();
        return;
    }

    barbersReport.innerHTML = data
        .map(barber => `
            <div class="report-entity-row">
                <div class="report-entity-person">
                    <div class="report-mini-avatar">
                        ${escapeHTML(getInitials(barber.name))}
                    </div>

                    <div>
                        <strong>
                            ${escapeHTML(barber.name)}
                        </strong>
                        <span>
                            ${barber.count}
                            ${barber.count === 1
                                ? "cita"
                                : "citas"}
                        </span>
                    </div>
                </div>

                <strong>
                    ${formatMoney(barber.revenue)}
                </strong>
            </div>
        `)
        .join("");
}

/* =========================================================
   ORIGEN DE CITAS
========================================================= */

function renderOrigins(appointments) {
    if (!originsReport) {
        return;
    }

    if (!appointments.length) {
        originsReport.innerHTML = emptyReport();
        return;
    }

    const counts = Object.create(null);

    appointments.forEach(appointment => {
        const origin =
            appointment.origin || "unknown";

        counts[origin] =
            (counts[origin] || 0) + 1;
    });

    const data = Object.entries(counts)
        .map(([id, count]) => ({
            id,
            count,
            name: origins[id] || getOriginName(id)
        }))
        .sort((a, b) => b.count - a.count);

    originsReport.innerHTML = data
        .map(item => {
            const percentage = Math.round(
                item.count /
                appointments.length *
                100
            );

            return `
                <div class="report-origin-simple-row">
                    <div class="report-origin-simple-icon">
                        ${getOriginIcon(item.id)}
                    </div>

                    <div class="report-origin-simple-info">
                        <div>
                            <strong>${escapeHTML(item.name)}</strong>
                            <span>
                                ${item.count}
                                ${item.count === 1
                                    ? "cita"
                                    : "citas"}
                            </span>
                        </div>

                        <div class="report-simple-progress">
                            <div style="width: ${percentage}%"></div>
                        </div>
                    </div>

                    <strong>${percentage}%</strong>
                </div>
            `;
        })
        .join("");
}

/* =========================================================
   UTILIDADES
========================================================= */

function normalizePhone(value) {
    return String(value || "")
        .replace(/\D/g, "");
}

function getOriginName(origin) {
    const names = {
        whatsapp: "WhatsApp",
        instagram: "Instagram",
        facebook: "Facebook",
        phone: "Teléfono",
        "walk-in": "En persona",
        web: "Página web",
        unknown: "Sin origen"
    };

    return names[origin] || "Otro";
}

function getOriginIcon(origin) {
    const icons = {
        whatsapp: "W",
        instagram: "I",
        facebook: "F",
        phone: "☎",
        "walk-in": "P",
        web: "◎",
        unknown: "?"
    };

    return icons[origin] || "•";
}

function getInitials(name) {
    return String(name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(word => word.charAt(0))
        .join("")
        .toUpperCase() || "?";
}

function formatMoney(value) {
    const amount = Number(value);

    return MONEY_FORMATTER.format(
        Number.isFinite(amount)
            ? amount
            : 0
    );
}

function emptyReport() {
    return `
        <div class="report-simple-empty">
            Sin información en este período.
        </div>
    `;
}

function escapeHTML(value) {
    const element = document.createElement("div");

    element.textContent = String(value ?? "");

    return element.innerHTML;
}

/* =========================================================
   INICIAR
========================================================= */

void initialize();
