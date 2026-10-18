import { Check, CircleDashed, Lock, Minus } from "lucide-react";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BrokerInfo } from "@/lib/brokerConfig";
import { AUTH_COPY, MATRIX_COLUMNS, capabilityMatrix, type MatrixCell, type MatrixLevel } from "@/lib/brokerDirectory";

const ICON: Record<MatrixLevel, typeof Check> = { yes: Check, partial: CircleDashed, gated: Lock, no: Minus };
const TONE: Record<MatrixLevel, string> = {
  yes: "text-bullish",
  partial: "text-warning",
  gated: "text-warning",
  no: "text-muted-foreground",
};

/** One matrix cell: icon plus visible text, so meaning never rests on colour alone. */
function Cell({ cell }: { cell: MatrixCell }) {
  const Icon = ICON[cell.level];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" title={cell.detail}>
      <Icon className={`h-3.5 w-3.5 shrink-0 ${TONE[cell.level]}`} aria-hidden />
      <span className={cell.level === "no" ? "text-muted-foreground" : "text-foreground"}>{cell.label}</span>
    </span>
  );
}

/** The five capability columns as a compact wrapped list (inside each broker card). */
export function BrokerMatrixRow({ broker }: { broker: Pick<BrokerInfo, "capabilities" | "greeks" | "verified"> }) {
  const m = capabilityMatrix(broker);
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-body-sm" aria-label="Capabilities">
      {MATRIX_COLUMNS.map((c) => (
        <li key={c.key} className="inline-flex items-center gap-1">
          <span className="text-muted-foreground">{c.label}:</span>
          <Cell cell={m[c.key]} />
          <span className="sr-only">. {m[c.key].detail}</span>
        </li>
      ))}
    </ul>
  );
}

/** Capability matrix for many brokers (chain / quotes / live feed / portfolio / orders). */
export function BrokerCapabilityMatrix({ brokers, onSelect }: { brokers: BrokerInfo[]; onSelect?: (id: string) => void }) {
  return (
    <Table className="min-w-[640px] text-body-sm">
      <TableCaption className="text-left text-body-sm text-muted-foreground">
        From each broker&apos;s server adapter. &ldquo;Blocked&rdquo; orders are built and gated but cannot be sent from this app yet; only Dhan places live orders, through 1Cliq after you arm it.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="sticky left-0 z-10 bg-surface">
            Broker
          </TableHead>
          <TableHead scope="col">Sign-in</TableHead>
          {MATRIX_COLUMNS.map((c) => (
            <TableHead key={c.key} scope="col">
              {c.label}
            </TableHead>
          ))}
          <TableHead scope="col">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {brokers.map((b) => {
          const m = capabilityMatrix(b);
          return (
            <TableRow key={b.id}>
              <TableHead scope="row" className="sticky left-0 z-10 bg-surface font-medium text-foreground">
                {onSelect ? (
                  <button
                    type="button"
                    className="rounded-sm text-left underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    onClick={() => onSelect(b.id)}
                  >
                    {b.name}
                  </button>
                ) : (
                  b.name
                )}
              </TableHead>
              <TableCell className="whitespace-nowrap">{AUTH_COPY[b.authKind].label}</TableCell>
              {MATRIX_COLUMNS.map((c) => (
                <TableCell key={c.key}>
                  <Cell cell={m[c.key]} />
                </TableCell>
              ))}
              <TableCell className="whitespace-nowrap">{b.verified ? "Verified live" : "Beta"}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
