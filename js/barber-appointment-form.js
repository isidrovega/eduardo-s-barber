
import {
    createAppointment,
    updateAppointment
} from "./appointment-booking.js";

import { services } from "./data.js";

const TIME_INTERVAL = 30;

function getElement(id) {
    const element = document.getElementById(id);

    if (!element) {
        throw new Error(`Falta el elemento ${id}.`);
    }

    return element;
}

function minutesToTime(total) {
    return (
        String(Math.floor(total / 60)).padStart(2, "0") +
        ":" +
        String(total % 60).padStart(2, "0")
    );
}

function timeToMinutes(value) {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
}

function localDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function getDayName(dateString) {
    const date = new Date(`${dateString}T12:00:00Z`);

    return [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday"
    ][date.getUTCDay()];
}

export function initializeBarberAppointmentForm(barber) {
    if (!barber || !Array.isArray(barber.serviceIds)) {
        throw new Error("No se pudieron cargar los servicios del barbero.");
    }

    const form = getElement("barberAppointmentForm");
    const appointmentId = getElement("barberAppointmentId");
    const clientName = getElement("barberClientName");
    const phone = getElement("barberClientPhone");
    const serviceId = getElement("barberServiceId");
    const date = getElement("barberAppointmentDate");
    const time = getElement("barberAppointmentTime");
    const origin = getElement("barberAppointmentOrigin");
    const notes = getElement("barberAppointmentNotes");
    const title = getElement("appointmentEditorTitle");
    const saveButton = getElement("saveBarberAppointmentButton");
    const resetButton = getElement("resetBarberAppointmentButton");
    const message = getElement("barberAppointmentMessage");
    const calendar = getElement("barberCalendar");

    serviceId.replaceChildren(
        new Option("Selecciona un servicio", "")
    );

    services
        .filter(service => barber.serviceIds.includes(service.id))
        .forEach(service => {
            serviceId.add(
                new Option(
                    `${service.name} (${service.duration} min)`,
                    service.id
                )
            );
        });

    function renderTimes() {
        const previousTime = time.value;

        time.replaceChildren(
            new Option("Selecciona una hora", "")
        );

        if (!date.value || !serviceId.value) {
            return;
        }

        const schedule = barber.schedule?.[getDayName(date.value)];

        if (!schedule?.enabled) {
            message.textContent = "El barbero no trabaja ese día.";
            return;
        }

        const selectedService = services.find(
            service => service.id === serviceId.value
        );

        if (!selectedService) {
            return;
        }

        const opening = timeToMinutes(schedule.start);
        const closing = timeToMinutes(schedule.end);

        for (
            let start = opening;
            start + selectedService.duration <= closing;
            start += TIME_INTERVAL
        ) {
            const value = minutesToTime(start);
            time.add(new Option(value, value));
        }

        if (
            Array.from(time.options).some(
                option => option.value === previousTime
            )
        ) {
            time.value = previousTime;
        }
    }

    function resetForm() {
        form.reset();
        appointmentId.value = "";
        date.value = localDate();
        title.textContent = "Agendar cita";
        saveButton.textContent = "Guardar cita";
        message.textContent = "";
        renderTimes();
    }

    date.addEventListener("change", renderTimes);
    serviceId.addEventListener("change", renderTimes);
    resetButton.addEventListener("click", resetForm);

    calendar.addEventListener("appointment:edit", event => {
        const appointment = event.detail?.appointment;

        if (!appointment?.id) {
            return;
        }

        appointmentId.value = appointment.id;
        clientName.value = appointment.clientName || "";
        phone.value = appointment.phone || "";
        serviceId.value = appointment.serviceId || "";
        date.value = appointment.date || "";
        origin.value = appointment.origin || "phone";
        notes.value = appointment.notes || "";

        renderTimes();
        time.value = appointment.time || "";

        title.textContent = "Modificar cita";
        saveButton.textContent = "Guardar cambios";
        message.textContent = "";

        form.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    });

    form.addEventListener("submit", async event => {
        event.preventDefault();

        if (!form.reportValidity()) {
            return;
        }

        const appointment = {
            clientName: clientName.value.trim(),
            phone: phone.value.trim(),
            serviceId: serviceId.value,
            date: date.value,
            time: time.value,
            origin: origin.value,
            notes: notes.value.trim()
        };

        saveButton.disabled = true;
        message.textContent = "Guardando cita...";

        try {
            if (appointmentId.value) {
                await updateAppointment(
                    appointmentId.value,
                    appointment
                );

                message.textContent =
                    "Cita modificada correctamente.";
            } else {
                await createAppointment(appointment);

                message.textContent =
                    "Cita agendada correctamente.";
            }

            form.reset();
            appointmentId.value = "";
            date.value = localDate();
            title.textContent = "Agendar cita";
            saveButton.textContent = "Guardar cita";
            renderTimes();
        } catch (error) {
            console.error("Error al guardar cita:", error);

            message.textContent =
                error.message || "No se pudo guardar la cita.";
        } finally {
            saveButton.disabled = false;
        }
    });

    resetForm();

    return () => {
        form.replaceWith(form.cloneNode(true));
    };
}
