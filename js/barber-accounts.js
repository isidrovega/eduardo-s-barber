
import { auth, db } from "./firebase.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const section = document.getElementById("barberAccountSection");
const form = document.getElementById("barberAccountForm");
const emailInput = document.getElementById("barberAccountEmail");
const passwordInput = document.getElementById("barberAccountPassword");
const button = document.getElementById("createBarberAccountButton");
const message = document.getElementById("barberAccountMessage");
const modal = document.getElementById("barberModal");
const grid = document.getElementById("barbersGrid");
const newBarberButton = document.getElementById("newBarberButton");

let selectedBarberId = null;
let selectionVersion = 0;
let busy = false;

function showMessage(text, success = false) {
    message.textContent = text;
    message.style.color = success ? "#218653" : "#c0392b";
}

function clearAccountForm() {
    form.reset();
    showMessage("");
}

function hideAccountSection() {
    selectionVersion++;
    selectedBarberId = null;
    section.hidden = true;

    if (!busy) {
        clearAccountForm();
    }
}

async function selectBarber(barberId) {
    hideAccountSection();

    if (!barberId || busy) {
        return;
    }

    const currentVersion = selectionVersion;

    try {
        const snapshot = await getDoc(
            doc(db, "barbers", barberId)
        );

        if (
            currentVersion !== selectionVersion ||
            modal.classList.contains("hidden")
        ) {
            return;
        }

        if (!snapshot.exists()) {
            return;
        }

        const barber = snapshot.data();

        if (barber.status !== "active") {
            selectedBarberId = barberId;
            section.hidden = false;
            showMessage(
                "Este barbero está inactivo. Actívalo y guarda los cambios antes de crear su cuenta."
            );
            button.disabled = true;
            return;
        }

        selectedBarberId = barberId;
        section.hidden = false;
        button.disabled = false;

    } catch (error) {
        console.error(
            "Error comprobando barbero en Firebase:",
            error
        );

        if (currentVersion === selectionVersion) {
            section.hidden = false;
            button.disabled = true;
            showMessage(
                "No se pudo verificar el barbero en Firebase."
            );
        }
    }
}

function observeBarberModal() {
    newBarberButton?.addEventListener(
        "click",
        hideAccountSection
    );

    grid?.addEventListener("click", event => {
        const editButton = event.target.closest(
            "[data-action='edit']"
        );

        if (!editButton || busy) {
            return;
        }

        const barberId = editButton.dataset.id;

        if (barberId) {
            selectBarber(barberId);
        }
    });

    const observer = new MutationObserver(() => {
        if (modal.classList.contains("hidden")) {
            hideAccountSection();
        }
    });

    observer.observe(modal, {
        attributes: true,
        attributeFilter: ["class"]
    });
}

form.addEventListener("submit", async event => {
    event.preventDefault();

    if (busy) {
        return;
    }

    if (!selectedBarberId || button.disabled) {
        showMessage(
            "Selecciona un barbero activo guardado en Firebase."
        );
        return;
    }

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const barberId = selectedBarberId;

    if (!emailInput.checkValidity()) {
        showMessage("Ingresa un correo electrónico válido.");
        return;
    }

    if (password.length < 8 || password.length > 128) {
        showMessage(
            "La contraseña debe tener entre 8 y 128 caracteres."
        );
        return;
    }

    const user = auth.currentUser;

    if (!user) {
        showMessage(
            "Tu sesión expiró. Inicia sesión nuevamente."
        );
        return;
    }

    busy = true;
    button.disabled = true;
    button.textContent = "Creando cuenta...";
    showMessage("");

    try {
        const token = await user.getIdToken();

        const response = await fetch(
            "/.netlify/functions/create-barber",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    barberId,
                    email,
                    password
                })
            }
        );

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.error ||
                "No se pudo crear la cuenta."
            );
        }

        passwordInput.value = "";

        showMessage(
            "Cuenta creada correctamente. El barbero ya puede iniciar sesión.",
            true
        );

        button.textContent = "Cuenta creada";
        return;

    } catch (error) {
        console.error(
            "Error creando cuenta de barbero:",
            error
        );

        showMessage(
            error.message || "No se pudo crear la cuenta."
        );

    } finally {
        busy = false;

        if (button.textContent !== "Cuenta creada") {
            button.disabled = false;
            button.textContent = "Crear cuenta de acceso";
        }
    }
});

observeBarberModal();
