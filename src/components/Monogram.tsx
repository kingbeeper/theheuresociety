import Image from "next/image";

export function Monogram({
  size = 40,
  className = "",
  priority = false,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  // Proporción original del monograma: 435 × 559
  return (
    <Image
      src="/brand/monogram-white.png"
      alt="The Heure Society"
      width={size}
      height={Math.round((size * 559) / 435)}
      className={className}
      priority={priority}
    />
  );
}
