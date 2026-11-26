/**
 * An installed consumer for the sandbox tests: it posts the message's title to the URL of its
 * config with the token of its secret, through the `http` capability. Node runs it as it is inside
 * the child, so it uses only erasable TypeScript and imports nothing but types.
 */
import type { GuestMethods } from "../../src/sandbox/child.js";

interface Args {
  readonly message: { readonly title: string };
  readonly config: { readonly url: string; readonly stray?: string };
  readonly secret: { readonly token: string } | null;
}

async function post(raw: unknown, broker: Parameters<GuestMethods[string]>[1]): Promise<unknown> {
  const args = raw as Args;
  const target = args.config.stray ?? args.config.url;
  try {
    const answer = (await broker.request("http", {
      url: target,
      method: "POST",
      headers: { authorization: `Bearer ${args.secret?.token ?? ""}` },
      body: args.message.title,
    })) as { status: number };
    return answer.status === 200 ? { kind: "ok" } : { kind: "retry", message: "not 200" };
  } catch (error) {
    return { kind: "failed", message: (error as Error).message };
  }
}

const methods: GuestMethods = { deliver: post, test: post };

export default methods;
