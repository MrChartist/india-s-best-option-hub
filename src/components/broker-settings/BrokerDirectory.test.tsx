import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrokerDirectory } from "./BrokerDirectory";
import { BrokerKeysCard } from "./BrokerKeysCard";
import { BROKERS, getBrokerInfo, getSavedBrokers, saveBrokerCredentials, wipeAllCredentials, type BrokerInfo } from "@/lib/brokerConfig";

beforeEach(() => {
  wipeAllCredentials();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const get = (id: string) => getBrokerInfo(id) as BrokerInfo;
// Card-view tests render a few brokers: 32 full cards are slow under coverage instrumentation.
const FEW = ["dhan", "angelone", "samco", "zerodha"].map(get);

describe("BrokerDirectory", () => {
  it("shows a capability matrix of all 33 brokers and filters it by search", () => {
    render(<BrokerDirectory brokers={BROKERS} saved={[]} locked={false} />);
    expect(screen.getByRole("heading", { name: /all brokers \(33\)/i })).toBeInTheDocument();
    const table = screen.getByRole("table");
    // header row + 33 broker rows
    expect(within(table).getAllByRole("row")).toHaveLength(34);
    for (const col of ["Option chain", "Quotes", "Live feed", "Portfolio", "Orders"]) {
      expect(within(table).getByRole("columnheader", { name: col })).toBeInTheDocument();
    }
    expect(screen.getByRole("status")).toHaveTextContent("Showing 33 of 33 brokers");

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "upstox" } });
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 33 brokers");
    const row = within(screen.getByRole("table")).getAllByRole("row")[1];
    expect(row).toHaveTextContent("Upstox");
    expect(row).toHaveTextContent("OAuth login");
    expect(row).toHaveTextContent("Blocked");
    expect(row).toHaveTextContent("Beta");

    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.getByRole("status")).toHaveTextContent("Showing 33 of 33 brokers");
  });

  it("filters by sign-in method and capability, and says when nothing matches", () => {
    render(<BrokerDirectory brokers={BROKERS} saved={[]} locked={false} />);
    fireEvent.change(screen.getByLabelText("Sign-in method"), { target: { value: "sessionLogin" } });
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    for (const r of rows) expect(r).toHaveTextContent("Session login");
    fireEvent.change(screen.getByLabelText("Must offer"), { target: { value: "feed" } });
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "no-such-broker" } });
    expect(screen.getByText(/no broker matches/i)).toBeInTheDocument();
  });

  it("opens a broker's card from the matrix, with its beta note and session-login hint", async () => {
    render(<BrokerDirectory brokers={FEW} saved={[]} locked={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Angel One (SmartAPI)" }));
    expect(screen.getByRole("button", { name: "Connect" })).toHaveAttribute("aria-pressed", "true");
    const card = document.getElementById("broker-card-angelone") as HTMLElement;
    expect(card).toBeTruthy();
    expect(within(card).getByText(/beta: not yet verified with a live account/i)).toBeInTheDocument();
    expect(within(card).getByText(/session login\./i)).toBeInTheDocument();
    expect(within(card).getByText(/PIN \/ MPIN and 6-digit TOTP code/)).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(card));
    // Dhan's keys live in the card at the top of the page, not a second copy here.
    expect(document.getElementById("broker-card-dhan")).toBeNull();
  });

  it("shows only saved brokers when asked", async () => {
    await saveBrokerCredentials({ brokerId: "samco", values: { apiKey: "k", apiSecret: "s" }, addedAt: "t" });
    render(<BrokerDirectory brokers={FEW} saved={getSavedBrokers()} activeId="samco" locked={false} />);
    // A saved non-Dhan broker opens the cards view by default.
    expect(screen.getByRole("button", { name: "Connect" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("Saved only"));
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 of 4 brokers");
  });
});

describe("BrokerKeysCard", () => {
  it("marks Dhan as verified and every other broker as beta", () => {
    const { unmount } = render(<BrokerKeysCard broker={get("dhan")} isActive={false} disabled={false} />);
    expect(screen.getByText(/verified live/i)).toBeInTheDocument();
    expect(screen.queryByText(/beta: not yet verified/i)).toBeNull();
    unmount();
    render(<BrokerKeysCard broker={get("kotak")} isActive={false} disabled={false} />);
    expect(screen.getByText(/beta: not yet verified with a live account/i)).toBeInTheDocument();
  });

  it("needs one complete alternative before saving, then saves", async () => {
    render(<BrokerKeysCard broker={get("groww")} isActive={false} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: /save keys/i }));
    await new Promise((r) => setTimeout(r, 10));
    expect(getSavedBrokers()).toEqual([]);
    fireEvent.change(screen.getByLabelText(/^Access Token \(daily\)/), { target: { value: "tok-123" } });
    fireEvent.click(screen.getByRole("button", { name: /save keys/i }));
    await waitFor(() => expect(getSavedBrokers()[0]?.values.accessToken).toBe("tok-123"));
  });

  it("logs out by removing only the broker's own session keys", async () => {
    const values = { apiToken: "t", apiSecret: "s", apiSessionKey: "sess", uid: "u", sessionExpiresAt: String(Date.now() + 60_000) };
    await saveBrokerCredentials({ brokerId: "definedge", values, addedAt: "t" });
    render(<BrokerKeysCard broker={get("definedge")} saved={getSavedBrokers()[0]} isActive disabled={false} />);
    expect(screen.getByText(/logged in until/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /log out/i }));
    await waitFor(() => expect(getSavedBrokers()[0].values).toEqual({ apiToken: "t", apiSecret: "s" }));
  });

  it("asks to unlock when the vault is locked", () => {
    render(<BrokerKeysCard broker={get("zerodha")} isActive={false} disabled />);
    expect(screen.getByText(/unlock the vault/i)).toBeInTheDocument();
  });
});
