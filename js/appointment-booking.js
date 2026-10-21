
import { auth } from "./firebase.js";

/* =========================================================
   EDUARDO'S BARBERSHOP
   CLIENTE HTTP PARA GESTIÓN DE CITAS

   Funciones públicas:
   - createAppointment
   - updateAppointment
   - cancelAppointment
   - changeAppointmentStatus

   Características:
   - Autenticación Firebase
   - customerId permanente
   - Teléfono opcional
   - Validaciones básicas
   - Manejo de errores
   - Tiempo máximo de espera
   - Método de pago al completar citas
========================================================= */

const ENDPOINT =
  "/.netlify/functions/manage-appointments";

const REQUEST_TIMEOUT_MS = 20000;

const VALID_STATUSES = new Set([
  "pending",
  "confirmed",
  "completed",
  "no-show"
]);

const VALID_PAYMENT_METHODS = new Set([
  "cash",
  "card",
  "transfer"
]);

/* =========================================================
   VALIDACIONES
========================================================= */

function validId(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 150 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/")
  );
}

function requireId(value, label) {
  if (!validId(value)) {
    throw new Error(
      `${label} inválido.`
    );
  }

  return value;
}

function requireAppointment(appointment) {
  if (
    !appointment ||
    typeof appointment !== "object" ||
    Array.isArray(appointment)
  ) {
    throw new Error(
      "Los datos de la cita no son válidos."
    );
  }

  return appointment;
}

function validatePhone(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return "";
  }

  if (typeof value !== "string") {
    throw new Error(
      "El teléfono no es válido."
    );
  }

  const phone = value.trim();

  if (!phone) {
    return "";
  }

  const normalized = phone.replace(
    /\D/g,
    ""
  );

  if (
    normalized.length < 7 ||
    normalized.length > 15
  ) {
    throw new Error(
      "El teléfono debe tener entre 7 y 15 dígitos."
    );
  }

  return phone;
}

/* =========================================================
   PREPARAR DATOS DE CITA
========================================================= */

function prepareAppointment(
  appointment,
  {
    requireCustomerId = false
  } = {}
) {
  requireAppointment(appointment);

  const prepared = {
    ...appointment
  };

  /*
   * Las citas nuevas deben tener customerId.
   * Las citas históricas pueden no tenerlo.
   */
  if (requireCustomerId) {
    requireId(
      prepared.customerId,
      "Cliente"
    );
  } else if (
    prepared.customerId !== undefined &&
    prepared.customerId !== null &&
    prepared.customerId !== ""
  ) {
    requireId(
      prepared.customerId,
      "Cliente"
    );
  }

  /*
   * Teléfono opcional.
   * No se crea ni modifica customerId aquí.
   */
  if (
    Object.prototype.hasOwnProperty.call(
      prepared,
      "phone"
    )
  ) {
    prepared.phone = validatePhone(
      prepared.phone
    );
  }

  /*
   * No convertir identificadores
   * ni sobrescribir otros campos.
   *
   * El servidor valida horarios,
   * servicios, permisos y conflictos.
   */
  return prepared;
}

/* =========================================================
   PETICIÓN AUTENTICADA A NETLIFY
========================================================= */

async function sendAppointmentRequest(payload) {
  /*
   * Esperar a que Firebase determine
   * si hay una sesión activa.
   */
  await auth.authStateReady();

  const user = auth.currentUser;

  if (!user) {
    throw new Error(
      "Debes iniciar sesión para gestionar citas."
    );
  }

  let token;

  try {
    token = await user.getIdToken();
  } catch {
    throw new Error(
      "No se pudo verificar tu sesión. " +
      "Inicia sesión nuevamente."
    );
  }

  const controller = new AbortController();

  const timeoutId = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  let response;

  try {
    response = await fetch(
      ENDPOINT,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Authorization:
            `Bearer ${token}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      }
    );

  } catch (error) {
    if (
      error?.name === "AbortError"
    ) {
      throw new Error(
        "El servidor tardó demasiado en responder. " +
        "Comprueba si la operación se completó " +
        "antes de intentarlo nuevamente."
      );
    }

    throw new Error(
      "No se pudo conectar con el servidor. " +
      "Comprueba tu conexión e intenta nuevamente."
    );

  } finally {
    clearTimeout(timeoutId);
  }

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error(
      "El servidor devolvió una respuesta inválida."
    );
  }

  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result)
  ) {
    throw new Error(
      "El servidor devolvió datos inválidos."
    );
  }

  if (
    !response.ok ||
    result.ok !== true
  ) {
    if (
      response.status === 401
    ) {
      throw new Error(
        result.error ||
        "Tu sesión expiró. Inicia sesión nuevamente."
      );
    }

    if (
      response.status === 403
    ) {
      throw new Error(
        result.error ||
        "No tienes permiso para realizar esta operación."
      );
    }

    if (
      response.status === 409
    ) {
      throw new Error(
        result.error ||
        "La operación entra en conflicto con los datos actuales."
      );
    }

    throw new Error(
      result.error ||
      "No se pudo completar la operación."
    );
  }

  return result;
}

/* =========================================================
   CREAR CITA

   Requiere customerId.
   El teléfono puede estar vacío.
========================================================= */

export async function createAppointment(
  appointment
) {
  const prepared = prepareAppointment(
    appointment,
    {
      requireCustomerId: true
    }
  );

  return sendAppointmentRequest({
    action: "create",
    appointment: prepared
  });
}

/* =========================================================
   ACTUALIZAR CITA

   Compatible con citas históricas
   que no tengan customerId.
========================================================= */

export async function updateAppointment(
  id,
  appointment
) {
  requireId(
    id,
    "ID de cita"
  );

  const prepared = prepareAppointment(
    appointment,
    {
      requireCustomerId: false
    }
  );

  return sendAppointmentRequest({
    action: "update",
    id,
    appointment: prepared
  });
}

/* =========================================================
   CANCELAR CITA
========================================================= */

export async function cancelAppointment(
  id
) {
  requireId(
    id,
    "ID de cita"
  );

  return sendAppointmentRequest({
    action: "cancel",
    id
  });
}

/* =========================================================
   CAMBIAR ESTADO DE CITA

   Estados:
   - pending
   - confirmed
   - completed
   - no-show

   Método de pago al completar:
   - cash      (Efectivo)
   - card      (Tarjeta)
   - transfer  (Transferencia)
========================================================= */

export async function changeAppointmentStatus(
  id,
  status,
  paymentMethod = null
) {
  requireId(
    id,
    "ID de cita"
  );

  if (!VALID_STATUSES.has(status)) {
    throw new Error(
      "Estado de cita inválido."
    );
  }

  /*
   * El método de pago es obligatorio
   * únicamente al completar una cita.
   */
  if (status === "completed") {
    if (
      !VALID_PAYMENT_METHODS.has(
        paymentMethod
      )
    ) {
      throw new Error(
        "Selecciona cómo pagó el cliente: " +
        "efectivo, tarjeta o transferencia."
      );
    }

    return sendAppointmentRequest({
      action: "status",
      id,
      status,
      paymentMethod
    });
  }

  /*
   * Los demás cambios de estado
   * no requieren método de pago.
   */
  return sendAppointmentRequest({
    action: "status",
    id,
    status
  });
}
