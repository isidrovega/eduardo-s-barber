
import {
  origins,
  getLocalDate
} from "./data.js";

import {
  getCustomers,
  getServices,
  getBarbers
} from "./firestore-storage.js";

import { db } from "./firebase.js";
import { protectPage } from "./auth.js";

import {
  collection,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

/* =====================================================
   EDUARDO'S BARBERSHOP
   ADMIN.JS

   DASHBOARD ADMINISTRATIVO

   - Estadísticas en tiempo real
   - Próximas citas
   - Clientes registrados
   - Ingresos reales
   - Acceso al formulario único de citas
===================================================== */

let firebaseAppointments = [];
let firebaseBarbers = [];
let firebaseServices = [];
let firebaseCustomerCount = 0;

let appointmentsLoaded = false;
let unsubscribeAppointments = null;
let toastTimer = null;

const statsContainer = document.getElementById(
  "dashboardStats"
);

const appointmentsContainer = document.getElementById(
  "dashboardAppointments"
);

const MONEY_FORMATTER = new Intl.NumberFormat(
  "es-MX",
  {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }
);

/* =====================================================
   INICIALIZACIÓN
===================================================== */

async function initialize() {
  if (!statsContainer || !appointmentsContainer) {
    console.error(
      "No se encontraron los contenedores del Dashboard."
    );
    return;
  }

  statsContainer.textContent =
    "Cargando estadísticas...";

  appointmentsContainer.textContent =
    "Cargando citas...";

  try {
    const user = await protectPage("admin");

    if (!user) {
      return;
    }

    configureEvents();

    await loadCatalog();

    startAppointmentsListener();

    await refreshCustomerCount();

  } catch (error) {
    console.error(
      "Error al iniciar el Dashboard:",
      error
    );

    statsContainer.textContent =
      "No se pudieron cargar las estadísticas.";

    appointmentsContainer.textContent =
      "No se pudieron cargar las citas.";

    showToast(
      error.message ||
      "No se pudo iniciar el Dashboard."
    );
  }
}

/* =====================================================
   BOTONES DE NUEVA CITA

   Ambos abren el mismo formulario de citas.html.
===================================================== */

function configureEvents() {
  const newAppointmentButton =
    document.getElementById(
      "newAppointmentButton"
    );

  const quickNewAppointment =
    document.getElementById(
      "quickNewAppointment"
    );

  if (newAppointmentButton) {
    newAppointmentButton.addEventListener(
      "click",
      openNewAppointment
    );
  }

  if (quickNewAppointment) {
    quickNewAppointment.addEventListener(
      "click",
      openNewAppointment
    );
  }
}

function openNewAppointment() {
  window.location.assign(
    "citas.html?new=1"
  );
}

/* =====================================================
   CATÁLOGO
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
}

/* =====================================================
   FIRESTORE: CITAS EN TIEMPO REAL
===================================================== */

function startAppointmentsListener() {
  if (unsubscribeAppointments) {
    unsubscribeAppointments();
  }

  unsubscribeAppointments = onSnapshot(
    collection(
      db,
      "appointments"
    ),

    snapshot => {
      firebaseAppointments = snapshot.docs.map(
        document => ({
          ...document.data(),
          id: document.id
        })
      );

      appointmentsLoaded = true;

      renderDashboard();
    },

    error => {
      console.error(
        "Error al escuchar las citas:",
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
   CLIENTES
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

/* =====================================================
   PRECIO DEL SERVICIO
===================================================== */

function getServicePrice(appointment) {
  const service = getService(
    appointment.serviceId
  );

  const price = Number(service.price);

  if (
    !Number.isFinite(price) ||
    price < 0
  ) {
    return 0;
  }

  return price;
}

/* =====================================================
   INGRESO REAL

   Si la cita tiene amountCharged,
   se utiliza el importe realmente cobrado.

   Para citas antiguas sin ese campo,
   se utiliza el precio del servicio.
===================================================== */

function getAppointmentRevenue(appointment) {
  if (appointment.status !== "completed") {
    return 0;
  }

  if (
    typeof appointment.amountCharged === "number" &&
    Number.isFinite(appointment.amountCharged) &&
    appointment.amountCharged >= 0
  ) {
    return appointment.amountCharged;
  }

  return getServicePrice(appointment);
}

/* =====================================================
   DASHBOARD
===================================================== */

function renderDashboard() {
  if (!appointmentsLoaded) {
    return;
  }

  const today = getLocalDate();

  const todayAppointments = firebaseAppointments.filter(
    appointment =>
      appointment.date === today &&
      appointment.status !== "cancelled"
  );

  const completed = firebaseAppointments.filter(
    appointment =>
      appointment.status === "completed"
  );

  const revenue = completed.reduce(
    (total, appointment) =>
      total + getAppointmentRevenue(appointment),
    0
  );

  statsContainer.innerHTML = `
    ${statCard(
      "Citas de hoy",
      todayAppointments.length
    )}

    ${statCard(
      "Clientes",
      firebaseCustomerCount
    )}

    ${statCard(
      "Completadas",
      completed.length
    )}

    ${statCard(
      "Ingresos registrados",
      formatMoney(revenue)
    )}
  `;

  renderUpcomingAppointments(
    firebaseAppointments
  );
}

/* =====================================================
   PRÓXIMAS CITAS
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
      `${a.date || ""} ${a.time || ""}`
        .localeCompare(
          `${b.date || ""} ${b.time || ""}`
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

  appointmentsContainer.innerHTML = upcoming.map(
    appointment => {
      const service = getService(
        appointment.serviceId
      );

      const barber = getBarber(
        appointment.barberId
      );

      const clientName =
        appointment.clientName ||
        "Público en general";

      return `
        <div class="dashboard-appointment">

          <div class="appointment-time">
            ${formatTime(
              appointment.time
            )}
          </div>

          <div class="appointment-client">

            <strong>
              ${escapeHTML(
                clientName
              )}
            </strong>

            <span>
              ${escapeHTML(
                service.name
              )}

              · ${formatDate(
                appointment.date
              )}

              · ${escapeHTML(
                origins[
                  appointment.origin
                ] || "Otro"
              )}
            </span>

          </div>

          <div class="appointment-barber">
            ${escapeHTML(
              barber.name
            )}
          </div>

          <div class="appointment-status">
            ${renderStatus(
              appointment.status
            )}
          </div>

        </div>
      `;
    }
  ).join("");
}

/* =====================================================
   SERVICIOS Y BARBEROS
===================================================== */

function getService(id) {
  return firebaseServices.find(
    service =>
      service.id === id
  ) || {
    id,
    name: "Servicio no disponible",
    price: 0,
    duration: 30
  };
}

function getBarber(id) {
  return firebaseBarbers.find(
    barber =>
      barber.id === id
  ) || {
    id,
    name: "Barbero no disponible"
  };
}

/* =====================================================
   TARJETAS DE ESTADÍSTICAS
===================================================== */

function statCard(label, value) {
  return `
    <article class="stat-card">
      <span>
        ${escapeHTML(label)}
      </span>

      <strong>
        ${escapeHTML(value)}
      </strong>
    </article>
  `;
}

/* =====================================================
   ESTADOS
===================================================== */

function renderStatus(status) {
  const labels = {
    pending: "Pendiente",
    confirmed: "Confirmada",
    completed: "Completada",
    cancelled: "Cancelada",
    "no-show": "No asistió"
  };

  const safeStatus = Object.hasOwn(
    labels,
    status
  )
    ? status
    : "pending";

  return `
    <span class="status ${safeStatus}">
      ${labels[safeStatus]}
    </span>
  `;
}

/* =====================================================
   FORMATO DE DINERO
===================================================== */

function formatMoney(value) {
  const amount = Number(value);

  return MONEY_FORMATTER.format(
    Number.isFinite(amount)
      ? amount
      : 0
  );
}

/* =====================================================
   FORMATO DE HORA
===================================================== */

function formatTime(time) {
  if (!time) {
    return "";
  }

  const [hours, minutes] =
    String(time)
      .split(":")
      .map(Number);

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return "";
  }

  const period =
    hours >= 12
      ? "PM"
      : "AM";

  return (
    `${hours % 12 || 12}:` +
    `${String(minutes).padStart(2, "0")} ${period}`
  );
}

/* =====================================================
   FORMATO DE FECHA
===================================================== */

function formatDate(dateString) {
  if (!dateString) {
    return "";
  }

  const date = new Date(
    `${dateString}T12:00:00Z`
  );

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "es-MX",
    {
      day: "2-digit",
      month: "short",
      timeZone: "UTC"
    }
  ).format(date);
}

/* =====================================================
   ESCAPAR HTML
===================================================== */

function escapeHTML(value) {
  const element = document.createElement(
    "div"
  );

  element.textContent =
    String(value ?? "");

  return element.innerHTML;
}

/* =====================================================
   NOTIFICACIONES
===================================================== */

function showToast(message) {
  const toast = document.getElementById(
    "toast"
  );

  if (!toast) {
    console.warn(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(
    () => {
      toast.classList.remove(
        "show"
      );
    },
    2800
  );
}

/* =====================================================
   INICIO
===================================================== */

initialize();
