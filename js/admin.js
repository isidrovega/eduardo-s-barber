
import {
  origins,
  availableTimes,
  getLocalDate
} from "./data.js";

import {
  getCustomers,
  findCustomerByPhone,
  getOrCreateCustomer,
  getServices,
  getBarbers
} from "./firestore-storage.js";

import { db } from "./firebase.js";
import { protectPage } from "./auth.js";
import { createAppointment } from "./appointment-booking.js";

import {
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

/* =====================================================
   ESTADO
===================================================== */

let selectedTime = "";

let firebaseAppointments = [];
let firebaseBarbers = [];
let firebaseServices = [];
let firebaseCustomerCount = 0;

let appointmentsLoaded = false;
let savingAppointment = false;
let openingAppointmentModal = false;

let unsubscribeAppointments = null;
let customerLookupVersion = 0;
let toastTimer = null;

/* =====================================================
   ELEMENTOS
===================================================== */

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

const statsContainer = document.getElementById("dashboardStats");
const appointmentsContainer = document.getElementById(
  "dashboardAppointments"
);

/* =====================================================
   INICIALIZACIÓN
===================================================== */

async function initialize() {
  statsContainer.textContent = "Cargando estadísticas...";
  appointmentsContainer.textContent = "Cargando citas...";

  try {
    const user = await protectPage("admin");

    if (!user) return;

    await populateSelectors();

    configureEvents();
    startAppointmentsListener();

    await refreshCustomerCount();

  } catch (error) {
    console.error(
      "Error al iniciar el administrador:",
      error
    );

    statsContainer.textContent =
      "No se pudieron cargar las estadísticas.";

    appointmentsContainer.textContent =
      "No se pudieron cargar las citas.";

    showToast(
      error.message ||
      "No se pudo iniciar el administrador."
    );
  }
}

/* =====================================================
   FIRESTORE: BARBEROS Y SERVICIOS
===================================================== */

async function loadCatalog() {
  const [barbers, services] = await Promise.all([
    getBarbers(),
    getServices()
  ]);

  firebaseBarbers = [...barbers].sort(
    (a, b) =>
      (a.name || "").localeCompare(
        b.name || "",
        "es"
      )
  );

  firebaseServices = [...services];

  return {
    barbers: firebaseBarbers,
    services: firebaseServices
  };
}

/* =====================================================
   SELECTORES
===================================================== */

async function populateSelectors() {
  await loadCatalog();

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
      new Option("Sin barberos activos", "")
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

  const assignedServiceIds = Array.isArray(barber?.serviceIds)
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
      new Option("Sin servicios disponibles", "")
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

  serviceSelect.disabled = allowedServices.length === 0;

  return allowedServices;
}

/* =====================================================
   FIRESTORE: CITAS EN TIEMPO REAL
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

      renderDashboard();
      renderTimes();
    },

    error => {
      console.error(
        "Error al escuchar citas:",
        error
      );

      appointmentsLoaded = false;

      statsContainer.textContent =
        "No se pudieron actualizar las estadísticas.";

      appointmentsContainer.textContent =
        "No se pudieron actualizar las citas.";

      showToast(
        "Error al consultar las citas de Firebase."
      );
    }
  );
}

/* =====================================================
   FIRESTORE: CLIENTES
===================================================== */

async function refreshCustomerCount() {
  try {
    const customers = await getCustomers();

    firebaseCustomerCount = customers.length;

    if (appointmentsLoaded) {
      renderDashboard();
    }

  } catch (error) {
    console.error(
      "Error al contar clientes:",
      error
    );

    showToast(
      "No se pudo actualizar el total de clientes."
    );
  }
}

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
    console.error(
      "Error al buscar cliente:",
      error
    );

    if (lookupVersion === customerLookupVersion) {
      customerDetection.textContent =
        "No se pudo consultar el cliente.";
    }
  }
}

/* =====================================================
   EVENTOS
===================================================== */

function configureEvents() {
  document.getElementById("newAppointmentButton")
    .addEventListener("click", openModal);

  document.getElementById("quickNewAppointment")
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
   DASHBOARD
===================================================== */

function renderDashboard() {
  if (!appointmentsLoaded) return;

  const today = getLocalDate();

  const todayAppointments = firebaseAppointments.filter(
    appointment =>
      appointment.date === today &&
      appointment.status !== "cancelled"
  );

  const completed = firebaseAppointments.filter(
    appointment => appointment.status === "completed"
  );

  const revenue = completed.reduce(
    (total, appointment) => {
      const service = getService(appointment.serviceId);

      return total + (
        Number(service.price) || 0
      );
    },
    0
  );

  statsContainer.innerHTML = `
    ${statCard("Citas de hoy", todayAppointments.length)}
    ${statCard("Clientes", firebaseCustomerCount)}
    ${statCard("Completadas", completed.length)}
    ${statCard("Ingresos registrados", `$${revenue}`)}
  `;

  renderUpcomingAppointments(firebaseAppointments);
}

function renderUpcomingAppointments(appointments) {
  const today = getLocalDate();

  const upcoming = appointments
    .filter(appointment =>
      (
        appointment.status === "pending" ||
        appointment.status === "confirmed"
      ) &&
      appointment.date >= today
    )
    .sort((a, b) =>
      `${a.date} ${a.time}`.localeCompare(
        `${b.date} ${b.time}`
      )
    )
    .slice(0, 7);

  if (!upcoming.length) {
    appointmentsContainer.innerHTML = `
      <div class="empty">
        No hay próximas citas.
      </div>
    `;

    return;
  }

  appointmentsContainer.innerHTML = upcoming
    .map(appointment => {
      const service = getService(appointment.serviceId);
      const barber = getBarber(appointment.barberId);

      return `
        <div class="dashboard-appointment">
          <div class="appointment-time">
            ${formatTime(appointment.time)}
          </div>

          <div class="appointment-client">
            <strong>
              ${escapeHTML(appointment.clientName)}
            </strong>

            <span>
              ${escapeHTML(service.name)}
              · ${formatDate(appointment.date)}
              · ${escapeHTML(
                origins[appointment.origin] || "Otro"
              )}
            </span>
          </div>

          <div class="appointment-barber">
            ${escapeHTML(barber.name)}
          </div>

          <div class="appointment-status">
            ${renderStatus(appointment.status)}
          </div>
        </div>
      `;
    })
    .join("");
}

/* =====================================================
   MODAL
===================================================== */

async function openModal() {
  if (openingAppointmentModal) {
    return;
  }

  if (!appointmentsLoaded) {
    showToast("Espera a que carguen las citas.");
    return;
  }

  openingAppointmentModal = true;

  try {
    await resetForm();

    modal.classList.remove("hidden");

    setTimeout(() => {
      phoneInput.focus();
    }, 50);

  } catch (error) {
    console.error(
      "Error al abrir nueva cita:",
      error
    );

    showToast(
      "No se pudo abrir el formulario de citas."
    );

  } finally {
    openingAppointmentModal = false;
  }
}

function closeModal() {
  ++customerLookupVersion;

  modal.classList.add("hidden");
}

async function resetForm() {
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

  selectedTime = "";

  serviceSelect.replaceChildren(
    new Option("Cargando servicios...", "")
  );

  serviceSelect.disabled = true;
  barberSelect.disabled = true;

  try {
    await populateSelectors();

  } catch (error) {
    console.error(
      "Error al actualizar el catálogo:",
      error
    );

    serviceSelect.replaceChildren(
      new Option("Error al cargar servicios", "")
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

  const [hours, minutes] = value.split(":").map(Number);

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
  ][new Date(`${date}T12:00:00Z`).getUTCDay()];

  const schedule = barber.schedule?.[weekday];

  if (!schedule?.enabled) {
    return [];
  }

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

  const businessTime = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "America/Mazatlan",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }
  ).format(new Date());

  const currentMinutes = toMinutes(businessTime);

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
      const existingService = firebaseServices.find(
        item => item.id === appointment.serviceId
      );

      const existingStart = toMinutes(appointment.time);

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
      "Selecciona un barbero y un servicio disponibles."
    );

    return;
  }

  if (!date || !selectedTime) {
    showToast(
      "Selecciona servicio, barbero, fecha y hora."
    );

    return;
  }

  const currentAvailableTimes = getAvailableTimes(
    date,
    barber.id
  );

  if (!currentAvailableTimes.includes(selectedTime)) {
    showToast(
      "El horario seleccionado ya no está disponible."
    );

    renderTimes();
    return;
  }

  const appointment = {
    clientName: name,
    phone,
    date,
    time: selectedTime,
    barberId: barber.id,
    serviceId: service.id,
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

    await refreshCustomerCount();

    showToast(
      `Cita de ${name} y cliente registrados en Firebase.`
    );

  } catch (error) {
    console.error(
      "Error al guardar:",
      error
    );

    if (appointmentCreated) {
      closeModal();

      showToast(
        "La cita se guardó, pero falló el registro del cliente."
      );

    } else {
      showToast(
        error.message ||
        "No se pudo registrar la cita."
      );
    }

  } finally {
    savingAppointment = false;
    button.disabled = false;
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

function statCard(label, value) {
  return `
    <article class="stat-card">
      <span>${escapeHTML(label)}</span>
      <strong>${escapeHTML(value)}</strong>
    </article>
  `;
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

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return "";
  }

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
    month: "short"
  }).format(
    new Date(`${dateString}T12:00:00`)
  );
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
