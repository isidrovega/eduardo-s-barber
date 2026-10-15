
/* =====================================================
   EDUARDO'S BARBERSHOP
   CALENDARIO DE CITAS DEL ADMINISTRADOR
===================================================== */

const TIME_ZONE = "America/Mazatlan";

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

    return `${values.year}-${values.month}-${values.day}`;
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

function formatDateKey(date) {
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
        String(date.getUTCDate()).padStart(2, "0")
    ].join("-");
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

    const weekday = (date.getUTCDay() + 6) % 7;

    const start = addDays(today, -weekday);

    return {
        start,
        end: addDays(start, 6)
    };
}

function formatMonth(date) {
    return new Intl.DateTimeFormat("es-MX", {
        month: "long",
        year: "numeric",
        timeZone: "UTC"
    }).format(date);
}

function formatTime(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(value || "");

    if (!match) {
        return value || "";
    }

    const hours = Number(match[1]);
    const minutes = match[2];

    return `${hours % 12 || 12}:${minutes} ${hours >= 12 ? "PM" : "AM"}`;
}

/* =====================================================
   ELEMENTOS SEGUROS
===================================================== */

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

            elements.start.value = currentRange.start;
            elements.end.value = currentRange.end;

            notifyChange();
        }
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
    const previousValue = elements.barber.value;

    const options = [
        new Option("Todos los barberos", "all")
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
        elements.barber.replaceChildren(...options);

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
    const filters = getAppointmentCalendarFilters();

    if (!filters.valid) {
        return [];
    }

    return appointments.filter(appointment => {
        if (
            filters.barberId !== "all" &&
            appointment.barberId !== filters.barberId
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
    });
}

/* =====================================================
   CREAR TARJETA DE CITA
===================================================== */

function createAppointmentCard(
    appointment,
    barberNames
) {
    const status = Object.hasOwn(
        STATUS_LABELS,
        appointment.status
    )
        ? appointment.status
        : "pending";

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
            barberNames.get(appointment.barberId) ||
                "Barbero no disponible"
        )
    );

    card.title = [
        appointment.clientName || "Sin nombre",
        barberNames.get(appointment.barberId) ||
            "Barbero no disponible",
        STATUS_LABELS[status]
    ].join(" · ");

    return card;
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

    const filters = getAppointmentCalendarFilters();

    elements.calendar.replaceChildren();

    if (!filters.valid) {
        elements.message.textContent =
            "Selecciona un rango válido: la fecha de inicio debe ser anterior o igual a la fecha de fin.";

        elements.count.textContent = "0 citas";
        return;
    }

    elements.message.textContent = "";

    const filteredAppointments =
        filterAppointmentsByCalendar(appointments);

    elements.count.textContent =
        `${filteredAppointments.length} ` +
        (
            filteredAppointments.length === 1
                ? "cita"
                : "citas"
        );

    const appointmentsByDate = new Map();

    for (const appointment of filteredAppointments) {
        if (!appointmentsByDate.has(appointment.date)) {
            appointmentsByDate.set(
                appointment.date,
                []
            );
        }

        appointmentsByDate
            .get(appointment.date)
            .push(appointment);
    }

    for (const items of appointmentsByDate.values()) {
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

    const startDate = parseDate(filters.start);
    const endDate = parseDate(filters.end);

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

    const fragment = document.createDocumentFragment();

    for (
        let month = new Date(firstMonth);
        month <= lastMonth;
        month.setUTCMonth(month.getUTCMonth() + 1)
    ) {
        const monthSection = createElement(
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

        const weekdayRow = createElement(
            "div",
            "calendar-weekdays"
        );

        for (const weekday of WEEKDAYS) {
            weekdayRow.append(
                createElement("span", "", weekday)
            );
        }

        monthSection.append(weekdayRow);

        const daysGrid = createElement(
            "div",
            "calendar-days"
        );

        const year = month.getUTCFullYear();
        const monthNumber = month.getUTCMonth();

        const daysInMonth = new Date(
            Date.UTC(year, monthNumber + 1, 0)
        ).getUTCDate();

        const firstWeekday = (
            new Date(
                Date.UTC(year, monthNumber, 1)
            ).getUTCDay() + 6
        ) % 7;

        for (let i = 0; i < firstWeekday; i++) {
            daysGrid.append(
                createElement(
                    "div",
                    "calendar-day-empty"
                )
            );
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dayKey = [
                year,
                String(monthNumber + 1).padStart(2, "0"),
                String(day).padStart(2, "0")
            ].join("-");

            const outsideRange =
                dayKey < filters.start ||
                dayKey > filters.end;

            const dayElement = createElement(
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
                    appointmentsByDate.get(dayKey) || [];

                for (const appointment of dayAppointments) {
                    dayElement.append(
                        createAppointmentCard(
                            appointment,
                            barberNames
                        )
                    );
                }
            }

            daysGrid.append(dayElement);
        }

        monthSection.append(daysGrid);
        fragment.append(monthSection);
    }

    elements.calendar.append(fragment);
}
