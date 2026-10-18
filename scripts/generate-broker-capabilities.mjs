#!/usr/bin/env node
/**
 * Writes src/lib/brokerCapabilities.generated.ts from the server adapters' own `capabilities`,
 * `credentialFields` and session-login fields, so Broker Settings shows what each adapter actually
 * declares instead of hand-written feature lists. server/brokers/brokerCapabilitiesSnapshot.test.mjs
 * fails when the file drifts from the adapters; rerun:  node scripts/generate-broker-capabilities.mjs
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBrokerCapabilityMeta, renderBrokerCapabilityModule } from "../server/brokers/brokerCapabilityMeta.mjs";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/brokerCapabilities.generated.ts");
writeFileSync(out, renderBrokerCapabilityModule(buildBrokerCapabilityMeta()));
console.log(`Wrote ${out}`);
