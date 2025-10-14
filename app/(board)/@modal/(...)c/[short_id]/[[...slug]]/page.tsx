"use client";

import { useEffect } from "react";

export default function CardModalInterceptSlot() {
  useEffect(() => {
    document.body.classList.add("overflow-hidden");
    return () => {
      document.body.classList.remove("overflow-hidden");
    };
  }, []);

  return null;
}
