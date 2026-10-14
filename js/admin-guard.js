
import {
    protectPage,
    logout
} from "./auth.js";

document.documentElement.style.visibility = "hidden";

try {
    const user = await protectPage("admin");

    if (user) {
        document.documentElement.style.visibility = "visible";

        const topbar = document.querySelector(
            ".topbar .admin-user"
        );

        if (topbar) {
            const button = document.createElement("button");

            button.type = "button";
            button.textContent = "Cerrar sesión";
            button.style.cssText = `
                margin-left: 12px;
                padding: 9px 13px;
                background: #c99f5d;
                color: #111;
                border: none;
                border-radius: 8px;
                font-weight: 700;
                cursor: pointer;
            `;

            button.addEventListener("click", logout);
            topbar.appendChild(button);
        }
    }

} catch (error) {
    console.error("Error de autorización:", error);

    document.documentElement.style.visibility = "visible";
    document.body.replaceChildren();

    const message = document.createElement("p");
    message.textContent =
        "No se pudo verificar tu acceso. " +
        "Comprueba la conexión y vuelve a intentarlo.";

    message.style.cssText = `
        color: #e8bf7c;
        padding: 40px;
        text-align: center;
    `;

    document.body.appendChild(message);
}
