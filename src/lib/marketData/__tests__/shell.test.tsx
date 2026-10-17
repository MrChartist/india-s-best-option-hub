// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { SampleBanner } from "@/components/SampleBanner";
import { markProxyOffline, markProxyOnline, resetProxyGate, setProxyGateEnabled } from "@/lib/api/proxyClient";
import { formatDocumentTitle, resolveCanonical, useDocumentTitle, usePageMeta } from "@/hooks/useDocumentTitle";

describe("SampleBanner", () => {
  beforeEach(() => {
    setProxyGateEnabled(true);
    resetProxyGate();
  });
  afterEach(() => {
    cleanup();
    setProxyGateEnabled(false);
    resetProxyGate();
  });

  it("stays hidden until the proxy is known to be offline, then labels sample data", () => {
    render(<SampleBanner />);
    expect(screen.queryByTestId("sample-banner")).toBeNull();
    act(() => markProxyOffline("offline"));
    const bar = screen.getByTestId("sample-banner");
    expect(bar).toHaveAttribute("data-kind", "sample");
    expect(bar).toHaveTextContent("Sample data");
    expect(bar).toHaveTextContent("Proxy offline");
    expect(screen.getByRole("button", { name: /start proxy/i })).toBeInTheDocument();
    expect(bar).toHaveTextContent(/Next check in 30 s/);
    act(() => markProxyOnline());
    expect(screen.queryByTestId("sample-banner")).toBeNull();
  });

  it("switches to 'Cached' when the device goes offline", () => {
    const spy = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    render(<SampleBanner />);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    const bar = screen.getByTestId("sample-banner");
    expect(bar).toHaveAttribute("data-kind", "cached");
    expect(bar).toHaveTextContent("Cached");
    expect(bar).toHaveTextContent("No live data this session");
    spy.mockRestore();
  });
});

describe("useDocumentTitle / usePageMeta", () => {
  it("keeps useDocumentTitle working and restores the title", () => {
    document.title = "Before";
    const { unmount } = renderHook(() => useDocumentTitle("Option Chain"));
    expect(document.title).toBe(formatDocumentTitle("Option Chain"));
    unmount();
    expect(document.title).toBe("Before");
  });

  it("sets title, description and social tags, then restores them", () => {
    document.title = "Before";
    const desc = document.createElement("meta");
    desc.setAttribute("name", "description");
    desc.setAttribute("content", "Site description");
    document.head.appendChild(desc);

    const { unmount } = renderHook(() => usePageMeta({ title: "Max Pain & PCR", description: "Max pain and put-call ratio for NIFTY." }));
    expect(document.title).toBe(formatDocumentTitle("Max Pain & PCR"));
    expect(desc.getAttribute("content")).toBe("Max pain and put-call ratio for NIFTY.");
    expect(document.head.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(formatDocumentTitle("Max Pain & PCR"));
    expect(document.head.querySelector('meta[name="twitter:description"]')?.getAttribute("content")).toMatch(/put-call/);
    // No VITE_SITE_URL in tests: a relative canonical cannot be made absolute, so none is added.
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    unmount();
    expect(document.title).toBe("Before");
    expect(desc.getAttribute("content")).toBe("Site description");
    expect(document.head.querySelector('meta[property="og:title"]')).toBeNull();
    desc.remove();
  });

  it("uses an absolute canonical as given", () => {
    const { unmount } = renderHook(() => usePageMeta({ title: "Learn", canonical: "https://example.in/learn" }));
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe("https://example.in/learn");
    expect(document.head.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe("https://example.in/learn");
    unmount();
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("resolves canonical paths against a site URL", () => {
    expect(resolveCanonical(undefined, "/option-chain", "https://x.in")).toBe("https://x.in/option-chain");
    expect(resolveCanonical("/oi", "/ignored", "https://x.in/")).toBe("https://x.in/oi");
    expect(resolveCanonical("/oi", "/", "")).toBe("");
  });
});
