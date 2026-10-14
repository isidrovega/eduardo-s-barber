
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cheerio = require("cheerio");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const t = require("@babel/types");

const ROOT = __dirname;
const BACKUP = fs.mkdtempSync(
    path.join(os.tmpdir(), "eduardos-backup-")
);

const HTML_FILES = [
    "index.html",
    "citas.html",
    "clientes.html",
    "barberos.html",
    "servicios.html",
    "reportes.html"
];

const JS_FILES = [
    "admin.js",
    "appointments.js",
    "customers.js",
    "data.js",
    "storage.js"
];

function locate(filename) {
    const options = [
        path.join(ROOT, filename),
        path.join(ROOT, "js", filename),
        path.join(ROOT, "css", filename)
    ];

    return options.find(fs.existsSync);
}

function load(filename) {
    const location = locate(filename);

    if (!location) {
        throw new Error(`No existe: ${filename}`);
    }

    return {
        location,
        content: fs.readFileSync(location, "utf8")
    };
}

function backup(location) {
    const relative = path.relative(ROOT, location);
    const destination = path.join(BACKUP, relative);

    fs.mkdirSync(path.dirname(destination), {
        recursive: true
    });

    fs.copyFileSync(location, destination);
}

function save(filename, content) {
    const file = load(filename);

    if (file.content === content) {
        console.log(`Sin cambios: ${filename}`);
        return;
    }

    backup(file.location);
    fs.writeFileSync(file.location, content, "utf8");
    console.log(`Actualizado: ${filename}`);
}

function parseJS(source) {
    return parser.parse(source, {
        sourceType: "module",
        plugins: []
    });
}

function printJS(ast) {
    return generate(ast, {
        comments: true,
        retainLines: false,
        jsescOption: {
            minimal: true
        }
    }).code + "\n";
}

function removeFunctions(ast, names) {
    traverse(ast, {
        FunctionDeclaration(p) {
            if (names.includes(p.node.id?.name)) {
                p.remove();
            }
        }
    });
}

function removeCalls(ast, names) {
    traverse(ast, {
        ExpressionStatement(p) {
            const expression = p.node.expression;

            if (
                t.isCallExpression(expression) &&
                t.isIdentifier(expression.callee) &&
                names.includes(expression.callee.name)
            ) {
                p.remove();
            }
        }
    });
}

function removeVariables(ast, names) {
    traverse(ast, {
        VariableDeclarator(p) {
            if (
                t.isIdentifier(p.node.id) &&
                names.includes(p.node.id.name)
            ) {
                const declaration = p.parentPath;

                p.remove();

                if (
                    declaration.node &&
                    declaration.node.declarations.length === 0
                ) {
                    declaration.remove();
                }
            }
        }
    });
}

function replaceFunction(ast, name, replacement) {
    const parsed = parseJS(replacement);

    const newFunction = parsed.program.body.find(
        node => t.isFunctionDeclaration(node)
    );

    if (!newFunction) {
        throw new Error(`Función inválida: ${name}`);
    }

    let replaced = false;

    traverse(ast, {
        FunctionDeclaration(p) {
            if (p.node.id?.name === name) {
                p.replaceWith(t.cloneNode(newFunction, true));
                replaced = true;
                p.skip();
            }
        }
    });

    if (!replaced) {
        throw new Error(`No se encontró función: ${name}`);
    }
}

function removeProperty(ast, propertyName) {
    traverse(ast, {
        ObjectProperty(p) {
            const key = p.node.key;

            const name = t.isIdentifier(key)
                ? key.name
                : t.isStringLiteral(key)
                    ? key.value
                    : null;

            if (name === propertyName) {
                p.remove();
            }
        }
    });
}

function removeHTML() {
    for (const filename of HTML_FILES) {
        const { content } = load(filename);
        const $ = cheerio.load(content, {
            decodeEntities: false
        });

        // Menú lateral.
        $('a[href="fidelidad.html"]').remove();

        // Elementos exclusivos de fidelidad.
        $("#qrButton").remove();

        $("button").filter((_, element) => {
            return /programa de fidelidad/i.test(
                $(element).text()
            );
        }).remove();

        if (filename === "clientes.html") {
            $("p").filter((_, element) => {
                return /consulta clientes, historial de citas y fidelidad/i
                    .test($(element).text());
            }).text(
                "Consulta clientes e historial de citas."
            );

            // Elimina la sección que contiene las
            // estampas y la barra de recompensas.
            const loyaltyElements = [
                "#modalLoyaltyStamps",
                "#modalLoyaltyProgress",
                "#loyaltyDescription"
            ];

            for (const selector of loyaltyElements) {
                const element = $(selector);

                if (!element.length) continue;

                const section = element.closest("section");

                if (section.length) {
                    section.remove();
                } else {
                    element.remove();
                }
            }

            // Registrar visitas manualmente pertenecía
            // al sistema de fidelidad.
            $("#addVisitButton").remove();

            // Eliminar contenedores residuales.
            $(".customer-loyalty-label").remove();
            $(".loyalty-stamps-small").remove();
        }

        save(filename, $.html());
    }
}

function updateCustomers() {
    const { content } = load("customers.js");
    const ast = parseJS(content);

    removeFunctions(ast, [
        "getLoyaltyProgress",
        "renderSmallStamps",
        "renderCustomerLoyalty",
        "addVisitToSelectedCustomer"
    ]);

    removeCalls(ast, [
        "renderCustomerLoyalty"
    ]);

    removeVariables(ast, [
        "addVisitButton",
        "loyalty",
        "rewards"
    ]);

    // Elimina el listener del botón retirado.
    traverse(ast, {
        ExpressionStatement(p) {
            const expression = p.node.expression;

            if (!t.isCallExpression(expression)) return;

            const callee = expression.callee;

            if (
                t.isMemberExpression(callee) &&
                t.isIdentifier(callee.object, {
                    name: "addVisitButton"
                })
            ) {
                p.remove();
            }
        }
    });

    replaceFunction(ast, "renderStats", `
        function renderStats() {
            const customers = getCustomers();
            const appointments = getAppointments();

            const completed = appointments.filter(
                appointment => appointment.status === "completed"
            );

            const frequent = customers.filter(
                customer => Number(customer.visits || 0) >= 3
            );

            const totalVisits = customers.reduce(
                (total, customer) =>
                    total + Number(customer.visits || 0),
                0
            );

            document.getElementById("customerStats").innerHTML = [
                statCard("Total clientes", customers.length),
                statCard("Clientes frecuentes", frequent.length),
                statCard("Citas completadas", completed.length),
                statCard("Visitas registradas", totalVisits)
            ].join("");
        }
    `);

    // Eliminar contenido de fidelidad de las tarjetas
    // que se generan dinámicamente.
    traverse(ast, {
        TemplateLiteral(p) {
            const node = p.node;

            const text = node.quasis
                .map(q => q.value.raw)
                .join("");

            if (!text.includes("customer-card")) {
                return;
            }

            // Recompone la plantilla retirando
            // los dos bloques de fidelidad.
            const elements = [];

            for (let i = 0; i < node.quasis.length; i++) {
                elements.push({
                    type: "text",
                    value: node.quasis[i].value.raw
                });

                if (i < node.expressions.length) {
                    elements.push({
                        type: "expression",
                        value: node.expressions[i]
                    });
                }
            }

            // Convertimos únicamente la plantilla
            // de tarjeta a texto con marcadores internos.
            const expressionMap = new Map();
            let template = "";

            for (const item of elements) {
                if (item.type === "text") {
                    template += item.value;
                } else {
                    const marker =
                        `__EXPR_${expressionMap.size}__`;

                    expressionMap.set(marker, item.value);
                    template += marker;
                }
            }

            template = template.replace(
                /<div class="customer-loyalty-label">[\s\S]*?<\/div>\s*<div class="loyalty-stamps-small">[\s\S]*?<\/div>/g,
                ""
            );

            const parts = template.split(
                /(__EXPR_\d+__)/g
            );

            const quasis = [];
            const expressions = [];
            let buffer = "";

            for (const part of parts) {
                if (expressionMap.has(part)) {
                    quasis.push(
                        t.templateElement({
                            raw: buffer,
                            cooked: buffer
                        }, false)
                    );

                    expressions.push(
                        expressionMap.get(part)
                    );

                    buffer = "";
                } else {
                    buffer += part;
                }
            }

            quasis.push(
                t.templateElement({
                    raw: buffer,
                    cooked: buffer
                }, true)
            );

            p.replaceWith(
                t.templateLiteral(quasis, expressions)
            );

            p.skip();
        }
    });

    // Quitar el cálculo de fidelidad de renderCustomers.
    traverse(ast, {
        VariableDeclarator(p) {
            if (
                t.isIdentifier(p.node.id, {
                    name: "loyalty"
                })
            ) {
                p.remove();
            }
        }
    });

    save("customers.js", printJS(ast));
}

function updateAppointments() {
    const { content } = load("appointments.js");
    const ast = parseJS(content);

    // El contador de visitas se mantiene, pero
    // sin la propiedad loyaltyApplied.
    replaceFunction(ast, "updateStatus", `
        function updateStatus(appointmentId, newStatus) {
            const appointments = getAppointments();

            const appointment = appointments.find(
                item => item.id === appointmentId
            );

            if (!appointment) {
                showToast("No se encontró la cita.");
                return;
            }

            const previousStatus = appointment.status;

            if (previousStatus === newStatus) {
                return;
            }

            appointment.status = newStatus;

            const messages = {
                confirmed: "Cita confirmada.",
                cancelled: "Cita cancelada.",
                pending: "Cita restaurada como pendiente.",
                "no-show": "Cita marcada como no asistió.",
                completed: "Cita completada."
            };

            // Contabilizar una visita solamente cuando
            // la cita se completa por primera vez.
            if (newStatus === "completed") {
                const alreadyCounted =
                    appointment.visitCounted === true ||
                    appointment.loyaltyApplied === true;

                if (!alreadyCounted) {
                    addCustomerVisit(appointment.phone);
                }

                appointment.visitCounted = true;
            }

            delete appointment.loyaltyApplied;

            saveAppointments(appointments);
            renderAppointments();

            showToast(
                messages[newStatus] || "Estado actualizado."
            );
        }
    `);

    // No incluir campos de fidelidad en nuevas citas.
    removeProperty(ast, "loyaltyApplied");

    save("appointments.js", printJS(ast));
}

function updateDashboard() {
    const { content } = load("admin.js");
    const ast = parseJS(content);

    // El botón QR del Dashboard se retiró.
    // Se elimina su listener, sin alterar
    // la creación de citas.
    traverse(ast, {
        ExpressionStatement(p) {
            const source = generate(p.node).code;

            if (
                source.includes('getElementById("qrButton")') ||
                source.includes("getElementById('qrButton')")
            ) {
                p.remove();
            }
        }
    });

    save("admin.js", printJS(ast));
}

function updateData() {
    const { content } = load("data.js");
    const ast = parseJS(content);

    removeProperty(ast, "loyaltyApplied");

    save("data.js", printJS(ast));
}

function validate() {
    const files = [
        "customers.js",
        "appointments.js",
        "admin.js",
        "data.js"
    ];

    for (const filename of files) {
        const { content } = load(filename);
        parseJS(content);
        console.log(`Sintaxis válida: ${filename}`);
    }

    const customers = load("customers.js").content;

    const forbidden = [
        "getLoyaltyProgress",
        "renderCustomerLoyalty",
        "renderSmallStamps",
        "addVisitToSelectedCustomer",
        "modalLoyaltyStamps",
        "Recompensas disponibles"
    ];

    for (const name of forbidden) {
        if (customers.includes(name)) {
            throw new Error(
                `Referencia pendiente en customers.js: ${name}`
            );
        }
    }
}

function main() {
    const required = [
        ...HTML_FILES,
        ...JS_FILES
    ];

    for (const filename of required) {
        load(filename);
    }

    console.log("Iniciando limpieza de fidelidad...");
    console.log(`Respaldo: ${BACKUP}`);

    removeHTML();
    updateCustomers();
    updateAppointments();
    updateDashboard();
    updateData();
    validate();

    console.log("");
    console.log("Limpieza de código finalizada.");
    console.log("El diseño negro y dorado se conserva.");
    console.log("Revisa Clientes y Citas en el navegador.");
    console.log(
        "Cuando todo funcione, elimina js/loyalty.js."
    );
}

try {
    main();
} catch (error) {
    console.error("No se completó la actualización:");
    console.error(error.message);
    console.error(`Respaldo disponible en: ${BACKUP}`);
    process.exitCode = 1;
}
