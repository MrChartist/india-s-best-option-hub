import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { getDefaultWatchlist } from "@/lib/advancedMockData";
import { fnoStocks } from "@/lib/mockData";
import { useNavigate } from "react-router-dom";
import { Search, Star, Eye, TrendingUp, TrendingDown, ExternalLink } from "lucide-react";

export default function Watchlist() {
  const navigate = useNavigate();
  const [watchlist, setWatchlist] = useState(() => getDefaultWatchlist());
  const [search, setSearch] = useState("");
  const [addSymbol, setAddSymbol] = useState("");

  const filtered = useMemo(() => {
    if (!search) return watchlist;
    return watchlist.filter(w => w.symbol.includes(search.toUpperCase()));
  }, [watchlist, search]);

  const addToWatchlist = () => {
    const sym = addSymbol.toUpperCase();
    if (sym && !watchlist.find(w => w.symbol === sym) && (fnoStocks.includes(sym) || ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].includes(sym))) {
      setWatchlist([...watchlist, {
        symbol: sym, ltp: 1000 + Math.random() * 5000,
        change: (Math.random() - 0.5) * 50, changePercent: (Math.random() - 0.5) * 3,
        iv: 12 + Math.random() * 15, ivRank: Math.round(Math.random() * 100),
        oi: Math.round(5000000 + Math.random() * 30000000), oiChange: Math.round((Math.random() - 0.4) * 2000000),
        pcr: Math.round((0.5 + Math.random() * 1.5) * 100) / 100,
        volume: Math.round(2000000 + Math.random() * 10000000),
      }]);
      setAddSymbol("");
    }
  };

  const removeFromWatchlist = (sym: string) => setWatchlist(watchlist.filter(w => w.symbol !== sym));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Watchlist</h1>
          <p className="text-sm text-muted-foreground">Pinned symbols · Quick IV & OI overview · One-click navigation</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Filter..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 w-[140px] text-xs" />
          </div>
          <Input placeholder="Add symbol..." value={addSymbol} onChange={e => setAddSymbol(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addToWatchlist()} className="h-8 w-[130px] text-xs" />
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={addToWatchlist}>Add</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="text-[10px]">
                <TableHead className="w-8"></TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">LTP</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Chg%</TableHead>
                <TableHead className="text-right">IV</TableHead>
                <TableHead className="text-right">IV Rank</TableHead>
                <TableHead className="text-right">OI</TableHead>
                <TableHead className="text-right">OI Chg</TableHead>
                <TableHead className="text-right">PCR</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(w => (
                <TableRow key={w.symbol} className="text-[11px] font-mono hover:bg-accent/50">
                  <TableCell>
                    <Star className="h-3 w-3 text-warning fill-warning cursor-pointer" onClick={() => removeFromWatchlist(w.symbol)} />
                  </TableCell>
                  <TableCell className="font-sans font-medium">{w.symbol}</TableCell>
                  <TableCell className="text-right">₹{w.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className={`text-right ${w.change >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {w.change >= 0 ? "+" : ""}{w.change.toFixed(2)}
                  </TableCell>
                  <TableCell className={`text-right font-medium ${w.changePercent >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {w.changePercent >= 0 ? "+" : ""}{w.changePercent.toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right">{w.iv.toFixed(1)}%</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Progress value={w.ivRank} className={`h-1.5 w-8 ${w.ivRank > 70 ? "[&>div]:bg-bearish" : w.ivRank < 30 ? "[&>div]:bg-bullish" : ""}`} />
                      <span className={w.ivRank > 70 ? "text-bearish" : w.ivRank < 30 ? "text-bullish" : ""}>{w.ivRank}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{(w.oi / 1000000).toFixed(1)}M</TableCell>
                  <TableCell className={`text-right ${w.oiChange >= 0 ? "text-bullish" : "text-bearish"}`}>
                    {w.oiChange >= 0 ? "+" : ""}{(w.oiChange / 1000).toFixed(0)}K
                  </TableCell>
                  <TableCell className={`text-right ${w.pcr > 1 ? "text-bullish" : "text-bearish"}`}>{w.pcr.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{(w.volume / 1000000).toFixed(1)}M</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navigate(`/option-chain?symbol=${w.symbol}`)}>
                        <ExternalLink className="h-3 w-3" />
                      </Button>
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
