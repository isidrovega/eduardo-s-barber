
import {
  initializeApp,
  getApps,
  cert
} from "firebase-admin/app";

import {
  getAuth
} from "firebase-admin/auth";

import {
  getFirestore
} from "firebase-admin/firestore";

/* =========================================================
   EDUARDO'S BARBERSHOP
   GESTIÓN SEGURA DE CLIENTES

   Acciones:
   - find
   - get
   - search
   - save

   Características:
   - Autenticación Firebase
   - Administradores y barberos autorizados
   - customerId permanente
   - Teléfono opcional
   - Teléfonos únicos mediante transacciones
   - Compatibilidad con clientes históricos
   - Agregar teléfono a un cliente existente
   - No fusionar clientes automáticamente
   - No modificar nombres desde las citas
========================================================= */

const ADMIN_UIDS = new Set([
  "5Dt5IvBhLZgEJ7cgLQ1dIwuQKZx2",
  "KcHcm82nZESqoHy7RrHZdyj1y2p2"
]);

const MAX_BODY_BYTES = 8192;
const MAX_SEARCH_RESULTS = 30;

/* =========================================================
   ERRORES
========================================================= */

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

/* =========================================================
   RESPUESTAS
========================================================= */

function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type":
        "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(data)
  };
}

/* =========================================================
   FIREBASE ADMIN
========================================================= */

function getFirebase() {
  if (!getApps().length) {
    const projectId =
      process.env.FIREBASE_PROJECT_ID;

    const clientEmail =
      process.env.FIREBASE_CLIENT_EMAIL;

    const privateKey =
      process.env.FIREBASE_PRIVATE_KEY;

    if (
      !projectId ||
      !clientEmail ||
      !privateKey
    ) {
      throw new AppError(
        "Falta la configuración de Firebase.",
        500
      );
    }

    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(
          /\\n/g,
          "\n"
        )
      })
    });
  }

  return {
    auth: getAuth(),
    db: getFirestore()
  };
}

/* =========================================================
   NORMALIZACIÓN
========================================================= */

function normalizePhone(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "";
  }

  if (typeof value !== "string") {
    throw new AppError(
      "El teléfono no es válido."
    );
  }

  const phone = value.replace(/\D/g, "");

  if (
    phone.length < 7 ||
    phone.length > 15
  ) {
    throw new AppError(
      "El teléfono debe tener entre 7 y 15 dígitos."
    );
  }

  return phone;
}

function normalizeName(value) {
  if (typeof value !== "string") {
    throw new AppError(
      "Ingresa el nombre del cliente."
    );
  }

  const name = value
    .trim()
    .replace(/\s+/g, " ");

  if (
    name.length < 2 ||
    name.length > 120
  ) {
    throw new AppError(
      "El nombre debe tener entre 2 y 120 caracteres."
    );
  }

  return name;
}

function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es");
}

function validId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 150 &&
    !value.includes("/")
  );
}

/* =========================================================
   DATOS PÚBLICOS DEL CLIENTE
========================================================= */

function publicCustomer(snapshot) {
  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data();

  return {
    id: snapshot.id,
    name: data.name || "",
    phone: data.phone || "",
    visits: Number(data.visits) || 0,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null
  };
}

/* =========================================================
   AUTORIZACIÓN
========================================================= */

async function getIdentity(auth, db, event) {
  const header =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    "";

  const match = header.match(
    /^Bearer\s+(.+)$/i
  );

  if (!match) {
    throw new AppError(
      "Inicia sesión para continuar.",
      401
    );
  }

  let decoded;

  try {
    decoded = await auth.verifyIdToken(
      match[1],
      true
    );
  } catch {
    throw new AppError(
      "La sesión no es válida.",
      401
    );
  }

  if (ADMIN_UIDS.has(decoded.uid)) {
    return {
      uid: decoded.uid,
      role: "admin"
    };
  }

  const userSnapshot = await db
    .collection("users")
    .doc(decoded.uid)
    .get();

  if (!userSnapshot.exists) {
    throw new AppError(
      "Acceso no autorizado.",
      403
    );
  }

  const user = userSnapshot.data();

  if (
    user.role !== "barber" ||
    user.active !== true ||
    !validId(user.barberId)
  ) {
    throw new AppError(
      "Acceso no autorizado.",
      403
    );
  }

  const barberSnapshot = await db
    .collection("barbers")
    .doc(user.barberId)
    .get();

  if (
    !barberSnapshot.exists ||
    barberSnapshot.data().status !== "active"
  ) {
    throw new AppError(
      "El barbero no está activo.",
      403
    );
  }

  return {
    uid: decoded.uid,
    role: "barber",
    barberId: user.barberId
  };
}

/* =========================================================
   REFERENCIA ÚNICA POR TELÉFONO
========================================================= */

function phoneReference(db, phone) {
  return db
    .collection("customerPhones")
    .doc(phone);
}

/* =========================================================
   BUSCAR TELÉFONO HISTÓRICO

   Comprueba normalizedPhone y phone.

   La segunda consulta se realiza para detectar
   registros antiguos que no tengan el campo
   normalizedPhone.
========================================================= */

async function findLegacyPhoneOwners(db, phone) {
  const customers = db.collection("customers");

  const normalizedSnapshot = await customers
    .where(
      "normalizedPhone",
      "==",
      phone
    )
    .get();

  const owners = new Map();

  for (const snapshot of normalizedSnapshot.docs) {
    owners.set(
      snapshot.id,
      snapshot
    );
  }

  /*
   * Para preservar compatibilidad con clientes
   * históricos, también revisar los documentos
   * cuyo teléfono todavía no está normalizado.
   *
   * Esta lectura completa puede resultar costosa
   * en bases de datos grandes. Se debe retirar
   * después de migrar los registros antiguos.
   */
  const allSnapshot = await customers.get();

  for (const snapshot of allSnapshot.docs) {
    const data = snapshot.data();

    const storedPhone = String(
      data.normalizedPhone ||
      data.phone ||
      ""
    ).replace(/\D/g, "");

    if (storedPhone === phone) {
      owners.set(
        snapshot.id,
        snapshot
      );
    }
  }

  return [...owners.values()];
}

/* =========================================================
   BUSCAR POR TELÉFONO
========================================================= */

async function findByPhone(db, phone) {
  const normalizedPhone =
    normalizePhone(phone);

  if (!normalizedPhone) {
    return null;
  }

  const owners = await findLegacyPhoneOwners(
    db,
    normalizedPhone
  );

  if (owners.length > 1) {
    throw new AppError(
      "Hay varios clientes con este teléfono. " +
      "Solicita al administrador revisar las fichas.",
      409
    );
  }

  const indexedSnapshot = await phoneReference(
    db,
    normalizedPhone
  ).get();

  if (indexedSnapshot.exists) {
    const indexedCustomerId =
      indexedSnapshot.data()?.customerId;

    if (!validId(indexedCustomerId)) {
      throw new AppError(
        "El índice del teléfono es inválido.",
        409
      );
    }

    if (
      owners.length === 1 &&
      owners[0].id !== indexedCustomerId
    ) {
      throw new AppError(
        "El teléfono tiene registros inconsistentes. " +
        "Solicita una revisión administrativa.",
        409
      );
    }

    const customerSnapshot = await db
      .collection("customers")
      .doc(indexedCustomerId)
      .get();

    if (!customerSnapshot.exists) {
      throw new AppError(
        "El teléfono apunta a una ficha inexistente.",
        409
      );
    }

    return publicCustomer(
      customerSnapshot
    );
  }

  return owners.length === 1
    ? publicCustomer(owners[0])
    : null;
}

/* =========================================================
   BUSCAR POR ID
========================================================= */

async function getById(db, id) {
  if (!validId(id)) {
    throw new AppError(
      "Identificador inválido."
    );
  }

  const snapshot = await db
    .collection("customers")
    .doc(id)
    .get();

  return publicCustomer(snapshot);
}

/* =========================================================
   BUSCAR POR NOMBRE O TELÉFONO
========================================================= */

async function searchCustomers(db, text) {
  const term = normalizeSearch(text);

  if (term.length < 2) {
    return [];
  }

  if (term.length > 120) {
    throw new AppError(
      "Búsqueda demasiado larga."
    );
  }

  const phoneTerm = term.replace(
    /\D/g,
    ""
  );

  const snapshot = await db
    .collection("customers")
    .get();

  return snapshot.docs
    .filter(document => {
      const data = document.data();

      const nameMatches =
        normalizeSearch(
          data.name
        ).includes(term);

      const storedPhone = String(
        data.normalizedPhone ||
        data.phone ||
        ""
      ).replace(/\D/g, "");

      const phoneMatches =
        phoneTerm.length >= 2 &&
        storedPhone.includes(phoneTerm);

      return (
        nameMatches ||
        phoneMatches
      );
    })
    .slice(0, MAX_SEARCH_RESULTS)
    .map(publicCustomer);
}

/* =========================================================
   ACTUALIZAR CLIENTE EXISTENTE
========================================================= */

async function updateExistingCustomer(
  db,
  customerId,
  name,
  normalizedPhone,
  originalPhone
) {
  const reference = db
    .collection("customers")
    .doc(customerId);

  /*
   * Verificar que el teléfono no esté registrado
   * en otra ficha histórica.
   */
  if (normalizedPhone) {
    const owners = await findLegacyPhoneOwners(
      db,
      normalizedPhone
    );

    if (
      owners.some(
        owner => owner.id !== customerId
      )
    ) {
      throw new AppError(
        "Este teléfono pertenece a otro cliente.",
        409
      );
    }
  }

  const phoneRef = normalizedPhone
    ? phoneReference(
        db,
        normalizedPhone
      )
    : null;

  const now = new Date().toISOString();

  await db.runTransaction(
    async transaction => {
      /*
       * Todas las lecturas de la transacción
       * deben realizarse antes de escribir.
       */
      const customerSnapshot =
        await transaction.get(reference);

      if (!customerSnapshot.exists) {
        throw new AppError(
          "No se encontró el cliente.",
          404
        );
      }

      const phoneSnapshot = phoneRef
        ? await transaction.get(phoneRef)
        : null;

      const previous =
        customerSnapshot.data();

      const previousPhone = String(
        previous.normalizedPhone ||
        previous.phone ||
        ""
      ).replace(/\D/g, "");

      /*
       * No permitir cambiar un teléfono
       * ya registrado desde el formulario
       * de citas.
       */
      if (
        previousPhone &&
        normalizedPhone &&
        previousPhone !== normalizedPhone
      ) {
        throw new AppError(
          "Para cambiar un teléfono existente, " +
          "utiliza el proceso de corrección de datos.",
          409
        );
      }

      if (
        phoneSnapshot?.exists &&
        phoneSnapshot.data()?.customerId !==
          customerId
      ) {
        throw new AppError(
          "Este teléfono pertenece a otro cliente.",
          409
        );
      }

      const changes = {};

      /*
       * Solo agregar teléfono si la ficha
       * todavía no tenía uno.
       */
      if (
        normalizedPhone &&
        !previousPhone
      ) {
        changes.phone =
          String(originalPhone).trim();

        changes.normalizedPhone =
          normalizedPhone;
      }

      /*
       * Corregir índice faltante sin cambiar
       * los datos del cliente.
       */
      if (
        normalizedPhone &&
        previousPhone === normalizedPhone &&
        !previous.normalizedPhone
      ) {
        changes.normalizedPhone =
          normalizedPhone;
      }

      if (
        phoneRef &&
        !phoneSnapshot.exists
      ) {
        transaction.create(
          phoneRef,
          {
            customerId,
            createdAt: now
          }
        );
      }

      /*
       * No sobrescribir nombres ni visitas
       * desde un formulario de citas.
       */
      if (
        Object.keys(changes).length > 0
      ) {
        changes.updatedAt = now;

        transaction.update(
          reference,
          changes
        );
      }
    }
  );

  const updated = await reference.get();

  return {
    customer: publicCustomer(updated),
    created: false
  };
}

/* =========================================================
   CREAR CLIENTE NUEVO
========================================================= */

async function createNewCustomer(
  db,
  name,
  normalizedPhone,
  originalPhone
) {
  /*
   * Detectar registros históricos antes de
   * crear una ficha nueva.
   */
  if (normalizedPhone) {
    const existing = await findByPhone(
      db,
      normalizedPhone
    );

    if (existing) {
      return {
        customer: existing,
        created: false
      };
    }
  }

  /*
   * Evitar duplicados exactos por nombre
   * cuando no hay teléfono que distinga
   * a los clientes.
   *
   * No se fusionan fichas automáticamente.
   */
  const matches = await searchCustomers(
    db,
    name
  );

  const exactMatches = matches.filter(
    customer =>
      normalizeSearch(customer.name) ===
      normalizeSearch(name)
  );

  if (exactMatches.length) {
    throw new AppError(
      "Ya existe un cliente con ese nombre. " +
      "Selecciona su ficha antes de continuar. " +
      "Si es otra persona, utiliza un nombre distintivo.",
      409
    );
  }

  const reference = db
    .collection("customers")
    .doc();

  const phoneRef = normalizedPhone
    ? phoneReference(
        db,
        normalizedPhone
      )
    : null;

  const now = new Date().toISOString();

  const customer = {
    id: reference.id,
    name,
    phone: normalizedPhone
      ? String(originalPhone).trim()
      : "",
    normalizedPhone,
    visits: 0,
    createdAt: now,
    updatedAt: now
  };

  const result = await db.runTransaction(
    async transaction => {
      /*
       * Comprobar la reserva única dentro
       * de la misma transacción.
       */
      const phoneSnapshot = phoneRef
        ? await transaction.get(phoneRef)
        : null;

      if (phoneSnapshot?.exists) {
        const existingId =
          phoneSnapshot.data()?.customerId;

        if (!validId(existingId)) {
          throw new AppError(
            "El índice del teléfono es inválido.",
            409
          );
        }

        const existingReference = db
          .collection("customers")
          .doc(existingId);

        const existingSnapshot =
          await transaction.get(
            existingReference
          );

        if (!existingSnapshot.exists) {
          throw new AppError(
            "El teléfono apunta a una ficha inexistente.",
            409
          );
        }

        return {
          existing: publicCustomer(
            existingSnapshot
          )
        };
      }

      transaction.create(
        reference,
        customer
      );

      if (phoneRef) {
        transaction.create(
          phoneRef,
          {
            customerId: reference.id,
            createdAt: now
          }
        );
      }

      return {
        existing: null
      };
    }
  );

  if (result.existing) {
    return {
      customer: result.existing,
      created: false
    };
  }

  return {
    customer,
    created: true
  };
}

/* =========================================================
   GUARDAR CLIENTE
========================================================= */

async function saveCustomer(db, input) {
  const name = normalizeName(
    input.name
  );

  const normalizedPhone = normalizePhone(
    input.phone
  );

  const customerId =
    input.customerId || null;

  if (
    customerId &&
    !validId(customerId)
  ) {
    throw new AppError(
      "El identificador del cliente es inválido."
    );
  }

  /*
   * Si existe customerId, actualizar esa ficha.
   * Nunca crear otra automáticamente.
   */
  if (customerId) {
    return updateExistingCustomer(
      db,
      customerId,
      name,
      normalizedPhone,
      input.phone || ""
    );
  }

  return createNewCustomer(
    db,
    name,
    normalizedPhone,
    input.phone || ""
  );
}

/* =========================================================
   LEER SOLICITUD
========================================================= */

async function parseBody(event) {
  const raw = event.body || "";

  if (
    Buffer.byteLength(
      raw,
      "utf8"
    ) > MAX_BODY_BYTES
  ) {
    throw new AppError(
      "La solicitud es demasiado grande.",
      413
    );
  }

  try {
    const body = JSON.parse(raw);

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      throw new Error(
        "Formato inválido"
      );
    }

    return body;

  } catch {
    throw new AppError(
      "El contenido de la solicitud no es válido."
    );
  }
}

/* =========================================================
   NETLIFY HANDLER
========================================================= */

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(
      405,
      {
        ok: false,
        error: "Método no permitido."
      }
    );
  }

  try {
    const { auth, db } = getFirebase();

    await getIdentity(
      auth,
      db,
      event
    );

    const body = await parseBody(
      event
    );

    switch (body.action) {
      case "find": {
        const customer = await findByPhone(
          db,
          body.phone
        );

        return json(
          200,
          {
            ok: true,
            customer
          }
        );
      }

      case "get": {
        const customer = await getById(
          db,
          body.customerId
        );

        return json(
          200,
          {
            ok: true,
            customer
          }
        );
      }

      case "search": {
        const customers = await searchCustomers(
          db,
          body.query
        );

        return json(
          200,
          {
            ok: true,
            customers
          }
        );
      }

      case "save": {
        const result = await saveCustomer(
          db,
          body
        );

        return json(
          200,
          {
            ok: true,
            ...result
          }
        );
      }

      default:
        throw new AppError(
          "Acción no reconocida."
        );
    }

  } catch (error) {
    console.error(
      "manage-customers:",
      error
    );

    return json(
      error instanceof AppError
        ? error.status
        : 500,
      {
        ok: false,
        error:
          error instanceof AppError
            ? error.message
            : "Error interno al gestionar clientes."
      }
    );
  }
}
