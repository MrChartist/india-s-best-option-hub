import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps custom font-size classes next to text colours", () => {
    expect(cn("text-label text-bullish")).toBe("text-label text-bullish");
    expect(cn("h-5 text-label uppercase text-primary-ink")).toBe("h-5 text-label uppercase text-primary-ink");
    expect(cn("text-body-sm text-muted-foreground")).toBe("text-body-sm text-muted-foreground");
  });

  it("still dedupes conflicting custom font sizes", () => {
    expect(cn("text-label", "text-micro")).toBe("text-micro");
    expect(cn("text-sm", "text-body")).toBe("text-body");
  });

  it("merges custom radii and shadows", () => {
    expect(cn("rounded-md", "rounded-card")).toBe("rounded-card");
    expect(cn("shadow-sm", "shadow-ember")).toBe("shadow-ember");
    expect(cn("rounded-card text-num-hero shadow-card")).toBe("rounded-card text-num-hero shadow-card");
  });
});
