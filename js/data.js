
/* =========================================================
   EDUARDO'S BARBERSHOP
   DATA.JS

   Configuración general sin registros de demostración.
   Los registros reales deben consultarse en Firestore.
========================================================= */

/*
 * Se conservan estos exports por compatibilidad con
 * módulos existentes.
 *
 * No representan los registros de Firestore.
 */
export const services = [];

export const barbers = [];

export const demoCustomers = [];

/* =========================================================
   ORIGEN DE LAS CITAS
========================================================= */

export const origins = {
    whatsapp: "WhatsApp",
    instagram: "Instagram",
    facebook: "Facebook",
    phone: "Teléfono",
    "walk-in": "En persona"
};

/* =========================================================
   HORARIOS DISPONIBLES

   Intervalos de 30 minutos.

   Último inicio posible: 21:30 (9:30 p. m.)

   La hora de cierre real depende del horario
   configurado para cada barbero.

   La duración del servicio y las citas ocupadas
   se validan en el formulario y en el servidor.
========================================================= */

export const availableTimes = [
    "09:00",
    "09:30",
    "10:00",
    "10:30",
    "11:00",
    "11:30",
    "12:00",
    "12:30",
    "13:00",
    "13:30",
    "14:00",
    "14:30",
    "15:00",
    "15:30",
    "16:00",
    "16:30",
    "17:00",
    "17:30",
    "18:00",
    "18:30",
    "19:00",
    "19:30",
    "20:00",
    "20:30",
    "21:00",
    "21:30"
];

/* =========================================================
   FECHA LOCAL
========================================================= */

export function getLocalDate(offset = 0) {
    const date = new Date();

    date.setDate(
        date.getDate() + offset
    );

    const year = date.getFullYear();

    const month = String(
        date.getMonth() + 1
    ).padStart(2, "0");

    const day = String(
        date.getDate()
    ).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

/* =========================================================
   CITAS DE DEMOSTRACIÓN DESACTIVADAS
========================================================= */

export function createDemoAppointments() {
    return [];
}
