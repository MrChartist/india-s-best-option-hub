import { useEffect, useState, type FormEvent } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  BROKERS,
  enableEncryptedMode,
  getSavedBrokers,
  getStorageState,
  isVaultLocked,
  lockVault,
  onBrokerCredentialsChange,
  removeBrokerCredentials,
  saveBrokerCredentials,
  setActiveBroker,
  switchToSessionMode,
  unlockVault,
  wipeAllCredentials,
  type BrokerCredentials,
  type BrokerInfo,
  type StorageState,
} from "@/lib/brokerConfig";
import { testDhanConnection } from "@/lib/marketApi";
import { useProxyHealth } from "@/hooks/useMarketData";
import { useFeedStatus } from "@/hooks/useWebSocket";
import { formatDateIST, formatTimeIST } from "@/lib/options";
import {
  ExternalLink, Trash2, CheckCircle2, Eye, EyeOff, Info, Key, Plug, Lock, LockOpen, Server, Zap, Globe,
  BarChart3, Loader2, XCircle, Wifi, ShieldCheck, ShieldAlert, Clock3, LineChart,
} from "lucide-react";
import { DatabaseManager } from "@/components/DatabaseManager";
import { ChartDataDownloader } from "@/components/ChartDataDownloader";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

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
  session: { title: "Session only", body: "Keys live in this tab's session storage and are deleted when the tab or browser closes." },
  encrypted: { title: "Encrypted on this device", body: "Keys are encrypted with AES-GCM using a key derived from your passphrase (PBKDF2, 310,000 rounds). Unlock once per tab." },
  legacy: { title: "Unencrypted (older format)", body: "Keys from an older version are stored as plain text in this browser. Move them to session-only or encrypted storage." },
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
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          {safe ? <ShieldCheck className="h-4 w-4 text-bullish" aria-hidden /> : <ShieldAlert className="h-4 w-4 text-warning" aria-hidden />}
          Key storage
          <Badge variant="outline" className={state === "legacy" ? "border-warning/40 text-warning" : ""}>{copy.title}</Badge>
          {state === "encrypted" && <Badge variant="outline">{locked ? "Locked" : "Unlocked"}</Badge>}
        </CardTitle>
        <CardDescription className="text-xs">{copy.body}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mode === "unlock" && state === "encrypted" ? (
          <form onSubmit={onUnlock} className="flex flex-col sm:flex-row gap-2">
            <Label htmlFor="vault-pass" className="sr-only">Passphrase</Label>
            <Input id="vault-pass" type="password" autoComplete="current-password" placeholder="Passphrase" value={pass} onChange={(e) => setPass(e.target.value)} className="sm:max-w-xs" />
            <Button type="submit" size="sm" disabled={busy || !pass} className="gap-1.5">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <LockOpen className="h-3.5 w-3.5" aria-hidden />} Unlock
            </Button>
          </form>
        ) : mode === "encrypt" ? (
          <form onSubmit={onEncrypt} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
            <div className="space-y-1">
              <Label htmlFor="new-pass" className="text-xs">New passphrase</Label>
              <Input id="new-pass" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="At least 8 characters" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-pass2" className="text-xs">Repeat passphrase</Label>
              <Input id="new-pass2" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy} className="gap-1.5">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Lock className="h-3.5 w-3.5" aria-hidden />} Encrypt
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-3">There is no recovery. If you forget the passphrase, wipe the keys and paste them again.</p>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            {state !== "encrypted" && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setMode("encrypt")}>
                <Lock className="h-3.5 w-3.5" aria-hidden /> Encrypt with a passphrase
              </Button>
            )}
            {state !== "session" && (
              <Button size="sm" variant="outline" className="gap-1.5" disabled={locked} onClick={async () => { await switchToSessionMode(); toast.success("Keys now last only for this browser session"); }}>
                <Clock3 className="h-3.5 w-3.5" aria-hidden /> Use session-only storage
              </Button>
            )}
            {state === "encrypted" && !locked && (
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { lockVault(); toast.info("Vault locked"); }}>
                <Lock className="h-3.5 w-3.5" aria-hidden /> Lock now
              </Button>
            )}
            {state !== "none" && (
              <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground hover:text-destructive" onClick={() => { wipeAllCredentials(); toast.info("All saved keys deleted"); }}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete all keys
              </Button>
            )}
          </div>
        )}
        {state === "encrypted" && locked && (
          <p className="text-xs text-muted-foreground">While locked, the terminal uses NSE data (or the proxy's own .env keys, if set).</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Dhan credential card ──

function DhanCard({ broker, saved, isActive, disabled }: { broker: BrokerInfo; saved?: BrokerCredentials; isActive: boolean; disabled: boolean }) {
  const [values, setValues] = useState<Record<string, string>>(saved?.values ?? {});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(!saved);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValues(saved?.values ?? {});
    setEditing(!saved);
  }, [saved]);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const missing = broker.fields.filter((f) => f.required && !values[f.key]?.trim());
    if (missing.length > 0) return toast.error(`Please fill: ${missing.map((f) => f.label).join(", ")}`);
    setBusy(true);
    try {
      await saveBrokerCredentials({ brokerId: broker.id, values, addedAt: new Date().toISOString() });
      toast.success(`${broker.name} keys saved`);
      setEditing(false);
    } catch (err) {
      toast.error(errMsg(err, "Could not save keys"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={isActive ? "ring-1 ring-primary/50" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="h-9 w-9 shrink-0 rounded-lg bg-wash-brand text-primary-ink flex items-center justify-center text-xs font-bold" aria-hidden>{broker.logo}</span>
            <div className="min-w-0">
              <CardTitle className="text-base flex flex-wrap items-center gap-2">
                {broker.name}
                {saved && <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "Active" : "Saved"}</Badge>}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">{broker.description}</CardDescription>
            </div>
          </div>
          <a href={broker.docsUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label={`${broker.name} API docs (opens in a new tab)`}>
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {broker.features.map((f) => <Badge key={f} variant="outline" className="font-normal">{f}</Badge>)}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {disabled ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" aria-hidden /> Unlock the vault above to view or edit these keys.</p>
        ) : editing ? (
          <form onSubmit={onSave} className="space-y-3">
            {broker.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`f-${field.key}`} className="text-xs">
                  {field.label} {field.required && <span className="text-destructive" aria-hidden>*</span>}
                </Label>
                <div className="relative">
                  <Input
                    id={`f-${field.key}`}
                    type={field.type === "password" && !show[field.key] ? "password" : "text"}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={field.placeholder}
                    value={values[field.key] || ""}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    className="text-sm pr-9"
                    aria-describedby={field.helpText ? `h-${field.key}` : undefined}
                  />
                  {field.type === "password" && (
                    <button
                      type="button"
                      onClick={() => setShow({ ...show, [field.key]: !show[field.key] })}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={show[field.key] ? `Hide ${field.label}` : `Show ${field.label}`}
                    >
                      {show[field.key] ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                    </button>
                  )}
                </div>
                {field.helpText && (
                  <p id={`h-${field.key}`} className="text-xs text-muted-foreground flex items-center gap-1">
                    <Info className="h-3 w-3 shrink-0" aria-hidden /> {field.helpText}
                  </p>
                )}
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" className="flex-1 gap-1.5" disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Key className="h-3.5 w-3.5" aria-hidden />} Save keys
              </Button>
              {saved && <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
          </form>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-bullish" aria-hidden />
              Client ID {saved?.values.clientId ? `••••${saved.values.clientId.slice(-4)}` : "—"}
              <span className="text-xs">· added {saved ? formatDateIST(saved.addedAt) : "—"}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {!isActive && (
                <Button size="sm" variant="outline" onClick={async () => { await setActiveBroker(broker.id); toast.success(`${broker.name} is now active`); }}>
                  Set active
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive gap-1.5"
                onClick={async () => { await removeBrokerCredentials(broker.id); toast.info(`${broker.name} keys removed`); }}
                aria-label={`Remove ${broker.name} keys`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Connection status ──

type Status = "online" | "offline" | "unknown" | "degraded";

const DOT: Record<Status, string> = { online: "bg-bullish", offline: "bg-bearish", degraded: "bg-warning", unknown: "bg-muted-foreground/50" };
const TXT: Record<Status, string> = { online: "text-bullish", offline: "text-bearish", degraded: "text-warning", unknown: "text-muted-foreground" };

function upstreamStatus(u?: { lastSuccess: number | null; lastFailure: number | null }): Status {
  if (!u || (!u.lastSuccess && !u.lastFailure)) return "unknown";
  if (u.lastSuccess && (!u.lastFailure || u.lastSuccess >= u.lastFailure)) return "online";
  return u.lastSuccess ? "degraded" : "offline";
}

function lastSeen(u?: { lastSuccess: number | null; lastFailure: number | null; lastError: string | null }): string {
  if (!u) return "No requests yet";
  if (u.lastSuccess && (!u.lastFailure || u.lastSuccess >= u.lastFailure)) return `Last success ${formatTimeIST(u.lastSuccess)}`;
  if (u.lastFailure) return `Last failure ${formatTimeIST(u.lastFailure)}${u.lastError ? ` · ${u.lastError}` : ""}`;
  return "No requests yet";
}

function ConnectionStatusPanel() {
  const { data: health } = useProxyHealth();
  const feed = useFeedStatus();
  const [test, setTest] = useState<{ state: "idle" | "testing" | "success" | "error"; message: string }>({ state: "idle", message: "" });
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
      detail: reachable ? `Up ${Math.floor((health?.uptime ?? 0) / 60)} min · ${health?.security?.host ?? "127.0.0.1"}` : "Not reachable. Start it with: npm run proxy",
    },
    {
      name: "Dhan API",
      icon: <Wifi className="h-4 w-4" aria-hidden />,
      status: test.state === "success" ? "online" : test.state === "error" ? "offline" : upstreamStatus(up.dhan),
      detail: test.message || (health?.sources?.dhan ? "Proxy has keys in .env · " : "") + lastSeen(up.dhan),
      action: (
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={runTest} disabled={test.state === "testing" || !reachable}>
          {test.state === "testing" ? <><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Testing</> : test.state === "success" ? <><CheckCircle2 className="h-3 w-3 text-bullish" aria-hidden /> OK</> : test.state === "error" ? <><XCircle className="h-3 w-3 text-bearish" aria-hidden /> Retry</> : "Test"}
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
    { name: "NSE India", icon: <Globe className="h-4 w-4" aria-hidden />, status: upstreamStatus(up.nse), detail: lastSeen(up.nse) },
    { name: "TradingView scanner", icon: <BarChart3 className="h-4 w-4" aria-hidden />, status: upstreamStatus(up.tv), detail: lastSeen(up.tv) },
    { name: "Yahoo Finance", icon: <LineChart className="h-4 w-4" aria-hidden />, status: upstreamStatus(up.yahoo), detail: lastSeen(up.yahoo) },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wifi className="h-4 w-4 text-primary" aria-hidden />
          Data sources
          <Badge variant="outline" className="ml-auto">{rows.filter((s) => s.status === "online").length}/{rows.length} online</Badge>
        </CardTitle>
        <CardDescription className="text-xs">Each source's last success or failure, as seen by your local proxy. Times in IST.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2" aria-live="polite">
        {rows.map((src) => (
          <div key={src.name} className="flex items-center gap-3 p-2 rounded-md bg-muted/40">
            <span className={TXT[src.status]}>{src.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium">{src.name}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${DOT[src.status]}`} aria-hidden />
                <span className="sr-only">{src.status}</span>
              </div>
              <p className="text-xs text-muted-foreground truncate" title={src.detail}>{src.detail}</p>
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
    <div className="space-y-6 p-1">
      <div>
        <h1 className="flex items-center gap-2 font-display text-title text-foreground">
          <Plug className="h-5 w-5 text-primary" aria-hidden />
          Broker and data settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Connect Dhan for live option chains and the real-time feed. Without keys the terminal uses NSE data through the local proxy.</p>
      </div>

      <Card className="border-warning/30 bg-wash-warning/40">
        <CardContent className="flex items-start gap-3 py-3">
          <ShieldAlert className="h-5 w-5 text-warning shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm space-y-1">
            <p className="font-medium text-foreground">How your keys are handled</p>
            <ul className="text-muted-foreground text-xs list-disc pl-4 space-y-0.5">
              <li>Keys stay in this browser. Mr. Chartist has no server and never receives them.</li>
              <li>When the terminal needs Dhan data, the keys go to the proxy running on your own machine (127.0.0.1), which forwards them to Dhan over HTTPS.</li>
              <li>We never ask for your login password, MPIN or TOTP. Use a Dhan data token, not trading credentials.</li>
              <li>Anyone using this browser profile, or a malicious extension, can read keys while they are unlocked. Lock or delete them on shared computers.</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <StorageCard state={state} locked={locked} />
        <ConnectionStatusPanel />
      </div>

      <section aria-labelledby="brokers-h" className="space-y-3">
        <h2 id="brokers-h" className="text-base font-semibold">Brokers</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <DhanCard broker={dhan} saved={dhanSaved} isActive={activeId === "dhan"} disabled={locked} />
        </div>
      </section>

      <DatabaseManager />
      <ChartDataDownloader />

      <p className="text-xs text-muted-foreground">Data for education and research. Not investment advice.</p>
    </div>
  );
}
