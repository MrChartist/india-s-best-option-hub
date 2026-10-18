import { useEffect, useState, type FormEvent } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  BROKERS,
  enableEncryptedMode,
  getSavedBrokers,
  getStorageState,
  isVaultLocked,
  lockVault,
  onBrokerCredentialsChange,
  switchToSessionMode,
  unlockVault,
  wipeAllCredentials,
  type BrokerInfo,
  type StorageState,
} from "@/lib/brokerConfig";
import { testDhanConnection } from "@/lib/marketApi";
import { LiveTradingToggle } from "@/components/LiveTradingToggle";
import { useProxyHealth } from "@/hooks/useMarketData";
import { useFeedStatus } from "@/hooks/useWebSocket";
import { formatTimeIST } from "@/lib/options";
import {
  Trash2,
  CheckCircle2,
  Plug,
  Lock,
  LockOpen,
  Server,
  Zap,
  Globe,
  Loader2,
  XCircle,
  Wifi,
  ShieldCheck,
  ShieldAlert,
  Clock3,
  LineChart,
} from "lucide-react";
import { BrokerKeysCard } from "@/components/broker-settings/BrokerKeysCard";
import { BrokerDirectory } from "@/components/broker-settings/BrokerDirectory";
import { DatabaseManager } from "@/components/DatabaseManager";
import { ChartDataDownloader } from "@/components/ChartDataDownloader";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { PageHeader } from "@/components/PageHeader";

// ── Credential store state shared by the page ──

const readCredentialState = () => ({ saved: getSavedBrokers(), state: getStorageState(), locked: isVaultLocked() });

function useCredentialState() {
  const [snap, setSnap] = useState(readCredentialState);
  useEffect(() => onBrokerCredentialsChange(() => setSnap(readCredentialState())), []);
  return snap;
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

// ── Storage mode card ──

const STATE_COPY: Record<StorageState, { title: string; body: string }> = {
  none: { title: "No keys saved", body: "Choose how keys should be kept before you add any." },
  session: {
    title: "Session only",
    body: "Keys live in this tab's session storage and are deleted when the tab or browser closes.",
  },
  encrypted: {
    title: "Encrypted on this device",
    body: "Keys are encrypted with AES-GCM using a key derived from your passphrase (PBKDF2, 310,000 rounds). Unlock once per tab.",
  },
  legacy: {
    title: "Unencrypted (older format)",
    body: "Keys from an older version are stored as plain text in this browser. Move them to session-only or encrypted storage.",
  },
};

function StorageCard({ state, locked }: { state: StorageState; locked: boolean }) {
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"idle" | "encrypt" | "unlock">(locked ? "unlock" : "idle");

  useEffect(() => setMode(locked ? "unlock" : "idle"), [locked]);

  const onEncrypt = async (e: FormEvent) => {
    e.preventDefault();
    if (pass.length < 8) return toast.error("Use a passphrase of at least 8 characters.");
    if (pass !== pass2) return toast.error("The two passphrases do not match.");
    setBusy(true);
    try {
      await enableEncryptedMode(pass);
      toast.success("Keys are now encrypted on this device");
      setPass("");
      setPass2("");
      setMode("idle");
    } catch (err) {
      toast.error(errMsg(err, "Could not encrypt keys"));
    } finally {
      setBusy(false);
    }
  };

  const onUnlock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await unlockVault(pass);
    setBusy(false);
    if (ok) {
      toast.success("Vault unlocked for this tab");
      setPass("");
    } else toast.error("Wrong passphrase");
  };

  const copy = STATE_COPY[state];
  const safe = state === "session" || state === "encrypted";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2">
          {safe ? (
            <ShieldCheck className="h-4 w-4 text-bullish" aria-hidden />
          ) : (
            <ShieldAlert className="h-4 w-4 text-warning" aria-hidden />
          )}
          Key storage
          <Badge variant="outline" className={state === "legacy" ? "border-warning/40 text-warning" : ""}>
            {copy.title}
          </Badge>
          {state === "encrypted" && <Badge variant="outline">{locked ? "Locked" : "Unlocked"}</Badge>}
        </CardTitle>
        <CardDescription>{copy.body}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mode === "unlock" && state === "encrypted" ? (
          <form onSubmit={onUnlock} className="flex flex-col gap-2 sm:flex-row">
            <Label htmlFor="vault-pass" className="sr-only">
              Passphrase
            </Label>
            <Input
              id="vault-pass"
              type="password"
              autoComplete="current-password"
              placeholder="Passphrase"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              className="sm:max-w-xs"
            />
            <Button type="submit" size="sm" disabled={busy || !pass}>
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <LockOpen aria-hidden />
              )}{" "}
              Unlock
            </Button>
          </form>
        ) : mode === "encrypt" ? (
          <form onSubmit={onEncrypt} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor="new-pass" className="text-body-sm">
                New passphrase
              </Label>
              <Input
                id="new-pass"
                type="password"
                autoComplete="new-password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-pass2" className="text-body-sm">
                Repeat passphrase
              </Label>
              <Input
                id="new-pass2"
                type="password"
                autoComplete="new-password"
                value={pass2}
                onChange={(e) => setPass2(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Lock aria-hidden />
                )}{" "}
                Encrypt
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
            <p className="text-body-sm text-muted-foreground sm:col-span-3">
              There is no recovery. If you forget the passphrase, wipe the keys and paste them again.
            </p>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            {state !== "encrypted" && (
              <Button size="sm" variant="outline" onClick={() => setMode("encrypt")}>
                <Lock aria-hidden /> Encrypt with a passphrase
              </Button>
            )}
            {state !== "session" && (
              <Button
                size="sm"
                variant="outline"
               
                disabled={locked}
                onClick={async () => {
                  await switchToSessionMode();
                  toast.success("Keys now last only for this browser session");
                }}
              >
                <Clock3 aria-hidden /> Use session-only storage
              </Button>
            )}
            {state === "encrypted" && !locked && (
              <Button
                size="sm"
                variant="ghost"
               
                onClick={() => {
                  lockVault();
                  toast.info("Vault locked");
                }}
              >
                <Lock aria-hidden /> Lock now
              </Button>
            )}
            {state !== "none" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive">
                    <Trash2 aria-hidden /> Delete all keys
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete all saved keys?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Every broker key and the vault passphrase check are removed from this browser. The terminal falls
                      back to NSE data until you paste keys again.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className={buttonVariants({ variant: "destructive" })}
                      onClick={() => {
                        wipeAllCredentials();
                        toast.info("All saved keys deleted");
                      }}
                    >
                      Delete all keys
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
        {state === "encrypted" && locked && (
          <p className="text-body-sm text-muted-foreground">
            While locked, the terminal uses NSE data (or the proxy's own .env keys, if set).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Connection status ──

type Status = "online" | "offline" | "unknown" | "degraded";

const DOT: Record<Status, string> = {
  online: "bg-bullish",
  offline: "bg-bearish",
  degraded: "bg-warning",
  unknown: "bg-muted-foreground/50",
};
const TXT: Record<Status, string> = {
  online: "text-bullish",
  offline: "text-bearish",
  degraded: "text-warning",
  unknown: "text-muted-foreground",
};

function upstreamStatus(u?: { lastSuccess: number | null; lastFailure: number | null }): Status {
  if (!u || (!u.lastSuccess && !u.lastFailure)) return "unknown";
  if (u.lastSuccess && (!u.lastFailure || u.lastSuccess >= u.lastFailure)) return "online";
  return u.lastSuccess ? "degraded" : "offline";
}

function lastSeen(u?: { lastSuccess: number | null; lastFailure: number | null; lastError: string | null }): string {
  if (!u) return "No requests yet";
  if (u.lastSuccess && (!u.lastFailure || u.lastSuccess >= u.lastFailure))
    return `Last success ${formatTimeIST(u.lastSuccess)}`;
  if (u.lastFailure) return `Last failure ${formatTimeIST(u.lastFailure)}${u.lastError ? ` · ${u.lastError}` : ""}`;
  return "No requests yet";
}

function ConnectionStatusPanel() {
  const { data: health } = useProxyHealth();
  const feed = useFeedStatus();
  const [test, setTest] = useState<{ state: "idle" | "testing" | "success" | "error"; message: string }>({
    state: "idle",
    message: "",
  });
  const up = health?.upstreams ?? {};
  const reachable = !!health?.reachable;

  const runTest = async () => {
    setTest({ state: "testing", message: "" });
    const result = await testDhanConnection();
    if (result.status === "success") {
      setTest({ state: "success", message: "Dhan accepted the keys" });
      toast.success("Dhan API connection works");
    } else {
      setTest({ state: "error", message: result.message || "Connection failed" });
      toast.error(`Dhan test failed: ${result.message || "unknown error"}`);
    }
  };

  const rows: Array<{ name: string; icon: JSX.Element; status: Status; detail: string; action?: JSX.Element }> = [
    {
      name: "Local proxy",
      icon: <Server className="h-4 w-4" aria-hidden />,
      status: reachable ? "online" : "offline",
      detail: reachable
        ? `Up ${Math.floor((health?.uptime ?? 0) / 60)} min · ${health?.security?.host ?? "127.0.0.1"}`
        : "Not reachable. Start it with: npm run proxy",
    },
    {
      name: "Dhan API",
      icon: <Wifi className="h-4 w-4" aria-hidden />,
      status: test.state === "success" ? "online" : test.state === "error" ? "offline" : upstreamStatus(up.dhan),
      detail: test.message || (health?.sources?.dhan ? "Proxy has keys in .env · " : "") + lastSeen(up.dhan),
      action: (
        <Button
          size="sm"
          variant="outline"
          onClick={runTest}
          disabled={test.state === "testing" || !reachable}
        >
          {test.state === "testing" ? (
            <>
              <Loader2 className="animate-spin" aria-hidden /> Testing
            </>
          ) : test.state === "success" ? (
            <>
              <CheckCircle2 className="text-bullish" aria-hidden /> OK
            </>
          ) : test.state === "error" ? (
            <>
              <XCircle className="text-bearish" aria-hidden /> Retry
            </>
          ) : (
            "Test"
          )}
        </Button>
      ),
    },
    {
      name: "Dhan live feed",
      icon: <Zap className="h-4 w-4" aria-hidden />,
      status: feed.dhanConnected ? "online" : feed.disconnectCode ? "offline" : "unknown",
      detail: feed.dhanConnected
        ? `Ticks flowing · ${health?.websocket?.cachedTicks ?? 0} instruments`
        : feed.message || (feed.proxyConnected ? "Proxy connected, waiting for Dhan keys" : "Proxy socket closed"),
    },
    {
      name: "NSE India",
      icon: <Globe className="h-4 w-4" aria-hidden />,
      status: upstreamStatus(up.nse),
      detail: lastSeen(up.nse),
    },
    {
      name: "Yahoo Finance",
      icon: <LineChart className="h-4 w-4" aria-hidden />,
      status: upstreamStatus(up.yahoo),
      detail: lastSeen(up.yahoo),
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Wifi className="h-4 w-4 text-primary-ink" aria-hidden />
          Data sources
          <Badge variant="outline" className="ml-auto">
            {rows.filter((s) => s.status === "online").length}/{rows.length} online
          </Badge>
        </CardTitle>
        <CardDescription>
          Each source's last success or failure, as seen by your local proxy. Times in IST.
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-1.5" aria-live="polite">
        {rows.map((src) => (
          <div key={src.name} className="flex min-h-[44px] items-center gap-3 py-1.5 [&+&]:hairline-t">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-control-track ${TXT[src.status]}`}>{src.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-body font-medium">{src.name}</span>
                <span className={`h-1.5 w-1.5 rounded-capsule ${DOT[src.status]}`} aria-hidden />
                <span className="sr-only">{src.status}</span>
              </div>
              <p className="truncate text-body-sm text-muted-foreground" title={src.detail}>
                {src.detail}
              </p>
            </div>
            {src.action}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Page ──

export default function BrokerSettings() {
  useDocumentTitle("Broker Settings");
  const { saved, state, locked } = useCredentialState();
  const dhan = BROKERS.find((b) => b.id === "dhan") as BrokerInfo;
  const dhanSaved = saved.find((s) => s.brokerId === "dhan");
  const activeId = (saved.find((b) => b.isActive) ?? saved[0])?.brokerId;

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-4 py-1">
      <PageHeader
        icon={Plug}
        title="Broker and Data Settings"
        description={`Connect Dhan or any of ${BROKERS.length - 1} other Indian brokers for live option chains. Without keys the terminal uses NSE data through the local proxy.`}
      />

      <Card className="bg-wash-warning/40">
        <CardContent className="flex items-start gap-3 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <div className="space-y-1 text-body">
            <p className="font-medium text-foreground">How your keys are handled</p>
            <ul className="list-disc space-y-0.5 pl-4 text-body-sm text-muted-foreground">
              <li>Keys stay in this browser. Mr. Chartist has no server and never receives them.</li>
              <li>
                When the terminal needs broker data, the keys go to the proxy running on your own machine (127.0.0.1),
                which forwards them to that broker over HTTPS.
              </li>
              <li>
                Only Dhan is verified with a live account. The other {BROKERS.length - 1} brokers are in beta, and none of them can place an
                order from this app.
              </li>
              <li>
                Your login password, PIN, MPIN and TOTP secret are never saved. Brokers that need them ask in a Log in dialog
                each session; only the session token the broker returns is kept, like any other key.
              </li>
              <li>
                Anyone using this browser profile, or a malicious extension, can read keys while they are unlocked. Lock
                or delete them on shared computers.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <StorageCard state={state} locked={locked} />

      {/* The Dhan card sits beside Data sources, so neither leaves an empty half-row. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section aria-label="Broker" className="min-w-0">
          <BrokerKeysCard broker={dhan} saved={dhanSaved} isActive={activeId === "dhan"} disabled={locked} />
        </section>
        <section aria-label="Data sources" className="min-w-0">
          <ConnectionStatusPanel />
        </section>
      </div>

      <section aria-label="Live trading">
        <LiveTradingToggle />
      </section>

      <BrokerDirectory brokers={BROKERS} saved={saved} activeId={activeId} locked={locked} />

      <DatabaseManager />
      <ChartDataDownloader />

      <p className="text-body-sm text-muted-foreground">Data for education and research. Not investment advice.</p>
    </div>
  );
}
