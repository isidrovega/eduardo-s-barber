
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
   REPORTS.JS

   Reportes conectados a Firebase Firestore.
   Sin registros de demostración.
   Sin almacenamiento local.
========================================================= */

let currentPeriod = "week";

let appointmentsData = [];
let servicesData = [];
let barbersData = [];

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
   INICIALIZACIÓN
========================================================= */

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

        renderReports();

    } catch (error) {
        console.error(
            "Error cargando reportes:",
            error
        );

        reportDateRange.textContent =
            "Error al cargar información de Firebase";

        showEmptyReports();
    }
}

/* =========================================================
   EVENTOS
========================================================= */

function configureEvents() {
    document
        .querySelectorAll("[data-period]")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => {
                    document
                        .querySelectorAll("[data-period]")
                        .forEach(item => {
                            item.classList.remove("active");
                        });

                    button.classList.add("active");

                    currentPeriod = button.dataset.period;

                    renderReports();
                }
            );
        });
}

/* =========================================================
   RENDERIZADO GENERAL
========================================================= */

function renderReports() {
    const appointments =
        getFilteredAppointments();

    renderPeriod();
    renderSummary(appointments);
    renderRevenue(appointments);
    renderStatuses(appointments);
    renderServices(appointments);
    renderBarbers(appointments);
    renderOrigins(appointments);
}

function showEmptyReports() {
    reportSummary.innerHTML = emptyReport();
    revenueReport.innerHTML = emptyReport();
    statusReport.innerHTML = emptyReport();
    servicesReport.innerHTML = emptyReport();
    barbersReport.innerHTML = emptyReport();
    originsReport.innerHTML = emptyReport();
}

/* =========================================================
   FILTRADO POR PERÍODO
========================================================= */

function getFilteredAppointments() {
    if (currentPeriod === "all") {
        return appointmentsData;
    }

    const today = startOfDay(new Date());

    let days = 0;

    if (currentPeriod === "week") {
        days = 6;
    }

    if (currentPeriod === "month") {
        days = 29;
    }

    const start = new Date(today);

    start.setDate(
        start.getDate() - days
    );

    const end = endOfDay(today);

    return appointmentsData.filter(appointment => {
        const date = parseDate(appointment.date);

        return (
            Number.isFinite(date.getTime()) &&
            date >= start &&
            date <= end
        );
    });
}

/* =========================================================
   ETIQUETA DEL PERÍODO
========================================================= */

function renderPeriod() {
    if (currentPeriod === "today") {
        reportDateRange.textContent =
            "Actividad de hoy";
        return;
    }

    if (currentPeriod === "week") {
        reportDateRange.textContent =
            "Últimos 7 días";
        return;
    }

    if (currentPeriod === "month") {
        reportDateRange.textContent =
            "Últimos 30 días";
        return;
    }

    reportDateRange.textContent =
        "Todo el historial";
}

/* =========================================================
   RESUMEN
========================================================= */

function renderSummary(appointments) {
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
========================================================= */

function renderServices(appointments) {
    const completed = appointments.filter(
        appointment =>
            appointment.status === "completed"
    );

    const data = servicesData
        .map(service => {
            const count = completed.filter(
                appointment =>
                    appointment.serviceId === service.id
            ).length;

            return {
                ...service,
                count,
                revenue:
                    count * Number(service.price || 0)
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
========================================================= */

function renderBarbers(appointments) {
    const completed = appointments.filter(
        appointment =>
            appointment.status === "completed"
    );

    const data = barbersData
        .map(barber => {
            const barberAppointments = completed.filter(
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
    if (!appointments.length) {
        originsReport.innerHTML = emptyReport();
        return;
    }

    const counts = {};

    appointments.forEach(appointment => {
        const origin = appointment.origin || "unknown";

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
                item.count / appointments.length * 100
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
   INGRESOS
========================================================= */

function calculateRevenue(appointments) {
    return appointments.reduce(
        (total, appointment) => {
            const service = servicesData.find(
                item =>
                    item.id === appointment.serviceId
            );

            return total + Number(service?.price || 0);
        },
        0
    );
}

/* =========================================================
   UTILIDADES
========================================================= */

function parseDate(value) {
    const [year, month, day] = String(value)
        .split("-")
        .map(Number);

    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day)
    ) {
        return new Date(NaN);
    }

    const date = new Date(
        year,
        month - 1,
        day
    );

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return new Date(NaN);
    }

    return date;
}

function startOfDay(date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
}

function endOfDay(date) {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
}

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
    return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
        maximumFractionDigits: 0
    }).format(Number(value) || 0);
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
