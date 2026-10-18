/**
 * Profitmart symbol masters: https://profitmax.profitmart.in/<SEG>_symbols.txt.zip (public, daily), each a ZIP
 * with one comma-separated text file and a header row. Layout checked against the live files on 18 Oct 2026:
 *   NFO: Exchange,Token,LotSize,Symbol,TradingSymbol,Expiry,Instrument,OptionType,StrikePrice,TickSize,
 *   BFO: Exchange,Token,LotSize,Symbol,TradingSymbol,CompanyName,Expiry,Instrument,OptionType,StrikePrice,
 *        TickSize,PrevClose,UpperCkt,LowerCkt,OI,FreezeQty   (the entry is named BFO_Symbol.txt)
 *   NSE: Exchange,Token,LotSize,Symbol,TradingSymbol,Instrument,TickSize,
 * The reader is header-keyed, so the extra BFO columns are ignored. In BFO the Symbol column already holds
 * the root (SENSEX, BANKEX, SENSEX50), and the shared core keeps SENSEX50 out of the SENSEX chain.
 */

import { loadZippedSegment } from "./shoonyaInstruments.mjs";
import { HOST } from "./profitmartAuth.mjs";

export const MASTER_ROOT = HOST;

export const loadSegment = (segment) => loadZippedSegment(MASTER_ROOT, segment, "Profitmart");
