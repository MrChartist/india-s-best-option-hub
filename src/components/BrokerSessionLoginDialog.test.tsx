import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrokerSessionLoginDialog } from "@/components/BrokerSessionLoginDialog";
import {
  BROKERS,
  LEGACY_SESSION_REFUSED,
  SESSION_LOGIN_BROKER_IDS,
  getBrokerInfo,
  getBrokerSessionState,
  getSavedBrokers,
  saveBrokerCredentials,
  wipeAllCredentials,
  withSession,
} from "@/lib/brokerConfig";

const SECRET_PIN = "864209";
const CODE = "123456";

function allStorage(): string {
  const dump = (s: Storage) => Array.from({ length: s.length }, (_, i) => `${s.key(i)}=${s.getItem(s.key(i) ?? "")}`).join("\n");
  return `${dump(window.localStorage)}\n${dump(window.sessionStorage)}`;
}

beforeEach(() => {
  wipeAllCredentials();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => vi.unstubAllGlobals());

describe("session-login brokers in the catalogue", () => {
  it("are usable, ask for a 6-digit code instead of a TOTP secret, and offer no secret fields for saving", () => {
    for (const id of SESSION_LOGIN_BROKER_IDS) {
      const b = getBrokerInfo(id);
      expect(b?.integrated, id).toBe(true);
      expect(b?.sessionLogin?.prompts.some((p) => p.key === "totpCode" && p.kind === "totp"), id).toBe(true);
      expect(b?.fields.filter((f) => /(pass|pin|totp|otp)/i.test(f.key)), id).toEqual([]);
    }
    expect(BROKERS.filter((b) => b.needsLoginSecrets && !b.integrated).map((b) => b.id)).toEqual([]);
  });

  it("stores only the returned session; secrets cannot ride along", async () => {
    const values = withSession({ apiKey: "k", clientId: "A1" }, { sessionToken: "jwt", feedToken: "feed", password: SECRET_PIN }, Date.now() + 60_000);
    await saveBrokerCredentials({ brokerId: "angelone", values: { ...values, totpSecret: "JBSWY3DPEHPK3PXP" }, addedAt: "t" });
    const saved = getSavedBrokers()[0];
    expect(saved.values).toMatchObject({ apiKey: "k", clientId: "A1", sessionToken: "jwt", feedToken: "feed" });
    expect(allStorage()).not.toContain(SECRET_PIN);
    expect(allStorage()).not.toContain("JBSWY3DPEHPK3PXP");
    expect(getBrokerSessionState(saved).state).toBe("active");
    expect(getBrokerSessionState({ ...saved, values: { ...saved.values, sessionExpiresAt: "1" } }).state).toBe("expired");
    expect(getBrokerSessionState(undefined).state).toBe("none");
  });
});

describe("session tokens and plaintext storage", () => {
  it("never keeps Angel One's refreshToken", () => {
    const values = withSession({ apiKey: "k" }, { sessionToken: "jwt", feedToken: "feed", refreshToken: "refresh-xyz" }, Date.now() + 60_000);
    expect(values).not.toHaveProperty("refreshToken");
    expect(values).toMatchObject({ sessionToken: "jwt", feedToken: "feed" });
  });

  it("refuses to write a session-login session to legacy plaintext storage", async () => {
    // A legacy user: keys in plain localStorage and no storage mode chosen yet.
    localStorage.setItem("optionsdesk_broker_keys", JSON.stringify([{ brokerId: "angelone", values: { apiKey: "k", clientId: "A1" }, addedAt: "t", isActive: true }]));
    const values = withSession({ apiKey: "k", clientId: "A1" }, { sessionToken: "jwt-legacy" }, Date.now() + 60_000);
    await expect(saveBrokerCredentials({ brokerId: "angelone", values, addedAt: "t" })).rejects.toThrow(LEGACY_SESSION_REFUSED);
    expect(allStorage()).not.toContain("jwt-legacy");
    // Saving keys without a session still works for legacy users.
    await saveBrokerCredentials({ brokerId: "angelone", values: { apiKey: "k2", clientId: "A1" }, addedAt: "t" });
    expect(getSavedBrokers()[0].values.apiKey).toBe("k2");
  });
});

describe("BrokerSessionLoginDialog", () => {
  it("sends the PIN and code once, saves only the session and keeps nothing secret in storage", async () => {
    await saveBrokerCredentials({ brokerId: "angelone", values: { apiKey: "k", clientId: "A1" }, addedAt: "t" });
    const saved = getSavedBrokers()[0];
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "success", session: { sessionToken: "jwt-xyz" }, expiresAt: Date.now() + 3_600_000 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    render(<BrokerSessionLoginDialog broker={getBrokerInfo("angelone")!} saved={saved} open onOpenChange={onOpenChange} />);

    const pin = screen.getByLabelText(/password|pin/i) as HTMLInputElement;
    const code = screen.getByLabelText(/6-digit TOTP code/i) as HTMLInputElement;
    for (const input of [pin, code]) {
      expect(input.type).toBe("password");
      expect(input.autocomplete).toBe("one-time-code");
    }
    fireEvent.change(pin, { target: { value: SECRET_PIN } });
    fireEvent.change(code, { target: { value: CODE } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/broker-session-login?broker=angelone");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ values: { apiKey: "k", clientId: "A1" }, secrets: { password: SECRET_PIN, totpCode: CODE } });
    expect(getSavedBrokers()[0].values.sessionToken).toBe("jwt-xyz");
    expect(allStorage()).not.toContain(SECRET_PIN);
    expect(allStorage()).not.toContain(`"${CODE}"`);
  });

  it("re-login sends only the saved keys, not the previous session, and stays under the 4 KB cap", async () => {
    const jwt = (n: number) => `eyJ${"a".repeat(n)}.eyJ${"b".repeat(n)}.${"c".repeat(n)}`;
    for (const id of ["angelone", "kotak"]) {
      wipeAllCredentials();
      const base: Record<string, string> = id === "angelone" ? { apiKey: "k", clientId: "A1" } : { accessToken: "kotak-access", mobileNumber: "+919999999999", ucc: "U1" };
      const values = withSession(base, { sessionToken: jwt(600), feedToken: jwt(600), sessionSid: jwt(300), sessionBaseUrl: "https://example.invalid" }, Date.now() + 60_000);
      await saveBrokerCredentials({ brokerId: id, values, addedAt: "t" });
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "success", session: { sessionToken: "new" }, expiresAt: Date.now() + 60_000 }), { status: 200, headers: { "Content-Type": "application/json" } }));
      vi.stubGlobal("fetch", fetchMock);
      const broker = getBrokerInfo(id)!;
      const { unmount } = render(<BrokerSessionLoginDialog broker={broker} saved={getSavedBrokers()[0]} open onOpenChange={() => undefined} />);
      for (const p of broker.sessionLogin!.prompts) {
        fireEvent.change(screen.getByLabelText(p.label), { target: { value: p.kind === "totp" ? CODE : SECRET_PIN } });
      }
      fireEvent.click(screen.getByRole("button", { name: /log in/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
      expect(JSON.parse(body).values, id).toEqual(base);
      expect(new TextEncoder().encode(body).length, id).toBeLessThan(4096);
      unmount();
    }
  });

  it("refuses a code that is not 6 digits without calling the proxy", async () => {
    await saveBrokerCredentials({ brokerId: "nubra", values: { phone: "9999999999" }, addedAt: "t" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<BrokerSessionLoginDialog broker={getBrokerInfo("nubra")!} saved={getSavedBrokers()[0]} open onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/mpin/i), { target: { value: "1357" } });
    fireEvent.change(screen.getByLabelText(/6-digit TOTP code/i), { target: { value: "12a4" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
