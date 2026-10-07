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
