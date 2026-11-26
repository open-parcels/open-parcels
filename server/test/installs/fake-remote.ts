import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FetchLike } from "../../src/net/guarded-fetch.js";

/** A fake internet for installs: answers from a map of URLs, 404 for everything else. */
export class FakeRemote {
  readonly files = new Map<string, string | Buffer>();
  readonly asked: string[] = [];

  readonly fetch: FetchLike = (input) => {
    const url = input.toString();
    this.asked.push(url);
    const body = this.files.get(url);
    return Promise.resolve(
      body === undefined ? new Response("missing", { status: 404 }) : new Response(body),
    );
  };

  json(url: string, value: unknown): void {
    this.files.set(url, JSON.stringify(value));
  }
}

export const REGISTRY =
  "https://raw.githubusercontent.com/open-parcels/open-parcels-registry/main/";

/** The registry's first real index (empty, signed with the registry key), as published. */
export function serveRealIndex(remote: FakeRemote): void {
  for (const file of ["index.json", "index.json.sig"]) {
    remote.files.set(`${REGISTRY}${file}`, readFileSync(new URL(`./${file}`, import.meta.url)));
  }
}

function sshString(value: Buffer | string): Buffer {
  const body = typeof value === "string" ? Buffer.from(value) : value;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  return Buffer.concat([length, body]);
}

/** A made-up Ed25519 key that signs like `ssh-keygen -Y sign`, for registry tests. */
export function testSigner(): {
  publicKey: string;
  sign(message: Buffer, namespace: string): string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url");
  const blob = Buffer.concat([sshString("ssh-ed25519"), sshString(raw)]);
  return {
    publicKey: `ssh-ed25519 ${blob.toString("base64")} test`,
    sign(message, namespace) {
      const digest = createHash("sha512").update(message).digest();
      const signed = Buffer.concat([
        Buffer.from("SSHSIG"),
        sshString(namespace),
        sshString(""),
        sshString("sha512"),
        sshString(digest),
      ]);
      const signature = Buffer.concat([
        sshString("ssh-ed25519"),
        sshString(sign(null, signed, privateKey)),
      ]);
      const version = Buffer.alloc(4);
      version.writeUInt32BE(1, 0);
      const body = Buffer.concat([
        Buffer.from("SSHSIG"),
        version,
        sshString(blob),
        sshString(namespace),
        sshString(""),
        sshString("sha512"),
        sshString(signature),
      ]).toString("base64");
      return `-----BEGIN SSH SIGNATURE-----\n${body}\n-----END SSH SIGNATURE-----\n`;
    },
  };
}
