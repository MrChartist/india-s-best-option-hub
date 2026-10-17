/**
 * Shared types for the broker catalogue. Split out so brokerCatalogPart1/2/3.ts
 * (the data) don't need to import from the brokerCatalog.ts barrel and create a
 * circular import.
 */

export interface BrokerInfo {
  id: string;
  name: string;
  logo: string; // emoji for now
  color: string; // tailwind hsl token reference
  fields: BrokerField[];
  docsUrl: string;
  description: string;
  features: string[];
}

export interface BrokerField {
  key: string;
  label: string;
  placeholder: string;
  type: "text" | "password";
  required: boolean;
  helpText?: string;
}
