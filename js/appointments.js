
import {
  origins,
  availableTimes,
  getLocalDate
} from "./data.js";

import {
  getServices,
  getBarbers
} from "./firestore-storage.js";

import { db } from "./firebase.js";
import { protectPage } from "./auth.js";

import {
  createAppointment,
  cancelAppointment,
  changeAppointmentStatus
} from "./appointment-booking.js";

import {
  initializeAppointmentCalendar,
  filterAppointmentsByCalendar,
  renderAppointmentCalendar
} from "./appointments-calendar.js";

import {
  createCustomerSelector
} from "./customer-selector.js";

import {
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

/* =====================================================
   ESTADO
===================================================== */

let currentFilter = "all";
let selectedTime = "";

let firebaseAppointments = [];
let firebaseBarbers = [];
let firebaseServices = [];

let appointmentsLoaded = false;
let savingAppointment = false;
let openingAppointmentModal = false;

let unsubscribeAppointments = null;
let toastTimer = null;

let customerSelector = null;
let modalOpenVersion = 0;

let syncingServiceOptions = false;

/* =====================================================
   ELEMENTOS
===================================================== */

const appointmentsTable = document.getElementById(
  "appointmentsTable"
);

const modal = document.getElementById("appointmentModal");
const phoneInput = document.getElementById("appointmentPhone");
const nameInput = document.getElementById("appointmentName");
const serviceSelect = document.getElementById("appointmentService");
const barberSelect = document.getElementById("appointmentBarber");
const dateInput = document.getElementById("appointmentDate");
const originSelect = document.getElementById("appointmentOrigin");
const statusSelect = document.getElementById("appointmentStatus");
const notesInput = document.getElementById("appointmentNotes");
const timeContainer = document.getElementById("appointmentTimes");
const customerDetection = document.getElementById("customerDetection");

/* =====================================================
   INICIALIZACIÓN
===================================================== */

async function initialize() {
  appointmentsTable.innerHTML = `
    <tr>
      <td colspan="8">
        <div class="empty">
          Cargando citas desde Firebase...
        </div>
      </td>
    </tr>
  `;

  try {
    const user = await protectPage("admin");

    if (!user) {
      return;
    }

    await populateSelectors();

    initializeCustomerSelector();

    initializeAppointmentCalendar(
      renderAppointments
    );

    configureEvents();
    startAppointmentsListener();

    await handleIncomingCustomerBooking();

  } catch (error) {
    console.error(
      "Error al iniciar citas:",
      error
    );

    appointmentsTable.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty">
            No se pudo cargar el módulo de citas.
          </div>
        </td>
      </tr>
    `;

    showToast(
      error.message ||
      "No se pudo cargar el módulo de citas."
    );
  }
}

/* =====================================================
   SELECTOR DE CLIENTES
===================================================== */

function initializeCustomerSelector() {
  if (customerSelector) {
    return;
  }

  customerSelector = createCustomerSelector({
    nameInput,
    phoneInput,
    container: customerDetection
  });
}

/* =====================================================
   CATÁLOGO Y SELECTORES
===================================================== */

async function populateSelectors() {
  const [services, barbers] = await Promise.all([
    getServices(),
    getBarbers()
  ]);

  firebaseServices = services;

  firebaseBarbers = [...barbers].sort(
    (a, b) =>
      (a.name || "").localeCompare(
        b.name || "",
        "es"
      )
  );

  const previousBarberId = barberSelect.value;

  const activeBarbers = firebaseBarbers.filter(
    barber => barber.status === "active"
  );

  barberSelect.replaceChildren();

  for (const barber of activeBarbers) {
    barberSelect.add(
      new Option(
        barber.name || barber.id,
        barber.id
      )
    );
  }

  if (!activeBarbers.length) {
    barberSelect.add(
      new Option(
        "Sin barberos activos",
        ""
      )
    );
  }

  if (
    activeBarbers.some(
      barber => barber.id === previousBarberId
    )
  ) {
    barberSelect.value = previousBarberId;
  } else {
    barberSelect.value = activeBarbers[0]?.id || "";
  }

  updateServiceOptions();
}

function updateServiceOptions() {
  const barber = firebaseBarbers.find(
    item => item.id === barberSelect.value
  );

  const previousServiceId = serviceSelect.value;

  const assignedServiceIds =
    Array.isArray(barber?.serviceIds)
      ? barber.serviceIds
      : [];

  const allowedServices = firebaseServices.filter(
    service =>
      service.status === "active" &&
      assignedServiceIds.includes(service.id)
  );

  const options = allowedServices.map(
    service =>
      new Option(
        `${service.name} · $${service.price} · ${service.duration} min`,
        service.id
      )
  );

  if (!options.length) {
    options.push(
      new Option(
        "Sin servicios disponibles",
        ""
      )
    );
  }

  serviceSelect.replaceChildren(...options);

  if (
    allowedServices.some(
      service => service.id === previousServiceId
    )
  ) {
    serviceSelect.value = previousServiceId;
  } else {
    serviceSelect.value = allowedServices[0]?.id || "";
  }

  serviceSelect.disabled = !allowedServices.length;

  return allowedServices;
}

/* =====================================================
   SINCRONIZACIÓN DE SERVICIOS

   Se conserva el MutationObserver original.
===================================================== */

const serviceOptionsObserver = new MutationObserver(() => {
  if (
    syncingServiceOptions ||
    modal.classList.contains("hidden") ||
    serviceSelect.disabled
  ) {
    return;
  }

  const barber = firebaseBarbers.find(
    item => item.id === barberSelect.value
  );

  const assignedIds =
    Array.isArray(barber?.serviceIds)
      ? barber.serviceIds
      : [];

  const expectedServices = firebaseServices.filter(
    service =>
      service.status === "active" &&
      assignedIds.includes(service.id)
  );

  const expectedIds = expectedServices
    .map(service => service.id)
    .sort();

  const actualIds = [...serviceSelect.options]
    .map(option => option.value)
    .filter(Boolean)
    .sort();

  const isCorrect =
    expectedIds.length === actualIds.length &&
    expectedIds.every(
      (id, index) => id === actualIds[index]
    );

  if (isCorrect) {
    return;
  }

  syncingServiceOptions = true;

  try {
    updateServiceOptions();
    renderTimes();

  } finally {
    syncingServiceOptions = false;
  }
});

serviceOptionsObserver.observe(serviceSelect, {
  childList: true,
  subtree: true
});

/* =====================================================
   FIRESTORE EN TIEMPO REAL
===================================================== */

function startAppointmentsListener() {
  if (unsubscribeAppointments) {
    unsubscribeAppointments();
  }

  unsubscribeAppointments = onSnapshot(
    collection(db, "appointments"),

    snapshot => {
      firebaseAppointments = snapshot.docs.map(
        document => ({
          ...document.data(),
          id: document.id
        })
      );

      appointmentsLoaded = true;

      renderAppointments();
      renderTimes();
    },

    error => {
      console.error(
        "Error al consultar citas:",
        error
      );

      appointmentsLoaded = false;

      appointmentsTable.innerHTML = `
        <tr>
          <td colspan="8">
            <div class="empty">
              No se pudieron cargar las citas de Firebase.
            </div>
          </td>
        </tr>
      `;

      showToast(
        "Error al consultar citas."
      );
    }
  );
}

/* =====================================================
   EVENTOS
===================================================== */

function configureEvents() {
  document.getElementById(
    "newAppointmentButton"
  ).addEventListener(
    "click",
    openModal
  );

  document.getElementById(
    "closeModalButton"
  ).addEventListener(
    "click",
    closeModal
  );

  document.getElementById(
    "cancelModalButton"
  ).addEventListener(
    "click",
    closeModal
  );

  document.getElementById(
    "saveAppointmentButton"
  ).addEventListener(
    "click",
    saveAppointment
  );

  barberSelect.addEventListener(
    "change",
    () => {
      updateServiceOptions();
      renderTimes();
    }
  );

  serviceSelect.addEventListener(
    "change",
    renderTimes
  );

  dateInput.addEventListener(
    "change",
    renderTimes
  );

  modal.addEventListener(
    "click",
    event => {
      if (event.target === modal) {
        closeModal();
      }
    }
  );

  document.querySelectorAll(
    ".filter"
  ).forEach(button => {
    button.addEventListener(
      "click",
      () => {
        document.querySelectorAll(
          ".filter"
        ).forEach(item => {
          item.classList.remove("active");
        });

        button.classList.add("active");

        currentFilter =
          button.dataset.filter || "all";

        renderAppointments();
      }
    );
  });

  appointmentsTable.addEventListener(
    "click",
    handleTableAction
  );

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Escape" &&
        !modal.classList.contains("hidden")
      ) {
        closeModal();
      }
    }
  );
}

/* =====================================================
   RESERVA DESDE CLIENTES

   Conserva id, nombre y teléfono.
   Espera a que resetForm termine.
===================================================== */

async function handleIncomingCustomerBooking() {
  const params = new URLSearchParams(
    window.location.search
  );

  if (params.get("new") !== "1") {
    return;
  }

  const storedCustomer =
    sessionStorage.getItem(
      "barbershop_booking_customer"
    );

  let customer = null;

  if (storedCustomer) {
    try {
      customer = JSON.parse(storedCustomer);

    } catch (error) {
      console.error(
        "Error leyendo cliente seleccionado:",
        error
      );
    }
  }

  const opened = await openModal();

  if (!opened) {
    return;
  }

  if (!customer) {
    sessionStorage.removeItem(
      "barbershop_booking_customer"
    );

    cleanBookingURL();
    return;
  }

  /*
   * Establecer el customerId directamente.
   * No buscar únicamente por teléfono,
   * porque puede estar vacío.
   */
  nameInput.value = customer.name || "";
  phoneInput.value = customer.phone || "";

  if (customer.id) {
    customerSelector?.setCustomerId(customer.id);
  }

  sessionStorage.removeItem(
    "barbershop_booking_customer"
  );

  cleanBookingURL();

  showToast(
    "Cliente seleccionado para nueva cita."
  );
}

function cleanBookingURL() {
  window.history.replaceState(
    {},
    document.title,
    window.location.pathname
  );
}

/* =====================================================
   MODAL
===================================================== */

async function openModal() {
  if (openingAppointmentModal) {
    return false;
  }

  openingAppointmentModal = true;

  const version = ++modalOpenVersion;

  modal.classList.remove("hidden");

  try {
    await resetForm();

    if (version !== modalOpenVersion) {
      return false;
    }

    setTimeout(() => {
      if (
        version === modalOpenVersion &&
        !modal.classList.contains("hidden")
      ) {
        nameInput.focus();
      }
    }, 50);

    return true;

  } catch (error) {
    console.error(
      "Error al preparar el formulario:",
      error
    );

    showToast(
      "No se pudieron cargar los datos de la cita."
    );

    return false;

  } finally {
    openingAppointmentModal = false;
  }
}

function closeModal() {
  ++modalOpenVersion;

  modal.classList.add("hidden");
}

async function resetForm() {
  phoneInput.value = "";
  nameInput.value = "";
  notesInput.value = "";

  customerSelector?.reset();

  originSelect.value = "whatsapp";

  statusSelect.value = "pending";
  statusSelect.disabled = true;

  dateInput.min = getLocalDate();
  dateInput.value = getLocalDate();

  selectedTime = "";

  serviceSelect.replaceChildren(
    new Option(
      "Cargando servicios...",
      ""
    )
  );

  serviceSelect.disabled = true;
  barberSelect.disabled = true;

  try {
    await populateSelectors();

  } catch (error) {
    console.error(
      "Error al actualizar barberos y servicios:",
      error
    );

    serviceSelect.replaceChildren(
      new Option(
        "Error al cargar servicios",
        ""
      )
    );

    serviceSelect.disabled = true;

    throw error;

  } finally {
    barberSelect.disabled = false;
  }

  renderTimes();
}

/* =====================================================
   DISPONIBILIDAD
===================================================== */

function toMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(value || "")) {
    return NaN;
  }

  const [hours, minutes] =
    value.split(":").map(Number);

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

function getAvailableTimes(date, barberId) {
  if (
    !appointmentsLoaded ||
    !date ||
    !barberId ||
    !serviceSelect.value
  ) {
    return [];
  }

  const barber = firebaseBarbers.find(
    item => item.id === barberId
  );

  const service = firebaseServices.find(
    item => item.id === serviceSelect.value
  );

  if (
    !barber ||
    barber.status !== "active" ||
    !service ||
    service.status !== "active" ||
    !barber.serviceIds?.includes(service.id)
  ) {
    return [];
  }

  const duration = Number(service.duration);

  if (
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return [];
  }

  const weekday = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"
  ][
    new Date(
      `${date}T12:00:00Z`
    ).getUTCDay()
  ];

  const schedule =
    barber.schedule?.[weekday];

  if (!schedule?.enabled) {
    return [];
  }

  const opening = toMinutes(
    schedule.start
  );

  const closing = toMinutes(
    schedule.end
  );

  if (
    !Number.isFinite(opening) ||
    !Number.isFinite(closing)
  ) {
    return [];
  }

  const occupied = firebaseAppointments.filter(
    appointment =>
      appointment.date === date &&
      appointment.barberId === barberId &&
      appointment.status !== "cancelled" &&
      appointment.status !== "no-show"
  );

  const businessTime =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone: "America/Mazatlan",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }
    ).format(new Date());

  const currentMinutes =
    toMinutes(businessTime);

  return availableTimes.filter(time => {
    const start = toMinutes(time);
    const end = start + duration;

    if (
      !Number.isFinite(start) ||
      start < opening ||
      end > closing
    ) {
      return false;
    }

    if (
      date === getLocalDate() &&
      start <= currentMinutes
    ) {
      return false;
    }

    return !occupied.some(appointment => {
      const existingService =
        firebaseServices.find(
          item =>
            item.id === appointment.serviceId
        );

      const existingStart =
        toMinutes(appointment.time);

      if (!Number.isFinite(existingStart)) {
        return true;
      }

      const existingDuration =
        Number(appointment.duration) ||
        Number(existingService?.duration) ||
        30;

      const existingEnd =
        existingStart + existingDuration;

      return (
        start < existingEnd &&
        end > existingStart
      );
    });
  });
}

function renderTimes() {
  const times = getAvailableTimes(
    dateInput.value,
    barberSelect.value
  );

  if (!times.includes(selectedTime)) {
    selectedTime = times[0] || "";
  }

  if (!times.length) {
    timeContainer.innerHTML = `
      <div
        class="empty"
        style="grid-column: 1 / -1;"
      >
        No hay horarios disponibles.
      </div>
    `;

    return;
  }

  timeContainer.innerHTML = times.map(
    time => `
      <button
        type="button"
        class="time-button ${
          selectedTime === time
            ? "selected"
            : ""
        }"
        data-time="${time}"
      >
        ${formatTime(time)}
      </button>
    `
  ).join("");

  timeContainer.querySelectorAll(
    ".time-button"
  ).forEach(button => {
    button.addEventListener(
      "click",
      () => {
        selectedTime = button.dataset.time;
        renderTimes();
      }
    );
  });
}

/* =====================================================
   GUARDAR CITA Y CLIENTE

   Primero cliente, después cita.
===================================================== */

async function saveAppointment() {
  if (savingAppointment) {
    return;
  }

  if (!appointmentsLoaded) {
    showToast(
      "Espera a que carguen las citas."
    );

    return;
  }

  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const date = dateInput.value;

  if (!name) {
    showToast(
      "Ingresa el nombre del cliente."
    );

    nameInput.focus();
    return;
  }

  const phoneDigits =
    phone.replace(/\D/g, "");

  if (
    phone &&
    (
      phoneDigits.length < 7 ||
      phoneDigits.length > 15
    )
  ) {
    showToast(
      "El teléfono debe tener entre 7 y 15 dígitos, o dejarse vacío."
    );

    phoneInput.focus();
    return;
  }

  const barber = firebaseBarbers.find(
    item => item.id === barberSelect.value
  );

  const service = firebaseServices.find(
    item => item.id === serviceSelect.value
  );

  if (
    !barber ||
    barber.status !== "active" ||
    !service ||
    service.status !== "active" ||
    !barber.serviceIds?.includes(service.id)
  ) {
    showToast(
      "Selecciona un barbero y servicio disponibles."
    );

    return;
  }

  if (!date || !selectedTime) {
    showToast(
      "Selecciona servicio, barbero, fecha y hora."
    );

    return;
  }

  const currentAvailableTimes =
    getAvailableTimes(
      date,
      barber.id
    );

  if (
    !currentAvailableTimes.includes(selectedTime)
  ) {
    showToast(
      "El horario seleccionado ya no está disponible."
    );

    renderTimes();
    return;
  }

  const button = document.getElementById(
    "saveAppointmentButton"
  );

  savingAppointment = true;
  button.disabled = true;

  try {
    if (!customerSelector) {
      throw new Error(
        "No se pudo iniciar el selector de clientes."
      );
    }

    /*
     * Resolver cliente antes de crear la cita.
     * El servidor asigna o reutiliza customerId.
     */
    const customer =
      await customerSelector.resolve();

    if (!customer?.id) {
      throw new Error(
        "No se pudo identificar al cliente."
      );
    }

    /*
     * Validar nuevamente el horario después
     * de resolver al cliente.
     */
    if (
      !getAvailableTimes(
        date,
        barber.id
      ).includes(selectedTime)
    ) {
      throw new Error(
        "El horario ya no está disponible."
      );
    }

    const appointment = {
      customerId: customer.id,
      clientName: customer.name,
      phone: customer.phone || "",
      date,
      time: selectedTime,
      barberId: barber.id,
      serviceId: service.id,
      origin: originSelect.value,
      notes: notesInput.value.trim()
    };

    await createAppointment(appointment);

    closeModal();
    renderAppointments();

    showToast(
      `Cita de ${customer.name} registrada correctamente.`
    );

  } catch (error) {
    console.error(
      "Error al guardar cita:",
      error
    );

    showToast(
      error.message ||
      "No se pudo registrar la cita."
    );

  } finally {
    savingAppointment = false;
    button.disabled = false;
  }
}

/* =====================================================
   FILTROS DE CITAS
===================================================== */

function getFilteredAppointments() {
  let appointments =
    filterAppointmentsByCalendar(
      firebaseAppointments
    );

  if (currentFilter === "today") {
    appointments = appointments.filter(
      appointment =>
        appointment.date === getLocalDate()
    );

  } else if (currentFilter !== "all") {
    appointments = appointments.filter(
      appointment =>
        appointment.status === currentFilter
    );
  }

  appointments.sort(
    (a, b) =>
      `${a.date || ""} ${a.time || ""}`
        .localeCompare(
          `${b.date || ""} ${b.time || ""}`
        )
  );

  return appointments;
}

/* =====================================================
   TABLA Y CALENDARIO
===================================================== */

function renderAppointments() {
  if (!appointmentsLoaded) {
    appointmentsTable.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty">
            Cargando citas desde Firebase...
          </div>
        </td>
      </tr>
    `;

    return;
  }

  const appointments =
    getFilteredAppointments();

  /*
   * Calendario y tabla reciben
   * las mismas citas filtradas.
   */
  renderAppointmentCalendar(
    appointments,
    firebaseBarbers
  );

  if (!appointments.length) {
    appointmentsTable.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty">
            No hay citas para los filtros seleccionados.
          </div>
        </td>
      </tr>
    `;

    return;
  }

  appointmentsTable.innerHTML =
    appointments.map(appointment => {
      const service = getService(
        appointment.serviceId
      );

      const barber = getBarber(
        appointment.barberId
      );

      return `
        <tr>
          <td>
            ${formatDate(appointment.date)}
          </td>

          <td>
            <strong>
              ${formatTime(appointment.time)}
            </strong>
          </td>

          <td>
            <strong>
              ${escapeHTML(appointment.clientName)}
            </strong>

            <span class="client-phone">
              ${escapeHTML(
                appointment.phone || "Sin teléfono"
              )}
            </span>

            ${
              appointment.notes
                ? `
                  <span class="appointment-note">
                    Nota:
                    ${escapeHTML(appointment.notes)}
                  </span>
                `
                : ""
            }
          </td>

          <td>
            ${escapeHTML(service.name)}

            <span class="client-phone">
              ${escapeHTML(service.duration)} min
              · $${escapeHTML(service.price)}
            </span>
          </td>

          <td>
            ${escapeHTML(barber.name)}
          </td>

          <td>
            <span class="origin">
              ${escapeHTML(
                origins[appointment.origin] || "Otro"
              )}
            </span>
          </td>

          <td>
            ${renderStatus(appointment.status)}
          </td>

          <td>
            <div class="table-actions">
              ${renderActions(appointment)}
            </div>
          </td>
        </tr>
      `;
    }).join("");
}

/* =====================================================
   ACCIONES DE CITAS
===================================================== */

function renderActions(appointment) {
  const id = escapeHTML(
    appointment.id
  );

  switch (appointment.status) {
    case "pending":
      return `
        <button
          type="button"
          class="mini-button"
          data-action="confirmed"
          data-id="${id}"
        >
          Confirmar
        </button>

        <button
          type="button"
          class="mini-button danger"
          data-action="cancelled"
          data-id="${id}"
        >
          Cancelar
        </button>
      `;

    case "confirmed":
      return `
        <button
          type="button"
          class="mini-button success"
          data-action="completed"
          data-id="${id}"
        >
          Completar
        </button>

        <button
          type="button"
          class="mini-button"
          data-action="no-show"
          data-id="${id}"
        >
          No asistió
        </button>

        <button
          type="button"
          class="mini-button danger"
          data-action="cancelled"
          data-id="${id}"
        >
          Cancelar
        </button>
      `;

    case "cancelled":
    case "no-show":
      return `
        <span class="client-phone">
          Sin reserva activa
        </span>
      `;

    case "completed":
      return `
        <span class="client-phone">
          Finalizada
        </span>
      `;

    default:
      return "";
  }
}

function handleTableAction(event) {
  const button = event.target.closest(
    "[data-action]"
  );

  if (!button) {
    return;
  }

  const appointmentId = button.dataset.id;
  const newStatus = button.dataset.action;

  if (!appointmentId || !newStatus) {
    return;
  }

  button.disabled = true;

  updateStatus(
    appointmentId,
    newStatus
  ).finally(() => {
    if (button.isConnected) {
      button.disabled = false;
    }
  });
}

async function updateStatus(
  appointmentId,
  newStatus
) {
  const appointment =
    firebaseAppointments.find(
      item => item.id === appointmentId
    );

  if (!appointment) {
    showToast(
      "No se encontró la cita."
    );

    return;
  }

  if (appointment.status === newStatus) {
    return;
  }

  const messages = {
    confirmed: "Cita confirmada.",
    cancelled: "Cita cancelada.",
    "no-show": "Cita marcada como no asistió.",
    completed: "Cita completada."
  };

  try {
    if (newStatus === "cancelled") {
      const confirmed = window.confirm(
        `¿Cancelar la cita de ${appointment.clientName}?`
      );

      if (!confirmed) {
        return;
      }

      await cancelAppointment(
        appointmentId
      );

    } else {
      await changeAppointmentStatus(
        appointmentId,
        newStatus
      );
    }

    showToast(
      messages[newStatus] ||
      "Estado actualizado."
    );

  } catch (error) {
    console.error(
      "Error al cambiar estado:",
      error
    );

    showToast(
      error.message ||
      "No se pudo actualizar la cita."
    );
  }
}

/* =====================================================
   UTILIDADES
===================================================== */

function getService(id) {
  return firebaseServices.find(
    service => service.id === id
  ) || {
    id,
    name: "Servicio no disponible",
    price: 0,
    duration: 30
  };
}

function getBarber(id) {
  return firebaseBarbers.find(
    barber => barber.id === id
  ) || {
    id,
    name: "Barbero no disponible"
  };
}

function renderStatus(status) {
  const labels = {
    pending: "Pendiente",
    confirmed: "Confirmada",
    completed: "Completada",
    cancelled: "Cancelada",
    "no-show": "No asistió"
  };

  const safeStatus =
    Object.hasOwn(labels, status)
      ? status
      : "pending";

  return `
    <span class="status ${safeStatus}">
      ${labels[safeStatus]}
    </span>
  `;
}

function formatTime(time) {
  if (!time) {
    return "";
  }

  const [hours, minutes] =
    String(time).split(":").map(Number);

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return "";
  }

  const period =
    hours >= 12 ? "PM" : "AM";

  return (
    `${hours % 12 || 12}:` +
    `${String(minutes).padStart(2, "0")} ${period}`
  );
}

function formatDate(dateString) {
  if (!dateString) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "es-MX",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }
  ).format(
    new Date(
      `${dateString}T12:00:00Z`
    )
  );
}

function escapeHTML(value) {
  const element =
    document.createElement("div");

  element.textContent =
    String(value ?? "");

  return element.innerHTML;
}

function showToast(message) {
  const toast =
    document.getElementById("toast");

  if (!toast) {
    console.warn(message);
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
   INICIO
===================================================== */

initialize();
