
import {
    auth
} from "./firebase.js";

import {
    login,
    logout,
    resetPassword,
    getUserRole,
    waitForUser,
    ROUTES
} from "./auth.js";

const form = document.getElementById("loginForm");
const emailInput = document.getElementById("loginEmail");
const passwordInput = document.getElementById("loginPassword");
const loginButton = document.getElementById("loginButton");
const message = document.getElementById("loginMessage");

const togglePassword = document.getElementById(
    "togglePassword"
);

const forgotPasswordButton = document.getElementById(
    "forgotPasswordButton"
);

function showMessage(text, success = false) {
    message.textContent = text;
    message.classList.toggle("success", success);
}

function setLoading(loading) {
    loginButton.disabled = loading;

    loginButton.textContent = loading
        ? "INICIANDO SESIÓN..."
        : "INICIAR SESIÓN →";
}

function getErrorMessage(error) {
    switch (error.code) {
        case "auth/invalid-credential":
        case "auth/wrong-password":
        case "auth/user-not-found":
            return "Correo o contraseña incorrectos.";

        case "auth/invalid-email":
            return "Ingresa un correo válido.";

        case "auth/too-many-requests":
            return "Demasiados intentos. Intenta más tarde.";

        case "auth/network-request-failed":
            return "Revisa tu conexión a internet.";

        case "permission-denied":
            return "No tienes permisos para acceder a tu perfil.";

        default:
            return error.message ||
                "No se pudo iniciar sesión.";
    }
}

form.addEventListener("submit", async event => {
    event.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
        showMessage("Completa todos los campos.");
        return;
    }

    setLoading(true);
    showMessage("");

    try {
        const { role } = await login(email, password);

        window.location.replace(ROUTES[role]);

    } catch (error) {
        console.error("Error de login:", error);
        showMessage(getErrorMessage(error));

    } finally {
        setLoading(false);
    }
});

togglePassword.addEventListener("click", () => {
    const visible = passwordInput.type === "text";

    passwordInput.type = visible
        ? "password"
        : "text";

    togglePassword.textContent = visible
        ? "Mostrar"
        : "Ocultar";

    togglePassword.setAttribute(
        "aria-pressed",
        String(!visible)
    );

    togglePassword.setAttribute(
        "aria-label",
        visible ? "Mostrar contraseña" : "Ocultar contraseña"
    );
});

forgotPasswordButton.addEventListener(
    "click",
    async () => {
        const email = emailInput.value.trim();

        if (!email) {
            showMessage(
                "Escribe tu correo electrónico para restablecer tu contraseña."
            );
            emailInput.focus();
            return;
        }

        forgotPasswordButton.disabled = true;

        try {
            await resetPassword(email);

            showMessage(
                "Si el correo tiene una cuenta habilitada, recibirás instrucciones para restablecer tu contraseña.",
                true
            );

        } catch (error) {
            console.error(
                "Error al restablecer contraseña:",
                error
            );

            showMessage(getErrorMessage(error));

        } finally {
            forgotPasswordButton.disabled = false;
        }
    }
);

async function checkExistingSession() {
    try {
        const user = await waitForUser();

        if (!user) {
            return;
        }

        const role = await getUserRole(user);

        if (role) {
            window.location.replace(ROUTES[role]);
            return;
        }

        await logout();

    } catch (error) {
        console.error(
            "Error verificando sesión:",
            error
        );

        showMessage(
            "No se pudo verificar la sesión. Intenta iniciar sesión."
        );
    }
}

checkExistingSession();
