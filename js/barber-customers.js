
import { auth } from "./firebase.js";

/* =========================================================
   EDUARDO'S BARBERSHOP
   GESTIÓN DE CLIENTES MEDIANTE NETLIFY

   - Autenticación Firebase
   - Buscar cliente por teléfono
   - Obtener cliente por customerId
   - Buscar clientes por nombre
   - Crear o actualizar clientes
   - Teléfono opcional
   - Agregar teléfono a clientes existentes
   - Conservar identificadores permanentes
========================================================= */

const ENDPOINT =
  "/.netlify/functions/manage-customers";

/* =========================================================
   UTILIDADES
========================================================= */

function normalizePhone(value) {
  return String(value ?? "")
    .replace(/\D/g, "");
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function validatePhone(phone, required = false) {
  const normalized = normalizePhone(phone);

  if (!normalized) {
    if (required) {
      throw new Error(
        "Ingresa un número de teléfono."
      );
    }

    return "";
  }

  if (
    normalized.length < 7 ||
    normalized.length > 15
  ) {
    throw new Error(
      "El teléfono debe contener entre 7 y 15 dígitos."
    );
  }

  return normalized;
}

function validateName(name) {
  const normalized = normalizeName(name);

  if (normalized.length < 2) {
    throw new Error(
      "El nombre debe tener al menos dos caracteres."
    );
  }

  return normalized;
}

function validateCustomerId(customerId) {
  const id = String(customerId ?? "").trim();

  if (!id) {
    throw new Error(
      "No se proporcionó un identificador de cliente válido."
    );
  }

  return id;
}

function validateCustomerResponse(customer) {
  if (
    !customer ||
    typeof customer !== "object" ||
    !customer.id
  ) {
    throw new Error(
      "El servidor no devolvió un cliente válido."
    );
  }

  return {
    ...customer,
    id: String(customer.id),
    name: String(customer.name || ""),
    phone: String(customer.phone || "")
  };
}

/* =========================================================
   PETICIONES AUTENTICADAS
========================================================= */

async function requestCustomer(action, data = {}) {
  await auth.authStateReady();

  const user = auth.currentUser;

  if (!user) {
    throw new Error(
      "Debes iniciar sesión para gestionar clientes."
    );
  }

  const token = await user.getIdToken();

  let response;

  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        action,
        ...data
      })
    });

  } catch (error) {
    console.error(
      "Error de conexión con Netlify:",
      error
    );

    throw new Error(
      "No se pudo conectar con el servidor. " +
      "Comprueba tu conexión e intenta nuevamente."
    );
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
    typeof result !== "object"
  ) {
    throw new Error(
      "El servidor devolvió datos inválidos."
    );
  }

  if (!response.ok || !result.ok) {
    throw new Error(
      result.error ||
      "No se pudo completar la operación."
    );
  }

  return result;
}

/* =========================================================
   BUSCAR CLIENTE POR TELÉFONO
========================================================= */

export async function findBarberCustomerByPhone(phone) {
  const normalized = validatePhone(phone);

  if (!normalized) {
    return null;
  }

  const result = await requestCustomer(
    "find",
    {
      phone: normalized
    }
  );

  if (!result.customer) {
    return null;
  }

  return validateCustomerResponse(
    result.customer
  );
}

/* =========================================================
   OBTENER CLIENTE POR ID
========================================================= */

export async function getBarberCustomerById(customerId) {
  if (!customerId) {
    return null;
  }

  const id = validateCustomerId(
    customerId
  );

  const result = await requestCustomer(
    "get",
    {
      customerId: id
    }
  );

  if (!result.customer) {
    return null;
  }

  return validateCustomerResponse(
    result.customer
  );
}

/* =========================================================
   BUSCAR CLIENTES POR NOMBRE
========================================================= */

export async function searchBarberCustomers(query) {
  const text = normalizeName(query);

  if (text.length < 2) {
    return [];
  }

  const result = await requestCustomer(
    "search",
    {
      query: text
    }
  );

  if (!Array.isArray(result.customers)) {
    return [];
  }

  return result.customers
    .filter(
      customer =>
        customer &&
        typeof customer === "object" &&
        customer.id
    )
    .map(validateCustomerResponse);
}

/* =========================================================
   CREAR O ACTUALIZAR CLIENTE

   customerId:
   - null: crear o encontrar cliente
   - valor existente: actualizar esa ficha
========================================================= */

export async function saveBarberCustomer(
  name,
  phone = "",
  customerId = null
) {
  const normalizedName = validateName(
    name
  );

  const normalizedPhone = validatePhone(
    phone
  );

  const id = customerId
    ? validateCustomerId(customerId)
    : null;

  const result = await requestCustomer(
    "save",
    {
      name: normalizedName,
      phone: normalizedPhone,
      customerId: id
    }
  );

  const customer = validateCustomerResponse(
    result.customer
  );

  /*
   * Si se solicitó actualizar un cliente,
   * el servidor debe devolver el mismo ID.
   */
  if (
    id &&
    customer.id !== id
  ) {
    throw new Error(
      "El servidor devolvió un cliente diferente " +
      "al que se intentó actualizar."
    );
  }

  return customer;
}

/* =========================================================
   CREAR CLIENTE

   Conserva la respuesta original:
   { customer, created }
========================================================= */

export async function createBarberCustomer(
  name,
  phone = ""
) {
  const normalizedName = validateName(
    name
  );

  const normalizedPhone = validatePhone(
    phone
  );

  const result = await requestCustomer(
    "save",
    {
      name: normalizedName,
      phone: normalizedPhone
    }
  );

  return {
    customer: validateCustomerResponse(
      result.customer
    ),
    created: Boolean(result.created)
  };
}

/* =========================================================
   AGREGAR TELÉFONO A CLIENTE EXISTENTE
========================================================= */

export async function addPhoneToBarberCustomer(
  customerId,
  name,
  phone
) {
  const id = validateCustomerId(
    customerId
  );

  const normalizedName = validateName(
    name
  );

  const normalizedPhone = validatePhone(
    phone,
    true
  );

  const result = await requestCustomer(
    "save",
    {
      customerId: id,
      name: normalizedName,
      phone: normalizedPhone
    }
  );

  const customer = validateCustomerResponse(
    result.customer
  );

  if (customer.id !== id) {
    throw new Error(
      "El servidor no actualizó la ficha seleccionada."
    );
  }

  return customer;
}
