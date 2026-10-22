
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

const BUSINESS_TIME_ZONE = "America/Mazatlan";
const MAX_AMOUNT_CHARGED = 1000000;

const PAYMENT_METHOD_LABELS = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia"
};

const MONEY_FORMATTER = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

let currentFilter = "all";
let selectedTime = "";
let firebaseAppointments = [];
let firebaseBarbers = [];
let firebaseServices = [];
let appointmentsLoaded = false;
let savingAppointment = false;
let openingAppointmentModal = false;
let updatingAppointmentStatus = false;
let unsubscribeAppointments = null;
let toastTimer = null;
let customerSelector = null;
let modalOpenVersion = 0;
let syncingServiceOptions = false;
let walkInCheckbox = null;
let walkInNotice = null;

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

function formatMoney(value) {
  const amount = Number(value);
  return MONEY_FORMATTER.format(
    Number.isFinite(amount) ? amount : 0
  );
}

function validateAmountCharged(value) {
  const raw = String(value ?? "").trim();

  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error(
      "Ingresa un importe válido con máximo dos decimales."
    );
  }

  const amount = Number(raw);

  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > MAX_AMOUNT_CHARGED
  ) {
    throw new Error(
      "El importe debe estar entre $0 y $1,000,000."
    );
  }

  return Math.round(amount * 100) / 100;
}

function getOriginalServicePrice(appointment) {
  const service = firebaseServices.find(
    item => item.id === appointment.serviceId
  );

  const price = Number(service?.price);

  return service && Number.isFinite(price) && price >= 0
    ? Math.round(price * 100) / 100
    : null;
}

function installAdditionalStyles() {
  if (document.getElementById("appointmentExtraStyles")) return;

  const style = document.createElement("style");
  style.id = "appointmentExtraStyles";

  style.textContent = `
    .walk-in-option {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 14px 0;
      padding: 15px;
      border: 1px solid #bd924d;
      border-radius: 12px;
      background: rgba(189,146,77,.09);
      color: inherit;
      cursor: pointer;
    }
    .walk-in-option input {
      width: 19px;
      height: 19px;
      accent-color: #d7a65c;
      flex-shrink: 0;
    }
    .walk-in-option strong {
      display: block;
      margin-bottom: 3px;
    }
    .walk-in-option small {
      display: block;
      opacity: .75;
      line-height: 1.4;
    }
    .walk-in-notice {
      margin: 0 0 14px;
      padding: 11px 13px;
      border-radius: 9px;
      border: 1px solid #bd924d;
      color: inherit;
      line-height: 1.5;
      font-size: .85rem;
    }
    .appointment-payment-label {
      display: block;
      margin-top: 6px;
      color: #d7a65c;
      font-size: .8rem;
      font-weight: 600;
    }
    .appointment-charged-label {
      display: block;
      margin-top: 5px;
      font-size: .82rem;
      font-weight: 700;
    }
    .walk-in-table-label {
      display: block;
      margin-top: 5px;
      color: #d7a65c;
      font-size: .76rem;
      font-weight: 700;
    }
    #appointmentPaymentDialog {
      width: min(460px, calc(100vw - 32px));
      max-height: calc(100dvh - 32px);
      margin: auto;
      padding: 0;
      border: 1px solid #d7a65c;
      border-radius: 18px;
      background: #171717;
      color: #f5f0e8;
      color-scheme: dark;
      box-shadow: 0 24px 80px rgba(0,0,0,.75);
      overflow: auto;
    }
    #appointmentPaymentDialog::backdrop {
      background: rgba(0,0,0,.82);
      backdrop-filter: blur(4px);
    }
    #appointmentPaymentDialog .payment-dialog-content {
      padding: 26px;
    }
    #appointmentPaymentDialog .payment-dialog-title {
      margin: 0 0 8px;
      color: #d7a65c;
      font-size: 1.35rem;
    }
    #appointmentPaymentDialog .payment-dialog-description {
      margin: 0 0 22px;
      color: #aaa;
      line-height: 1.5;
    }
    #appointmentPaymentDialog .payment-dialog-client {
      color: #fff;
      font-weight: 700;
    }
    #appointmentPaymentDialog .payment-amount-section {
      padding: 18px;
      margin-bottom: 22px;
      border-radius: 14px;
      background: #211e1a;
      border: 1px solid #35302a;
    }
    #appointmentPaymentDialog .payment-original-label {
      display: block;
      color: #aaa;
      font-size: .85rem;
    }
    #appointmentPaymentDialog .payment-original-price {
      display: block;
      margin: 6px 0 18px;
      font-size: 1.15rem;
    }
    #appointmentPaymentDialog .payment-amount-label {
      display: block;
      margin-bottom: 9px;
      color: #d7a65c;
      font-weight: 700;
    }
    #appointmentPaymentDialog .payment-amount-input-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 14px;
      border: 1px solid #555;
      border-radius: 11px;
      background: #111;
    }
    #appointmentPaymentDialog .payment-amount-input-wrap:focus-within {
      border-color: #d7a65c;
      outline: 2px solid rgba(215,166,92,.2);
    }
    #appointmentPaymentDialog .payment-currency-symbol {
      color: #d7a65c;
      font-size: 1.35rem;
      font-weight: 700;
    }
    #appointmentPaymentDialog .payment-amount-input {
      width: 100%;
      min-width: 0;
      height: 52px;
      border: 0;
      outline: 0;
      background: transparent;
      color: #fff;
      font: inherit;
      font-size: 1.35rem;
      font-weight: 700;
    }
    #appointmentPaymentDialog .payment-amount-help {
      margin: 9px 0 0;
      color: #aaa;
      font-size: .8rem;
      line-height: 1.5;
    }
    #appointmentPaymentDialog .payment-method-heading {
      margin: 0 0 13px;
    }
    #appointmentPaymentDialog .payment-options {
      display: grid;
      gap: 12px;
      margin-bottom: 24px;
    }
    #appointmentPaymentDialog .payment-option {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 15px;
      border: 1px solid #303030;
      border-radius: 12px;
      background: #202020;
      cursor: pointer;
    }
    #appointmentPaymentDialog .payment-option:has(input:checked) {
      border-color: #d7a65c;
      background: #30271b;
    }
    #appointmentPaymentDialog .payment-option input {
      width: 18px;
      height: 18px;
      accent-color: #d7a65c;
    }
    #appointmentPaymentDialog .payment-total {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 18px;
      padding: 15px 0;
      border-top: 1px solid #383838;
      border-bottom: 1px solid #383838;
    }
    #appointmentPaymentDialog .payment-total-value {
      color: #d7a65c;
      font-size: 1.35rem;
      font-weight: 800;
    }
    #appointmentPaymentDialog .payment-dialog-error {
      color: #ff9999;
      font-size: .88rem;
    }
    #appointmentPaymentDialog .payment-dialog-error:not(:empty) {
      margin-bottom: 14px;
    }
    #appointmentPaymentDialog .payment-dialog-actions {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 10px;
    }
    #appointmentPaymentDialog .payment-dialog-button {
      min-height: 44px;
      padding: 11px 16px;
      border-radius: 10px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    #appointmentPaymentDialog .payment-dialog-cancel {
      border: 1px solid #444;
      background: #202020;
      color: #fff;
    }
    #appointmentPaymentDialog .payment-dialog-save {
      border: 1px solid #d7a65c;
      background: #d7a65c;
      color: #090909;
    }
    @media (max-width: 480px) {
      #appointmentPaymentDialog .payment-dialog-content {
        padding: 20px;
      }
      #appointmentPaymentDialog .payment-dialog-actions {
        flex-direction: column-reverse;
      }
      #appointmentPaymentDialog .payment-dialog-button {
        width: 100%;
      }
    }
  `;

  document.head.append(style);
}

function initializeWalkInOption() {
  if (walkInCheckbox) return;

  const label = document.createElement("label");
  label.className = "walk-in-option";
  label.id = "appointmentWalkInOption";

  label.innerHTML = `
    <input id="appointmentWalkIn" type="checkbox">
    <span>
      <strong>Público en general</strong>
      <small>
        Cliente sin cita previa. Se registra como cita normal
        y ocupa el horario seleccionado.
      </small>
    </span>
  `;

  walkInNotice = document.createElement("p");
  walkInNotice.className = "walk-in-notice";
  walkInNotice.hidden = true;
  walkInNotice.textContent =
    "No se creará una ficha de cliente. El horario quedará reservado " +
    "para este servicio y podrás registrar el pago al completarlo.";

  const anchor = customerDetection || nameInput;

  if (anchor?.parentElement) {
    anchor.parentElement.insertBefore(label, anchor);
    label.insertAdjacentElement("afterend", walkInNotice);
  } else {
    modal.prepend(label, walkInNotice);
  }

  walkInCheckbox = label.querySelector("input");

  walkInCheckbox.addEventListener("change", () => {
    updateWalkInFields();
    renderTimes();
  });
}

function isWalkInMode() {
  return walkInCheckbox?.checked === true;
}

function updateWalkInFields() {
  const walkIn = isWalkInMode();

  if (walkIn) {
    customerSelector?.reset();
    nameInput.value = "Público en general";
    phoneInput.value = "";
    originSelect.value = "walk-in";
  } else {
    nameInput.value = "";
    phoneInput.value = "";
    originSelect.value = "whatsapp";
    customerSelector?.reset();
  }

  nameInput.readOnly = walkIn;
  phoneInput.readOnly = walkIn;
  nameInput.required = !walkIn;

  if (customerDetection) {
    customerDetection.hidden = walkIn;
  }

  if (walkInNotice) {
    walkInNotice.hidden = !walkIn;
  }
}

function initializePaymentDialog() {
  if (document.getElementById("appointmentPaymentDialog")) return;

  const dialog = document.createElement("dialog");
  dialog.id = "appointmentPaymentDialog";
  dialog.setAttribute(
    "aria-labelledby",
    "appointmentPaymentDialogTitle"
  );

  dialog.innerHTML = `
    <div class="payment-dialog-content">
      <h2 id="appointmentPaymentDialogTitle" class="payment-dialog-title">
        Completar cita
      </h2>

      <p class="payment-dialog-description">
        Registra el importe final y cómo pagó
        <span id="appointmentPaymentClient"
          class="payment-dialog-client"></span>.
      </p>

      <form id="appointmentPaymentForm" novalidate>
        <div class="payment-amount-section">
          <span class="payment-original-label">
            Precio original del servicio
          </span>

          <strong id="appointmentOriginalPrice"
            class="payment-original-price">—</strong>

          <label for="appointmentAmountCharged"
            class="payment-amount-label">
            Importe final cobrado
          </label>

          <div class="payment-amount-input-wrap">
            <span class="payment-currency-symbol">$</span>
            <input
              id="appointmentAmountCharged"
              class="payment-amount-input"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              inputmode="decimal"
              placeholder="0.00"
              autocomplete="off"
              required
            >
          </div>

          <p class="payment-amount-help">
            Puedes ajustar el importe por descuentos,
            promociones o cargos adicionales.
          </p>
        </div>

        <h3 class="payment-method-heading">Método de pago</h3>

        <div class="payment-options">
          <label class="payment-option">
            <input type="radio"
              name="appointmentPaymentMethod"
              value="cash" required>
            <span>Efectivo</span>
          </label>

          <label class="payment-option">
            <input type="radio"
              name="appointmentPaymentMethod"
              value="card">
            <span>Tarjeta</span>
          </label>

          <label class="payment-option">
            <input type="radio"
              name="appointmentPaymentMethod"
              value="transfer">
            <span>Transferencia</span>
          </label>
        </div>

        <div class="payment-total">
          <span>Total a registrar</span>
          <strong id="appointmentPaymentTotal"
            class="payment-total-value">—</strong>
        </div>

        <p id="appointmentPaymentError"
          class="payment-dialog-error" role="alert"></p>

        <div class="payment-dialog-actions">
          <button id="cancelAppointmentPayment"
            type="button"
            class="payment-dialog-button payment-dialog-cancel">
            Cancelar
          </button>

          <button type="submit"
            class="payment-dialog-button payment-dialog-save">
            Completar y guardar
          </button>
        </div>
      </form>
    </div>
  `;

  document.body.append(dialog);
}

function askPaymentDetails(appointment) {
  initializePaymentDialog();

  const dialog = document.getElementById("appointmentPaymentDialog");
  const form = document.getElementById("appointmentPaymentForm");
  const client = document.getElementById("appointmentPaymentClient");
  const originalElement = document.getElementById("appointmentOriginalPrice");
  const amountInput = document.getElementById("appointmentAmountCharged");
  const totalElement = document.getElementById("appointmentPaymentTotal");
  const errorElement = document.getElementById("appointmentPaymentError");
  const cancelButton = document.getElementById("cancelAppointmentPayment");

  const originalPrice = getOriginalServicePrice(appointment);

  client.textContent = appointment.clientName || "el cliente";
  originalElement.textContent = originalPrice === null
    ? "No disponible"
    : formatMoney(originalPrice);

  form.reset();

  amountInput.value = originalPrice === null
    ? ""
    : originalPrice.toFixed(2);

  errorElement.textContent = "";

  function updateTotal() {
    try {
      totalElement.textContent = formatMoney(
        validateAmountCharged(amountInput.value)
      );
    } catch {
      totalElement.textContent = "—";
    }
  }

  updateTotal();

  return new Promise(resolve => {
    let resolved = false;

    function finish(value) {
      if (resolved) return;
      resolved = true;

      form.removeEventListener("submit", onSubmit);
      amountInput.removeEventListener("input", onAmountInput);
      cancelButton.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onDialogCancel);
      dialog.removeEventListener("close", onDialogClose);

      if (dialog.open) dialog.close();
      resolve(value);
    }

    function onAmountInput() {
      errorElement.textContent = "";
      updateTotal();
    }

    function onSubmit(event) {
      event.preventDefault();

      const selected = form.querySelector(
        'input[name="appointmentPaymentMethod"]:checked'
      );

      if (
        !selected ||
        !Object.hasOwn(PAYMENT_METHOD_LABELS, selected.value)
      ) {
        errorElement.textContent = "Selecciona un método de pago.";
        return;
      }

      let amountCharged;

      try {
        amountCharged = validateAmountCharged(amountInput.value);
      } catch (error) {
        errorElement.textContent = error.message;
        amountInput.focus();
        return;
      }

      finish({
        paymentMethod: selected.value,
        amountCharged
      });
    }

    function onCancel() {
      finish(null);
    }

    function onDialogCancel(event) {
      event.preventDefault();
      finish(null);
    }

    function onDialogClose() {
      finish(null);
    }

    form.addEventListener("submit", onSubmit);
    amountInput.addEventListener("input", onAmountInput);
    cancelButton.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onDialogCancel);
    dialog.addEventListener("close", onDialogClose);

    try {
      dialog.showModal();
    } catch (error) {
      console.error("No se pudo abrir la ventana de pago:", error);
      finish(null);
    }
  });
}

async function initialize() {
  if (!appointmentsTable || !modal) {
    console.error("Faltan elementos del módulo de citas.");
    return;
  }

  appointmentsTable.innerHTML = `
    <tr><td colspan="8">
      <div class="empty">Cargando citas desde Firebase...</div>
    </td></tr>
  `;

  try {
    const user = await protectPage("admin");
    if (!user) return;

    installAdditionalStyles();
    initializeWalkInOption();

    await populateSelectors();

    initializeCustomerSelector();
    initializePaymentDialog();

    initializeAppointmentCalendar(renderAppointments);
    configureEvents();
    startAppointmentsListener();

    await handleIncomingCustomerBooking();

  } catch (error) {
    console.error("Error al iniciar citas:", error);

    appointmentsTable.innerHTML = `
      <tr><td colspan="8">
        <div class="empty">
          No se pudo cargar el módulo de citas.
        </div>
      </td></tr>
    `;

    showToast(
      error.message || "No se pudo cargar el módulo de citas."
    );
  }
}

function initializeCustomerSelector() {
  if (customerSelector) return;

  customerSelector = createCustomerSelector({
    nameInput,
    phoneInput,
    container: customerDetection
  });
}

async function populateSelectors() {
  const [services, barbers] = await Promise.all([
    getServices(),
    getBarbers()
  ]);

  firebaseServices = services;

  firebaseBarbers = [...barbers].sort(
    (a, b) => (a.name || "").localeCompare(b.name || "", "es")
  );

  const previousBarberId = barberSelect.value;
  const activeBarbers = firebaseBarbers.filter(
    barber => barber.status === "active"
  );

  barberSelect.replaceChildren();

  for (const barber of activeBarbers) {
    barberSelect.add(
      new Option(barber.name || barber.id, barber.id)
    );
  }

  if (!activeBarbers.length) {
    barberSelect.add(new Option("Sin barberos activos", ""));
  }

  barberSelect.value = activeBarbers.some(
    barber => barber.id === previousBarberId
  )
    ? previousBarberId
    : activeBarbers[0]?.id || "";

  updateServiceOptions();
}

function updateServiceOptions() {
  const barber = firebaseBarbers.find(
    item => item.id === barberSelect.value
  );

  const previousServiceId = serviceSelect.value;

  const assignedIds = Array.isArray(barber?.serviceIds)
    ? barber.serviceIds
    : [];

  const allowed = firebaseServices.filter(
    service =>
      service.status === "active" &&
      assignedIds.includes(service.id)
  );

  const options = allowed.map(
    service => new Option(
      `${service.name} · ${formatMoney(service.price)} · ${service.duration} min`,
      service.id
    )
  );

  if (!options.length) {
    options.push(new Option("Sin servicios disponibles", ""));
  }

  serviceSelect.replaceChildren(...options);

  serviceSelect.value = allowed.some(
    service => service.id === previousServiceId
  )
    ? previousServiceId
    : allowed[0]?.id || "";

  serviceSelect.disabled = !allowed.length;

  return allowed;
}

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

  const assignedIds = Array.isArray(barber?.serviceIds)
    ? barber.serviceIds
    : [];

  const expectedIds = firebaseServices
    .filter(service =>
      service.status === "active" &&
      assignedIds.includes(service.id)
    )
    .map(service => service.id)
    .sort();

  const actualIds = [...serviceSelect.options]
    .map(option => option.value)
    .filter(Boolean)
    .sort();

  if (
    expectedIds.length === actualIds.length &&
    expectedIds.every((id, index) => id === actualIds[index])
  ) {
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

function startAppointmentsListener() {
  if (unsubscribeAppointments) unsubscribeAppointments();

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
        <tr><td colspan="8">
          <div class="empty">
            No se pudieron cargar las citas de Firebase.
          </div>
        </td></tr>
      `;

      showToast("Error al consultar citas.");
    }
  );
}

function configureEvents() {
  document.getElementById("newAppointmentButton")
    .addEventListener("click", openModal);

  document.getElementById("closeModalButton")
    .addEventListener("click", closeModal);

  document.getElementById("cancelModalButton")
    .addEventListener("click", closeModal);

  document.getElementById("saveAppointmentButton")
    .addEventListener("click", saveAppointment);

  barberSelect.addEventListener("change", () => {
    updateServiceOptions();
    renderTimes();
  });

  serviceSelect.addEventListener("change", renderTimes);
  dateInput.addEventListener("change", renderTimes);

  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal();
  });

  document.querySelectorAll(".filter").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach(item => {
        item.classList.remove("active");
      });

      button.classList.add("active");
      currentFilter = button.dataset.filter || "all";
      renderAppointments();
    });
  });

  appointmentsTable.addEventListener("click", handleTableAction);

  document.addEventListener("keydown", event => {
    if (
      event.key === "Escape" &&
      !modal.classList.contains("hidden")
    ) {
      closeModal();
    }
  });
}

async function handleIncomingCustomerBooking() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("new") !== "1") return;

  const storedCustomer = sessionStorage.getItem(
    "barbershop_booking_customer"
  );

  let customer = null;

  if (storedCustomer) {
    try {
      customer = JSON.parse(storedCustomer);
    } catch (error) {
      console.error("Error leyendo cliente:", error);
    }
  }

  const opened = await openModal();
  if (!opened) return;

  if (!customer) {
    sessionStorage.removeItem("barbershop_booking_customer");
    cleanBookingURL();
    return;
  }

  if (walkInCheckbox) {
    walkInCheckbox.checked = false;
    updateWalkInFields();
  }

  nameInput.value = customer.name || "";
  phoneInput.value = customer.phone || "";

  if (customer.id) {
    customerSelector?.setCustomerId(customer.id);
  }

  sessionStorage.removeItem("barbershop_booking_customer");
  cleanBookingURL();

  showToast("Cliente seleccionado para nueva cita.");
}

function cleanBookingURL() {
  window.history.replaceState(
    {},
    document.title,
    window.location.pathname
  );
}

async function openModal() {
  if (openingAppointmentModal) return false;

  openingAppointmentModal = true;
  const version = ++modalOpenVersion;

  modal.classList.remove("hidden");

  try {
    await resetForm();

    if (version !== modalOpenVersion) return false;

    setTimeout(() => {
      if (
        version === modalOpenVersion &&
        !modal.classList.contains("hidden")
      ) {
        walkInCheckbox?.focus();
      }
    }, 50);

    return true;

  } catch (error) {
    console.error("Error al preparar formulario:", error);
    showToast("No se pudieron cargar los datos de la cita.");
    closeModal();
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

  if (walkInCheckbox) {
    walkInCheckbox.checked = false;
  }

  updateWalkInFields();

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
    console.error("Error al cargar servicios:", error);

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

function toMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(value || "")) return NaN;

  const [hours, mins] = value.split(":").map(Number);

  if (
    hours < 0 || hours > 23 ||
    mins < 0 || mins > 59
  ) {
    return NaN;
  }

  return hours * 60 + mins;
}

function getBusinessNow() {
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
    parts.filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: toMinutes(`${values.hour}:${values.minute}`)
  };
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
    !Number.isInteger(duration) ||
    duration < 5 ||
    duration > 480
  ) {
    return [];
  }

  const parsedDate = new Date(`${date}T12:00:00Z`);

  if (!Number.isFinite(parsedDate.getTime())) {
    return [];
  }

  const weekday = [
    "sunday", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday"
  ][parsedDate.getUTCDay()];

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

  const now = getBusinessNow();

  if (date < now.date) return [];

  const occupied = firebaseAppointments.filter(
    appointment =>
      appointment.date === date &&
      appointment.barberId === barberId &&
      appointment.status !== "cancelled" &&
      appointment.status !== "no-show"
  );

  return availableTimes.filter(time => {
    const start = toMinutes(time);
    const end = start + duration;

    if (
      !Number.isFinite(start) ||
      start % 30 !== 0 ||
      start < opening ||
      end > closing ||
      end > 1440
    ) {
      return false;
    }

    // En administración, el bloque sigue disponible
    // mientras su servicio no haya terminado.
    if (
      date === now.date &&
      end <= now.minutes
    ) {
      return false;
    }

    return !occupied.some(appointment => {
      const existingService = firebaseServices.find(
        item => item.id === appointment.serviceId
      );

      const existingStart = toMinutes(appointment.time);

      if (!Number.isFinite(existingStart)) return true;

      const existingDuration =
        Number(appointment.duration) ||
        Number(existingService?.duration) ||
        30;

      const existingEnd = existingStart + existingDuration;

      return (
        start < existingEnd &&
        end > existingStart
      );
    });
  });
}

function renderTimes() {
  if (!timeContainer) return;

  const times = getAvailableTimes(
    dateInput.value,
    barberSelect.value
  );

  if (!times.includes(selectedTime)) {
    selectedTime = times[0] || "";
  }

  if (!times.length) {
    timeContainer.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        No hay horarios disponibles.
      </div>
    `;
    return;
  }

  timeContainer.innerHTML = times.map(time => `
    <button
      type="button"
      class="time-button ${selectedTime === time ? "selected" : ""}"
      data-time="${time}">
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

async function saveAppointment() {
  if (savingAppointment) return;

  if (!appointmentsLoaded) {
    showToast("Espera a que carguen las citas.");
    return;
  }

  const walkIn = isWalkInMode();
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const date = dateInput.value;

  if (!walkIn && !name) {
    showToast("Ingresa el nombre del cliente.");
    nameInput.focus();
    return;
  }

  const phoneDigits = phone.replace(/\D/g, "");

  if (
    !walkIn &&
    phone &&
    (phoneDigits.length < 7 || phoneDigits.length > 15)
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
    showToast("Selecciona un barbero y servicio disponibles.");
    return;
  }

  if (!date || !selectedTime) {
    showToast("Selecciona servicio, barbero, fecha y hora.");
    return;
  }

  if (!getAvailableTimes(date, barber.id).includes(selectedTime)) {
    showToast("El horario seleccionado ya no está disponible.");
    renderTimes();
    return;
  }

  const button = document.getElementById("saveAppointmentButton");

  savingAppointment = true;
  button.disabled = true;

  try {
    let appointment;

    if (walkIn) {
      // Público en general no crea una ficha en customers.
      appointment = {
        walkIn: true,
        clientName: "Público en general",
        phone: "",
        date,
        time: selectedTime,
        barberId: barber.id,
        serviceId: service.id,
        origin: "walk-in",
        notes: notesInput.value.trim()
      };

    } else {
      if (!customerSelector) {
        throw new Error(
          "No se pudo iniciar el selector de clientes."
        );
      }

      const customer = await customerSelector.resolve();

      if (!customer?.id) {
        throw new Error("No se pudo identificar al cliente.");
      }

      appointment = {
        customerId: customer.id,
        walkIn: false,
        clientName: customer.name,
        phone: customer.phone || "",
        date,
        time: selectedTime,
        barberId: barber.id,
        serviceId: service.id,
        origin: originSelect.value,
        notes: notesInput.value.trim()
      };
    }

    if (!getAvailableTimes(date, barber.id).includes(selectedTime)) {
      throw new Error("El horario ya no está disponible.");
    }

    await createAppointment(appointment);

    closeModal();
    renderAppointments();

    showToast(
      walkIn
        ? "Cita de Público en general registrada. Horario ocupado."
        : `Cita de ${appointment.clientName} registrada correctamente.`
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

function getFilteredAppointments() {
  let appointments = filterAppointmentsByCalendar(
    firebaseAppointments
  );

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
    `${a.date || ""} ${a.time || ""}`.localeCompare(
      `${b.date || ""} ${b.time || ""}`
    )
  );

  return appointments;
}

function renderAppointments() {
  if (!appointmentsTable) return;

  if (!appointmentsLoaded) {
    appointmentsTable.innerHTML = `
      <tr><td colspan="8">
        <div class="empty">Cargando citas desde Firebase...</div>
      </td></tr>
    `;
    return;
  }

  const appointments = getFilteredAppointments();

  renderAppointmentCalendar(
    appointments,
    firebaseBarbers
  );

  if (!appointments.length) {
    appointmentsTable.innerHTML = `
      <tr><td colspan="8">
        <div class="empty">
          No hay citas para los filtros seleccionados.
        </div>
      </td></tr>
    `;
    return;
  }

  appointmentsTable.innerHTML = appointments.map(appointment => {
    const service = getService(appointment.serviceId);
    const barber = getBarber(appointment.barberId);

    const paymentLabel =
      appointment.status === "completed" &&
      Object.hasOwn(PAYMENT_METHOD_LABELS, appointment.paymentMethod)
        ? PAYMENT_METHOD_LABELS[appointment.paymentMethod]
        : "";

    const chargedAmount =
      appointment.status === "completed" &&
      typeof appointment.amountCharged === "number" &&
      Number.isFinite(appointment.amountCharged)
        ? appointment.amountCharged
        : null;

    const walkIn = appointment.walkIn === true;

    return `
      <tr>
        <td>${formatDate(appointment.date)}</td>

        <td>
          <strong>${formatTime(appointment.time)}</strong>
        </td>

        <td>
          <strong>${escapeHTML(appointment.clientName)}</strong>

          ${
            walkIn
              ? `<span class="walk-in-table-label">
                   Sin cita previa
                 </span>`
              : `<span class="client-phone">
                   ${escapeHTML(appointment.phone || "Sin teléfono")}
                 </span>`
          }

          ${
            appointment.notes
              ? `<span class="appointment-note">
                   Nota: ${escapeHTML(appointment.notes)}
                 </span>`
              : ""
          }
        </td>

        <td>
          ${escapeHTML(service.name)}
          <span class="client-phone">
            ${escapeHTML(service.duration)} min ·
            ${escapeHTML(formatMoney(service.price))}
          </span>
        </td>

        <td>${escapeHTML(barber.name)}</td>

        <td>
          <span class="origin">
            ${escapeHTML(origins[appointment.origin] || "Otro")}
          </span>
        </td>

        <td>
          ${renderStatus(appointment.status)}

          ${
            paymentLabel
              ? `<span class="appointment-payment-label">
                   Pago: ${escapeHTML(paymentLabel)}
                 </span>`
              : ""
          }

          ${
            chargedAmount !== null
              ? `<span class="appointment-charged-label">
                   Cobrado: ${escapeHTML(formatMoney(chargedAmount))}
                 </span>`
              : ""
          }
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

function renderActions(appointment) {
  const id = escapeHTML(appointment.id);

  switch (appointment.status) {
    case "pending":
      return `
        <button type="button" class="mini-button"
          data-action="confirmed" data-id="${id}">
          Confirmar
        </button>
        <button type="button" class="mini-button danger"
          data-action="cancelled" data-id="${id}">
          Cancelar
        </button>
      `;

    case "confirmed":
      return `
        <button type="button" class="mini-button success"
          data-action="completed" data-id="${id}">
          Completar
        </button>
        <button type="button" class="mini-button"
          data-action="no-show" data-id="${id}">
          No asistió
        </button>
        <button type="button" class="mini-button danger"
          data-action="cancelled" data-id="${id}">
          Cancelar
        </button>
      `;

    case "cancelled":
    case "no-show":
      return `<span class="client-phone">Sin reserva activa</span>`;

    case "completed":
      return `<span class="client-phone">Finalizada</span>`;

    default:
      return "";
  }
}

function handleTableAction(event) {
  const button = event.target.closest("[data-action]");

  if (!button || updatingAppointmentStatus) return;

  const appointmentId = button.dataset.id;
  const newStatus = button.dataset.action;

  if (!appointmentId || !newStatus) return;

  updatingAppointmentStatus = true;
  button.disabled = true;

  updateStatus(appointmentId, newStatus).finally(() => {
    updatingAppointmentStatus = false;

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
    completed: "Cita completada y pago registrado."
  };

  try {
    if (newStatus === "cancelled") {
      const confirmed = window.confirm(
        `¿Cancelar la cita de ${appointment.clientName}?`
      );

      if (!confirmed) return;

      await cancelAppointment(appointmentId);

    } else if (newStatus === "completed") {
      const paymentDetails = await askPaymentDetails(appointment);

      if (!paymentDetails) return;

      await changeAppointmentStatus(
        appointmentId,
        "completed",
        paymentDetails.paymentMethod,
        paymentDetails.amountCharged
      );

    } else {
      await changeAppointmentStatus(
        appointmentId,
        newStatus
      );
    }

    showToast(messages[newStatus] || "Estado actualizado.");

  } catch (error) {
    console.error("Error al cambiar estado:", error);

    showToast(
      error.message || "No se pudo actualizar la cita."
    );
  }
}

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

  const [hours, mins] = String(time).split(":").map(Number);

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(mins)
  ) {
    return "";
  }

  const period = hours >= 12 ? "PM" : "AM";

  return (
    `${hours % 12 || 12}:` +
    `${String(mins).padStart(2, "0")} ${period}`
  );
}

function formatDate(dateString) {
  if (!dateString) return "";

  const date = new Date(`${dateString}T12:00:00Z`);

  if (!Number.isFinite(date.getTime())) return "";

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
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

void initialize();
