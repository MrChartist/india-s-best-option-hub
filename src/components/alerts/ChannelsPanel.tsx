import { useEffect, useId, useState, type ReactNode } from "react";
import { Bell, BellOff, FlaskConical, Globe, MonitorSmartphone, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { playAlertSound, testFireAlert, type AlertEngine } from "@/hooks/useAlertEngine";
import { validateWebhookUrl } from "@/lib/alerts";

function Row({
  icon,
  title,
  description,
  control,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  control: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2 border-b border-border py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
          <div className="min-w-0">
            <div className="text-body-sm font-semibold">{title}</div>
            <p className="text-body-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="shrink-0">{control}</div>
      </div>
      {children ? <div className="pl-7">{children}</div> : null}
    </div>
  );
}

const PERMISSION_COPY = {
  unsupported: {
    badge: "Not supported",
    variant: "neutral" as const,
    text: "This browser cannot show notifications for web pages.",
  },
  default: {
    badge: "Not asked yet",
    variant: "neutral" as const,
    text: "Your browser will ask for permission when you turn this on.",
  },
  granted: {
    badge: "Allowed",
    variant: "bullish" as const,
    text: "Alerts appear as system notifications even when this tab is in the background.",
  },
  denied: {
    badge: "Blocked",
    variant: "warning" as const,
    text: "Notifications are blocked for this site. Allow them from the padlock (site settings) in the address bar, then reload.",
  },
};

export function ChannelsPanel({ engine }: { engine: AlertEngine }) {
  const uid = useId();
  const s = engine.settings;
  const [url, setUrl] = useState(s.webhookUrl);
  const [urlError, setUrlError] = useState("");
  useEffect(() => setUrl(s.webhookUrl), [s.webhookUrl]);
  const perm = PERMISSION_COPY[engine.permission];

  const saveUrl = (): boolean => {
    if (!url.trim()) {
      engine.setSettings({ webhookUrl: "", webhook: false });
      setUrlError("");
      return false;
    }
    const v = validateWebhookUrl(url);
    if (!v.ok) {
      setUrlError(v.error);
      return false;
    }
    setUrlError("");
    engine.setSettings({ webhookUrl: v.url });
    return true;
  };

  return (
    <div>
      <Row
        icon={<Bell className="h-4 w-4" aria-hidden="true" />}
        title={<Label htmlFor={`${uid}-toast`}>In-app toast</Label>}
        description="A card in the corner of the terminal."
        control={
          <Switch id={`${uid}-toast`} checked={s.toast} onCheckedChange={(c) => engine.setSettings({ toast: c })} />
        }
      />
      <Row
        icon={<MonitorSmartphone className="h-4 w-4" aria-hidden="true" />}
        title={
          <span className="flex flex-wrap items-center gap-1.5">
            <Label htmlFor={`${uid}-desktop`}>Browser notifications</Label>
            <Badge variant={perm.variant}>{perm.badge}</Badge>
          </span>
        }
        description={perm.text}
        control={
          <Switch
            id={`${uid}-desktop`}
            checked={s.desktop && engine.permission === "granted"}
            disabled={engine.permission === "unsupported" || engine.permission === "denied"}
            onCheckedChange={async (c) => {
              const p = await engine.enableDesktop(c);
              if (c && p === "denied")
                toast.error("Notifications are blocked", {
                  description: "Allow them for this site in your browser settings.",
                });
              if (c && p === "granted") toast.success("Browser notifications on");
            }}
          />
        }
      />
      <Row
        icon={<Volume2 className="h-4 w-4" aria-hidden="true" />}
        title={<Label htmlFor={`${uid}-sound`}>Sound</Label>}
        description="A short chime; rising for bullish, falling for bearish."
        control={
          <Switch id={`${uid}-sound`} checked={s.sound} onCheckedChange={(c) => engine.setSettings({ sound: c })} />
        }
      >
        <div className="flex items-center gap-3">
          <Label htmlFor={`${uid}-vol`} className="shrink-0 text-body-sm text-muted-foreground">
            Volume
          </Label>
          <Slider
            id={`${uid}-vol`}
            value={[Math.round(s.volume * 100)]}
            min={5}
            max={100}
            step={5}
            disabled={!s.sound}
            onValueChange={([v]) => engine.setSettings({ volume: v / 100 })}
            aria-label="Alert volume"
            className="max-w-48"
          />
          <Button variant="ghost" size="pill" disabled={!s.sound} onClick={() => playAlertSound("bullish", s.volume)}>
            <Volume2 aria-hidden="true" /> Play
          </Button>
        </div>
      </Row>
      <Row
        icon={<Globe className="h-4 w-4" aria-hidden="true" />}
        title={<Label htmlFor={`${uid}-webhook`}>Webhook</Label>}
        description="POSTs each alert as JSON to your URL (Slack, Discord, Google Chat, n8n, Zapier or your own server). Sent from this browser; the URL stays on this device."
        control={
          <Switch
            id={`${uid}-webhook`}
            checked={s.webhook && !!s.webhookUrl}
            onCheckedChange={(c) => {
              if (!c) engine.setSettings({ webhook: false });
              else if (saveUrl()) engine.setSettings({ webhook: true });
              else if (!url.trim()) setUrlError("Enter a webhook URL first.");
            }}
          />
        }
      >
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (saveUrl()) toast.success("Webhook URL saved");
          }}
        >
          <Label htmlFor={`${uid}-url`} className="sr-only">
            Webhook URL
          </Label>
          <Input
            id={`${uid}-url`}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://hooks.example.com/…"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError("");
            }}
            aria-invalid={!!urlError || undefined}
            aria-describedby={urlError ? `${uid}-url-err` : undefined}
            className="h-9 min-w-0 flex-1"
          />
          <Button type="submit" size="sm" variant="outline">
            Save URL
          </Button>
        </form>
        {urlError ? (
          <p id={`${uid}-url-err`} role="alert" className="mt-1 text-body-sm text-bearish">
            {urlError}
          </p>
        ) : null}
        <p className="mt-1 text-micro normal-case tracking-normal text-muted-foreground">
          Body is JSON with title, message, symbol, IST time and a “text” field. Browsers cannot read the reply, so
          “sent” means it left your browser.
        </p>
      </Row>
      <div className="flex flex-wrap items-center gap-2 pt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            testFireAlert();
            if (!s.toast)
              toast.info("Test alert sent", { description: "The in-app toast channel is off; check the trigger log." });
          }}
        >
          <FlaskConical aria-hidden="true" /> Send a test alert
        </Button>
        {!s.toast && !s.desktop && !s.sound && !s.webhook ? (
          <span className="flex items-center gap-1 text-body-sm text-warning">
            <BellOff className="h-4 w-4" aria-hidden="true" /> Every channel is off: alerts will only be logged.
          </span>
        ) : null}
      </div>
    </div>
  );
}
