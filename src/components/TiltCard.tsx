"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";

// Lightweight mouse-tracked 3D tilt — pure CSS transform, no 3D library.
// Used across the landing page and both login screens for a consistent
// "dynamic 3D" feel without adding a Three.js-sized dependency.
export default function TiltCard({
  children,
  className = "",
  max = 8,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState("perspective(1000px) rotateX(0deg) rotateY(0deg)");

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTransform(
      `perspective(1000px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg)`
    );
  }

  function handleLeave() {
    setTransform("perspective(1000px) rotateX(0deg) rotateY(0deg)");
  }

  const style: CSSProperties = {
    transform,
    transformStyle: "preserve-3d",
    transition: "transform 200ms ease-out",
    willChange: "transform",
  };

  return (
    <div ref={ref} onMouseMove={handleMove} onMouseLeave={handleLeave} style={style} className={className}>
      {children}
    </div>
  );
}
