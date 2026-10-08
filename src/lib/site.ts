// Configuración del negocio. Ajustar con los datos reales del cliente.

export const booking = {
  // Días que se pueden reservar, a partir de mañana
  daysAhead: 21,
  // Horarios por día de la semana (0 = domingo). Vacío = cerrado.
  slots: {
    0: [],
    1: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"],
    2: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"],
    3: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"],
    4: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"],
    5: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"],
    6: ["10:00", "11:00", "12:00", "13:00"],
  } as Record<number, string[]>,
  // Duración de la cita, en minutos (se muestra al cliente)
  durationMinutes: 45,
};

// Datos de contacto (también se usan en el pie de página y en los botones de WhatsApp)
export const contact = {
  phoneDisplay: "(305) 509-5767",
  phoneE164: "+13055095767",
  whatsapp: "13055095767", // formato de wa.me: código de país + número, sin "+"
  address: {
    street: "169 East Flagler St, Suite 1122",
    city: "Miami",
    region: "FL",
    postalCode: "33131",
    country: "US",
  },
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=169+East+Flagler+St+Suite+1122+Miami+FL+33131",
  mapEmbed: "https://www.google.com/maps?q=169+East+Flagler+St,+Miami,+FL+33131&z=16&output=embed",
};
