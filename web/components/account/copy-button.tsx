"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState("Copy email");
  return (
    <button
      type="button"
      className="h-9 self-start rounded-md bg-primary px-4 font-medium text-primary-foreground"
      onClick={() => navigator.clipboard.writeText(text).then(() => setLabel("Copied"), () => setLabel("Select the text and copy it"))}
    >
      {label}
    </button>
  );
}
