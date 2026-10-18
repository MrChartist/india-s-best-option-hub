#!/usr/bin/env node
/**
 * Licence check for broker adapters: reports runs of N consecutive code tokens that a server/brokers file shares with
 * a local checkout of OpenAlgo (AGPL-3.0). This project is MIT, so adapters must be written independently; a shared
 * run that is not an endpoint path, a documented field name or a documented constant is a sign that code was
 * translated and must be rewritten before merge. Not run in CI (it needs the OpenAlgo checkout); see
 * docs/broker-contract.md section 9.
 *
 * Usage:
 *   node scripts/check-openalgo-overlap.mjs --ref <path-to-openalgo-checkout> [--n 6] [--max 40] [file-or-broker-id ...]
 *
 * With no file arguments every non-test server/brokers/*.mjs is scanned. A broker id (e.g. "motilal") scans that
 * broker's files only. Each file is compared against OpenAlgo's broker/<id>/ folder when one matches its prefix,
 * otherwise against every broker folder. Comments and docstrings are ignored on both sides.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const [value] = args.splice(i, 2).slice(1);
  return value;
};
const refRoot = opt("ref", null);
const N = Number(opt("n", 6));
const MAX = Number(opt("max", 40));
if (!refRoot) {
  console.error("Pass --ref <path to an OpenAlgo checkout>.");
  process.exit(2);
}

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const brokersDir = join(repoRoot, "server/brokers");
const refBrokers = join(resolve(refRoot), "broker");
const ALIASES = { angelone: "angel" };

// Words too common in both languages to say anything about provenance.
const NOISE = new Set(
  ("const let var function return if else for while of in new await async try catch throw def import from export " +
    "class self none null true false undefined and or not is elif with as pass raise except lambda this string number " +
    "json data res response str int float get len").split(" "),
);

const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const stripPy = (src) => src.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, " ").replace(/#[^\n]*/g, " ");

function tokens(src) {
  const out = [];
  for (const m of src.matchAll(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?/g)) {
    const t = m[0].replaceAll("_", "").toLowerCase(); // snake_case and camelCase compare equal
    if (t.length > 1 && !NOISE.has(t)) out.push(t);
  }
  return out;
}

function shingles(list) {
  const set = new Set();
  for (let i = 0; i + N <= list.length; i++) set.add(list.slice(i, i + N).join(" "));
  return set;
}

function walkPy(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkPy(p, acc);
    else if (name.endsWith(".py")) acc.push(p);
  }
  return acc;
}

const refCache = new Map();
function refShingles(folder) {
  if (!refCache.has(folder)) {
    const set = new Set();
    for (const f of walkPy(folder)) for (const s of shingles(tokens(stripPy(readFileSync(f, "utf8"))))) set.add(s);
    refCache.set(folder, set);
  }
  return refCache.get(folder);
}

function refFor(file) {
  const prefix = basename(file).match(/^[a-z]+/)?.[0] ?? "";
  const id = ALIASES[prefix] ?? prefix;
  const folder = join(refBrokers, id);
  try {
    if (statSync(folder).isDirectory()) return { label: id, set: refShingles(folder) };
  } catch { /* no matching folder */ }
  const all = new Set();
  for (const name of readdirSync(refBrokers)) {
    const p = join(refBrokers, name);
    if (statSync(p).isDirectory()) for (const s of refShingles(p)) all.add(s);
  }
  return { label: "*", set: all };
}

const allFiles = readdirSync(brokersDir).filter((f) => f.endsWith(".mjs") && !f.includes(".test.") && !f.includes("Testkit"));
const wanted = args.length
  ? allFiles.filter((f) => args.some((a) => f === basename(a) || f.startsWith(a)))
  : allFiles;

let flagged = 0;
for (const f of wanted) {
  const mine = shingles(tokens(stripJs(readFileSync(join(brokersDir, f), "utf8"))));
  if (!mine.size) continue;
  const { label, set } = refFor(f);
  const shared = [...mine].filter((s) => set.has(s)).sort();
  if (!shared.length) continue;
  flagged++;
  console.log(`${f} vs openalgo/broker/${label}: ${shared.length} shared ${N}-token runs`);
  for (const s of shared.slice(0, MAX)) console.log(`    ${s}`);
  if (shared.length > MAX) console.log(`    ... ${shared.length - MAX} more`);
}
console.log(flagged ? `\n${flagged} file(s) share runs. Every run listed must be an endpoint path, documented field name or constant; rewrite anything else.` : "No shared runs.");
