import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

/**
 * Verifies an SSH signature (`ssh-keygen -Y sign`, the "SSHSIG" format) made with an Ed25519 key,
 * with `node:crypto` only. The registry signs its index this way (decision record 0002 §2.6.1).
 */

const MAGIC = "SSHSIG";
const ED25519 = "ssh-ed25519";

/** Reads SSH wire-format strings (uint32 length, then bytes) one after another. */
class Reader {
  private offset = 0;
  private readonly buffer: Buffer;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  bytes(length: number): Buffer {
    if (this.offset + length > this.buffer.length) throw new Error("truncated");
    const out = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  string(): Buffer {
    return this.bytes(this.bytes(4).readUInt32BE(0));
  }

  uint32(): number {
    return this.bytes(4).readUInt32BE(0);
  }

  done(): boolean {
    return this.offset === this.buffer.length;
  }
}

function sshString(value: Buffer | string): Buffer {
  const body = typeof value === "string" ? Buffer.from(value) : value;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  return Buffer.concat([length, body]);
}

/** The raw 32-byte key of an `ssh-ed25519 AAAA…` blob. */
function ed25519Key(blob: Buffer): Buffer {
  const reader = new Reader(blob);
  if (reader.string().toString() !== ED25519) throw new Error("not an Ed25519 key");
  const key = reader.string();
  if (key.length !== 32 || !reader.done()) throw new Error("bad Ed25519 key");
  return key;
}

function keyObject(raw: Buffer): KeyObject {
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") },
    format: "jwk",
  });
}

/** The key blob of an `ssh-ed25519 AAAA… comment` line. */
export function parsePublicKey(line: string): Buffer {
  const [type, data] = line.trim().split(/\s+/);
  if (type !== ED25519 || data === undefined) throw new Error("not an ssh-ed25519 key");
  const blob = Buffer.from(data, "base64");
  ed25519Key(blob);
  return blob;
}

function unarmor(armored: string): Buffer {
  const match = /-----BEGIN SSH SIGNATURE-----([\s\S]+?)-----END SSH SIGNATURE-----/.exec(armored);
  if (match?.[1] === undefined) throw new Error("not an SSH signature");
  return Buffer.from(match[1].replace(/\s+/g, ""), "base64");
}

/**
 * True when `armored` is a valid signature of `message` in `namespace` by one of `allowedKeys`
 * (key blobs from `parsePublicKey`). Anything malformed is simply not valid.
 */
export function verifySshSignature(
  message: Buffer,
  armored: string,
  namespace: string,
  allowedKeys: readonly Buffer[],
): boolean {
  try {
    const reader = new Reader(unarmor(armored));
    if (reader.bytes(6).toString() !== MAGIC || reader.uint32() !== 1) return false;
    const publicKey = reader.string();
    const signedNamespace = reader.string().toString();
    const reserved = reader.string();
    const hashAlgorithm = reader.string().toString();
    const signatureBlob = reader.string();
    if (!reader.done() || signedNamespace !== namespace) return false;
    if (!allowedKeys.some((key) => key.equals(publicKey))) return false;
    if (hashAlgorithm !== "sha512" && hashAlgorithm !== "sha256") return false;
    const signature = new Reader(signatureBlob);
    if (signature.string().toString() !== ED25519) return false;
    const raw = signature.string();
    const signed = Buffer.concat([
      Buffer.from(MAGIC),
      sshString(namespace),
      sshString(reserved),
      sshString(hashAlgorithm),
      sshString(createHash(hashAlgorithm).update(message).digest()),
    ]);
    return verify(null, signed, keyObject(ed25519Key(publicKey)), raw);
  } catch {
    // Malformed input is an invalid signature, never an error the caller must handle.
    return false;
  }
}
