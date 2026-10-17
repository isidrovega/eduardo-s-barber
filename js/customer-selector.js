
import {
    searchBarberCustomers,
    findBarberCustomerByPhone,
    getBarberCustomerById,
    saveBarberCustomer
} from "./barber-customers.js";

/* =========================================================
   EDUARDO'S BARBERSHOP
   CUSTOMER SELECTOR

   - Buscar por nombre o teléfono
   - Seleccionar clientes existentes
   - Registrar clientes nuevos
   - Permitir teléfono opcional
   - Agregar teléfono sin cambiar customerId
   - Evitar duplicados evidentes
   - Evitar respuestas asíncronas obsoletas
   - Conservar los datos de citas históricas
   - Limpiar listeners
========================================================= */

const SEARCH_DELAY_MS = 250;

function normalize(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("es");
}

function digits(value) {
    return String(value ?? "")
        .replace(/\D/g, "");
}

function normalizeCustomer(customer) {
    if (
        !customer ||
        !customer.id
    ) {
        return null;
    }

    return {
        ...customer,
        id: String(customer.id),
        name: String(
            customer.name || ""
        ).trim(),
        phone: String(
            customer.phone || ""
        ).trim()
    };
}

function validatePhone(phone) {
    const raw = String(
        phone ?? ""
    ).trim();

    if (!raw) {
        return "";
    }

    const normalized =
        digits(raw);

    if (
        normalized.length < 7 ||
        normalized.length > 15
    ) {
        throw new Error(
            "El teléfono debe tener entre 7 y 15 dígitos."
        );
    }

    return normalized;
}

function validCustomerId(value) {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 150 &&
        value !== "." &&
        value !== ".." &&
        !value.includes("/")
    );
}

/* =========================================================
   CREAR SELECTOR
========================================================= */

export function createCustomerSelector({
    nameInput,
    phoneInput,
    container,
    initialCustomerId = null
}) {
    if (
        !nameInput ||
        !phoneInput ||
        !container
    ) {
        throw new Error(
            "Faltan elementos para inicializar el selector de clientes."
        );
    }

    let selected = null;

    let version = 0;
    let disposed = false;
    let resolving = false;

    let searchTimer = null;

    /*
     * Indica si la ficha fue asociada
     * por una selección explícita o
     * por setCustomerId().
     */
    let selectedExplicitly = false;

    container.replaceChildren();

    /* =====================================================
       INTERFAZ
    ===================================================== */

    const status =
        document.createElement("div");

    const results =
        document.createElement("div");

    status.setAttribute(
        "aria-live",
        "polite"
    );

    results.style.cssText =
        "display:grid;" +
        "gap:6px;" +
        "margin-top:8px";

    container.append(
        status,
        results
    );

    /* =====================================================
       MENSAJES
    ===================================================== */

    function message(text) {
        if (disposed) {
            return;
        }

        status.textContent =
            String(text || "");
    }

    /* =====================================================
       CONTROL DE SOLICITUDES
    ===================================================== */

    function clearSearchTimer() {
        if (
            searchTimer !== null
        ) {
            clearTimeout(
                searchTimer
            );

            searchTimer = null;
        }
    }

    function invalidateRequests() {
        ++version;

        clearSearchTimer();
    }

    function isCurrent(requestVersion) {
        return (
            !disposed &&
            requestVersion === version
        );
    }

    /* =====================================================
       SELECCIÓN
    ===================================================== */

    function clearSelection({
        clearMessage = true
    } = {}) {
        selected = null;
        selectedExplicitly = false;

        results.replaceChildren();

        if (clearMessage) {
            message("");
        }
    }

    function selectedNameMatches() {
        return (
            selected &&
            normalize(nameInput.value) ===
                normalize(selected.name)
        );
    }

    function selectedPhoneMatches() {
        if (!selected) {
            return false;
        }

        const registeredPhone =
            digits(
                selected.phone
            );

        const enteredPhone =
            digits(
                phoneInput.value
            );

        /*
         * Cliente sin teléfono:
         * puede conservar su selección
         * al escribir un teléfono nuevo.
         */
        if (!registeredPhone) {
            return true;
        }

        return (
            enteredPhone ===
            registeredPhone
        );
    }

    function selectionMatchesInputs() {
        return Boolean(
            selected &&
            selectedNameMatches() &&
            selectedPhoneMatches()
        );
    }

    /* =====================================================
       SELECCIONAR CLIENTE
    ===================================================== */

    function select(
        customer,
        {
            updateInputs = true,
            explicit = true
        } = {}
    ) {
        if (disposed) {
            return null;
        }

        const normalizedCustomer =
            normalizeCustomer(
                customer
            );

        if (!normalizedCustomer) {
            throw new Error(
                "No se pudo seleccionar el cliente."
            );
        }

        invalidateRequests();

        selected =
            normalizedCustomer;

        selectedExplicitly =
            explicit;

        if (updateInputs) {
            nameInput.value =
                selected.name;

            phoneInput.value =
                selected.phone;
        }

        results.replaceChildren();

        message(
            `✓ Cliente seleccionado: ${selected.name}`
        );

        return selected;
    }

    /* =====================================================
       RESULTADOS
    ===================================================== */

    function renderMatches(matches) {
        if (disposed) {
            return;
        }

        results.replaceChildren();

        if (
            !Array.isArray(matches) ||
            matches.length === 0
        ) {
            message(
                "No hay coincidencias. Puedes registrar un cliente nuevo."
            );
            return;
        }

        message(
            "Selecciona la ficha correcta antes de guardar."
        );

        for (const customer of matches) {
            const normalizedCustomer =
                normalizeCustomer(
                    customer
                );

            if (!normalizedCustomer) {
                continue;
            }

            const button =
                document.createElement(
                    "button"
                );

            button.type = "button";

            button.textContent =
                `${normalizedCustomer.name} · ` +
                (
                    normalizedCustomer.phone ||
                    "Sin teléfono"
                );

            button.style.cssText =
                "padding:8px;" +
                "text-align:left;" +
                "border:1px solid #ccc;" +
                "border-radius:6px;" +
                "cursor:pointer";

            button.addEventListener(
                "pointerdown",
                event => {
                    event.preventDefault();
                }
            );

            button.addEventListener(
                "click",
                () => {
                    select(
                        normalizedCustomer,
                        {
                            updateInputs: true,
                            explicit: true
                        }
                    );
                }
            );

            results.append(
                button
            );
        }
    }

    /* =====================================================
       BÚSQUEDA
    ===================================================== */

    async function search() {
        if (
            disposed ||
            resolving
        ) {
            return;
        }

        clearSearchTimer();

        const current =
            ++version;

        if (
            selected &&
            selectionMatchesInputs()
        ) {
            return;
        }

        const name =
            nameInput.value.trim();

        const phone =
            digits(
                phoneInput.value
            );

        results.replaceChildren();

        /*
         * Buscar por teléfono válido.
         */
        if (
            phone.length >= 7 &&
            phone.length <= 15
        ) {
            message(
                "Buscando teléfono..."
            );

            try {
                const customer =
                    await findBarberCustomerByPhone(
                        phone
                    );

                if (
                    !isCurrent(
                        current
                    )
                ) {
                    return;
                }

                if (customer) {
                    /*
                     * No asociar automáticamente
                     * un nombre diferente.
                     */
                    if (
                        name &&
                        normalize(
                            customer.name
                        ) !==
                        normalize(
                            name
                        )
                    ) {
                        renderMatches([
                            customer
                        ]);

                        return;
                    }

                    select(
                        customer,
                        {
                            updateInputs: true,
                            explicit: true
                        }
                    );

                    return;
                }

            } catch (error) {
                if (
                    !isCurrent(
                        current
                    )
                ) {
                    return;
                }

                message(
                    error.message ||
                    "No se pudo buscar el teléfono."
                );

                return;
            }
        }

        if (
            name.length < 2
        ) {
            message(
                "Escribe al menos dos letras para buscar."
            );

            return;
        }

        message(
            "Buscando clientes..."
        );

        try {
            const matches =
                await searchBarberCustomers(
                    name
                );

            if (
                !isCurrent(
                    current
                )
            ) {
                return;
            }

            renderMatches(
                Array.isArray(matches)
                    ? matches
                    : []
            );

        } catch (error) {
            if (
                !isCurrent(
                    current
                )
            ) {
                return;
            }

            message(
                error.message ||
                "No se pudieron buscar los clientes."
            );
        }
    }

    /* =====================================================
       PROGRAMAR BÚSQUEDA
    ===================================================== */

    function scheduleSearch() {
        clearSearchTimer();

        if (
            disposed ||
            resolving
        ) {
            return;
        }

        searchTimer =
            setTimeout(
                () => {
                    searchTimer = null;
                    search();
                },
                SEARCH_DELAY_MS
            );
    }

    /* =====================================================
       CAMBIOS EN CAMPOS
    ===================================================== */

    function handleChange() {
        invalidateRequests();

        if (
            selected &&
            selectionMatchesInputs()
        ) {
            /*
             * Mantener customerId al
             * agregar teléfono a una
             * ficha que no lo tenía.
             */
            results.replaceChildren();

            if (
                !digits(
                    selected.phone
                ) &&
                digits(
                    phoneInput.value
                )
            ) {
                message(
                    "El teléfono se agregará a esta ficha al guardar."
                );
            } else {
                message(
                    `✓ Cliente seleccionado: ${selected.name}`
                );
            }

            return;
        }

        clearSelection();

        scheduleSearch();
    }

    /* =====================================================
       CARGAR CLIENTE POR ID
    ===================================================== */

    async function setCustomerId(
        id,
        {
            preserveInputs = true
        } = {}
    ) {
        if (disposed) {
            throw new Error(
                "El selector de clientes ya no está activo."
            );
        }

        if (!id) {
            reset();
            return null;
        }

        const customerId =
            String(id);

        if (
            !validCustomerId(
                customerId
            )
        ) {
            throw new Error(
                "El identificador del cliente no es válido."
            );
        }

        invalidateRequests();

        const current =
            version;

        message(
            "Cargando cliente seleccionado..."
        );

        try {
            const customer =
                await getBarberCustomerById(
                    customerId
                );

            if (
                !isCurrent(
                    current
                )
            ) {
                return null;
            }

            if (
                !customer?.id
            ) {
                throw new Error(
                    "No se encontró el cliente seleccionado."
                );
            }

            /*
             * preserveInputs=true evita
             * sobrescribir los datos
             * históricos de una cita.
             */
            return select(
                customer,
                {
                    updateInputs:
                        !preserveInputs,
                    explicit: false
                }
            );

        } catch (error) {
            if (
                isCurrent(
                    current
                )
            ) {
                message(
                    error.message ||
                    "No se pudo cargar el cliente."
                );
            }

            throw error;
        }
    }

    /* =====================================================
       RESOLVER CLIENTE
    ===================================================== */

    async function resolve() {
        if (disposed) {
            throw new Error(
                "El selector de clientes ya no está activo."
            );
        }

        if (resolving) {
            throw new Error(
                "Espera a que termine el registro del cliente."
            );
        }

        const name =
            nameInput.value.trim();

        const phone =
            phoneInput.value.trim();

        if (
            name.length < 2
        ) {
            throw new Error(
                "Ingresa el nombre del cliente."
            );
        }

        const normalizedPhone =
            validatePhone(
                phone
            );

        invalidateRequests();

        resolving = true;

        try {
            /* =========================================
               CLIENTE SELECCIONADO
            ========================================= */

            if (selected) {
                if (
                    normalize(
                        name
                    ) !==
                    normalize(
                        selected.name
                    )
                ) {
                    throw new Error(
                        "El nombre cambió. Selecciona nuevamente al cliente."
                    );
                }

                const existingPhone =
                    digits(
                        selected.phone
                    );

                if (
                    existingPhone &&
                    normalizedPhone &&
                    normalizedPhone !==
                        existingPhone
                ) {
                    throw new Error(
                        "El teléfono no coincide con la ficha seleccionada."
                    );
                }

                /*
                 * Si no tenía teléfono,
                 * agregarlo al mismo ID.
                 */
                if (
                    !existingPhone &&
                    normalizedPhone
                ) {
                    const updated =
                        await saveBarberCustomer(
                            selected.name,
                            phone,
                            selected.id
                        );

                    if (
                        !updated?.id ||
                        String(
                            updated.id
                        ) !==
                        selected.id
                    ) {
                        throw new Error(
                            "No se pudo actualizar el cliente seleccionado."
                        );
                    }

                    select(
                        updated,
                        {
                            updateInputs: true,
                            explicit: true
                        }
                    );
                }

                return selected;
            }

            /* =========================================
               BUSCAR POR TELÉFONO
            ========================================= */

            if (
                normalizedPhone
            ) {
                const existing =
                    await findBarberCustomerByPhone(
                        normalizedPhone
                    );

                if (
                    existing?.id
                ) {
                    if (
                        normalize(
                            existing.name
                        ) !==
                        normalize(
                            name
                        )
                    ) {
                        renderMatches([
                            existing
                        ]);

                        throw new Error(
                            `El teléfono pertenece a ${existing.name}. Selecciona su ficha.`
                        );
                    }

                    select(
                        existing,
                        {
                            updateInputs: true,
                            explicit: true
                        }
                    );

                    return selected;
                }
            }

            /* =========================================
               COMPROBAR NOMBRES EXISTENTES
            ========================================= */

            const matches =
                await searchBarberCustomers(
                    name
                );

            const exact = (
                Array.isArray(
                    matches
                )
                    ? matches
                    : []
            ).filter(
                customer =>
                    normalize(
                        customer.name
                    ) ===
                    normalize(
                        name
                    )
            );

            if (
                exact.length > 0
            ) {
                renderMatches(
                    exact
                );

                throw new Error(
                    "Ya existe un cliente con ese nombre. Selecciona su ficha para conservar el historial."
                );
            }

            /* =========================================
               CREAR CLIENTE
            ========================================= */

            const customer =
                await saveBarberCustomer(
                    name,
                    phone
                );

            if (
                !customer?.id
            ) {
                throw new Error(
                    "No se pudo registrar el cliente."
                );
            }

            select(
                customer,
                {
                    updateInputs: true,
                    explicit: true
                }
            );

            return selected;

        } finally {
            resolving = false;
        }
    }

    /* =====================================================
       REINICIAR
    ===================================================== */

    function reset() {
        invalidateRequests();
        clearSelection();
    }

    /* =====================================================
       DESTRUIR
    ===================================================== */

    function destroy() {
        if (disposed) {
            return;
        }

        disposed = true;

        invalidateRequests();

        nameInput.removeEventListener(
            "input",
            handleChange
        );

        phoneInput.removeEventListener(
            "input",
            handleChange
        );

        nameInput.removeEventListener(
            "blur",
            search
        );

        phoneInput.removeEventListener(
            "blur",
            search
        );

        container.replaceChildren();
    }

    /* =====================================================
       EVENTOS
    ===================================================== */

    nameInput.addEventListener(
        "input",
        handleChange
    );

    phoneInput.addEventListener(
        "input",
        handleChange
    );

    nameInput.addEventListener(
        "blur",
        search
    );

    phoneInput.addEventListener(
        "blur",
        search
    );

    /* =====================================================
       CLIENTE INICIAL
    ===================================================== */

    if (
        initialCustomerId
    ) {
        setCustomerId(
            initialCustomerId
        ).catch(
            error => {
                if (!disposed) {
                    message(
                        error.message ||
                        "No se pudo cargar el cliente inicial."
                    );
                }
            }
        );
    }

    /* =====================================================
       API PÚBLICA
    ===================================================== */

    return {
        resolve,
        reset,
        setCustomerId,
        destroy,

        get selectedCustomerId() {
            return selected?.id || null;
        }
    };
}
