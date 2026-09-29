import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Eye, EyeOff, Info, KeyRound, Loader2, Pencil, ShieldCheck, Trash2, XCircle, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isComplete, maskSecret, type BrokerCredentials, type BrokerInfo } from "@/lib/brokerConfig";
import { testDhanConnection } from "@/lib/marketApi";

interface Props {
  broker: BrokerInfo;
  saved?: BrokerCredentials;
  isActive: boolean;
  onSave: (creds: BrokerCredentials) => void;
  onRemove: (brokerId: string) => void;
  onSetActive: (brokerId: string) => void;
}

type TestState = { status: "idle" } | { status: "testing" } | { status: "ok" } | { status: "error"; message: string };

function BrandTile({ broker }: { broker: BrokerInfo }) {
  return (
    <div
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] text-sm font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
      style={{ background: `linear-gradient(145deg, hsl(${broker.hue}), hsl(${broker.hue} / 0.7))` }}
      aria-hidden
    >
      {broker.initial}
    </div>
  );
}

export function BrokerCard({ broker, saved, isActive, onSave, onRemove, onSetActive }: Props) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(saved?.values ?? {});
  const [persist, setPersist] = useState(saved?.persist ?? true);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [test, setTest] = useState<TestState>({ status: "idle" });

  const live = broker.support === "live";
  const configured = isComplete(broker, saved);

  const draft = (): BrokerCredentials => ({
    brokerId: broker.id,
    values,
    persist,
    addedAt: saved?.addedAt ?? new Date().toISOString(),
  });

  const missing = () => broker.fields.filter((f) => f.required && !values[f.key]?.trim());

  const runTest = async (creds: BrokerCredentials) => {
    setTest({ status: "testing" });
    try {
      const result = await testDhanConnection(creds);
      if (result.status === "success") {
        setTest({ status: "ok" });
        toast.success(`${broker.name} connected`);
        return true;
      }
      setTest({ status: "error", message: result.message || "Connection failed" });
      return false;
    } catch {
      setTest({ status: "error", message: "Could not reach the local proxy — is `npm run dev` running?" });
      return false;
    }
  };

  const save = async (andTest: boolean) => {
    const gaps = missing();
    if (gaps.length) {
      toast.error(`Fill in: ${gaps.map((f) => f.label).join(", ")}`);
      return;
    }
    const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
    const creds = { ...draft(), values: trimmed };
    onSave(creds);
    setValues(trimmed);
    setEditing(false);
    toast.success(`${broker.name} keys saved ${persist ? "on this device" : "for this session"}`);
    if (andTest && live) await runTest(creds);
  };

  return (
    <Card className={cn("flex flex-col gap-4 p-5 transition-shadow", isActive && configured && "ring-2 ring-primary/60")}>
      <div className="flex items-start gap-3">
        <BrandTile broker={broker} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold leading-tight">{broker.name}</h3>
            {isActive && configured && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">Active</span>
            )}
            {live ? (
              <span className="rounded-full bg-bullish/15 px-2 py-0.5 text-[11px] font-semibold text-bullish">Live data</span>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help rounded-full bg-foreground/[0.08] px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    Relay pending
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[240px] text-xs">
                  Your keys can be stored here, but this broker's data relay isn't built into the local proxy yet. Contributions welcome.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{broker.description}</p>
        </div>
        <a
          href={broker.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
          aria-label={`${broker.name} API docs`}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {broker.features.map((f) => (
          <span key={f} className="rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">{f}</span>
        ))}
      </div>

      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save(live);
          }}
          autoComplete="off"
        >
          {broker.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`${broker.id}-${field.key}`} className="text-xs">
                {field.label}
                {field.required ? <span className="ml-0.5 text-bearish">*</span> : <span className="ml-1 text-muted-foreground">(optional)</span>}
              </Label>
              <div className="relative">
                <Input
                  id={`${broker.id}-${field.key}`}
                  type={field.secret && !revealed[field.key] ? "password" : "text"}
                  placeholder={field.placeholder}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                  className={cn("text-sm", field.secret && "pr-10")}
                  autoComplete="off"
                  spellCheck={false}
                />
                {field.secret && (
                  <button
                    type="button"
                    onClick={() => setRevealed({ ...revealed, [field.key]: !revealed[field.key] })}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={revealed[field.key] ? "Hide value" : "Show value"}
                  >
                    {revealed[field.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
              {field.helpText && (
                <p className="flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
                  <Info className="mt-px h-3 w-3 shrink-0" />
                  {field.helpText}
                </p>
              )}
            </div>
          ))}

          <label className="glass-control flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-xs font-medium">Remember on this device</span>
              <span className="block text-[11px] text-muted-foreground">
                {persist ? "Kept in this browser until you remove it" : "Cleared when you close this tab"}
              </span>
            </span>
            <Switch checked={persist} onCheckedChange={setPersist} />
          </label>

          <div className="flex gap-2 pt-1">
            <Button type="submit" className="flex-1">
              {live ? <Zap className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
              {live ? "Save & test" : "Save keys"}
            </Button>
            {live && (
              <Button type="button" variant="secondary" onClick={() => void save(false)}>Save only</Button>
            )}
            {saved && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setValues(saved.values);
                  setPersist(saved.persist);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      ) : !saved ? (
        <div className="mt-auto flex items-center gap-3">
          <Button size="sm" variant={live ? "default" : "secondary"} onClick={() => setEditing(true)}>
            <KeyRound className="h-4 w-4" /> Add keys
          </Button>
          {live && <span className="text-[11px] text-muted-foreground">or set <code className="rounded bg-foreground/10 px-1">DHAN_CLIENT_ID</code> in <code className="rounded bg-foreground/10 px-1">.env</code></span>}
        </div>
      ) : (
        <div className="space-y-3">
          <dl className="glass-control divide-y divide-border/50 rounded-xl px-3">
            {broker.fields.filter((f) => saved?.values[f.key]).map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-3 py-2 text-xs">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className="num truncate font-mono">{f.secret ? maskSecret(saved?.values[f.key]) : saved?.values[f.key]}</dd>
              </div>
            ))}
          </dl>

          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            {saved?.persist ? "Saved on this device" : "This session only"} · added{" "}
            {new Date(saved?.addedAt ?? Date.now()).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
          </p>

          {test.status === "ok" && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-bullish"><CheckCircle2 className="h-4 w-4" /> Connected</p>
          )}
          {test.status === "error" && (
            <p className="flex items-start gap-1.5 text-xs font-medium text-bearish"><XCircle className="mt-px h-4 w-4 shrink-0" /> {test.message}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {live && saved && (
              <Button size="sm" onClick={() => void runTest(saved)} disabled={test.status === "testing"}>
                {test.status === "testing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Test connection
              </Button>
            )}
            {!isActive && configured && (
              <Button size="sm" variant="secondary" onClick={() => onSetActive(broker.id)}>Make active</Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-bearish"
              onClick={() => onRemove(broker.id)}
              aria-label={`Remove ${broker.name} keys`}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
