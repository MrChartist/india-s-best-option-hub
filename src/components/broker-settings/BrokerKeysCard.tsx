import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Eye, EyeOff, FlaskConical, Info, Key, Loader2, Lock, LogIn, LogOut, ShieldCheck, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  clearSession,
  getBrokerSessionState,
  removeBrokerCredentials,
  saveBrokerCredentials,
  setActiveBroker,
  type BrokerCredentials,
  type BrokerInfo,
} from "@/lib/brokerConfig";
import { AUTH_COPY, capabilityLabels, missingCredentialFields } from "@/lib/brokerDirectory";
import { testBrokerConnection } from "@/lib/marketApi";
import { formatDateIST, formatTimeIST } from "@/lib/options";
import { BrokerSessionLoginDialog } from "@/components/BrokerSessionLoginDialog";
import { BrokerMatrixRow } from "./BrokerCapabilityMatrix";

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function maskedId(broker: BrokerInfo, saved?: BrokerCredentials): string {
  const field = broker.fields.find((f) => f.type === "text" && saved?.values[f.key]) ?? broker.fields.find((f) => saved?.values[f.key]) ?? broker.fields[0];
  const v = field ? saved?.values[field.key] : undefined;
  return `${field?.label ?? "Key"} ${v ? `••••${v.slice(-4)}` : "—"}`;
}

/** "Beta" for every adapter not yet exercised against a live account (all but Dhan). */
export function VerificationBadge({ broker }: { broker: Pick<BrokerInfo, "verified"> }) {
  return broker.verified ? (
    <Badge variant="bullish" className="gap-1">
      <ShieldCheck aria-hidden /> Verified live
    </Badge>
  ) : (
    <Badge variant="warning" className="gap-1">
      <FlaskConical aria-hidden /> Beta
    </Badge>
  );
}

/** Keys, session and capability card for one broker (Dhan and every catalogue broker). */
export function BrokerKeysCard({
  broker,
  saved,
  isActive,
  disabled,
}: {
  broker: BrokerInfo;
  saved?: BrokerCredentials;
  isActive: boolean;
  disabled: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(saved?.values ?? {});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(!saved);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const session = broker.sessionLogin ? getBrokerSessionState(saved) : null;
  const fid = (key: string) => `f-${broker.id}-${key}`;
  const auth = AUTH_COPY[broker.authKind];

  useEffect(() => {
    setValues(saved?.values ?? {});
    setEditing(!saved);
  }, [saved]);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    const missing = missingCredentialFields(broker, values);
    if (missing.length > 0) return toast.error(`Please fill: ${missing.join(", ")}`);
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

  const titleId = `broker-${broker.id}-title`;

  return (
    <Card aria-labelledby={titleId}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-primary text-body-sm font-semibold text-primary-foreground"
              aria-hidden
            >
              {broker.logo}
            </span>
            <div className="min-w-0">
              <CardTitle id={titleId} className="flex flex-wrap items-center gap-2">
                {broker.name}
                {saved && <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "Active" : "Saved"}</Badge>}
                <VerificationBadge broker={broker} />
              </CardTitle>
              <CardDescription className="mt-0.5">{broker.description}</CardDescription>
            </div>
          </div>
          <a
            href={broker.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-pill text-muted-foreground hover:bg-control-track hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
            aria-label={`${broker.name} API docs (opens in a new tab)`}
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </div>
        <dl className="mt-2 space-y-1.5 text-body-sm">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <dt className="font-medium text-foreground">Sign-in:</dt>
            <dd className="text-muted-foreground">
              <span className="text-foreground">{auth.label}.</span> {auth.help}
            </dd>
          </div>
          <div>
            <dt className="sr-only">Capability summary</dt>
            <dd>
              <BrokerMatrixRow broker={broker} />
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <dt className="font-medium text-foreground">Adapter offers:</dt>
            <dd className="text-muted-foreground">{capabilityLabels(broker).join(" · ")}</dd>
          </div>
        </dl>
        {!broker.verified && (
          <p className="mt-2 flex items-start gap-1.5 rounded-pill bg-wash-warning/60 p-2 text-body-sm text-foreground">
            <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <span>
              <strong className="font-medium">Beta: not yet verified with a live account.</strong> Built from {broker.name}&apos;s official
              docs and tested against recorded samples only. Check the numbers against your broker before relying on them.
            </span>
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {disabled ? (
          <p className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden /> Unlock the vault above to view or edit these keys.
          </p>
        ) : editing ? (
          <form onSubmit={onSave} className="space-y-3" aria-label={`${broker.name} keys`}>
            {broker.fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={fid(field.key)} className="text-body-sm">
                  {field.label}{" "}
                  {field.required ? (
                    <span className="text-destructive" aria-hidden>
                      *
                    </span>
                  ) : (
                    <span className="text-muted-foreground">(optional)</span>
                  )}
                </Label>
                <div className="relative">
                  <Input
                    id={fid(field.key)}
                    type={field.type === "password" && !show[field.key] ? "password" : "text"}
                    autoComplete="off"
                    spellCheck={false}
                    required={field.required}
                    placeholder={field.placeholder}
                    value={values[field.key] || ""}
                    onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                    className="pr-8"
                    aria-describedby={field.helpText ? `${fid(field.key)}-help` : undefined}
                  />
                  {field.type === "password" && (
                    <button
                      type="button"
                      onClick={() => setShow({ ...show, [field.key]: !show[field.key] })}
                      className="absolute right-0.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-chip text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
                      aria-label={show[field.key] ? `Hide ${field.label}` : `Show ${field.label}`}
                    >
                      {show[field.key] ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                    </button>
                  )}
                </div>
                {field.helpText && (
                  <p id={`${fid(field.key)}-help`} className="flex items-start gap-1 break-words text-body-sm text-muted-foreground">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> <span className="min-w-0">{field.helpText}</span>
                  </p>
                )}
              </div>
            ))}
            {broker.sessionLogin && (
              <p className="text-body-sm text-muted-foreground">
                After saving, use <strong className="font-medium text-foreground">Log in</strong> to open a session. You will be asked for{" "}
                {broker.sessionLogin.prompts.map((p) => p.label).join(" and ")}; they are never saved.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              {saved && (
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Key aria-hidden />} Save keys
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-2 text-body text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-bullish" aria-hidden />
              {maskedId(broker, saved)}
              <span className="text-body-sm">· added {saved ? formatDateIST(saved.addedAt) : "—"}</span>
            </p>
            {session && (
              <p className="text-body-sm text-muted-foreground" aria-live="polite">
                {session.state === "active"
                  ? `Logged in${session.expiresAt ? ` until ${formatTimeIST(session.expiresAt)} IST` : ""}.`
                  : session.state === "expired"
                    ? "Session expired. Log in again to use this broker."
                    : "Not logged in. This broker needs your PIN or password and a TOTP code each session; they are never saved."}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {session && saved && (
                <Button size="sm" variant={session.state === "active" ? "outline" : "default"} onClick={() => setLoginOpen(true)}>
                  <LogIn aria-hidden /> {session.state === "active" ? "Log in again" : "Log in"}
                </Button>
              )}
              {session?.state === "active" && saved && (
                <Button
                  size="sm"
                  variant="ghost"
                 
                  onClick={async () => {
                    await saveBrokerCredentials({ ...saved, values: clearSession(broker.id, saved.values) });
                    toast.info(`${broker.name}: session removed`);
                  }}
                >
                  <LogOut aria-hidden /> Log out
                </Button>
              )}
              {!isActive && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await setActiveBroker(broker.id);
                    toast.success(`${broker.name} is now active`);
                  }}
                >
                  Set active
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setEditing(true)} aria-label={`Edit ${broker.name} keys`}>
                Edit
              </Button>
              {broker.id !== "dhan" && saved && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testing}
                  aria-label={`Test ${broker.name} connection`}
                  onClick={async () => {
                    setTesting(true);
                    try {
                      const r = await testBrokerConnection(broker.id, saved.values);
                      if (r.status === "success") toast.success(`${broker.name}: ${r.message || "connected"}`);
                      else toast.error(`${broker.name} test failed: ${r.message || "unknown error"}`);
                    } finally {
                      setTesting(false);
                    }
                  }}
                >
                  {testing ? <Loader2 className="animate-spin" aria-hidden /> : null} Test
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={async () => {
                  await removeBrokerCredentials(broker.id);
                  toast.info(`${broker.name} keys removed`);
                }}
                aria-label={`Remove ${broker.name} keys`}
              >
                <Trash2 aria-hidden /> Remove
              </Button>
            </div>
          </div>
        )}
        {session && saved && <BrokerSessionLoginDialog broker={broker} saved={saved} open={loginOpen} onOpenChange={setLoginOpen} />}
      </CardContent>
    </Card>
  );
}
