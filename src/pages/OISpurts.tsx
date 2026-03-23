import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getOISpurts } from "@/lib/advancedMockData";
import { Search, Zap, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from "lucide-react";

const interpColors: Record<string, string> = {
  "Long Buildup": "text-bullish",
  "Short Buildup": "text-bearish",
  "Long Unwinding": "text-warning",
  "Short Covering": "text-primary",
};

const interpIcons: Record<string, React.ReactNode> = {
  "Long Buildup": <TrendingUp className="h-3 w-3 text-bullish" />,
  "Short Buildup": <TrendingDown className="h-3 w-3 text-bearish" />,
  "Long Unwinding": <ArrowDownRight className="h-3 w-3 text-warning" />,
  "Short Covering": <ArrowUpRight className="h-3 w-3 text-primary" />,
};

export default function OISpurts() {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterInterp, setFilterInterp] = useState<string>("all");

  const spurts = useMemo(() => getOISpurts(), []);

  const filtered = useMemo(() => {
    let data = [...spurts];
    if (search) data = data.filter(s => s.symbol.includes(search.toUpperCase()));
    if (filterType !== "all") data = data.filter(s => s.type === filterType);
    if (filterInterp !== "all") data = data.filter(s => s.interpretation === filterInterp);
    return data;
  }, [spurts, search, filterType, filterInterp]);

  const longBuildup = spurts.filter(s => s.interpretation === "Long Buildup").length;
  const shortBuildup = spurts.filter(s => s.interpretation === "Short Buildup").length;
  const totalOIChg = spurts.reduce((s, sp) => s + Math.abs(sp.oiChange), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">OI Spurts</h1>
        <p className="text-sm text-muted-foreground">Real-time OI spurt detection · Sudden OI jumps across strikes · Smart money tracking</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Total Spurts</p>
          <p className="text-xl font-bold font-mono">{spurts.length}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Long Buildup</p>
          <p className="text-xl font-bold font-mono text-bullish">{longBuildup}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Short Buildup</p>
          <p className="text-xl font-bold font-mono text-bearish">{shortBuildup}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Total OI Change</p>
          <p className="text-lg font-bold font-mono">{(totalOIChg / 1000000).toFixed(1)}M</p>
        </CardContent></Card>
        <Card><CardContent className="pt-3 pb-3 text-center">
          <p className="text-[9px] text-muted-foreground">Max Spurt</p>
          <p className="text-lg font-bold font-mono text-warning">{spurts[0]?.oiChangePercent.toFixed(1)}%</p>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search symbol..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 w-[160px] text-xs" />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="CE">CE Only</SelectItem>
            <SelectItem value="PE">PE Only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterInterp} onValueChange={setFilterInterp}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Interpretations</SelectItem>
            <SelectItem value="Long Buildup">Long Buildup</SelectItem>
            <SelectItem value="Short Buildup">Short Buildup</SelectItem>
            <SelectItem value="Long Unwinding">Long Unwinding</SelectItem>
            <SelectItem value="Short Covering">Short Covering</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="h-8 px-3 text-xs">{filtered.length} results</Badge>
      </div>

      {/* Spurts Table */}
      <Card>
        <CardContent className="p-0 overflow-auto max-h-[60vh]">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="text-[10px]">
                <TableHead>Time</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-center">Type</TableHead>
                <TableHead className="text-right">Strike</TableHead>
                <TableHead className="text-right">LTP</TableHead>
                <TableHead className="text-right">LTP Chg</TableHead>
                <TableHead className="text-right">Prev OI</TableHead>
                <TableHead className="text-right">Curr OI</TableHead>
                <TableHead className="text-right">OI Chg</TableHead>
                <TableHead className="text-right">OI Chg%</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead>Interpretation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s, i) => (
                <TableRow key={i} className="text-[11px] font-mono">
                  <TableCell className="text-muted-foreground">{s.timestamp}</TableCell>
                  <TableCell className="font-sans font-medium">{s.symbol}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${s.type === "CE" ? "text-bullish" : "text-bearish"}`}>{s.type}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{s.strike.toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right">₹{s.ltp.toFixed(2)}</TableCell>
                  <TableCell className={`text-right ${s.ltpChange >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {s.ltpChange >= 0 ? "+" : ""}₹{s.ltpChange.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">{(s.previousOI / 1000).toFixed(0)}K</TableCell>
                  <TableCell className="text-right">{(s.currentOI / 1000).toFixed(0)}K</TableCell>
                  <TableCell className={`text-right font-medium ${s.oiChange >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {s.oiChange >= 0 ? "+" : ""}{(s.oiChange / 1000).toFixed(0)}K
                  </TableCell>
                  <TableCell className={`text-right font-bold ${Math.abs(s.oiChangePercent) > 15 ? "text-warning" : s.oiChange >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {s.oiChangePercent >= 0 ? "+" : ""}{s.oiChangePercent.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right">{(s.volume / 1000).toFixed(0)}K</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {interpIcons[s.interpretation]}
                      <span className={`text-[10px] ${interpColors[s.interpretation]}`}>{s.interpretation}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
