// Monograma en latón: la imagen blanca del logo usada como máscara sobre un degradado dorado
export function GoldMonogram({ height = 56, className = "" }: { height?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block ${className}`}
      style={{
        height,
        aspectRatio: "435 / 559",
        background: "linear-gradient(135deg, #f3e2b0 0%, #c8a960 30%, #8f7136 55%, #d9bf7d 75%, #9c7c3c 100%)",
        WebkitMaskImage: "url(/brand/monogram-white.png)",
        maskImage: "url(/brand/monogram-white.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
