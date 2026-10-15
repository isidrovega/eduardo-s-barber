import { services, barbers, origins, availableTimes, getLocalDate } from "./data.js";
import {
  findCustomerByPhone,
  getOrCreateCustomer
} from "./storage.js";
import { protectPage } from "./auth.js";
import { db } from "./firebase.js";

import {
  collection,
  onSnapshot,
  query,
  orderBy,
  getDocs
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

import {
    createAppointment,
    cancelAppointment,
    changeAppointmentStatus
} from "./appointment-booking.js";


/* =====================================================
   STATE
===================================================== */

let currentFilter = "all";
let selectedTime = "";
let firebaseAppointments = [];
let unsubscribeAppointments = null;
let appointmentsLoaded = false;
let firebaseBarbers = [];
let savingAppointment = false;

function startAppointmentsListener() {
  if (unsubscribeAppointments) {
    unsubscribeAppointments();
  }

  const appointmentsQuery = query(
    collection(db, "appointments"),
    orderBy("date", "asc")
  );

  unsubscribeAppointments = onSnapshot(
    appointmentsQuery,
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
      console.error("Error al cargar citas:", error);
      showToast("No se pudieron cargar las citas de Firebase.");
    }
  );
}

/* =====================================================
   ELEMENTS
===================================================== */

const appointmentsTable = document.getElementById("appointmentsTable");
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
   INITIALIZATION
===================================================== */


async function initialize() {
    appointmentsTable.innerHTML = `
        <tr>
            <td colspan="8">
                <div class="empty">Cargando citas y barberos...</div>
            </td>
        </tr>
    `;

    try {
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
        showToast(error.message || "Error al cargar citas.");
    }
}


/* =====================================================
   SELECTORS
===================================================== */


async function populateSelectors() {
    serviceSelect.replaceChildren();

    services.forEach(service => {
        serviceSelect.add(
            new Option(
                `${service.name} · $${service.price} · ${service.duration} min`,
                service.id
            )
        );
    });

    const snapshot = await getDocs(collection(db, "barbers"));

    firebaseBarbers = snapshot.docs
        .map(document => ({
            id: document.id,
            ...document.data()
        }))
        .filter(barber => barber.status === "active")
        .sort((a, b) =>
            (a.name || "").localeCompare(b.name || "", "es")
        );

    barberSelect.replaceChildren();

    firebaseBarbers.forEach(barber => {
        barberSelect.add(
            new Option(barber.name || barber.id, barber.id)
        );
    });

    if (!firebaseBarbers.length) {
        throw new Error("No hay barberos activos disponibles.");
    }
}


/* =====================================================
   EVENTS
===================================================== */

function configureEvents() {
  document.getElementById("newAppointmentButton").addEventListener("click", openModal);
  document.getElementById("closeModalButton").addEventListener("click", closeModal);
  document.getElementById("cancelModalButton").addEventListener("click", closeModal);
  document.getElementById("saveAppointmentButton").addEventListener("click", saveAppointment);
  phoneInput.addEventListener("input", detectCustomer);
  barberSelect.addEventListener("change", renderTimes);
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
  appointmentsTable.addEventListener("click", handleTableAction);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) {
      closeModal();
    }
  });
}

/* =====================================================
   INCOMING CUSTOMER FROM clientes.html
===================================================== */

function handleIncomingCustomerBooking() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("new") !== "1") {
    return;
  }
  const storedCustomer = sessionStorage.getItem("barbershop_booking_customer");

  /*
      Abrimos el modal incluso si por algún
      motivo no llegaron los datos del cliente.
  */

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
    sessionStorage.removeItem("barbershop_booking_customer");
    cleanBookingURL();
    showToast(`Agendando cita para ${customer.name || "el cliente"}.`);
  } catch (error) {
    console.error("No se pudo cargar el cliente.", error);
    sessionStorage.removeItem("barbershop_booking_customer");
    cleanBookingURL();
    showToast("No se pudieron cargar los datos del cliente.");
  }
}
function cleanBookingURL() {
  const cleanURL = `${window.location.pathname}`;
  window.history.replaceState({}, document.title, cleanURL);
}

/* =====================================================
   MODAL
===================================================== */

function openModal() {
  resetForm();
  modal.classList.remove("hidden");
  setTimeout(() => {
    phoneInput.focus();
  }, 50);
}
function closeModal() {
  modal.classList.add("hidden");
}

/* =====================================================
   RESET FORM
===================================================== */

function resetForm() {
  phoneInput.value = "";
  nameInput.value = "";
  notesInput.value = "";
  customerDetection.innerHTML = "";
  originSelect.value = "whatsapp";
  statusSelect.value = "confirmed";
  dateInput.min = getLocalDate();
  dateInput.value = getLocalDate();
  serviceSelect.value = services[0].id;
  barberSelect.value = firebaseBarbers[0]?.id || "";
  selectedTime = "";
  renderTimes();
}

/* =====================================================
   CUSTOMER DETECTION
===================================================== */

function detectCustomer() {
  const phone = phoneInput.value.trim();
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 7) {
    customerDetection.innerHTML = "";
    return;
  }
  const customer = findCustomerByPhone(phone);
  if (customer) {
    nameInput.value = customer.name;
    customerDetection.innerHTML = `
            <div
                class="
                    customer-found
                "
            >

                ✓ Cliente encontrado:

                <strong>
                    ${escapeHTML(customer.name)}
                </strong>

                ·

                ${customer.visits}
                ${customer.visits === 1 ? "visita" : "visitas"}

            </div>
        `;
    return;
  }
  customerDetection.innerHTML = `
        <div
            class="
                customer-new
            "
        >

            Cliente nuevo.
            Se registrará automáticamente
            al guardar la cita.

        </div>
    `;
}

/* =====================================================
   AVAILABILITY
===================================================== */


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

    if (!schedule?.enabled) {
        return [];
    }

    const toMinutes = value => {
        const [hours, minutes] = value.split(":").map(Number);
        return hours * 60 + minutes;
    };

    const opening = toMinutes(schedule.start);
    const closing = toMinutes(schedule.end);

    const occupied = firebaseAppointments.filter(
        appointment =>
            appointment.date === date &&
            appointment.barberId === barberId &&
            appointment.status !== "cancelled" &&
            appointment.status !== "no-show"
    );

    return availableTimes.filter(time => {
        const start = toMinutes(time);
        const end = start + service.duration;

        if (start < opening || end > closing) {
            return false;
        }

        return !occupied.some(appointment => {
            const existingService = services.find(
                item => item.id === appointment.serviceId
            );

            const existingStart = toMinutes(appointment.time);
            const existingEnd =
                existingStart +
                (appointment.duration || existingService?.duration || 30);

            return start < existingEnd && end > existingStart;
        });
    });
}


/* =====================================================
   RENDER TIMES
===================================================== */

function renderTimes() {
  const date = dateInput.value;
  const barberId = barberSelect.value;
  const times = getAvailableTimes(date, barberId);
  if (!times.includes(selectedTime)) {
    selectedTime = times[0] || "";
  }
  if (!times.length) {
    timeContainer.innerHTML = `
            <div
                class="empty"
                style="
                    grid-column:
                    1 / -1;
                "
            >

                No hay horarios disponibles.

            </div>
        `;
    return;
  }
  timeContainer.innerHTML = times.map(time => `
                    <button
                        type="button"

                        class="
                            time-button
                            ${selectedTime === time ? "selected" : ""}
                        "

                        data-time="${time}"
                    >
                        ${formatTime(time)}
                    </button>
                `).join("");
  timeContainer.querySelectorAll(".time-button").forEach(button => {
    button.addEventListener("click", () => {
      selectedTime = button.dataset.time;
      renderTimes();
    });
  });
}

/* =====================================================
   CREATE APPOINTMENT
===================================================== */


async function saveAppointment() {
    if (savingAppointment || !appointmentsLoaded) {
        showToast("Espera a que terminen de cargar las citas.");
        return;
    }

    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    const date = dateInput.value;
    const phoneDigits = phone.replace(/\D/g, "");

    if (!name) {
        showToast("Ingresa el nombre del cliente.");
        nameInput.focus();
        return;
    }

    if (phoneDigits.length < 7) {
        showToast("Ingresa un teléfono válido.");
        phoneInput.focus();
        return;
    }

    if (!date || !selectedTime || !barberSelect.value) {
        showToast("Selecciona barbero, fecha y horario.");
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

    const button = document.getElementById("saveAppointmentButton");

    savingAppointment = true;
    button.disabled = true;

    try {
        await createAppointment(appointment);

        // Los clientes continúan almacenándose en el
        // módulo actual hasta migrar clientes a Firestore.
        getOrCreateCustomer(name, phone);

        closeModal();
        showToast(`Cita de ${name} registrada correctamente.`);
    } catch (error) {
        console.error("No se pudo agendar:", error);
        showToast(error.message || "No se pudo registrar la cita.");
    } finally {
        savingAppointment = false;
        button.disabled = false;
    }
}


/* =====================================================
   RENDER APPOINTMENTS
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
  appointmentsTable.innerHTML = appointments.map(appointment => {
    const service = getService(appointment.serviceId);
    const barber = getBarber(appointment.barberId);
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

                                <span
                                    class="
                                        client-phone
                                    "
                                >
                                    ${escapeHTML(appointment.phone)}
                                </span>

                                ${appointment.notes ? `
                                            <span
                                                class="
                                                    appointment-note
                                                "
                                            >
                                                Nota:
                                                ${escapeHTML(appointment.notes)}
                                            </span>
                                        ` : ""}

                            </td>


                            <td>

                                ${service.name}

                                <span
                                    class="
                                        client-phone
                                    "
                                >
                                    ${service.duration}
                                    min ·
                                    $${service.price}
                                </span>

                            </td>


                            <td>
                                ${barber.name}
                            </td>


                            <td>

                                <span
                                    class="
                                        origin
                                    "
                                >
                                    ${origins[appointment.origin] || "Otro"}
                                </span>

                            </td>


                            <td>
                                ${renderStatus(appointment.status)}
                            </td>


                            <td>

                                <div
                                    class="
                                        table-actions
                                    "
                                >
                                    ${renderActions(appointment)}
                                </div>

                            </td>

                        </tr>
                    `;
  }).join("");
}

/* =====================================================
   ACTION BUTTONS
===================================================== */

function renderActions(appointment) {
  switch (appointment.status) {
    case "pending":
      return `
                <button
                    type="button"

                    class="
                        mini-button
                    "

                    data-action="confirmed"

                    data-id="${appointment.id}"
                >
                    Confirmar
                </button>


                <button
                    type="button"

                    class="
                        mini-button
                        danger
                    "

                    data-action="cancelled"

                    data-id="${appointment.id}"
                >
                    Cancelar
                </button>
            `;
    case "confirmed":
      return `
                <button
                    type="button"

                    class="
                        mini-button
                        success
                    "

                    data-action="completed"

                    data-id="${appointment.id}"
                >
                    Completar
                </button>


                <button
                    type="button"

                    class="
                        mini-button
                    "

                    data-action="no-show"

                    data-id="${appointment.id}"
                >
                    No asistió
                </button>


                <button
                    type="button"

                    class="
                        mini-button
                        danger
                    "

                    data-action="cancelled"

                    data-id="${appointment.id}"
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
                <span
                    class="
                        client-phone
                    "
                >
                    Finalizada
                </span>
            `;
    default:
      return "";
  }
}

/* =====================================================
   TABLE ACTION
===================================================== */

function handleTableAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }
  const appointmentId = button.dataset.id;
  const action = button.dataset.action;
  updateStatus(appointmentId, action);
}

/* =====================================================
   UPDATE STATUS
===================================================== */

async function updateStatus(appointmentId, newStatus) {
    const appointment = firebaseAppointments.find(
        item => item.id === appointmentId
    );

    if (!appointment) {
        showToast("No se encontró la cita.");
        return;
    }

    if (appointment.status === newStatus) {
        return;
    }

    if (newStatus === "pending") {
        showToast(
            "La restauración requiere volver a reservar el horario. " +
            "Esta función aún no está habilitada."
        );
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

            await cancelAppointment(appointmentId);
        } else {
            await changeAppointmentStatus(
                appointmentId,
                newStatus
            );
        }

        if (newStatus === "completed") {
            // La contabilización de visitas todavía
            // depende del almacenamiento local.
            // No la ejecutamos aquí para evitar
            // inconsistencias entre dispositivos.
        }

        showToast(messages[newStatus] || "Estado actualizado.");
    } catch (error) {
        console.error("Error al cambiar estado:", error);
        showToast(error.message || "No se pudo actualizar la cita.");
    }
}


/* =====================================================
   GET SERVICE
===================================================== */

function getService(id) {
  return services.find(service => service.id === id) || services[0];
}

/* =====================================================
   GET BARBER
===================================================== */

function getBarber(id) {
    return firebaseBarbers.find(barber => barber.id === id) || {
        id,
        name: "Barbero no disponible"
    };
}

/* =====================================================
   STATUS
===================================================== */

function renderStatus(status) {
  const labels = {
    pending: "Pendiente",
    confirmed: "Confirmada",
    completed: "Completada",
    cancelled: "Cancelada",
    "no-show": "No asistió"
  };
  return `
        <span
            class="
                status
                ${status}
            "
        >
            ${labels[status] || status}
        </span>
    `;
}

/* =====================================================
   FORMAT TIME
===================================================== */

function formatTime(time) {
  if (!time) {
    return "";
  }
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")} ${period}`;
}

/* =====================================================
   FORMAT DATE
===================================================== */

function formatDate(dateString) {
  if (!dateString) {
    return "";
  }
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}

/* =====================================================
   ESCAPE HTML
===================================================== */

function escapeHTML(value) {
  const element = document.createElement("div");
  element.textContent = String(value || "");
  return element.innerHTML;
}

/* =====================================================
   TOAST
===================================================== */

let toastTimer;
function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) {
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

async function startAppointmentsPage() {
  try {
    const user = await protectPage("admin");

    if (!user) {
      return;
    }

    initialize();
  } catch (error) {
    console.error("Error al iniciar el módulo de citas:", error);
    alert("No se pudo verificar tu acceso al administrador.");
  }
}

startAppointmentsPage();
