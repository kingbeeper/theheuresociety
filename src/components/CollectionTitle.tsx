"use client";

import { useRef } from "react";

// "La Colección" con un reflejo de luz que sigue al ratón sobre la palabra dorada,
// como la luz al girar una pieza de metal pulido. Sin ratón, el reflejo pasa solo.
export function CollectionTitle({ first, second }: { first: string; second: string }) {
  const gold = useRef<HTMLElement>(null);

  const move = (e: React.PointerEvent) => {
    const el = gold.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  };

  const leave = () => {
    gold.current?.style.setProperty("--mx", "-30%");
  };

  return (
    <h1
      onPointerMove={move}
      onPointerLeave={leave}
      className="group mt-5 cursor-default font-display text-6xl font-light leading-none tracking-[0.02em] md:text-8xl"
    >
      {first}{" "}
      <em ref={gold} className="title-shine font-light">
        {second}
      </em>
    </h1>
  );
}
