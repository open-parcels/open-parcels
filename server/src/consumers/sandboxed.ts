import { z } from "zod";
import type { Sandbox } from "../sandbox/host.js";
import type {
  Consumer,
  ConsumerCall,
  ConsumerDescription,
  DeliveryOutcome,
  Message,
} from "./api.js";

/**
 * An installed consumer runs in the sandbox (`docs/consumers.md` §6): `deliver` and `test` go to
 * the guest with the config and secret of that call only, and the call is granted `http` alone,
 * answered by the core's allow-listed transport. The child holds no store and no socket.
 */

const CALL_TIMEOUT_MS = 60_000;

const requestSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/ }),
  method: z.enum(["GET", "POST", "PUT"]),
  headers: z.record(z.string(), z.string()),
  body: z
    .string()
    .max(1024 * 1024)
    .nullable(),
});

const outcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ok") }),
  z.strictObject({
    kind: z.literal("retry"),
    message: z.string().max(500),
    retryAfterSeconds: z.number().positive().optional(),
  }),
  z.strictObject({ kind: z.literal("failed"), message: z.string().max(500) }),
]);

function parseOutcome(value: unknown): DeliveryOutcome {
  const parsed = outcomeSchema.safeParse(value);
  if (!parsed.success) return { kind: "failed", message: "The consumer answered nonsense." };
  const outcome = parsed.data;
  if (outcome.kind !== "retry" || outcome.retryAfterSeconds === undefined) {
    return outcome.kind === "retry" ? { kind: "retry", message: outcome.message } : outcome;
  }
  return { kind: "retry", message: outcome.message, retryAfterSeconds: outcome.retryAfterSeconds };
}

/** A consumer whose code runs in `sandbox`; what it is comes from its manifest, without a call. */
export function sandboxedConsumer(description: ConsumerDescription, sandbox: Sandbox): Consumer {
  const run = async (method: "deliver" | "test", message: Message, call: ConsumerCall) => {
    const value = await sandbox.call(
      method,
      { message, config: call.config, secret: call.secret },
      {
        timeoutMs: CALL_TIMEOUT_MS,
        capabilities: { http: (args) => call.http(requestSchema.parse(args)) },
      },
    );
    return parseOutcome(value);
  };
  return {
    describe: () => description,
    deliver: (message, call) => run("deliver", message, call),
    test: (message, call) => run("test", message, call),
  };
}
