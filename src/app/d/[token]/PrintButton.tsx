"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button onClick={() => window.print()} className="bg-[#1b1f1c] px-5 py-2.5 text-[0.68rem] tracking-[0.22em] uppercase text-white hover:bg-[#3a4a40]">
      {label}
    </button>
  );
}
