
import {
    createAppointment,
    updateAppointment
} from "./appointment-booking.js";

import {
    findCustomerByPhone,
    getOrCreateCustomer,
    normalizePhone
} from "./firestore-storage.js";

import { services } from "./data.js";
import { db } from "./firebase.js";

import {
    collection,
    onSnapshot,
    query,
    where
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

/* =========================================================
   EDUARDO'S BARBERSHOP
   FORMULARIO DE CITAS DEL BARBERO

   - Horarios ocupados en tiempo real
   - Respeta la duración de cada servicio
   - Permite crear y modificar citas
   - Registra clientes en Firestore
========================================================= */

const TIME_INTERVAL = 30;
const BUSINESS_TIME_ZONE = "America/Mazatlan";

const DAY_NAMES = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"
];

const BLOCKING_STATUSES = new Set([
    "pending",
    "confirmed",
    "completed"
]);

let activeCleanup = null;

/* =========================================================
   UTILIDADES
========================================================= */

function getElement(id) {
    const element = document.getElementById(id);

    if (!element) {
        throw new Error(`Falta el elemento ${id}.`);
    }

    return element;
}

function minutesToTime(total) {
    const hours = Math.floor(total / 60);
    const minutes = total % 60;

    return (
        String(hours).padStart(2, "0") +
        ":" +
        String(minutes).padStart(2, "0")
    );
}

function timeToMinutes(value) {
    if (!/^\d{2}:\d{2}$/.test(value || "")) {
        return NaN;
    }

    const [hours, minutes] = value
        .split(":")
        .map(Number);

    if (
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
    ) {
        return NaN;
    }

    return hours * 60 + minutes;
}

function getBusinessDateTime() {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: BUSINESS_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date());

    const values = Object.fromEntries(
        parts
            .filter(part => part.type !== "literal")
            .map(part => [part.type, part.value])
    );

    return {
        date: (
            `${values.year}-` +
            `${values.month}-` +
            `${values.day}`
        ),
        time: `${values.hour}:${values.minute}`
    };
}

function getDayName(dateString) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || "")) {
        return null;
    }

    const date = new Date(`${dateString}T12:00:00Z`);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return DAY_NAMES[date.getUTCDay()];
}

function isValidPhone(value) {
    return normalizePhone(value).length >= 7;
}

function getServiceDuration(serviceId) {
    const service = services.find(
        item => item.id === serviceId
    );

    return Number(service?.duration) || 30;
}

function getAppointmentDuration(appointment) {
    const explicitDuration = Number(
        appointment.duration
    );

    if (
        Number.isFinite(explicitDuration) &&
        explicitDuration > 0
    ) {
        return explicitDuration;
    }

    return getServiceDuration(
        appointment.serviceId
    );
}

function isBlockingAppointment(appointment) {
    return BLOCKING_STATUSES.has(
        appointment.status || "pending"
    );
}

function appointmentsOverlap(
    firstStart,
    firstEnd,
    secondStart,
    secondEnd
) {
    return (
        firstStart < secondEnd &&
        secondStart < firstEnd
    );
}

/* =========================================================
   INICIALIZAR FORMULARIO
========================================================= */

export function initializeBarberAppointmentForm(barber) {
    if (
        !barber ||
        !Array.isArray(barber.serviceIds)
    ) {
        throw new Error(
            "No se pudieron cargar los servicios del barbero."
        );
    }

    if (activeCleanup) {
        activeCleanup();
    }

    const form = getElement(
        "barberAppointmentForm"
    );

    const appointmentId = getElement(
        "barberAppointmentId"
    );

    const clientName = getElement(
        "barberClientName"
    );

    const phone = getElement(
        "barberClientPhone"
    );

    const serviceId = getElement(
        "barberServiceId"
    );

    const date = getElement(
        "barberAppointmentDate"
    );

    const time = getElement(
        "barberAppointmentTime"
    );

    const origin = getElement(
        "barberAppointmentOrigin"
    );

    const notes = getElement(
        "barberAppointmentNotes"
    );

    const title = getElement(
        "appointmentEditorTitle"
    );

    const saveButton = getElement(
        "saveBarberAppointmentButton"
    );

    const resetButton = getElement(
        "resetBarberAppointmentButton"
    );

    const message = getElement(
        "barberAppointmentMessage"
    );

    const calendar = getElement(
        "barberCalendar"
    );

    const controller = new AbortController();
    const { signal } = controller;

    let appointments = [];
    let appointmentsLoaded = false;
    let appointmentsError = false;

    let saving = false;
    let disposed = false;

    let customerLookupVersion = 0;
    let unsubscribeAppointments = null;

    /*
       El ID del barbero se obtiene del documento
       si está incluido en el objeto. Si no,
       se consulta desde el perfil autenticado.
    */

    let barberId = barber.id || null;

    /* =====================================================
       CARGAR SERVICIOS
    ===================================================== */

    serviceId.replaceChildren(
        new Option(
            "Selecciona un servicio",
            ""
        )
    );

    services
        .filter(service =>
            barber.serviceIds.includes(
                service.id
            )
        )
        .forEach(service => {
            serviceId.add(
                new Option(
                    `${service.name} (${service.duration} min)`,
                    service.id
                )
            );
        });

    /* =====================================================
       DISPONIBILIDAD
    ===================================================== */

    function getOccupiedAppointments(
        selectedDate
    ) {
        return appointments.filter(
            appointment =>
                appointment.date === selectedDate &&
                isBlockingAppointment(
                    appointment
                ) &&
                appointment.id !==
                    appointmentId.value
        );
    }

    function isTimeAvailable(
        start,
        duration,
        selectedDate
    ) {
        const end = start + duration;

        const occupiedAppointments =
            getOccupiedAppointments(
                selectedDate
            );

        return !occupiedAppointments.some(
            appointment => {
                const occupiedStart =
                    timeToMinutes(
                        appointment.time
                    );

                if (
                    !Number.isFinite(
                        occupiedStart
                    )
                ) {
                    // No ofrecer un horario como libre
                    // si la cita tiene datos inválidos.
                    return true;
                }

                const occupiedEnd =
                    occupiedStart +
                    getAppointmentDuration(
                        appointment
                    );

                return appointmentsOverlap(
                    start,
                    end,
                    occupiedStart,
                    occupiedEnd
                );
            }
        );
    }

    function renderTimes() {
        const previousTime = time.value;

        time.replaceChildren(
            new Option(
                "Selecciona una hora",
                ""
            )
        );

        if (
            !date.value ||
            !serviceId.value
        ) {
            return;
        }

        if (!appointmentsLoaded) {
            message.textContent =
                appointmentsError
                    ? "No se pudo consultar la disponibilidad."
                    : "Consultando horarios disponibles...";

            return;
        }

        const dayName = getDayName(
            date.value
        );

        const schedule =
            barber.schedule?.[dayName];

        if (!schedule?.enabled) {
            message.textContent =
                "El barbero no trabaja ese día.";

            return;
        }

        const selectedService =
            services.find(
                service =>
                    service.id ===
                    serviceId.value
            );

        if (!selectedService) {
            return;
        }

        const opening = timeToMinutes(
            schedule.start
        );

        const closing = timeToMinutes(
            schedule.end
        );

        if (
            !Number.isFinite(opening) ||
            !Number.isFinite(closing) ||
            closing <= opening
        ) {
            message.textContent =
                "El horario del barbero no es válido.";

            return;
        }

        const now = getBusinessDateTime();

        const selectedDate = date.value;
        const editing = Boolean(
            appointmentId.value
        );

        if (selectedDate < now.date) {
            message.textContent =
                "No se pueden agendar citas en fechas pasadas.";

            return;
        }

        const currentMinutes =
            timeToMinutes(now.time);

        const duration =
            selectedService.duration;

        let availableCount = 0;

        for (
            let start = opening;
            start + duration <= closing;
            start += TIME_INTERVAL
        ) {
            const value =
                minutesToTime(start);

            /*
               No mostrar horas pasadas.
               La validación definitiva también
               se realiza en Netlify.
            */

            if (
                selectedDate === now.date &&
                start <= currentMinutes
            ) {
                continue;
            }

            /*
               Revisar el intervalo completo
               que ocupará el servicio.
            */

            if (
                !isTimeAvailable(
                    start,
                    duration,
                    selectedDate
                )
            ) {
                continue;
            }

            time.add(
                new Option(
                    value,
                    value
                )
            );

            availableCount++;
        }

        /*
           Si estamos editando una cita,
           mantener su hora anterior solo
           cuando todavía sea una opción
           válida según la disponibilidad.
        */

        if (
            previousTime &&
            Array.from(time.options).some(
                option =>
                    option.value ===
                    previousTime
            )
        ) {
            time.value = previousTime;
        }

        if (
            availableCount === 0
        ) {
            message.textContent =
                editing
                    ? "No hay otros horarios disponibles para esta cita."
                    : "No hay horarios disponibles para ese día.";
        } else if (
            message.textContent.includes(
                "horarios disponibles"
            ) ||
            message.textContent.includes(
                "Consultando horarios"
            ) ||
            message.textContent.includes(
                "no trabaja ese día"
            )
        ) {
            message.textContent = "";
        }
    }

    /* =====================================================
       SUSCRIPCIÓN A FIRESTORE
    ===================================================== */

    function listenToAppointments(
        currentBarberId
    ) {
        if (
            !currentBarberId ||
            typeof currentBarberId !==
                "string"
        ) {
            appointmentsLoaded = false;
            appointmentsError = true;

            message.textContent =
                "No se pudo identificar al barbero.";

            return;
        }

        barberId = currentBarberId;

        if (
            unsubscribeAppointments
        ) {
            unsubscribeAppointments();
        }

        appointmentsLoaded = false;
        appointmentsError = false;

        const appointmentsQuery = query(
            collection(
                db,
                "appointments"
            ),
            where(
                "barberId",
                "==",
                barberId
            )
        );

        unsubscribeAppointments =
            onSnapshot(
                appointmentsQuery,
                snapshot => {
                    if (disposed) {
                        return;
                    }

                    appointments =
                        snapshot.docs.map(
                            document => ({
                                ...document.data(),
                                id: document.id
                            })
                        );

                    appointmentsLoaded = true;
                    appointmentsError = false;

                    renderTimes();
                },
                error => {
                    if (disposed) {
                        return;
                    }

                    console.error(
                        "Error consultando horarios:",
                        error
                    );

                    appointmentsLoaded = false;
                    appointmentsError = true;

                    renderTimes();

                    message.textContent =
                        "No se pudo consultar la disponibilidad de citas.";
                }
            );
    }

    /* =====================================================
       OBTENER ID DEL BARBERO
    ===================================================== */

    async function initializeAvailability() {
        if (barberId) {
            listenToAppointments(
                barberId
            );

            return;
        }

        try {
            const { auth } = await import(
                "./firebase.js"
            );

            const {
                doc,
                getDoc
            } = await import(
                "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js"
            );

            await auth.authStateReady();

            const user =
                auth.currentUser;

            if (!user) {
                throw new Error(
                    "No hay una sesión activa."
                );
            }

            const profileSnapshot =
                await getDoc(
                    doc(
                        db,
                        "users",
                        user.uid
                    )
                );

            if (
                !profileSnapshot.exists()
            ) {
                throw new Error(
                    "No se encontró el perfil del barbero."
                );
            }

            const profile =
                profileSnapshot.data();

            if (
                !profile.barberId
            ) {
                throw new Error(
                    "El perfil no tiene un barbero asignado."
                );
            }

            if (disposed) {
                return;
            }

            listenToAppointments(
                profile.barberId
            );
        } catch (error) {
            if (disposed) {
                return;
            }

            console.error(
                "Error identificando al barbero:",
                error
            );

            appointmentsLoaded = false;
            appointmentsError = true;

            message.textContent =
                error.message ||
                "No se pudo cargar la disponibilidad.";
        }
    }

    /* =====================================================
       DETECTAR CLIENTE
    ===================================================== */

    async function detectCustomer() {
        const currentPhone =
            phone.value.trim();

        const version =
            ++customerLookupVersion;

        if (
            !isValidPhone(
                currentPhone
            )
        ) {
            if (!saving) {
                message.textContent = "";
            }

            return;
        }

        if (!saving) {
            message.textContent =
                "Buscando cliente en Firebase...";
        }

        try {
            const customer =
                await findCustomerByPhone(
                    currentPhone
                );

            if (
                disposed ||
                version !==
                    customerLookupVersion ||
                normalizePhone(
                    phone.value
                ) !==
                    normalizePhone(
                        currentPhone
                    )
            ) {
                return;
            }

            if (saving) {
                return;
            }

            if (customer) {
                if (
                    !clientName.value.trim()
                ) {
                    clientName.value =
                        customer.name || "";
                }

                message.textContent =
                    `Cliente registrado: ${customer.name || "Sin nombre"}. ` +
                    `${Number(customer.visits) || 0} visitas.`;
            } else {
                message.textContent =
                    "Cliente nuevo. Se registrará al guardar la cita.";
            }
        } catch (error) {
            console.error(
                "Error buscando cliente:",
                error
            );

            if (
                !disposed &&
                version ===
                    customerLookupVersion &&
                !saving
            ) {
                message.textContent =
                    "No se pudo consultar el cliente.";
            }
        }
    }

    /* =====================================================
       REINICIAR FORMULARIO
    ===================================================== */

    function resetForm() {
        ++customerLookupVersion;

        form.reset();

        appointmentId.value = "";

        const now =
            getBusinessDateTime();

        date.min = now.date;
        date.value = now.date;

        title.textContent =
            "Agendar cita";

        saveButton.textContent =
            "Guardar cita";

        message.textContent = "";

        renderTimes();
    }

    /* =====================================================
       EDITAR CITA
    ===================================================== */

    function handleEditAppointment(
        event
    ) {
        const appointment =
            event.detail?.appointment;

        if (
            !appointment?.id
        ) {
            return;
        }

        ++customerLookupVersion;

        appointmentId.value =
            appointment.id;

        clientName.value =
            appointment.clientName || "";

        phone.value =
            appointment.phone || "";

        serviceId.value =
            appointment.serviceId || "";

        date.value =
            appointment.date || "";

        origin.value =
            appointment.origin || "phone";

        notes.value =
            appointment.notes || "";

        date.min = "";

        /*
           Renderizar horarios excluyendo
           la propia cita del bloqueo.
        */

        renderTimes();

        const originalTime =
            appointment.time || "";

        /*
           Conservar la hora original solo
           si sigue siendo una opción válida.
        */

        if (
            Array.from(
                time.options
            ).some(
                option =>
                    option.value ===
                    originalTime
            )
        ) {
            time.value =
                originalTime;
        } else {
            time.value = "";
        }

        title.textContent =
            "Modificar cita";

        saveButton.textContent =
            "Guardar cambios";

        if (
            appointmentsLoaded &&
            !time.value
        ) {
            message.textContent =
                "Selecciona un horario disponible para modificar esta cita.";
        } else {
            message.textContent = "";
        }

        form.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    /* =====================================================
       GUARDAR CITA Y CLIENTE
    ===================================================== */

    async function handleSubmit(
        event
    ) {
        event.preventDefault();

        if (saving) {
            return;
        }

        if (
            !form.reportValidity()
        ) {
            return;
        }

        if (
            !appointmentsLoaded
        ) {
            message.textContent =
                "Espera a que se carguen los horarios disponibles.";

            return;
        }

        const nameValue =
            clientName.value.trim();

        const phoneValue =
            phone.value.trim();

        const editingId =
            appointmentId.value.trim();

        if (
            !nameValue
        ) {
            message.textContent =
                "Ingresa el nombre del cliente.";

            clientName.focus();
            return;
        }

        if (
            !isValidPhone(
                phoneValue
            )
        ) {
            message.textContent =
                "Ingresa un teléfono válido.";

            phone.focus();
            return;
        }

        if (
            !serviceId.value ||
            !date.value ||
            !time.value
        ) {
            message.textContent =
                "Selecciona servicio, fecha y hora.";

            return;
        }

        /*
           Validar de nuevo antes de enviar,
           por si alguien ocupó la hora
           mientras el formulario estaba abierto.
        */

        const selectedService =
            services.find(
                service =>
                    service.id ===
                    serviceId.value
            );

        if (
            !selectedService
        ) {
            message.textContent =
                "El servicio seleccionado no es válido.";

            return;
        }

        const selectedStart =
            timeToMinutes(
                time.value
            );

        if (
            !isTimeAvailable(
                selectedStart,
                selectedService.duration,
                date.value
            )
        ) {
            message.textContent =
                "Ese horario acaba de ocuparse. Selecciona otro.";

            renderTimes();

            return;
        }

        const appointment = {
            clientName: nameValue,
            phone: phoneValue,
            serviceId: serviceId.value,
            date: date.value,
            time: time.value,
            origin: origin.value,
            notes: notes.value.trim()
        };

        ++customerLookupVersion;

        saving = true;

        saveButton.disabled = true;
        resetButton.disabled = true;

        message.textContent =
            editingId
                ? "Guardando cambios..."
                : "Guardando cita...";

        let appointmentSaved =
            false;

        try {
            if (
                editingId
            ) {
                await updateAppointment(
                    editingId,
                    appointment
                );
            } else {
                await createAppointment(
                    appointment
                );
            }

            appointmentSaved = true;

            message.textContent =
                "Cita guardada. Registrando cliente...";

            await getOrCreateCustomer(
                nameValue,
                phoneValue
            );

            resetForm();

            message.textContent =
                editingId
                    ? "Cita modificada y cliente actualizado correctamente."
                    : "Cita y cliente registrados correctamente en Firebase.";
        } catch (error) {
            console.error(
                "Error guardando cita:",
                error
            );

            if (
                appointmentSaved
            ) {
                resetForm();

                message.textContent =
                    "La cita se guardó, pero no se pudo registrar el cliente.";
            } else {
                message.textContent =
                    error.message ||
                    "No se pudo guardar la cita.";

                renderTimes();
            }
        } finally {
            saving = false;

            saveButton.disabled = false;
            resetButton.disabled = false;
        }
    }

    /* =====================================================
       EVENTOS
    ===================================================== */

    date.addEventListener(
        "change",
        renderTimes,
        { signal }
    );

    serviceId.addEventListener(
        "change",
        renderTimes,
        { signal }
    );

    phone.addEventListener(
        "blur",
        detectCustomer,
        { signal }
    );

    resetButton.addEventListener(
        "click",
        resetForm,
        { signal }
    );

    calendar.addEventListener(
        "appointment:edit",
        handleEditAppointment,
        { signal }
    );

    form.addEventListener(
        "submit",
        handleSubmit,
        { signal }
    );

    /* =====================================================
       LIMPIEZA
    ===================================================== */

    function cleanup() {
        if (disposed) {
            return;
        }

        disposed = true;

        ++customerLookupVersion;

        controller.abort();

        if (
            unsubscribeAppointments
        ) {
            unsubscribeAppointments();

            unsubscribeAppointments = null;
        }

        if (
            activeCleanup === cleanup
        ) {
            activeCleanup = null;
        }
    }

    activeCleanup = cleanup;

    resetForm();

    initializeAvailability();

    return cleanup;
}
