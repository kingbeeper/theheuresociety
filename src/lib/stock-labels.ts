// Etiquetas del inventario (servidor y navegador)

export const ITEM_STATUS = { in_stock: "En stock", reserved: "Reservado", sold: "Vendido", returned: "Devuelto" } as const;
export type ItemStatus = keyof typeof ITEM_STATUS;

export const ACQUISITION = { purchase: "Compra", trade: "Intercambio", consignment: "Consignación", memo: "Memo de dealer" } as const;
export type Acquisition = keyof typeof ACQUISITION;

export const PAYMENT = { wire: "Transferencia", zelle: "Zelle", cash: "Efectivo", card: "Tarjeta", crypto: "Cripto", trade: "Intercambio", other: "Otro" } as const;

export const CONDITIONS = ["New", "Unworn", "Pre-Owned", "Excellent", "Very good", "Good", "Fair"];

// Consignación y memo: el reloj no es nuestro; al venderlo se paga al dueño (cost)
export const isOwnerStock = (a: string) => a === "consignment" || a === "memo";
