import { describe, expect, it } from "vitest";
import { isMacPlatform, modKeyLabel } from "./useKeyboardShortcuts";

const nav = (fields: Partial<Navigator> & { userAgentData?: { platform?: string } }) => fields as unknown as Navigator;

describe("modKeyLabel", () => {
  it("shows the command glyph on Apple platforms", () => {
    expect(modKeyLabel("k", nav({ platform: "MacIntel", userAgent: "" }))).toBe("⌘K");
    expect(modKeyLabel("K", nav({ platform: "iPad", userAgent: "" }))).toBe("⌘K");
  });

  it("prefers userAgentData.platform when present", () => {
    expect(isMacPlatform(nav({ userAgentData: { platform: "macOS" }, platform: "", userAgent: "" }))).toBe(true);
    expect(isMacPlatform(nav({ userAgentData: { platform: "Windows" }, platform: "MacIntel", userAgent: "" }))).toBe(false);
  });

  it("spells out Ctrl everywhere else", () => {
    expect(modKeyLabel("k", nav({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)" }))).toBe("Ctrl K");
    expect(modKeyLabel("k", nav({ platform: "Linux x86_64", userAgent: "" }))).toBe("Ctrl K");
  });
});
