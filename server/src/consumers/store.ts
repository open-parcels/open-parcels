import type { Kysely } from "kysely";
import type { z } from "zod";
import { isoNow, type Clock } from "../clock.js";
import type { SecretBox } from "../crypto/secrets.js";
import type { ConsumerRow, Database } from "../db/schema.js";
import type { Consumer } from "./api.js";
import { notificationRulesSchema, type NotificationRules } from "./rules.js";

/** Configured consumers: settings, the encrypted secret and the notification rules. */

export class ConsumerInputError extends Error {
  override readonly name = "ConsumerInputError";

  constructor(
    readonly code: "unknown_consumer" | "invalid_config" | "invalid_secret" | "invalid_rules",
    message: string,
  ) {
    super(message);
  }
}

export interface ConsumerView {
  readonly id: string;
  readonly consumer: string;
  readonly label: string;
  readonly config: unknown;
  readonly hasSecret: boolean;
  readonly rules: NotificationRules;
  readonly enabled: boolean;
  readonly lastAttemptAt: string | null;
  readonly lastOkAt: string | null;
  readonly lastError: string | null;
}

export interface ConsumerInput {
  readonly label?: string | undefined;
  readonly config?: unknown;
  /** undefined: keep; null: remove; else the new secret. */
  readonly secret?: unknown;
  readonly rules?: unknown;
  readonly enabled?: boolean | undefined;
}

function viewOf(row: ConsumerRow): ConsumerView {
  return {
    id: row.id,
    consumer: row.consumer,
    label: row.label,
    config: JSON.parse(row.config) as unknown,
    hasSecret: row.secret_blob !== null,
    rules: notificationRulesSchema.parse(JSON.parse(row.rules)),
    enabled: row.enabled === 1,
    lastAttemptAt: row.last_attempt_at,
    lastOkAt: row.last_ok_at,
    lastError: row.last_error,
  };
}

function checked<T>(schema: z.ZodType<T>, value: unknown, code: ConsumerInputError["code"]): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new ConsumerInputError(code, problems.join("; "));
  }
  return parsed.data;
}

export class ConsumerStore {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly secrets: SecretBox,
    private readonly clock: Clock,
    private readonly consumers: ReadonlyMap<string, Consumer>,
  ) {}

  async list(): Promise<ConsumerView[]> {
    const rows = await this.db.selectFrom("consumers").selectAll().orderBy("created_at").execute();
    return rows.map(viewOf);
  }

  async get(id: string): Promise<ConsumerView | undefined> {
    const row = await this.db
      .selectFrom("consumers")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row === undefined ? undefined : viewOf(row);
  }

  /** The stored secret, decrypted for one call. */
  async secretOf(id: string): Promise<unknown> {
    const row = await this.db
      .selectFrom("consumers")
      .select("secret_blob")
      .where("id", "=", id)
      .executeTakeFirst();
    if (row === undefined || row.secret_blob === null) return null;
    return this.secrets.decryptJson(row.secret_blob, id);
  }

  #consumer(id: string): Consumer {
    const consumer = this.consumers.get(id);
    if (consumer === undefined) {
      throw new ConsumerInputError("unknown_consumer", `There is no consumer ${id}.`);
    }
    return consumer;
  }

  #secretBlob(consumer: Consumer, id: string, secret: unknown): Buffer | null {
    if (secret === null) return null;
    const schema = consumer.describe().secretSchema;
    if (schema === null) throw new ConsumerInputError("invalid_secret", "It takes no secret.");
    return this.secrets.encryptJson(checked(schema, secret, "invalid_secret"), id);
  }

  async create(
    consumerId: string,
    input: ConsumerInput & { label: string },
  ): Promise<ConsumerView> {
    const consumer = this.#consumer(consumerId);
    const id = crypto.randomUUID();
    const now = isoNow(this.clock);
    const config = checked(consumer.describe().configSchema, input.config ?? {}, "invalid_config");
    const rules = checked(notificationRulesSchema, input.rules, "invalid_rules");
    await this.db
      .insertInto("consumers")
      .values({
        id,
        consumer: consumerId,
        label: input.label,
        config: JSON.stringify(config),
        secret_blob: this.#secretBlob(consumer, id, input.secret ?? null),
        rules: JSON.stringify(rules),
        enabled: input.enabled === false ? 0 : 1,
        created_at: now,
        updated_at: now,
      })
      .execute();
    const view = await this.get(id);
    if (view === undefined) throw new Error("The new consumer was not stored.");
    return view;
  }

  /** Changes what `input` names; undefined on an unknown id. */
  async update(id: string, input: ConsumerInput): Promise<ConsumerView | undefined> {
    const current = await this.get(id);
    if (current === undefined) return undefined;
    const consumer = this.#consumer(current.consumer);
    const describe = consumer.describe();
    await this.db
      .updateTable("consumers")
      .set({
        updated_at: isoNow(this.clock),
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.config === undefined
          ? {}
          : {
              config: JSON.stringify(
                checked(describe.configSchema, input.config, "invalid_config"),
              ),
            }),
        ...(input.secret === undefined
          ? {}
          : { secret_blob: this.#secretBlob(consumer, id, input.secret) }),
        ...(input.rules === undefined
          ? {}
          : {
              rules: JSON.stringify(checked(notificationRulesSchema, input.rules, "invalid_rules")),
            }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled ? 1 : 0 }),
      })
      .where("id", "=", id)
      .execute();
    return this.get(id);
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.db.deleteFrom("consumers").where("id", "=", id).executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  /** Records an attempt's outcome: the Status page shows it. */
  async recordAttempt(id: string, error: string | null): Promise<void> {
    const now = isoNow(this.clock);
    await this.db
      .updateTable("consumers")
      .set({
        last_attempt_at: now,
        last_error: error,
        ...(error === null ? { last_ok_at: now } : {}),
      })
      .where("id", "=", id)
      .execute();
  }
}
