
import {
  services,
  origins,
  availableTimes,
  getLocalDate
} from "./data.js";

import {
  getCustomers,
  findCustomerByPhone,
  getOrCreateCustomer
} from "./storage.js";

import { db } from "./firebase.js";
import { protectPage } from "./auth.js";
import { createAppointment } from "./appointment-booking.js";

import {
  collection,
  getDocs,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

/* =====================================================
   STATE
===================================================== */

let selectedTime = "";
let firebaseAppointments = [];
let firebaseBarbers = [];
let appointmentsLoaded = false;
let savingAppointment = false;
let unsubscribeAppointments = null;

/* =====================================================
   ELEMENTS
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
   INITIALIZATION
===================================================== */

async function initialize() {
  statsContainer.textContent = "Cargando estadísticas...";
  appointmentsContainer.textContent = "Cargando citas...";

  try {
    const user = await protectPage("admin");

    if (!user) {
      return;
    }

    await populateSelectors();
    configureEvents();
    startAppointmentsListener();
  } catch (error) {
    console.error("Error al iniciar el administrador:", error);

    statsContainer.textContent =
      "No se pudieron cargar las estadísticas.";

    appointmentsContainer.textContent =
      "No se pudieron cargar las citas.";

    showToast(
      error.message || "No se pudo iniciar el administrador."
    );
  }
}

/* =====================================================
   SELECTORS
===================================================== */

async function populateSelectors() {
  serviceSelect.replaceChildren();

  for (const service of services) {
    serviceSelect.add(
      new Option(
        `${service.name} · $${service.price}`,
        service.id
      )
    );
  }

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
      new Option(
        barber.name || barber.id,
        barber.id
      )
    );
  }

  if (!firebaseBarbers.length) {
    throw new Error(
      "No hay barberos activos disponibles."
    );
  }

  updateServiceOptions();
}

/* =====================================================
   FIRESTORE REALTIME
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

      renderDashboard();
      renderTimes();
    },
    error => {
      console.error("Error al escuchar citas:", error);

      appointmentsLoaded = false;

      statsContainer.textContent =
        "No se pudieron actualizar las estadísticas.";

      appointmentsContainer.textContent =
        "No se pudieron actualizar las citas.";

      showToast("Error al consultar Firebase.");
    }
  );
}

/* =====================================================
   EVENTS
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
}

/* =====================================================
   DASHBOARD
===================================================== */

function renderDashboard() {
  if (!appointmentsLoaded) {
    return;
  }

  const appointments = firebaseAppointments;
  const customers = getCustomers();
  const today = getLocalDate();

  const todayAppointments = appointments.filter(
    appointment =>
      appointment.date === today &&
      appointment.status !== "cancelled"
  );

  const completed = appointments.filter(
    appointment => appointment.status === "completed"
  );

  const revenue = completed.reduce((total, appointment) => {
    const service = getService(appointment.serviceId);

    return total + service.price;
  }, 0);

  statsContainer.innerHTML = `
    ${statCard("Citas de hoy", todayAppointments.length)}
    ${statCard("Clientes", customers.length)}
    ${statCard("Completadas", completed.length)}
    ${statCard("Ingresos registrados", `$${revenue}`)}
  `;

  renderUpcomingAppointments(appointments);
}

/* =====================================================
   UPCOMING APPOINTMENTS
===================================================== */

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
              ·
              ${formatDate(appointment.date)}
              ·
              ${escapeHTML(
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

function openModal() {
  if (!appointmentsLoaded) {
    showToast("Espera a que carguen las citas.");
    return;
  }

  resetForm();
  modal.classList.remove("hidden");

  setTimeout(() => {
    phoneInput.focus();
  }, 50);
}

function closeModal() {
  modal.classList.add("hidden");
}

function resetForm() {
  phoneInput.value = "";
  nameInput.value = "";
  notesInput.value = "";

  customerDetection.replaceChildren();

  originSelect.value = "whatsapp";

  /*
   * El servidor crea las citas como pending.
   * Reflejamos ese estado en el formulario.
   */
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
   CUSTOMER DETECTION
===================================================== */

function detectCustomer() {
  const phone = phoneInput.value.trim();

  if (phone.replace(/\D/g, "").length < 7) {
    customerDetection.replaceChildren();
    return;
  }

  const customer = findCustomerByPhone(phone);

  if (customer) {
    nameInput.value = customer.name;

    customerDetection.innerHTML = `
      <div class="customer-found">
        ✓ Cliente encontrado:
        <strong>${escapeHTML(customer.name)}</strong>
        · ${Number(customer.visits) || 0} visitas
      </div>
    `;

    return;
  }

  customerDetection.innerHTML = `
    <div class="customer-new">
      Cliente nuevo.
      Se registrará automáticamente al guardar.
    </div>
  `;
}

/* =====================================================
   SERVICES
===================================================== */

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
        `${service.name} · $${service.price}`,
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
   AVAILABILITY
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

  const service = getService(serviceSelect.value);

  if (
    !barber ||
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

  if (!schedule?.enabled) {
    return [];
  }

  const opening = toMinutes(schedule.start);
  const closing = toMinutes(schedule.end);

  const occupied = firebaseAppointments.filter(
    appointment =>
      appointment.date === date &&
      appointment.barberId === barberId &&
      appointment.status !== "cancelled" &&
      appointment.status !== "no-show"
  );

  const now = new Date();
  const currentTime =
    now.getHours() * 60 + now.getMinutes();

  return availableTimes.filter(time => {
    const start = toMinutes(time);
    const end = start + service.duration;

    if (
      start < opening ||
      end > closing ||
      !Number.isFinite(opening) ||
      !Number.isFinite(closing)
    ) {
      return false;
    }

    if (
      date === getLocalDate() &&
      start <= currentTime
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

      return (
        start < existingEnd &&
        end > existingStart
      );
    });
  });
}

/* =====================================================
   TIMES
===================================================== */

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
   SAVE APPOINTMENT
===================================================== */

async function saveAppointment() {
  if (savingAppointment) {
    return;
  }

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

  try {
    await createAppointment(appointment);

    /*
     * Los clientes siguen en localStorage
     * temporalmente.
     */
    getOrCreateCustomer(name, phone);

    closeModal();

    showToast(
      `Cita de ${name} registrada correctamente.`
    );
  } catch (error) {
    console.error("Error al guardar cita:", error);

    showToast(
      error.message || "No se pudo registrar la cita."
    );
  } finally {
    savingAppointment = false;
    button.disabled = false;
  }
}

/* =====================================================
   HELPERS
===================================================== */

function getService(id) {
  return (
    services.find(service => service.id === id) ||
    {
      id,
      name: "Servicio no disponible",
      price: 0,
      duration: 30
    }
  );
}

function getBarber(id) {
  return (
    firebaseBarbers.find(barber => barber.id === id) ||
    {
      id,
      name: "Barbero no disponible"
    }
  );
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
  if (!time) {
    return "";
  }

  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;

  return (
    `${hour}:` +
    `${String(minutes).padStart(2, "0")} ` +
    period
  );
}

function formatDate(dateString) {
  if (!dateString) {
    return "";
  }

  const date = new Date(`${dateString}T12:00:00`);

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short"
  }).format(date);
}

function escapeHTML(value) {
  const element = document.createElement("div");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

let toastTimer;

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
   START
===================================================== */

initialize();
