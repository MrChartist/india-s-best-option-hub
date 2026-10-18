import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loginValuesFor, saveBrokerCredentials, withSession, type BrokerCredentials, type BrokerInfo } from "@/lib/brokerConfig";
import { loginBrokerSession } from "@/lib/marketApi";

const TOTP_RE = /^\d{6}$/;

/**
 * "Log in" for brokers whose API needs the password/PIN and a fresh TOTP code every session.
 * The typed values live only in this component's state: they are sent once to the local proxy and
 * cleared on submit or close. Only the session token the broker returns is saved, in the same
 * credential store (session-only or encrypted) as every other key.
 */
export function BrokerSessionLoginDialog({
  broker,
  saved,
  open,
  onOpenChange,
}: {
  broker: BrokerInfo;
  saved: BrokerCredentials;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const prompts = broker.sessionLogin?.prompts ?? [];
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const close = (next: boolean) => {
    if (!next) setSecrets({});
    onOpenChange(next);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = prompts.filter((p) => !secrets[p.key]?.trim());
    if (missing.length) return toast.error(`Please enter: ${missing.map((p) => p.label).join(", ")}`);
    const code = secrets.totpCode?.trim() ?? "";
    if (!TOTP_RE.test(code)) return toast.error("Enter the current 6-digit code from your authenticator app.");
    setBusy(true);
    const typed = { ...secrets, totpCode: code };
    setSecrets({});
    try {
      // Only the stored keys the adapter needs; the old session's tokens stay behind.
      const result = await loginBrokerSession(broker.id, loginValuesFor(broker.id, saved.values), typed);
      if (result.status !== "success") {
        toast.error(`${broker.name} login failed: ${result.message}`);
        return;
      }
      await saveBrokerCredentials({ ...saved, values: withSession(saved.values, result.session, result.expiresAt) });
      toast.success(`${broker.name}: logged in for this session`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Could not save the session");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log in to {broker.name}</DialogTitle>
          <DialogDescription>
            {broker.name} needs these each session. They go once to the proxy on your own machine and on to {broker.name}; they
            are never saved. Only the session token {broker.name} returns is kept.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3" autoComplete="off">
          {prompts.map((p) => (
            <div key={p.key} className="space-y-1.5">
              <Label htmlFor={`login-${broker.id}-${p.key}`} className="text-body-sm">
                {p.label}
              </Label>
              <Input
                id={`login-${broker.id}-${p.key}`}
                name={p.key}
                type="password"
                autoComplete="one-time-code"
                spellCheck={false}
                inputMode={p.kind === "totp" ? "numeric" : undefined}
                pattern={p.kind === "totp" ? "\\d{6}" : undefined}
                maxLength={p.kind === "totp" ? 6 : 256}
                placeholder={p.kind === "totp" ? "Current code from your authenticator app" : ""}
                value={secrets[p.key] ?? ""}
                onChange={(e) => setSecrets((s) => ({ ...s, [p.key]: e.target.value }))}
                className="text-body"
              />
            </div>
          ))}
          <DialogFooter className="gap-2 pt-1 sm:gap-0">
            <Button type="button" variant="ghost" size="sm" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
              Log in
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
