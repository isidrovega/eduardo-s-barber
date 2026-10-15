
import { db } from "./firebase.js";

import {
    collection,
    query,
    where,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const WEEKDAYS = [
    "Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"
];

const MONTHS = [
    "enero", "febrero", "marzo", "abril",
    "mayo", "junio", "julio", "agosto",
    "septiembre", "octubre", "noviembre", "diciembre"
];

function dateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function createElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;

    return element;
}

export function mountBarberCalendar(container, barberId) {
    if (!(container instanceof HTMLElement)) {
        throw new Error("No se encontró el contenedor del calendario.");
    }

    if (!barberId) {
        throw new Error("No se identificó al barbero.");
    }

    let currentMonth = new Date();
    currentMonth.setDate(1);

    let selectedDate = dateKey(new Date());
    let appointments = [];
    let disposed = false;

    container.replaceChildren();

    const calendar = createElement("section", "barber-calendar");
    const header = createElement("div", "calendar-header");
    const previous = createElement("button", "calendar-nav", "‹");
    const title = createElement("h2", "calendar-title");
    const next = createElement("button", "calendar-nav", "›");
    const weekdays = createElement("div", "calendar-weekdays");
    const grid = createElement("div", "calendar-grid");
    const dayTitle = createElement("h3", "calendar-day-title");
    const dayAppointments = createElement("div", "calendar-appointments");
    const message = createElement("p", "calendar-message");

    previous.type = "button";
    next.type = "button";
    previous.setAttribute("aria-label", "Mes anterior");
    next.setAttribute("aria-label", "Mes siguiente");

    header.append(previous, title, next);

    WEEKDAYS.forEach(day => {
        weekdays.append(
            createElement("span", "calendar-weekday", day)
        );
    });

    calendar.append(
        header,
        weekdays,
        grid,
        dayTitle,
        dayAppointments,
        message
    );

    container.append(calendar);

    function renderDay() {
        dayTitle.textContent = `Citas del ${selectedDate}`;
        dayAppointments.replaceChildren();

        const daily = appointments
            .filter(item =>
                item.date === selectedDate &&
                item.status !== "cancelled"
            )
            .sort((a, b) => a.time.localeCompare(b.time));

        if (!daily.length) {
            dayAppointments.append(
                createElement(
                    "p",
                    "calendar-empty",
                    "No tienes citas para este día."
                )
            );
            return;
        }

        daily.forEach(appointment => {
            const card = createElement("article", "calendar-appointment");
            const time = createElement(
                "strong",
                "calendar-appointment-time",
                appointment.time || "Sin hora"
            );

            const name = createElement(
                "span",
                "calendar-appointment-name",
                appointment.clientName || "Cliente"
            );

            const details = createElement(
                "small",
                "calendar-appointment-details",
                `${appointment.serviceId || "Servicio"} · ${appointment.status || "pending"}`
            );

            const actions = createElement(
    "div",
    "calendar-appointment-actions"
);

const editButton = createElement(
    "button",
    "calendar-action-button",
    "Modificar"
);

const cancelButton = createElement(
    "button",
    "calendar-action-button calendar-action-danger",
    "Cancelar"
);

editButton.type = "button";
cancelButton.type = "button";

editButton.addEventListener("click", () => {
    container.dispatchEvent(
        new CustomEvent("appointment:edit", {
            bubbles: true,
            detail: {
                appointment: { ...appointment }
            }
        })
    );
});

cancelButton.addEventListener("click", () => {
    container.dispatchEvent(
        new CustomEvent("appointment:cancel", {
            bubbles: true,
            detail: {
                appointment: { ...appointment }
            }
        })
    );
});

actions.append(editButton, cancelButton);

card.append(time, name, details, actions);
dayAppointments.append(card);
        });
    }

    function renderMonth() {
        title.textContent =
            `${MONTHS[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

        grid.replaceChildren();

        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const firstWeekday = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = dateKey(new Date());

        for (let i = 0; i < firstWeekday; i++) {
            grid.append(createElement("span", "calendar-blank"));
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = dateKey(new Date(year, month, day));

            const button = createElement(
                "button",
                "calendar-date",
                String(day)
            );

            button.type = "button";

            if (date === today) {
                button.classList.add("is-today");
            }

            if (date === selectedDate) {
                button.classList.add("is-selected");
            }

            const count = appointments.filter(item =>
                item.date === date &&
                item.status !== "cancelled"
            ).length;

            if (count > 0) {
                const indicator = createElement(
                    "span",
                    "calendar-count",
                    String(count)
                );

                button.append(indicator);
                button.setAttribute(
                    "aria-label",
                    `${date}, ${count} citas`
                );
            }

            button.addEventListener("click", () => {
                selectedDate = date;
                renderMonth();
                renderDay();
            });

            grid.append(button);
        }

        renderDay();
    }

    previous.addEventListener("click", () => {
        currentMonth.setMonth(currentMonth.getMonth() - 1);
        renderMonth();
    });

    next.addEventListener("click", () => {
        currentMonth.setMonth(currentMonth.getMonth() + 1);
        renderMonth();
    });

    message.textContent = "Cargando citas...";
    renderMonth();

    const appointmentsQuery = query(
        collection(db, "appointments"),
        where("barberId", "==", barberId)
    );

    const unsubscribe = onSnapshot(
        appointmentsQuery,
        snapshot => {
            if (disposed) return;

            appointments = snapshot.docs.map(document => ({
                ...document.data(),
                id: document.id
            }));

            message.textContent = "";
            renderMonth();
        },
        error => {
            if (disposed) return;

            console.error("Error al cargar citas:", error);
            message.textContent =
                "No se pudieron cargar las citas. Revisa los permisos de Firebase.";
        }
    );

    return () => {
        disposed = true;
        unsubscribe();
        container.replaceChildren();
    };
}
