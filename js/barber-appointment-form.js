
import {
    createAppointment,
    updateAppointment
} from "./appointment-booking.js";

import {
    normalizePhone,
    getServices
} from "./firestore-storage.js";

import {
    createCustomerSelector
} from "./customer-selector.js";

import {
    getBarberCustomerById
} from "./barber-customers.js";

import { auth, db } from "./firebase.js";

import {
    collection,
    doc,
    getDoc,
    onSnapshot,
    query,
    where
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

/* =========================================================
   EDUARDO'S BARBERSHOP
   FORMULARIO DE CITAS DEL BARBERO

   - Crear citas con customerId permanente
   - Editar citas existentes
   - Clientes con teléfono opcional
   - Buscar clientes por nombre o teléfono
   - Seleccionar clientes existentes
   - Registrar clientes mediante Netlify
   - Servicios asignados desde Firebase
   - Disponibilidad en tiempo real
   - Protección contra horarios ocupados
   - Duración real de los servicios
   - Compatibilidad con citas históricas
   - Limpieza de listeners
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
        throw new Error(
            `Falta el elemento ${id}.`
        );
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
    if (
        typeof value !== "string" ||
        !/^\d{2}:\d{2}$/.test(value)
    ) {
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
    const parts = new Intl.DateTimeFormat(
        "en-US",
        {
            timeZone: BUSINESS_TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }
    ).formatToParts(new Date());

    const values = Object.fromEntries(
        parts
            .filter(
                part => part.type !== "literal"
            )
            .map(
                part => [
                    part.type,
                    part.value
                ]
            )
    );

    return {
        date:
            `${values.year}-` +
            `${values.month}-` +
            `${values.day}`,

        time:
            `${values.hour}:` +
            `${values.minute}`
    };
}

function getDayName(dateString) {
    if (
        typeof dateString !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(dateString)
    ) {
        return null;
    }

    const date = new Date(
        `${dateString}T12:00:00Z`
    );

    if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !==
            dateString
    ) {
        return null;
    }

    return DAY_NAMES[
        date.getUTCDay()
    ];
}

function isValidPhone(value) {
    const raw = String(
        value || ""
    ).trim();

    if (!raw) {
        return true;
    }

    const normalized = normalizePhone(raw);

    return (
        normalized.length >= 7 &&
        normalized.length <= 15
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

function normalizeCustomerName(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("es");
}

function validCustomerId(value) {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 150 &&
        value !== "." &&
        value !== ".." &&
        !value.includes("/")
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

    /* =====================================================
       ELEMENTOS
    ===================================================== */

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

    /* =====================================================
       ESTADO
    ===================================================== */

    const controller = new AbortController();
    const { signal } = controller;

    let services = [];
    let servicesLoaded = false;

    let appointments = [];
    let appointmentsLoaded = false;
    let appointmentsError = false;

    let saving = false;
    let disposed = false;

    let unsubscribeAppointments = null;

    let barberId = barber.id || null;

    let editingCustomerId = null;
    let editingOriginalCustomer = null;
    let editVersion = 0;

    /* =====================================================
       CONTENEDOR DEL SELECTOR DE CLIENTES

       Se crea desde JavaScript para no exigir
       modificaciones al HTML existente.
    ===================================================== */

    const customerSelectorContainer =
        document.createElement("div");

    customerSelectorContainer.id =
        "barberCustomerSelectorContainer";

    customerSelectorContainer.className =
        "barber-customer-selector-container";

    customerSelectorContainer.setAttribute(
        "aria-live",
        "polite"
    );

    const phoneWrapper =
        phone.closest(
            ".form-group, .form-field, .field"
        );

    if (
        phoneWrapper &&
        phoneWrapper !== form &&
        form.contains(phoneWrapper)
    ) {
        phoneWrapper.insertAdjacentElement(
            "afterend",
            customerSelectorContainer
        );
    } else {
        phone.insertAdjacentElement(
            "afterend",
            customerSelectorContainer
        );
    }

    const customerSelector =
        createCustomerSelector({
            nameInput: clientName,
            phoneInput: phone,
            container: customerSelectorContainer
        });

    /* =====================================================
       UTILIDADES DE INTERFAZ
    ===================================================== */

    function setMessage(text) {
        if (!disposed) {
            message.textContent = text;
        }
    }

    function setSavingState(value) {
        saving = value;

        saveButton.disabled = value;
        resetButton.disabled = value;

        clientName.disabled = value;
        phone.disabled = value;
        serviceId.disabled =
            value || !servicesLoaded ||
            services.length === 0;

        date.disabled = value;
        time.disabled =
            value ||
            !appointmentsLoaded ||
            time.options.length <= 1;

        origin.disabled = value;
        notes.disabled = value;
    }

    /* =====================================================
       SERVICIOS
    ===================================================== */

    function getService(selectedServiceId) {
        return services.find(
            service =>
                String(service.id) ===
                String(selectedServiceId)
        );
    }

    function getServiceDuration(selectedServiceId) {
        const service = getService(
            selectedServiceId
        );

        const duration = Number(
            service?.duration
        );

        return (
            Number.isFinite(duration) &&
            duration > 0
        )
            ? duration
            : 30;
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

    async function loadAssignedServices() {
        serviceId.replaceChildren(
            new Option(
                "Cargando servicios...",
                ""
            )
        );

        serviceId.disabled = true;
        servicesLoaded = false;

        try {
            const firebaseServices =
                await getServices();

            if (disposed) {
                return;
            }

            const assignedIds = new Set(
                barber.serviceIds.map(String)
            );

            services = (
                Array.isArray(firebaseServices)
                    ? firebaseServices
                    : []
            ).filter(
                service =>
                    service.status === "active" &&
                    assignedIds.has(
                        String(service.id)
                    )
            );

            servicesLoaded = true;

            serviceId.replaceChildren(
                new Option(
                    "Selecciona un servicio",
                    ""
                )
            );

            services.forEach(service => {
                const price = Number(
                    service.price
                );

                const duration = Number(
                    service.duration
                );

                const priceText =
                    Number.isFinite(price)
                        ? ` · $${price}`
                        : "";

                const durationText =
                    Number.isFinite(duration) &&
                    duration > 0
                        ? ` · ${duration} min`
                        : "";

                serviceId.add(
                    new Option(
                        `${service.name}${priceText}${durationText}`,
                        service.id
                    )
                );
            });

            if (services.length === 0) {
                serviceId.replaceChildren(
                    new Option(
                        "Sin servicios asignados",
                        ""
                    )
                );

                serviceId.disabled = true;

                setMessage(
                    "No tienes servicios activos asignados. " +
                    "Contacta al administrador."
                );

                return;
            }

            serviceId.disabled = saving;

            renderTimes();

        } catch (error) {
            if (disposed) {
                return;
            }

            console.error(
                "Error cargando servicios:",
                error
            );

            servicesLoaded = false;

            serviceId.replaceChildren(
                new Option(
                    "No se pudieron cargar los servicios",
                    ""
                )
            );

            serviceId.disabled = true;

            setMessage(
                "No se pudieron consultar los servicios de Firebase."
            );
        }
    }

    /* =====================================================
       CITAS QUE BLOQUEAN HORARIOS
    ===================================================== */

    function getOccupiedAppointments(selectedDate) {
        return appointments.filter(
            appointment =>
                appointment.date === selectedDate &&
                isBlockingAppointment(appointment) &&
                appointment.id !==
                    appointmentId.value
        );
    }

    function isTimeAvailable(
        start,
        duration,
        selectedDate
    ) {
        if (
            !Number.isFinite(start) ||
            !Number.isFinite(duration) ||
            duration <= 0
        ) {
            return false;
        }

        const end = start + duration;

        return !getOccupiedAppointments(
            selectedDate
        ).some(appointment => {
            const occupiedStart =
                timeToMinutes(
                    appointment.time
                );

            if (
                !Number.isFinite(occupiedStart)
            ) {
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
        });
    }

    /* =====================================================
       HORARIOS DISPONIBLES
    ===================================================== */

    function renderTimes() {
        if (disposed) {
            return;
        }

        const previousTime = time.value;

        time.replaceChildren(
            new Option(
                "Selecciona una hora",
                ""
            )
        );

        time.disabled = true;

        if (
            !date.value ||
            !serviceId.value
        ) {
            return;
        }

        if (!servicesLoaded) {
            setMessage(
                "Cargando servicios..."
            );
            return;
        }

        if (!appointmentsLoaded) {
            setMessage(
                appointmentsError
                    ? "No se pudo consultar la disponibilidad."
                    : "Consultando horarios disponibles..."
            );
            return;
        }

        const dayName =
            getDayName(date.value);

        const schedule =
            barber.schedule?.[dayName];

        if (!schedule?.enabled) {
            setMessage(
                "El barbero no trabaja ese día."
            );
            return;
        }

        const selectedService =
            getService(
                serviceId.value
            );

        if (!selectedService) {
            setMessage(
                "El servicio seleccionado no está disponible."
            );
            return;
        }

        const opening =
            timeToMinutes(
                schedule.start
            );

        const closing =
            timeToMinutes(
                schedule.end
            );

        if (
            !Number.isFinite(opening) ||
            !Number.isFinite(closing) ||
            closing <= opening
        ) {
            setMessage(
                "El horario del barbero no es válido."
            );
            return;
        }

        const now =
            getBusinessDateTime();

        const selectedDate =
            date.value;

        if (
            selectedDate < now.date
        ) {
            setMessage(
                "No se pueden agendar citas en fechas pasadas."
            );
            return;
        }

        const currentMinutes =
            timeToMinutes(
                now.time
            );

        const duration = Number(
            selectedService.duration
        );

        if (
            !Number.isFinite(duration) ||
            duration <= 0
        ) {
            setMessage(
                "La duración del servicio no es válida."
            );
            return;
        }

        let availableCount = 0;

        /*
         * Alinear las horas de inicio con
         * la validación del servidor:
         * 00 y 30 minutos.
         */
        const firstStart =
            Math.ceil(
                opening / TIME_INTERVAL
            ) * TIME_INTERVAL;

        for (
            let start = firstStart;
            start + duration <= closing;
            start += TIME_INTERVAL
        ) {
            const value =
                minutesToTime(start);

            if (
                selectedDate === now.date &&
                start <= currentMinutes
            ) {
                continue;
            }

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

        time.disabled =
            saving ||
            availableCount === 0;

        if (
            previousTime &&
            Array.from(
                time.options
            ).some(
                option =>
                    option.value ===
                    previousTime
            )
        ) {
            time.value =
                previousTime;
        }

        if (availableCount === 0) {
            setMessage(
                appointmentId.value
                    ? "No hay otros horarios disponibles para esta cita."
                    : "No hay horarios disponibles para ese día."
            );
        } else if (
            /horarios disponibles|consultando horarios|no trabaja ese día|disponibilidad/i
                .test(message.textContent)
        ) {
            setMessage("");
        }
    }

    /* =====================================================
       ESCUCHAR CITAS EN TIEMPO REAL
    ===================================================== */

    function listenToAppointments(currentBarberId) {
        if (
            !currentBarberId ||
            typeof currentBarberId !== "string"
        ) {
            appointmentsLoaded = false;
            appointmentsError = true;

            setMessage(
                "No se pudo identificar al barbero."
            );

            return;
        }

        barberId = currentBarberId;

        if (unsubscribeAppointments) {
            unsubscribeAppointments();
            unsubscribeAppointments = null;
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

                    setMessage(
                        "No se pudo consultar la disponibilidad de citas."
                    );
                }
            );
    }

    /* =====================================================
       IDENTIFICAR BARBERO
    ===================================================== */

    async function initializeAvailability() {
        if (barberId) {
            listenToAppointments(
                barberId
            );
            return;
        }

        try {
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

            if (!profile.barberId) {
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

            setMessage(
                error.message ||
                "No se pudo cargar la disponibilidad."
            );
        }
    }

    /* =====================================================
       REINICIAR FORMULARIO
    ===================================================== */

    function resetForm() {
        if (disposed || saving) {
            return;
        }

        ++editVersion;

        editingCustomerId = null;
        editingOriginalCustomer = null;

        form.reset();

        customerSelector.reset();

        appointmentId.value = "";

        const now =
            getBusinessDateTime();

        date.min = now.date;
        date.value = now.date;

        title.textContent =
            "Agendar cita";

        saveButton.textContent =
            "Guardar cita";

        setMessage("");

        renderTimes();
    }

    /* =====================================================
       EDITAR CITA
    ===================================================== */

    async function handleEditAppointment(event) {
        if (disposed || saving) {
            return;
        }

        const appointment =
            event.detail?.appointment;

        if (!appointment?.id) {
            return;
        }

        const version =
            ++editVersion;

        customerSelector.reset();

        editingCustomerId =
            validCustomerId(
                appointment.customerId
            )
                ? appointment.customerId
                : null;

        editingOriginalCustomer = {
            name:
                String(
                    appointment.clientName || ""
                ).trim(),
            phone:
                String(
                    appointment.phone || ""
                ).trim()
        };

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

        /*
         * Vincular el customerId de la cita
         * sin cambiarlo ni crear otro cliente.
         */
        if (editingCustomerId) {
            customerSelector.setCustomerId(
                editingCustomerId
            );
        }

        date.min = "";

        title.textContent =
            "Modificar cita";

        saveButton.textContent =
            "Guardar cambios";

        renderTimes();

        const originalTime =
            appointment.time || "";

        const originalTimeAvailable =
            Array.from(
                time.options
            ).some(
                option =>
                    option.value ===
                    originalTime
            );

        time.value =
            originalTimeAvailable
                ? originalTime
                : "";

        if (
            appointmentsLoaded &&
            !time.value
        ) {
            setMessage(
                "Selecciona un horario disponible para modificar esta cita."
            );
        } else {
            setMessage("");
        }

        form.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

        /*
         * Recuperar la ficha para comprobar
         * que el cliente todavía existe.
         *
         * No reemplazar los datos de la cita
         * automáticamente: son datos históricos.
         */
        if (editingCustomerId) {
            try {
                const customer =
                    await getBarberCustomerById(
                        editingCustomerId
                    );

                if (
                    disposed ||
                    version !== editVersion ||
                    appointmentId.value !==
                        appointment.id
                ) {
                    return;
                }

                if (!customer?.id) {
                    setMessage(
                        "La ficha del cliente no está disponible. " +
                        "Revisa el registro antes de guardar."
                    );
                }

            } catch (error) {
                if (
                    !disposed &&
                    version === editVersion
                ) {
                    console.warn(
                        "No se pudo consultar la ficha del cliente:",
                        error
                    );

                    setMessage(
                        "No se pudo verificar la ficha del cliente."
                    );
                }
            }
        }
    }

    /* =====================================================
       RESOLVER CLIENTE PARA UNA CITA NUEVA
    ===================================================== */

    async function resolveNewCustomer() {
        const customer =
            await customerSelector.resolve();

        if (
            !customer ||
            !validCustomerId(
                customer.id
            )
        ) {
            throw new Error(
                "Selecciona o registra un cliente válido."
            );
        }

        return customer;
    }

    /* =====================================================
       PREPARAR CLIENTE AL EDITAR

       Una cita existente nunca crea otro
       cliente automáticamente.
    ===================================================== */

    async function resolveEditingCustomer() {
        if (!editingCustomerId) {
            /*
             * Cita histórica sin customerId.
             * Conservamos su identidad histórica
             * sin inventar un cliente nuevo.
             */
            return {
                customerId: null,
                clientName:
                    clientName.value.trim(),
                phone:
                    phone.value.trim()
            };
        }

        const customer =
            await getBarberCustomerById(
                editingCustomerId
            );

        if (!customer?.id) {
            throw new Error(
                "La ficha del cliente asociado a esta cita ya no existe."
            );
        }

        const currentName =
            clientName.value.trim();

        const currentPhone =
            phone.value.trim();

        /*
         * El servidor exige que el nombre
         * coincida con la ficha del cliente.
         * Se permite variar acentos,
         * mayúsculas y espacios.
         */
        if (
            normalizeCustomerName(
                currentName
            ) !==
            normalizeCustomerName(
                customer.name
            )
        ) {
            throw new Error(
                "Esta cita pertenece a " +
                `"${customer.name}". ` +
                "Para evitar cambiar su identidad, " +
                "conserva el nombre registrado."
            );
        }

        const registeredPhone =
            normalizePhone(
                customer.phone || ""
            );

        const enteredPhone =
            normalizePhone(
                currentPhone
            );

        if (
            registeredPhone &&
            enteredPhone &&
            registeredPhone !==
                enteredPhone
        ) {
            throw new Error(
                "El teléfono ingresado no coincide " +
                "con la ficha del cliente."
            );
        }

        /*
         * Si el cliente todavía no tiene
         * teléfono, el formulario de edición
         * no modifica su ficha.
         *
         * El teléfono puede agregarse desde
         * la gestión de clientes.
         */
        return {
            customerId:
                editingCustomerId,
            clientName:
                customer.name,
            phone:
                currentPhone ||
                customer.phone ||
                ""
        };
    }

    /* =====================================================
       GUARDAR CITA
    ===================================================== */

    async function handleSubmit(event) {
        event.preventDefault();

        if (disposed || saving) {
            return;
        }

        if (!form.reportValidity()) {
            return;
        }

        if (!servicesLoaded) {
            setMessage(
                "Espera a que se carguen los servicios."
            );
            return;
        }

        if (!appointmentsLoaded) {
            setMessage(
                "Espera a que se carguen los horarios disponibles."
            );
            return;
        }

        const nameValue =
            clientName.value.trim();

        const phoneValue =
            phone.value.trim();

        const editingId =
            appointmentId.value.trim();

        if (!nameValue) {
            setMessage(
                "Ingresa el nombre del cliente."
            );

            clientName.focus();
            return;
        }

        if (
            phoneValue &&
            !isValidPhone(
                phoneValue
            )
        ) {
            setMessage(
                "El teléfono ingresado no es válido."
            );

            phone.focus();
            return;
        }

        if (
            !serviceId.value ||
            !date.value ||
            !time.value
        ) {
            setMessage(
                "Selecciona servicio, fecha y hora."
            );
            return;
        }

        const selectedService =
            getService(
                serviceId.value
            );

        if (!selectedService) {
            setMessage(
                "El servicio seleccionado no es válido."
            );
            return;
        }

        const selectedStart =
            timeToMinutes(
                time.value
            );

        const selectedDuration =
            Number(
                selectedService.duration
            );

        if (
            !Number.isFinite(
                selectedStart
            ) ||
            !Number.isFinite(
                selectedDuration
            ) ||
            selectedDuration <= 0
        ) {
            setMessage(
                "Selecciona un horario y servicio válidos."
            );
            return;
        }

        if (
            !isTimeAvailable(
                selectedStart,
                selectedDuration,
                date.value
            )
        ) {
            setMessage(
                "Ese horario acaba de ocuparse. Selecciona otro."
            );

            renderTimes();
            return;
        }

        const selectedServiceId =
            serviceId.value;

        const selectedDate =
            date.value;

        const selectedTime =
            time.value;

        const selectedOrigin =
            origin.value;

        const selectedNotes =
            notes.value.trim();

        setSavingState(true);

        setMessage(
            editingId
                ? "Guardando cambios..."
                : "Guardando cita..."
        );

        try {
            let customerData;

            if (editingId) {
                /*
                 * Editar sin cambiar customerId.
                 */
                customerData =
                    await resolveEditingCustomer();

            } else {
                /*
                 * Crear: buscar o registrar
                 * mediante el selector compartido.
                 */
                const customer =
                    await resolveNewCustomer();

                customerData = {
                    customerId:
                        customer.id,
                    clientName:
                        customer.name,
                    phone:
                        customer.phone || ""
                };
            }

            if (disposed) {
                return;
            }

            /*
             * La disponibilidad visual es
             * orientativa; el servidor vuelve
             * a comprobar las reservas dentro
             * de una transacción.
             */
            if (
                !isTimeAvailable(
                    selectedStart,
                    selectedDuration,
                    selectedDate
                )
            ) {
                throw new Error(
                    "Ese horario ya no está disponible."
                );
            }

            const appointment = {
                clientName:
                    customerData.clientName,
                phone:
                    customerData.phone,
                serviceId:
                    selectedServiceId,
                date:
                    selectedDate,
                time:
                    selectedTime,
                origin:
                    selectedOrigin,
                notes:
                    selectedNotes
            };

            if (
                customerData.customerId
            ) {
                appointment.customerId =
                    customerData.customerId;
            }

            if (editingId) {
                await updateAppointment(
                    editingId,
                    appointment
                );
            } else {
                await createAppointment(
                    appointment
                );
            }

            if (disposed) {
                return;
            }

            setSavingState(false);
            resetForm();

            setMessage(
                editingId
                    ? "Cita modificada correctamente."
                    : "Cita y cliente guardados correctamente."
            );

        } catch (error) {
            if (disposed) {
                return;
            }

            console.error(
                "Error guardando cita:",
                error
            );

            setMessage(
                error.message ||
                "No se pudo guardar la cita."
            );

        } finally {
            if (!disposed) {
                setSavingState(false);
            }
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

    resetButton.addEventListener(
        "click",
        event => {
            event.preventDefault();

            if (!saving) {
                resetForm();
            }
        },
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

        ++editVersion;

        controller.abort();

        if (
            unsubscribeAppointments
        ) {
            unsubscribeAppointments();
            unsubscribeAppointments = null;
        }

        customerSelector.destroy();

        customerSelectorContainer.remove();

        if (
            activeCleanup === cleanup
        ) {
            activeCleanup = null;
        }
    }

    activeCleanup = cleanup;

    resetForm();

    loadAssignedServices();

    initializeAvailability();

    return cleanup;
}
