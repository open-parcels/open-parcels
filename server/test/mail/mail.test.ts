import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../../src/api/app.js";
import { SecretBox } from "../../src/crypto/secrets.js";
import { secretAad } from "../../src/engine/connections.js";
import type { FetchedMessage, MailboxClient, MailInput } from "../../src/mail/types.js";
import { snapshot } from "../../src/provider/api.js";
import { FakeWorld, fakePost } from "../fakes/carriers.js";
import { createTestContext, signIn, type TestContext } from "../helpers.js";

interface FakeMessage {
  readonly uid: number;
  readonly date: Date;
  readonly source: Buffer;
}

/** An in-memory mailbox that behaves like the IMAP wrapper. */
class FakeMailbox implements MailboxClient {
  folders = new Map<string, { uidValidity: string; messages: FakeMessage[] }>([
    ["INBOX", { uidValidity: "1", messages: [] }],
  ]);
  current = "INBOX";
  connectError: Error | undefined;
  newMail: (() => void) | undefined;
  closed: ((error: Error | undefined) => void) | undefined;
  fetched: number[] = [];

  connect(): Promise<void> {
    return this.connectError === undefined ? Promise.resolve() : Promise.reject(this.connectError);
  }
  open(folder: string): Promise<{ uidValidity: string }> {
    this.current = folder;
    return Promise.resolve({ uidValidity: this.#folder().uidValidity });
  }
  async searchSince(since: Date): Promise<number[]> {
    await this.searchGate;
    return this.#folder()
      .messages.filter((message) => message.date >= since)
      .map((message) => message.uid);
  }
  /** Like a real server for `UID FETCH n:*`: the newest message comes back even when not newer. */
  replayNewest = false;
  /** When set, searches wait for it, so a test can hold the first sync. */
  searchGate: Promise<void> | undefined;
  async *fetchAfter(afterUid: number): AsyncIterable<FetchedMessage> {
    const newer = this.#folder().messages.filter((entry) => entry.uid > afterUid);
    const newest = this.#folder().messages.at(-1);
    const answer =
      newer.length === 0 && this.replayNewest && newest !== undefined ? [newest] : newer;
    for (const message of answer) {
      this.fetched.push(message.uid);
      yield await Promise.resolve(message);
    }
  }
  async *fetchUids(uids: readonly number[]): AsyncIterable<FetchedMessage> {
    for (const message of this.#folder().messages.filter((entry) => uids.includes(entry.uid))) {
      this.fetched.push(message.uid);
      yield await Promise.resolve(message);
    }
  }
  onNewMail(listener: () => void): void {
    this.newMail = listener;
  }
  onClose(listener: (error: Error | undefined) => void): void {
    this.closed = listener;
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  #folder() {
    const folder = this.folders.get(this.current);
    if (folder === undefined) {
      throw new Error(`No folder ${this.current}.`);
    }
    return folder;
  }
  add(uid: number, date: string, subject: string): void {
    const raw = [
      `From: Shop <noreply@shop.example.invalid>`,
      `To: someone@example.invalid`,
      `Subject: ${subject}`,
      `Date: ${new Date(date).toUTCString()}`,
      `Message-ID: <${uid}@example.invalid>`,
      "",
      `Your parcel ${subject} is on its way.`,
    ].join("\r\n");
    this.#folder().messages.push({ uid, date: new Date(date), source: Buffer.from(raw) });
  }
}

let context: TestContext;
let mailbox: FakeMailbox;
let seen: MailInput[];
let app: App;
let headers: Record<string, string>;

/** Interprets a subject "FP<digits>" as a fakepost parcel, "BROKEN" as a mail that throws. */
function interpret(mail: MailInput) {
  seen.push(mail);
  if (mail.subject === "BROKEN") {
    throw new Error("parser bug");
  }
  const match = /FP\d+/.exec(mail.subject);
  return match === null
    ? []
    : [
        snapshot({
          carrier: "fakepost",
          trackingNumber: match[0],
          status: "registered",
          rawStatus: "Shipping notice",
        }),
      ];
}

beforeEach(async () => {
  mailbox = new FakeMailbox();
  seen = [];
  context = await createTestContextWithMail();
  await context.services.mail.start();
  app = await context.app();
  const session = await signIn(context, app);
  headers = { cookie: session.cookie, "x-csrf-token": session.csrf };
});
afterEach(async () => {
  await context.services.mail.stop();
  await context.close();
});

async function createTestContextWithMail(): Promise<TestContext> {
  return createTestContext({
    providers: [fakePost(new FakeWorld())],
    mailClientFactory: () => mailbox,
    mailInterpreter: interpret,
  });
}

const mailSecret = { username: "someone@example.invalid", password: ["made", "up"].join("-") };

async function addMailbox(): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/connections",
    headers,
    payload: {
      provider: "imap",
      kind: "mail",
      label: "Inbox",
      config: { host: "imap.example.invalid" },
      secret: mailSecret,
    },
  });
  expect(response.statusCode).toBe(201);
  expect(response.body).not.toContain("made-up");
  const id = response.json<{ id: string }>().id;
  await context.services.mail.settled(id);
  return id;
}

describe("mail watcher", () => {
  it("imports the last 30 days on first sync and follows found parcels with their carrier", async () => {
    mailbox.add(1, "2026-09-01T10:00:00Z", "Old FP0001");
    mailbox.add(2, "2026-11-10T10:00:00Z", "Recent FP0002");
    mailbox.add(3, "2026-11-17T10:00:00Z", "Newsletter");
    const id = await addMailbox();

    expect(seen.map((mail) => mail.subject)).toEqual(["Recent FP0002", "Newsletter"]);
    const parcels = await context.services.parcels.repository.list({}, false);
    expect(parcels.map((parcel) => parcel.tracking_number)).toEqual(["FP0002"]);
    expect(parcels[0]?.connections.map((connection) => connection.role).sort()).toEqual([
      "mail",
      "primary",
    ]);
    const connection = await context.services.connections.get(id);
    expect(connection).toMatchObject({ state: "ok" });
    const row = await context.services.db
      .selectFrom("connections")
      .select("session_blob")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.session_blob?.toString("utf8") ?? "").not.toContain("lastUid");
  });

  it("fetches only new messages when the server announces them", async () => {
    mailbox.add(1, "2026-11-17T10:00:00Z", "First FP0001");
    await addMailbox();
    mailbox.fetched = [];
    mailbox.add(2, "2026-11-18T10:00:00Z", "Second FP0002");
    mailbox.newMail?.();
    await context.services.mail.stop();
    expect(mailbox.fetched).toEqual([2]);
    expect(
      (await context.services.parcels.repository.list({}, false))
        .map((parcel) => parcel.tracking_number)
        .sort(),
    ).toEqual(["FP0001", "FP0002"]);
  });

  it("reads a batch again when storing it failed, even when the next sync runs on the same connection", async () => {
    mailbox.add(1, "2026-11-17T10:00:00Z", "First FP0001");
    await addMailbox();
    const ingest = vi
      .spyOn(context.services.reconciler, "ingest")
      .mockRejectedValueOnce(new Error("database busy"));
    mailbox.add(2, "2026-11-18T10:00:00Z", "Second FP0002");
    mailbox.newMail?.();
    // The failed batch, then a new-mail trigger on the same connection before any reconnect.
    mailbox.add(3, "2026-11-18T11:00:00Z", "Third FP0003");
    mailbox.newMail?.();
    await context.services.mail.stop();
    expect(ingest).toHaveBeenCalledTimes(2);
    expect(
      (await context.services.parcels.repository.list({}, false))
        .map((parcel) => parcel.tracking_number)
        .sort(),
    ).toEqual(["FP0001", "FP0002", "FP0003"]);
  });

  it("starts over when the folder's UIDVALIDITY changes", async () => {
    mailbox.add(5, "2026-11-17T10:00:00Z", "First FP0001");
    const id = await addMailbox();
    mailbox.folders.set("INBOX", { uidValidity: "2", messages: [] });
    mailbox.add(1, "2026-11-18T09:00:00Z", "Rebuilt FP0003");
    mailbox.fetched = [];
    await context.services.mail.connect(id);
    await context.services.mail.settled(id);
    expect(mailbox.fetched).toEqual([1]);
  });

  it("keeps going when one mail cannot be interpreted", async () => {
    mailbox.add(1, "2026-11-17T10:00:00Z", "BROKEN");
    mailbox.add(2, "2026-11-17T11:00:00Z", "Fine FP0009");
    await addMailbox();
    expect(
      (await context.services.parcels.repository.list({}, false)).map(
        (parcel) => parcel.tracking_number,
      ),
    ).toEqual(["FP0009"]);
  });

  it("asks for a new password when the server rejects the sign-in, and retries on network errors", async () => {
    mailbox.connectError = Object.assign(new Error("auth"), { authenticationFailed: true });
    const id = await addMailbox();
    expect((await context.services.connections.get(id))?.state).toBe("needs_sign_in");

    mailbox.connectError = undefined;
    await context.services.mail.connect(id);
    await context.services.mail.settled(id);
    mailbox.closed?.(new Error("connection reset"));
    await new Promise((resolve) => setImmediate(resolve));
    expect((await context.services.connections.get(id))?.state).toBe("error");
  });

  it("starts with an unreadable mailbox and marks it instead of failing (OP-016)", async () => {
    const lostKey = await addMailbox();
    const badConfig = await addMailbox();
    await context.services.mail.stop();
    await context.services.db
      .updateTable("connections")
      .set({
        secret_blob: new SecretBox(randomBytes(32)).encryptJson(mailSecret, secretAad(lostKey)),
      })
      .where("id", "=", lostKey)
      .execute();
    await context.services.db
      .updateTable("connections")
      .set({ config: "{}" })
      .where("id", "=", badConfig)
      .execute();

    await expect(context.services.mail.start()).resolves.toBeUndefined();
    expect(await context.services.connections.get(lostKey)).toMatchObject({
      state: "needs_sign_in",
    });
    expect(await context.services.connections.get(badConfig)).toMatchObject({
      state: "error",
      stateReason: "inbox_settings_invalid",
    });
  });

  it("refuses invalid mailbox settings on change and stores valid ones with defaults (OP-017)", async () => {
    const id = await addMailbox();
    const before = await context.services.connections.get(id);
    const refused = await app.inject({
      method: "PATCH",
      url: `/api/v1/connections/${id}`,
      headers,
      payload: { config: {} },
    });
    expect(refused.statusCode).toBe(400);
    expect((await context.services.connections.get(id))?.config).toEqual(before?.config);

    const changed = await app.inject({
      method: "PATCH",
      url: `/api/v1/connections/${id}`,
      headers,
      payload: { config: { host: "mail.example.invalid" } },
    });
    expect(changed.statusCode).toBe(200);
    expect((await context.services.connections.get(id))?.config).toEqual({
      host: "mail.example.invalid",
      port: 993,
      secure: true,
      allowPlaintext: false,
      folders: ["INBOX"],
      initialDays: 30,
      checkSenders: true,
    });
  });

  it("refuses sign-in data that does not fit the provider when a connection is added (OP-032)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/connections",
      headers,
      payload: {
        provider: "fakepost",
        kind: "account",
        label: "Post",
        config: {},
        secret: { username: 42 },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(await context.services.connections.list()).toEqual([]);
  });

  it("does not read the newest mail again when the server returns it for n:* (OP-023)", async () => {
    mailbox.add(1, "2026-11-17T10:00:00Z", "First FP0001");
    const id = await addMailbox();
    mailbox.replayNewest = true;
    seen = [];
    mailbox.newMail?.();
    await context.services.mail.settled(id);
    expect(seen).toEqual([]);
  });

  it("answers the add request before the first sync is done (OP-024)", async () => {
    mailbox.add(1, "2026-11-17T10:00:00Z", "First FP0001");
    let release = (): void => undefined;
    mailbox.searchGate = new Promise((resolve) => {
      release = resolve;
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/connections",
      headers,
      payload: {
        provider: "imap",
        kind: "mail",
        label: "Inbox",
        config: { host: "imap.example.invalid" },
        secret: mailSecret,
      },
    });
    expect(response.statusCode).toBe(201);
    expect(seen).toEqual([]);
    release();
    await context.services.mail.settled(response.json<{ id: string }>().id);
    expect(seen.map((mail) => mail.subject)).toEqual(["First FP0001"]);
  });

  it("schedules one reconnect however often a mailbox fails before it runs (OP-040)", async () => {
    mailbox.connectError = new Error("connection refused");
    const id = await addMailbox();
    const setState = vi.spyOn(context.services.connections, "setState");
    await context.services.mail.connect(id);
    await context.services.mail.connect(id);
    expect(setState).not.toHaveBeenCalled();
  });

  it("backs off further when the server accepts the connection but every sync fails", async () => {
    const id = await addMailbox();
    const at = (seconds: number): string =>
      new Date(context.clock.now().getTime() + seconds * 1000).toISOString();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      mailbox.open = () => Promise.reject(new Error("folder gone"));
      mailbox.newMail?.();
      await context.services.mail.settled(id);
      expect(context.services.mail.status(id)).toMatchObject({
        failures: 1,
        reconnectAt: at(30),
      });
      // The reconnect succeeds, the sync after it fails again: the wait doubles instead of
      // starting over at 30 seconds.
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() => {
        expect(context.services.mail.status(id)).toMatchObject({
          failures: 2,
          reconnectAt: at(60),
        });
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects mailboxes without a host or sign-in", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/connections",
      headers,
      payload: { provider: "imap", kind: "mail", label: "x", config: {} },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("reading old emails again (inbox job)", () => {
  it("is offered on the inbox and reads the chosen days again, paced and resumable", async () => {
    mailbox.add(1, "2026-09-01T10:00:00Z", "Old FP0001");
    mailbox.add(2, "2026-11-10T10:00:00Z", "Recent FP0002");
    const id = await addMailbox();
    const form = await app.inject({ url: "/api/v1/inbox-form", headers });
    expect(form.json<{ actions: { id: string }[] }>().actions.map((a) => a.id)).toEqual([
      "reread_emails",
    ]);
    const offered = await app.inject({ url: `/api/v1/connections/${id}/actions`, headers });
    expect(offered.json<{ id: string; available: boolean }[]>()).toMatchObject([
      { id: "reread_emails", available: true },
    ]);
    const started = await app.inject({
      method: "POST",
      url: `/api/v1/connections/${id}/actions/reread_emails`,
      headers,
      payload: { input: { days: 120 } },
    });
    expect(started.statusCode).toBe(202);
    await context.services.jobs.settled();
    const job = await context.services.jobs.store.get(
      started.json<{ job: { id: string } }>().job.id,
    );
    expect(job).toMatchObject({
      state: "done",
      summary: "2 emails: 2 parcels, 0 orders, 0 returns",
    });
    const parcels = await context.services.parcels.repository.list({}, false);
    expect(parcels.map((parcel) => parcel.tracking_number).sort()).toEqual(["FP0001", "FP0002"]);
  });
});
