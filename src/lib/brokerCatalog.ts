/**
 * The broker catalogue — static metadata plus the credential fields each
 * broker needs. Split out of brokerConfig.ts, which was 562 lines and almost
 * entirely this table; brokerConfig.ts now holds only account storage and the
 * live-trading gate.
 *
 * The table itself outgrew the 300-line limit (41 brokers, ~15 lines each),
 * so it's sliced across brokerCatalogPart1/2/3/4.ts (part 4 holds the newer beta adapters) and merged
 * back into the same `BROKERS` export here — every existing import of
 * `BROKERS` / `BrokerInfo` / `BrokerField` from "./brokerCatalog" is
 * unaffected.
 */

import type { BrokerInfo } from "./brokerCatalogTypes";
import { BROKERS_PART1 } from "./brokerCatalogPart1";
import { BROKERS_PART2 } from "./brokerCatalogPart2";
import { BROKERS_PART3 } from "./brokerCatalogPart3";
import { BROKERS_PART4 } from "./brokerCatalogPart4";

export type { BrokerInfo, BrokerField } from "./brokerCatalogTypes";

export const BROKERS: BrokerInfo[] = [...BROKERS_PART1, ...BROKERS_PART2, ...BROKERS_PART3, ...BROKERS_PART4];
