
import {
  services,
  origins,
  availableTimes,
  getLocalDate
} from "./data.js";

import {
  findCustomerByPhone,
  getOrCreateCustomer
} from "./firestore-storage.js";

import { db } from "./firebase.js";
import { protectPage } from "./auth.js";

import {
  createAppointment,
  cancelAppointment,
  changeAppointmentStatus
} from "./appointment-booking.js";

import {
  collection,
  getDocs,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

/* =====================================================
   ESTADO
===================================================== */

let currentFilter = "all";
let selectedTime = "";

let firebaseAppointments = [];
let firebaseBarbers = [];

let appointmentsLoaded = false;
let savingAppointment = false;

let unsubscribeAppointments = null;
let customerLookupVersion = 0;
let toastTimer = null;

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

    if (!user) return;

    await populateSelectors();

    configureEvents();
    startAppointmentsListener();
    handleIncomingCustomerBooking();
  } catch (error) {
    console.error("Error al iniciar citas:", error);

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
      error.message || "No se pudo cargar el módulo de citas."
    );
  }
}

/* =====================================================
   SELECTORES
===================================================== */

async function populateSelectors() {
  const snapshot = await getDocs(collection(db, "barbers"));

  firebaseBarbers = snapshot.docs
    .map(document => ({
      ...document.data(),
      id: document.id
    }))
    .filter(barber => barber.status === "active")
    .sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "es")
    );

  barberSelect.replaceChildren();

  for (const barber of firebaseBarbers) {
    barberSelect.add(
      new Option(barber.name || barber.id, barber.id)
    );
  }

  if (!firebaseBarbers.length) {
    throw new Error("No hay barberos activos disponibles.");
  }

  updateServiceOptions();
}

function updateServiceOptions() {
  const barber = firebaseBarbers.find(
    item => item.id === barberSelect.value
  );

  const previousService = serviceSelect.value;

  const allowedServices = services.filter(
    service => barber?.serviceIds?.includes(service.id)
  );

  serviceSelect.replaceChildren();

  for (const service of allowedServices) {
    serviceSelect.add(
      new Option(
        `${service.name} · $${service.price} · ${service.duration} min`,
        service.id
      )
    );
  }

  if (
    allowedServices.some(
      service => service.id === previousService
    )
  ) {
    serviceSelect.value = previousService;
  }

  if (!allowedServices.length) {
    serviceSelect.add(
      new Option("Sin servicios disponibles", "")
    );
  }
}

/* =====================================================
   FIRESTORE
===================================================== */

function startAppointmentsListener() {
  if (unsubscribeAppointments) {
    unsubscribeAppointments();
  }

  unsubscribeAppointments = onSnapshot(
    collection(db, "appointments"),
    snapshot => {
      firebaseAppointments = snapshot.docs.map(document => ({
        ...document.data(),
        id: document.id
      }));

      appointmentsLoaded = true;

      renderAppointments();
      renderTimes();
    },
    error => {
      console.error("Error al consultar citas:", error);

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

      showToast("Error al consultar citas.");
    }
  );
}

/* =====================================================
   EVENTOS
===================================================== */

function configureEvents() {
  document.getElementById("newAppointmentButton")
    .addEventListener("click", openModal);

  document.getElementById("closeModalButton")
    .addEventListener("click", closeModal);

  document.getElementById("cancelModalButton")
    .addEventListener("click", closeModal);

  document.getElementById("saveAppointmentButton")
    .addEventListener("click", saveAppointment);

  phoneInput.addEventListener("input", detectCustomer);

  barberSelect.addEventListener("change", () => {
    updateServiceOptions();
    renderTimes();
  });

  serviceSelect.addEventListener("change", renderTimes);
  dateInput.addEventListener("change", renderTimes);

  modal.addEventListener("click", event => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.querySelectorAll(".filter").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach(item => {
        item.classList.remove("active");
      });

      button.classList.add("active");
      currentFilter = button.dataset.filter;

      renderAppointments();
    });
  });

  appointmentsTable.addEventListener(
    "click",
    handleTableAction
  );

  document.addEventListener("keydown", event => {
    if (
      event.key === "Escape" &&
      !modal.classList.contains("hidden")
    ) {
      closeModal();
    }
  });
}

/* =====================================================
   RESERVA DESDE CLIENTES
===================================================== */

function handleIncomingCustomerBooking() {
  const params = new URLSearchParams(
    window.location.search
  );

  if (params.get("new") !== "1") return;

  const storedCustomer = sessionStorage.getItem(
    "barbershop_booking_customer"
  );

  openModal();

  if (!storedCustomer) {
    cleanBookingURL();
    return;
  }

  try {
    const customer = JSON.parse(storedCustomer);

    phoneInput.value = customer.phone || "";
    nameInput.value = customer.name || "";

    detectCustomer();

    sessionStorage.removeItem(
      "barbershop_booking_customer"
    );

    cleanBookingURL();

    showToast("Cliente seleccionado para nueva cita.");
  } catch (error) {
    console.error("Error al cargar cliente:", error);

    sessionStorage.removeItem(
      "barbershop_booking_customer"
    );

    cleanBookingURL();
  }
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

function openModal() {
  resetForm();
  modal.classList.remove("hidden");

  setTimeout(() => phoneInput.focus(), 50);
}

function closeModal() {
  modal.classList.add("hidden");
}

function resetForm() {
  ++customerLookupVersion;

  phoneInput.value = "";
  nameInput.value = "";
  notesInput.value = "";

  customerDetection.replaceChildren();

  originSelect.value = "whatsapp";

  statusSelect.value = "pending";
  statusSelect.disabled = true;

  dateInput.min = getLocalDate();
  dateInput.value = getLocalDate();

  barberSelect.value = firebaseBarbers[0]?.id || "";

  updateServiceOptions();

  selectedTime = "";
  renderTimes();
}

/* =====================================================
   DETECCIÓN DE CLIENTES EN FIRESTORE
===================================================== */

async function detectCustomer() {
  const phone = phoneInput.value.trim();
  const lookupVersion = ++customerLookupVersion;

  if (phone.replace(/\D/g, "").length < 7) {
    customerDetection.replaceChildren();
    return;
  }

  customerDetection.textContent = "Buscando cliente...";

  try {
    const customer = await findCustomerByPhone(phone);

    if (
      lookupVersion !== customerLookupVersion ||
      phoneInput.value.trim() !== phone
    ) {
      return;
    }

    if (customer) {
      nameInput.value = customer.name || "";

      customerDetection.innerHTML = `
        <div class="customer-found">
          ✓ Cliente encontrado:
          <strong>${escapeHTML(customer.name)}</strong>
          · ${Number(customer.visits) || 0} visitas
        </div>
      `;
    } else {
      customerDetection.innerHTML = `
        <div class="customer-new">
          Cliente nuevo. Se registrará en Firebase.
        </div>
      `;
    }
  } catch (error) {
    console.error("Error al buscar cliente:", error);

    if (lookupVersion === customerLookupVersion) {
      customerDetection.textContent =
        "No se pudo consultar el cliente.";
    }
  }
}

/* =====================================================
   DISPONIBILIDAD
===================================================== */

function toMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(value || "")) {
    return NaN;
  }

  const [hours, minutes] = value.split(":").map(Number);

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

  const service = services.find(
    item => item.id === serviceSelect.value
  );

  if (
    !barber ||
    !service ||
    !barber.serviceIds?.includes(service.id)
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
  ][new Date(`${date}T12:00:00Z`).getUTCDay()];

  const schedule = barber.schedule?.[weekday];

  if (!schedule?.enabled) return [];

  const opening = toMinutes(schedule.start);
  const closing = toMinutes(schedule.end);

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

  const businessTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Mazatlan",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date());

  const currentMinutes = toMinutes(businessTime);

  return availableTimes.filter(time => {
    const start = toMinutes(time);
    const end = start + service.duration;

    if (start < opening || end > closing) {
      return false;
    }

    if (
      date === getLocalDate() &&
      start <= currentMinutes
    ) {
      return false;
    }

    return !occupied.some(appointment => {
      const existingService = services.find(
        item => item.id === appointment.serviceId
      );

      const existingStart = toMinutes(appointment.time);

      const existingEnd =
        existingStart +
        (
          appointment.duration ||
          existingService?.duration ||
          30
        );

      return start < existingEnd && end > existingStart;
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
      <div class="empty" style="grid-column: 1 / -1;">
        No hay horarios disponibles.
      </div>
    `;
    return;
  }

  timeContainer.innerHTML = times
    .map(time => `
      <button
        type="button"
        class="time-button ${
          selectedTime === time ? "selected" : ""
        }"
        data-time="${time}"
      >
        ${formatTime(time)}
      </button>
    `)
    .join("");

  timeContainer
    .querySelectorAll(".time-button")
    .forEach(button => {
      button.addEventListener("click", () => {
        selectedTime = button.dataset.time;
        renderTimes();
      });
    });
}

/* =====================================================
   GUARDAR CITA Y CLIENTE
===================================================== */

async function saveAppointment() {
  if (savingAppointment) return;

  if (!appointmentsLoaded) {
    showToast("Espera a que carguen las citas.");
    return;
  }

  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const date = dateInput.value;

  if (!name) {
    showToast("Ingresa el nombre del cliente.");
    nameInput.focus();
    return;
  }

  if (phone.replace(/\D/g, "").length < 7) {
    showToast("Ingresa un teléfono válido.");
    phoneInput.focus();
    return;
  }

  if (
    !date ||
    !selectedTime ||
    !barberSelect.value ||
    !serviceSelect.value
  ) {
    showToast("Selecciona servicio, barbero, fecha y hora.");
    return;
  }

  const appointment = {
    clientName: name,
    phone,
    date,
    time: selectedTime,
    barberId: barberSelect.value,
    serviceId: serviceSelect.value,
    origin: originSelect.value,
    notes: notesInput.value.trim()
  };

  const button = document.getElementById(
    "saveAppointmentButton"
  );

  savingAppointment = true;
  button.disabled = true;

  let appointmentCreated = false;

  try {
    await createAppointment(appointment);
    appointmentCreated = true;

    await getOrCreateCustomer(name, phone);

    closeModal();
    renderAppointments();

    showToast(
      `Cita de ${name} y cliente registrados en Firebase.`
    );
  } catch (error) {
    console.error("Error al guardar cita:", error);

    if (appointmentCreated) {
      closeModal();

      showToast(
        "La cita se guardó, pero falló el registro del cliente."
      );
    } else {
      showToast(
        error.message || "No se pudo registrar la cita."
      );
    }
  } finally {
    savingAppointment = false;
    button.disabled = false;
  }
}

/* =====================================================
   TABLA DE CITAS
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

  let appointments = [...firebaseAppointments];

  if (currentFilter === "today") {
    appointments = appointments.filter(
      appointment => appointment.date === getLocalDate()
    );
  } else if (currentFilter !== "all") {
    appointments = appointments.filter(
      appointment => appointment.status === currentFilter
    );
  }

  appointments.sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(
      `${b.date} ${b.time}`
    )
  );

  if (!appointments.length) {
    appointmentsTable.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty">
            No hay citas para mostrar.
          </div>
        </td>
      </tr>
    `;
    return;
  }

  appointmentsTable.innerHTML = appointments
    .map(appointment => {
      const service = getService(appointment.serviceId);
      const barber = getBarber(appointment.barberId);

      return `
        <tr>
          <td>
            ${formatDate(appointment.date)}
          </td>

          <td>
            <strong>${formatTime(appointment.time)}</strong>
          </td>

          <td>
            <strong>
              ${escapeHTML(appointment.clientName)}
            </strong>

            <span class="client-phone">
              ${escapeHTML(appointment.phone)}
            </span>

            ${
              appointment.notes
                ? `
                  <span class="appointment-note">
                    Nota: ${escapeHTML(appointment.notes)}
                  </span>
                `
                : ""
            }
          </td>

          <td>
            ${escapeHTML(service.name)}

            <span class="client-phone">
              ${service.duration} min · $${service.price}
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
    })
    .join("");
}

/* =====================================================
   ACCIONES DE CITAS
===================================================== */

function renderActions(appointment) {
  const id = escapeHTML(appointment.id);

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
  const button = event.target.closest("[data-action]");

  if (!button) return;

  const appointmentId = button.dataset.id;
  const newStatus = button.dataset.action;

  button.disabled = true;

  updateStatus(appointmentId, newStatus)
    .finally(() => {
      if (button.isConnected) {
        button.disabled = false;
      }
    });
}

async function updateStatus(appointmentId, newStatus) {
  const appointment = firebaseAppointments.find(
    item => item.id === appointmentId
  );

  if (!appointment) {
    showToast("No se encontró la cita.");
    return;
  }

  if (appointment.status === newStatus) return;

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

      if (!confirmed) return;

      await cancelAppointment(appointmentId);
    } else {
      await changeAppointmentStatus(
        appointmentId,
        newStatus
      );
    }

    showToast(
      messages[newStatus] || "Estado actualizado."
    );
  } catch (error) {
    console.error("Error al cambiar estado:", error);

    showToast(
      error.message || "No se pudo actualizar la cita."
    );
  }
}

/* =====================================================
   UTILIDADES
===================================================== */

function getService(id) {
  return services.find(service => service.id === id) || {
    id,
    name: "Servicio no disponible",
    price: 0,
    duration: 30
  };
}

function getBarber(id) {
  return firebaseBarbers.find(barber => barber.id === id) || {
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

  const safeStatus = Object.hasOwn(labels, status)
    ? status
    : "pending";

  return `
    <span class="status ${safeStatus}">
      ${labels[safeStatus]}
    </span>
  `;
}

function formatTime(time) {
  if (!time) return "";

  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";

  return (
    `${hours % 12 || 12}:` +
    `${String(minutes).padStart(2, "0")} ${period}`
  );
}

function formatDate(dateString) {
  if (!dateString) return "";

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(`${dateString}T12:00:00`));
}

function escapeHTML(value) {
  const element = document.createElement("div");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function showToast(message) {
  const toast = document.getElementById("toast");

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
