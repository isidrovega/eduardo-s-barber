
/* =====================================================
   EDUARDO'S BARBERSHOP
   CALENDARIO DE CITAS DEL ADMINISTRADOR

   MEJORAS:
   - Máximo 2 citas visibles por día.
   - Botón para consultar citas adicionales.
   - Ventana con todas las citas del día.
   - Calendario compacto y adaptable a celulares.
   - Sin modificaciones en Firebase.
===================================================== */

const TIME_ZONE = "America/Mazatlan";
const MAX_VISIBLE_APPOINTMENTS = 2;

const WEEKDAYS = [
    "Lun", "Mar", "Mié", "Jue",
    "Vie", "Sáb", "Dom"
];

const STATUS_LABELS = {
    pending: "Pendiente",
    confirmed: "Confirmada",
    completed: "Completada",
    cancelled: "Cancelada",
    "no-show": "No asistió"
};

let initialized = false;
let onFiltersChange = null;

let currentAppointmentsByDate = new Map();
let currentBarberNames = new Map();

let detailsDialog = null;
let previousFocusedElement = null;

const elements = {
    barber: null,
    start: null,
    end: null,
    today: null,
    calendar: null,
    count: null,
    message: null
};

/* =====================================================
   FECHAS
===================================================== */

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

function formatDateKey(date) {
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
        String(date.getUTCDate()).padStart(2, "0")
    ].join("-");
}

function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
        return null;
    }

    const date = new Date(`${value}T12:00:00Z`);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    if (formatDateKey(date) !== value) {
        return null;
    }

    return date;
}

function addDays(value, amount) {
    const date = parseDate(value);

    if (!date) {
        return value;
    }

    date.setUTCDate(date.getUTCDate() + amount);

    return formatDateKey(date);
}

function getWeekRange() {
    const today = getToday();
    const date = parseDate(today);

    const weekday = (
        date.getUTCDay() + 6
    ) % 7;

    const start = addDays(
        today,
        -weekday
    );

    return {
        start,
        end: addDays(start, 6)
    };
}

function formatMonth(date) {
    return new Intl.DateTimeFormat(
        "es-MX",
        {
            month: "long",
            year: "numeric",
            timeZone: "UTC"
        }
    ).format(date);
}

function formatFullDate(value) {
    const date = parseDate(value);

    if (!date) {
        return value;
    }

    return new Intl.DateTimeFormat(
        "es-MX",
        {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC"
        }
    ).format(date);
}

function formatTime(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(
        value || ""
    );

    if (!match) {
        return value || "";
    }

    const hours = Number(match[1]);
    const minutes = match[2];

    return (
        `${hours % 12 || 12}:${minutes} ` +
        `${hours >= 12 ? "PM" : "AM"}`
    );
}

/* =====================================================
   ELEMENTOS SEGUROS
===================================================== */

function createElement(
    tag,
    className = "",
    text
) {
    const element = document.createElement(tag);

    if (className) {
        element.className = className;
    }

    if (text !== undefined) {
        element.textContent = String(text);
    }

    return element;
}

function getSafeStatus(status) {
    return Object.hasOwn(
        STATUS_LABELS,
        status
    )
        ? status
        : "pending";
}

/* =====================================================
   ESTILOS DEL CALENDARIO COMPACTO

   Se insertan una sola vez.
   No requiere modificar archivos CSS.
===================================================== */

function installCompactCalendarStyles() {
    const styleId =
        "eduardo-compact-calendar-styles";

    if (document.getElementById(styleId)) {
        return;
    }

    const style = document.createElement("style");

    style.id = styleId;

    style.textContent = `
        /* Calendario compacto */

        #appointmentCalendar .calendar-days {
            align-items: stretch;
        }

        #appointmentCalendar .calendar-day {
            min-width: 0;
            overflow: hidden;
            box-sizing: border-box;
        }

        #appointmentCalendar .calendar-day-number {
            display: block;
            margin-bottom: 5px;
        }

        #appointmentCalendar .calendar-appointment {
            min-width: 0;
            max-width: 100%;
            box-sizing: border-box;
            overflow: hidden;
            margin-bottom: 4px;
        }

        #appointmentCalendar .calendar-appointment strong,
        #appointmentCalendar .calendar-appointment span {
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        #appointmentCalendar .calendar-more-button {
            display: block;
            width: 100%;
            margin-top: 5px;
            padding: 6px 4px;
            border: 1px solid rgba(120, 120, 120, 0.3);
            border-radius: 6px;
            background: rgba(120, 120, 120, 0.10);
            color: inherit;
            font: inherit;
            font-size: 11px;
            font-weight: 700;
            line-height: 1.3;
            text-align: center;
            cursor: pointer;
            box-sizing: border-box;
        }

        #appointmentCalendar .calendar-more-button:hover {
            background: rgba(120, 120, 120, 0.20);
        }

        #appointmentCalendar .calendar-more-button:focus-visible {
            outline: 2px solid #c49a45;
            outline-offset: 2px;
        }

        /* Ventana con todas las citas */

        .eduardo-day-dialog {
            width: min(520px, calc(100vw - 28px));
            max-height: min(80vh, 760px);
            padding: 0;
            border: 1px solid rgba(120, 120, 120, 0.3);
            border-radius: 14px;
            background: #ffffff;
            color: #222222;
            box-shadow: 0 20px 65px rgba(0, 0, 0, 0.3);
            overflow: hidden;
            box-sizing: border-box;
        }

        .eduardo-day-dialog::backdrop {
            background: rgba(0, 0, 0, 0.65);
        }

        .eduardo-day-dialog-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
            padding: 18px;
            border-bottom: 1px solid #e5e5e5;
        }

        .eduardo-day-dialog-title {
            margin: 0;
            font-size: 18px;
            font-weight: 700;
            line-height: 1.3;
            text-transform: capitalize;
        }

        .eduardo-day-dialog-subtitle {
            margin: 6px 0 0;
            font-size: 13px;
            color: #666666;
        }

        .eduardo-day-dialog-close {
            flex: 0 0 auto;
            width: 34px;
            height: 34px;
            border: 0;
            border-radius: 8px;
            background: #eeeeee;
            color: #222222;
            font-size: 24px;
            line-height: 1;
            cursor: pointer;
        }

        .eduardo-day-dialog-close:hover {
            background: #dddddd;
        }

        .eduardo-day-dialog-list {
            max-height: calc(80vh - 105px);
            padding: 14px;
            overflow-y: auto;
            overscroll-behavior: contain;
        }

        .eduardo-day-detail-card {
            display: grid;
            gap: 7px;
            margin-bottom: 10px;
            padding: 13px;
            border: 1px solid #e5e5e5;
            border-left: 4px solid #999999;
            border-radius: 9px;
            background: #fafafa;
            overflow-wrap: anywhere;
        }

        .eduardo-day-detail-card.pending {
            border-left-color: #d8a52d;
        }

        .eduardo-day-detail-card.confirmed {
            border-left-color: #3289d0;
        }

        .eduardo-day-detail-card.completed {
            border-left-color: #32996b;
        }

        .eduardo-day-detail-card.cancelled,
        .eduardo-day-detail-card.no-show {
            border-left-color: #c75c5c;
        }

        .eduardo-day-detail-time {
            font-size: 15px;
            font-weight: 700;
        }

        .eduardo-day-detail-name {
            font-size: 15px;
            font-weight: 600;
        }

        .eduardo-day-detail-meta {
            font-size: 13px;
            color: #555555;
        }

        .eduardo-day-detail-status {
            font-size: 12px;
            font-weight: 700;
        }

        @media (max-width: 700px) {
            #appointmentCalendar .calendar-day {
                padding: 5px 3px;
            }

            #appointmentCalendar .calendar-day-number {
                font-size: 12px;
            }

            #appointmentCalendar .calendar-appointment {
                padding: 4px 3px;
                font-size: 10px;
            }

            #appointmentCalendar .calendar-appointment strong,
            #appointmentCalendar .calendar-appointment span {
                font-size: 10px;
            }

            #appointmentCalendar .calendar-more-button {
                padding: 5px 2px;
                font-size: 10px;
            }

            .eduardo-day-dialog-header {
                padding: 14px;
            }

            .eduardo-day-dialog-title {
                font-size: 16px;
            }

            .eduardo-day-dialog-list {
                padding: 10px;
            }
        }
    `;

    document.head.append(style);
}

/* =====================================================
   INICIALIZACIÓN
===================================================== */

export function initializeAppointmentCalendar(
    callback
) {
    if (initialized) {
        onFiltersChange = callback;
        return;
    }

    elements.barber = document.getElementById(
        "calendarBarberFilter"
    );

    elements.start = document.getElementById(
        "calendarStartDate"
    );

    elements.end = document.getElementById(
        "calendarEndDate"
    );

    elements.today = document.getElementById(
        "calendarTodayButton"
    );

    elements.calendar = document.getElementById(
        "appointmentCalendar"
    );

    elements.count = document.getElementById(
        "calendarAppointmentCount"
    );

    elements.message = document.getElementById(
        "calendarFilterMessage"
    );

    if (
        Object.values(elements).some(
            element => !element
        )
    ) {
        throw new Error(
            "Faltan elementos del calendario en citas.html."
        );
    }

    onFiltersChange = callback;

    installCompactCalendarStyles();
    initializeDetailsDialog();

    const range = getWeekRange();

    elements.start.value = range.start;
    elements.end.value = range.end;

    elements.barber.addEventListener(
        "change",
        notifyChange
    );

    elements.start.addEventListener(
        "change",
        notifyChange
    );

    elements.end.addEventListener(
        "change",
        notifyChange
    );

    elements.today.addEventListener(
        "click",
        () => {
            const currentRange = getWeekRange();

            elements.start.value =
                currentRange.start;

            elements.end.value =
                currentRange.end;

            notifyChange();
        }
    );

    elements.calendar.addEventListener(
        "click",
        handleCalendarClick
    );

    initialized = true;
}

function notifyChange() {
    if (typeof onFiltersChange === "function") {
        onFiltersChange();
    }
}

/* =====================================================
   SELECTOR DE BARBEROS
===================================================== */

function updateBarberOptions(barbers) {
    const previousValue =
        elements.barber.value;

    const options = [
        new Option(
            "Todos los barberos",
            "all"
        )
    ];

    const sorted = [...barbers].sort(
        (a, b) =>
            (a.name || "").localeCompare(
                b.name || "",
                "es"
            )
    );

    for (const barber of sorted) {
        options.push(
            new Option(
                barber.name || barber.id,
                barber.id
            )
        );
    }

    const currentOptions = Array.from(
        elements.barber.options
    ).map(option => option.value);

    const nextOptions = options.map(
        option => option.value
    );

    if (
        JSON.stringify(currentOptions) !==
        JSON.stringify(nextOptions)
    ) {
        elements.barber.replaceChildren(
            ...options
        );

        elements.barber.value =
            nextOptions.includes(previousValue)
                ? previousValue
                : "all";
    }
}

/* =====================================================
   FILTROS
===================================================== */

export function getAppointmentCalendarFilters() {
    if (!initialized) {
        return {
            valid: true,
            barberId: "all",
            start: "",
            end: ""
        };
    }

    const start = elements.start.value;
    const end = elements.end.value;

    const valid = Boolean(
        parseDate(start) &&
        parseDate(end) &&
        start <= end
    );

    return {
        valid,
        barberId: elements.barber.value || "all",
        start,
        end
    };
}

export function filterAppointmentsByCalendar(
    appointments
) {
    const filters =
        getAppointmentCalendarFilters();

    if (!filters.valid) {
        return [];
    }

    return appointments.filter(
        appointment => {
            if (
                filters.barberId !== "all" &&
                appointment.barberId !==
                    filters.barberId
            ) {
                return false;
            }

            if (
                filters.start &&
                appointment.date < filters.start
            ) {
                return false;
            }

            if (
                filters.end &&
                appointment.date > filters.end
            ) {
                return false;
            }

            return true;
        }
    );
}

/* =====================================================
   TARJETA COMPACTA
===================================================== */

function createAppointmentCard(
    appointment,
    barberNames
) {
    const status = getSafeStatus(
        appointment.status
    );

    const card = createElement(
        "div",
        `calendar-appointment ${status}`
    );

    card.append(
        createElement(
            "strong",
            "",
            formatTime(appointment.time)
        ),
        createElement(
            "span",
            "calendar-client",
            appointment.clientName || "Sin nombre"
        ),
        createElement(
            "span",
            "calendar-barber",
            barberNames.get(
                appointment.barberId
            ) || "Barbero no disponible"
        )
    );

    card.title = [
        appointment.clientName || "Sin nombre",
        barberNames.get(
            appointment.barberId
        ) || "Barbero no disponible",
        STATUS_LABELS[status]
    ].join(" · ");

    return card;
}

/* =====================================================
   VENTANA DE DETALLES DEL DÍA
===================================================== */

function initializeDetailsDialog() {
    if (detailsDialog) {
        return;
    }

    detailsDialog = createElement(
        "dialog",
        "eduardo-day-dialog"
    );

    detailsDialog.setAttribute(
        "aria-label",
        "Citas del día"
    );

    detailsDialog.addEventListener(
        "click",
        event => {
            if (event.target === detailsDialog) {
                detailsDialog.close();
            }
        }
    );

    detailsDialog.addEventListener(
        "close",
        () => {
            if (
                previousFocusedElement &&
                previousFocusedElement.isConnected
            ) {
                previousFocusedElement.focus();
            }

            previousFocusedElement = null;
        }
    );

    document.body.append(detailsDialog);
}

function createDetailCard(
    appointment,
    barberNames
) {
    const status = getSafeStatus(
        appointment.status
    );

    const card = createElement(
        "article",
        `eduardo-day-detail-card ${status}`
    );

    const time = createElement(
        "div",
        "eduardo-day-detail-time",
        formatTime(appointment.time) ||
            "Sin horario"
    );

    const name = createElement(
        "div",
        "eduardo-day-detail-name",
        appointment.clientName ||
            "Sin nombre"
    );

    const barber = createElement(
        "div",
        "eduardo-day-detail-meta",
        `Barbero: ${
            barberNames.get(
                appointment.barberId
            ) || "No disponible"
        }`
    );

    const statusElement = createElement(
        "div",
        "eduardo-day-detail-status",
        `Estado: ${STATUS_LABELS[status]}`
    );

    card.append(
        time,
        name,
        barber,
        statusElement
    );

    return card;
}

function openDayDetails(dayKey) {
    const appointments =
        currentAppointmentsByDate.get(
            dayKey
        ) || [];

    if (!appointments.length) {
        return;
    }

    initializeDetailsDialog();

    previousFocusedElement =
        document.activeElement;

    const header = createElement(
        "div",
        "eduardo-day-dialog-header"
    );

    const headingContainer =
        createElement("div");

    const title = createElement(
        "h2",
        "eduardo-day-dialog-title",
        formatFullDate(dayKey)
    );

    title.id =
        "eduardo-day-dialog-title";

    const subtitle = createElement(
        "p",
        "eduardo-day-dialog-subtitle",
        `${appointments.length} ${
            appointments.length === 1
                ? "cita"
                : "citas"
        }`
    );

    headingContainer.append(
        title,
        subtitle
    );

    const closeButton = createElement(
        "button",
        "eduardo-day-dialog-close",
        "×"
    );

    closeButton.type = "button";
    closeButton.setAttribute(
        "aria-label",
        "Cerrar detalles"
    );

    closeButton.addEventListener(
        "click",
        () => detailsDialog.close()
    );

    header.append(
        headingContainer,
        closeButton
    );

    const list = createElement(
        "div",
        "eduardo-day-dialog-list"
    );

    for (const appointment of appointments) {
        list.append(
            createDetailCard(
                appointment,
                currentBarberNames
            )
        );
    }

    detailsDialog.replaceChildren(
        header,
        list
    );

    detailsDialog.setAttribute(
        "aria-labelledby",
        title.id
    );

    if (!detailsDialog.open) {
        detailsDialog.showModal();
    }

    closeButton.focus();
}

function handleCalendarClick(event) {
    const button = event.target.closest(
        ".calendar-more-button"
    );

    if (
        !button ||
        !elements.calendar.contains(button)
    ) {
        return;
    }

    const dayKey = button.dataset.date;

    if (parseDate(dayKey)) {
        openDayDetails(dayKey);
    }
}

/* =====================================================
   CONSTRUIR CALENDARIO
===================================================== */

export function renderAppointmentCalendar(
    appointments,
    barbers
) {
    if (!initialized) {
        return;
    }

    updateBarberOptions(barbers);

    const filters =
        getAppointmentCalendarFilters();

    elements.calendar.replaceChildren();

    if (!filters.valid) {
        elements.message.textContent =
            "Selecciona un rango válido: " +
            "la fecha de inicio debe ser " +
            "anterior o igual a la fecha de fin.";

        elements.count.textContent =
            "0 citas";

        currentAppointmentsByDate =
            new Map();

        return;
    }

    elements.message.textContent = "";

    const filteredAppointments =
        filterAppointmentsByCalendar(
            appointments
        );

    elements.count.textContent =
        `${filteredAppointments.length} ` +
        (
            filteredAppointments.length === 1
                ? "cita"
                : "citas"
        );

    const appointmentsByDate =
        new Map();

    for (
        const appointment of filteredAppointments
    ) {
        if (
            !appointmentsByDate.has(
                appointment.date
            )
        ) {
            appointmentsByDate.set(
                appointment.date,
                []
            );
        }

        appointmentsByDate
            .get(appointment.date)
            .push(appointment);
    }

    for (
        const items of appointmentsByDate.values()
    ) {
        items.sort(
            (a, b) =>
                (a.time || "").localeCompare(
                    b.time || ""
                )
        );
    }

    const barberNames = new Map(
        barbers.map(barber => [
            barber.id,
            barber.name || barber.id
        ])
    );

    currentAppointmentsByDate =
        appointmentsByDate;

    currentBarberNames =
        barberNames;

    const startDate = parseDate(
        filters.start
    );

    const endDate = parseDate(
        filters.end
    );

    const firstMonth = new Date(
        Date.UTC(
            startDate.getUTCFullYear(),
            startDate.getUTCMonth(),
            1,
            12
        )
    );

    const lastMonth = new Date(
        Date.UTC(
            endDate.getUTCFullYear(),
            endDate.getUTCMonth(),
            1,
            12
        )
    );

    const today = getToday();

    const fragment =
        document.createDocumentFragment();

    for (
        let month = new Date(firstMonth);
        month <= lastMonth;
        month.setUTCMonth(
            month.getUTCMonth() + 1
        )
    ) {
        const monthSection =
            createElement(
                "section",
                "calendar-month"
            );

        monthSection.append(
            createElement(
                "h3",
                "calendar-month-title",
                formatMonth(month)
            )
        );

        const weekdayRow =
            createElement(
                "div",
                "calendar-weekdays"
            );

        for (const weekday of WEEKDAYS) {
            weekdayRow.append(
                createElement(
                    "span",
                    "",
                    weekday
                )
            );
        }

        monthSection.append(
            weekdayRow
        );

        const daysGrid =
            createElement(
                "div",
                "calendar-days"
            );

        const year =
            month.getUTCFullYear();

        const monthNumber =
            month.getUTCMonth();

        const daysInMonth = new Date(
            Date.UTC(
                year,
                monthNumber + 1,
                0
            )
        ).getUTCDate();

        const firstWeekday = (
            new Date(
                Date.UTC(
                    year,
                    monthNumber,
                    1
                )
            ).getUTCDay() + 6
        ) % 7;

        for (
            let i = 0;
            i < firstWeekday;
            i++
        ) {
            daysGrid.append(
                createElement(
                    "div",
                    "calendar-day-empty"
                )
            );
        }

        for (
            let day = 1;
            day <= daysInMonth;
            day++
        ) {
            const dayKey = [
                year,
                String(
                    monthNumber + 1
                ).padStart(2, "0"),
                String(day).padStart(2, "0")
            ].join("-");

            const outsideRange =
                dayKey < filters.start ||
                dayKey > filters.end;

            const dayElement =
                createElement(
                    "div",
                    "calendar-day" +
                    (
                        dayKey === today
                            ? " is-today"
                            : ""
                    ) +
                    (
                        outsideRange
                            ? " calendar-day-outside"
                            : ""
                    )
                );

            dayElement.append(
                createElement(
                    "span",
                    "calendar-day-number",
                    day
                )
            );

            if (!outsideRange) {
                const dayAppointments =
                    appointmentsByDate.get(
                        dayKey
                    ) || [];

                /*
                 * Mostrar solamente las primeras
                 * dos citas dentro de la casilla.
                 */
                const visibleAppointments =
                    dayAppointments.slice(
                        0,
                        MAX_VISIBLE_APPOINTMENTS
                    );

                for (
                    const appointment
                    of visibleAppointments
                ) {
                    dayElement.append(
                        createAppointmentCard(
                            appointment,
                            barberNames
                        )
                    );
                }

                /*
                 * Las citas restantes se consultan
                 * mediante una ventana independiente.
                 * La casilla nunca crece por ellas.
                 */
                const hiddenCount =
                    dayAppointments.length -
                    visibleAppointments.length;

                if (hiddenCount > 0) {
                    const moreButton =
                        createElement(
                            "button",
                            "calendar-more-button",
                            `+${hiddenCount} ${
                                hiddenCount === 1
                                    ? "cita más"
                                    : "citas más"
                            }`
                        );

                    moreButton.type =
                        "button";

                    moreButton.dataset.date =
                        dayKey;

                    moreButton.title =
                        `Ver las ${
                            dayAppointments.length
                        } citas del día`;

                    moreButton.setAttribute(
                        "aria-label",
                        `Ver todas las ${
                            dayAppointments.length
                        } citas del ${
                            formatFullDate(dayKey)
                        }`
                    );

                    dayElement.append(
                        moreButton
                    );
                }
            }

            daysGrid.append(
                dayElement
            );
        }

        monthSection.append(
            daysGrid
        );

        fragment.append(
            monthSection
        );
    }

    elements.calendar.append(
        fragment
    );
}

/* =====================================================
   ABRIR CALENDARIO NATIVO
   AL PULSAR LA FECHA
===================================================== */

function enableDatePickers() {
    const dateInputs = [
        document.getElementById(
            "calendarStartDate"
        ),
        document.getElementById(
            "calendarEndDate"
        )
    ];

    dateInputs.forEach(input => {
        if (
            !input ||
            input.dataset.pickerEnabled === "true"
        ) {
            return;
        }

        input.dataset.pickerEnabled =
            "true";

        input.addEventListener(
            "click",
            () => {
                if (
                    typeof input.showPicker ===
                    "function"
                ) {
                    try {
                        input.showPicker();
                    } catch (error) {
                        // El navegador conserva
                        // su selector nativo.
                    }
                }
            }
        );
    });
}

if (
    document.readyState === "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        enableDatePickers,
        { once: true }
    );
} else {
    enableDatePickers();
}
