#!/usr/bin/env node
// Prints the signing certificate fingerprints of an Android APK (APK Signature Scheme v2/v3, and v1 if present).
//
//   node scripts/apk-signing-cert.mjs path/to/app.apk [--expect <SHA-256>]
//
// An APK contains only public certificates, never private keys, so this is safe to run on any APK. Android installs
// an APK as an update only if its signer certificate matches the installed app's; compare the SHA-256 lines.
// With --expect, exits 1 unless one of the APK's signer certificates has that SHA-256 (colons and case ignored).
// Runs on Node 18+ with no dependencies (works in Termux).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SCHEMES = new Map([
  [0x7109871a, "v2"],
  [0xf05368c0, "v3"],
  [0x1b93ad61, "v3.1"],
]);

const hex = (buf, algo) => createHash(algo).update(buf).digest("hex").toUpperCase().match(/../g).join(":");

/** Splits a sequence of uint32-length-prefixed values. */
function lengthPrefixed(buf) {
  const out = [];
  for (let o = 0; o < buf.length;) {
    const n = buf.readUInt32LE(o);
    out.push(buf.subarray(o + 4, o + 4 + n));
    o += 4 + n;
  }
  return out;
}

export function signingCertificates(apk) {
  const eocd = apk.lastIndexOf(Buffer.from("PK\x05\x06", "latin1"));
  if (eocd < 0) throw new Error("not a zip/APK file");
  const cdOffset = apk.readUInt32LE(eocd + 16);
  const magic = apk.subarray(cdOffset - 16, cdOffset).toString("latin1");
  const certs = [];
  if (magic === "APK Sig Block 42") {
    const size = Number(apk.readBigUInt64LE(cdOffset - 24));
    const pairs = apk.subarray(cdOffset - size - 8 + 8, cdOffset - 24);
    for (let o = 0; o < pairs.length;) {
      const len = Number(pairs.readBigUInt64LE(o));
      const id = pairs.readUInt32LE(o + 8);
      const value = pairs.subarray(o + 12, o + 8 + len);
      o += 8 + len;
      const scheme = SCHEMES.get(id);
      if (!scheme) continue;
      for (const signer of lengthPrefixed(lengthPrefixed(value)[0])) {
        const signedData = lengthPrefixed(signer)[0];
        // signed data = digests, certificates, ... (each length-prefixed)
        const digestsLen = signedData.readUInt32LE(0);
        const certsBlock = signedData.subarray(4 + digestsLen);
        for (const der of lengthPrefixed(certsBlock.subarray(4, 4 + certsBlock.readUInt32LE(0)))) {
          certs.push({ scheme, sha256: hex(der, "sha256"), sha1: hex(der, "sha1") });
        }
      }
    }
  }
  return certs;
}

function main(argv) {
  const [file, flag, expected] = argv;
  if (!file || (flag && flag !== "--expect") || (flag && !expected)) {
    console.error("usage: node scripts/apk-signing-cert.mjs <app.apk> [--expect <SHA-256>]");
    return 2;
  }
  const certs = signingCertificates(readFileSync(file));
  if (certs.length === 0) {
    console.log("No v2/v3 signature block found (v1-only or unsigned APK).");
  }
  for (const c of certs) {
    console.log(`${c.scheme} signer certificate SHA-256: ${c.sha256}`);
    console.log(`${c.scheme} signer certificate SHA-1:   ${c.sha1}`);
  }
  if (flag) {
    const norm = (s) => s.replace(/[^0-9a-f]/gi, "").toUpperCase();
    const ok = certs.some((c) => norm(c.sha256) === norm(expected));
    console.log(
      ok ? "MATCH: signed with the expected certificate." : "NO MATCH: signed with a different certificate.",
    );
    return ok ? 0 : 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
