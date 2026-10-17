
import { auth } from "./firebase.js";

const ENDPOINT =
  "/.netlify/functions/manage-customers";

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
  } catch {
    throw new Error(
      "No se pudo conectar con el servidor."
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

  if (!response.ok || !result.ok) {
    throw new Error(
      result.error ||
      "No se pudo completar la operación."
    );
  }

  return result;
}

export async function findBarberCustomerByPhone(phone) {
  const normalized = String(phone ?? "")
    .replace(/\D/g, "");

  if (!normalized) {
    return null;
  }

  const result = await requestCustomer("find", {
    phone: normalized
  });

  return result.customer || null;
}

export async function getBarberCustomerById(customerId) {
  if (!customerId) {
    return null;
  }

  const result = await requestCustomer("get", {
    customerId
  });

  return result.customer || null;
}

export async function searchBarberCustomers(query) {
  const text = String(query ?? "").trim();

  if (text.length < 2) {
    return [];
  }

  const result = await requestCustomer("search", {
    query: text
  });

  return Array.isArray(result.customers)
    ? result.customers
    : [];
}

export async function saveBarberCustomer(
  name,
  phone = "",
  customerId = null
) {
  const result = await requestCustomer("save", {
    name,
    phone,
    customerId
  });

  return result.customer;
}

export async function createBarberCustomer(
  name,
  phone = ""
) {
  const result = await requestCustomer("save", {
    name,
    phone
  });

  return {
    customer: result.customer,
    created: Boolean(result.created)
  };
}

export async function addPhoneToBarberCustomer(
  customerId,
  name,
  phone
) {
  if (!customerId) {
    throw new Error(
      "Selecciona primero el cliente."
    );
  }

  if (!phone) {
    throw new Error(
      "Ingresa el teléfono que deseas agregar."
    );
  }

  const result = await requestCustomer("save", {
    customerId,
    name,
    phone
  });

  return result.customer;
}
