/**
 * Payload encryption for Axis Direct RAPID APIs.
 *
 * Official source: the "Encryption and Decryption" section of the RAPID APIs Postman collection
 * (https://documenter.getpostman.com/view/33771924/2sA3BkasEf):
 *  - secret_key: 16 random bytes written as 32 hexadecimal characters. The AES key is the UTF-8 bytes of that
 *    hex text (32 bytes), so the cipher is AES-256-GCM.
 *  - Request and response bodies: AES-GCM with a random nonce; the wire form is
 *    base64(nonce) + "." + base64(tag) + "." + base64(ciphertext). The nonce is 16 bytes (the length the
 *    documented library uses by default) and the tag 16 bytes.
 *  - x-api-encryption-key header: the secret_key encrypted with RSA-OAEP (SHA-256) under the public key that
 *    the Handshake API returns (a bare base64 SubjectPublicKeyInfo, wrapped into PEM here), as base64.
 *
 * The secret key lives only in this process, inside the session it belongs to. It is never logged or stored.
 */

import { constants, createCipheriv, createDecipheriv, publicEncrypt, randomBytes } from "node:crypto";
import { BrokerError } from "./contract.mjs";

const NONCE_BYTES = 16;
const TAG_BYTES = 16;

/** A fresh secret key: 32 lowercase hex characters. */
export function newSecretKey() {
  return randomBytes(16).toString("hex");
}

function keyBytes(secretKey) {
  const s = String(secretKey ?? "");
  if (!/^[0-9a-f]{32}$/i.test(s)) throw new BrokerError("Axis Direct: invalid encryption key.", { code: "AXIS_CRYPTO" });
  return Buffer.from(s, "utf8");
}

/** Encrypt a string (normally JSON text). `nonce` is only passed by tests. */
export function encryptPayload(plainText, secretKey, nonce = randomBytes(NONCE_BYTES)) {
  const cipher = createCipheriv("aes-256-gcm", keyBytes(secretKey), nonce);
  const body = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  return `${nonce.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${body.toString("base64")}`;
}

/** Decrypt the "nonce.tag.ciphertext" form. Throws BrokerError when the text is malformed or fails authentication. */
export function decryptPayload(encoded, secretKey) {
  const parts = String(encoded ?? "").split(".");
  if (parts.length !== 3) throw new BrokerError("Axis Direct sent an unreadable encrypted response.", { code: "AXIS_CRYPTO" });
  try {
    const [nonce, tag, body] = parts.map((p) => Buffer.from(p, "base64"));
    if (tag.length !== TAG_BYTES || nonce.length === 0) throw new Error("bad lengths");
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(secretKey), nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch (e) {
    if (e instanceof BrokerError) throw e;
    throw new BrokerError("Axis Direct sent a response that could not be decrypted.", { code: "AXIS_CRYPTO" });
  }
}

/** The PEM form of the Handshake API's bare base64 public key (already-PEM input is passed through). */
export function toPem(publicKey) {
  const s = String(publicKey ?? "").trim();
  if (s.startsWith("-----BEGIN")) return s;
  const body = s.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(body)) throw new BrokerError("Axis Direct handshake returned an invalid public key.", { code: "AXIS_CRYPTO" });
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----`;
}

/** x-api-encryption-key: RSA-OAEP(SHA-256) of the secret key, base64. */
export function encryptSecretKey(secretKey, publicKey) {
  keyBytes(secretKey);
  try {
    return publicEncrypt({ key: toPem(publicKey), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(secretKey, "utf8")).toString("base64");
  } catch (e) {
    if (e instanceof BrokerError) throw e;
    throw new BrokerError("Axis Direct handshake returned a public key that could not be used.", { code: "AXIS_CRYPTO" });
  }
}
