// Mientras carga una pantalla del CRM: el menú se queda y aquí sale un esqueleto (respuesta inmediata al clic)
export default function Loading() {
  return (
    <div aria-busy="true" className="animate-pulse">
      <div className="mb-8 space-y-3">
        <div className="h-3 w-24 bg-line" />
        <div className="h-9 w-64 bg-line/80" />
      </div>
      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-forest" />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-12 border border-line bg-forest/60" />
        ))}
      </div>
    </div>
  );
}
