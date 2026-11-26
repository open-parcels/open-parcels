import { z } from "zod";
import type { OrderSnapshot, ParcelSnapshot, ReturnSnapshot } from "../provider/snapshot.js";

/** Provider id of inbox connections. Mail is handled by the core, not by a carrier provider. */
export const MAIL_PROVIDER = "imap" as const;

/**
 * The carrier of a parcel an email names without one the rules know: filed under the user's
 * first fallback service before it is stored, or dropped when there is none.
 */
export const TO_FALLBACK_SERVICE = "<fallback service>";

/** The inbox form's fields; the titles and descriptions are translated like a provider's. */
export const mailConfigSchema = z.object({
  host: z
    .string()
    .min(1)
    .max(255)
    .meta({ title: "IMAP server", description: "For example imap.example.org." }),
  port: z.number().int().min(1).max(65535).default(993).meta({ title: "Port" }),
  /** TLS from the start (993). Without it the connection must upgrade with STARTTLS. */
  secure: z.boolean().default(true).meta({
    title: "Use TLS",
    description: "Off: the connection must switch to TLS with STARTTLS, usually on port 143.",
  }),
  /**
   * Without `secure`, allow staying in cleartext when the server offers no STARTTLS, which sends
   * the password unencrypted. Off unless the user chooses it.
   */
  allowPlaintext: z.boolean().default(false).meta({
    title: "Allow an unencrypted connection",
    description:
      "Only with TLS off: connect even when the server offers no STARTTLS. Sends the password in clear text.",
  }),
  folders: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(20)
    .default(["INBOX"])
    .meta({ title: "Folders" }),
  /** How far back the first sync looks. */
  initialDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(30)
    .meta({ title: "Days to look back on the first sync" }),
  /**
   * Hand an email to the provider of its sender's domain only when the receiving server
   * confirmed the sender (DKIM or DMARC). Off for servers that add no `Authentication-Results`;
   * a forged sender then reaches that provider too.
   */
  checkSenders: z.boolean().default(true).meta({
    title: "Check senders (DKIM/DMARC)",
    description:
      "Off only if your mail server adds no Authentication-Results header: emails then reach a shop's or carrier's provider by the sender's domain alone, which a forged sender can fake.",
  }),
});
export type MailConfig = z.infer<typeof mailConfigSchema>;

export const mailSecretSchema = z.object({
  username: z.string().min(1).meta({ title: "Username" }),
  password: z.string().min(1).meta({ title: "Password" }),
});
export type MailSecret = z.infer<typeof mailSecretSchema>;

/**
 * The default name of an inbox connection: the account, so two inboxes on one server differ.
 * A username that is already an address keeps its own domain and names the server after it.
 */
export function inboxLabel(username: string, host: string): string {
  return username.includes("@") ? `Inbox ${username} (${host})` : `Inbox ${username}@${host}`;
}

/** True for the names older versions gave inboxes by default, which hid the account. */
export function isGenericInboxLabel(label: string, host: string): boolean {
  return label === "Mailbox" || label === `Mailbox ${host}`;
}

/** Progress per folder, kept in the encrypted session store. */
export const mailProgressSchema = z.record(
  z.string(),
  z.object({ uidValidity: z.string(), lastUid: z.number().int().nonnegative() }),
);
export type MailProgress = z.infer<typeof mailProgressSchema>;

/** A received mail, already decoded. Never logged: it is personal data. */
export interface MailInput {
  readonly messageId: string | null;
  readonly from: string;
  readonly subject: string;
  readonly text: string | null;
  readonly html: string | null;
  readonly date: Date | null;
  /**
   * The topmost `Authentication-Results` header: the one the receiving server added, which says
   * whether the sender passed DKIM or DMARC. Null when there is none.
   */
  readonly authentication: string | null;
}

/**
 * Turns a mail into parcel snapshots. The rules come from the shared rules package; the watcher
 * itself knows nothing about carriers.
 */
export type MailInterpreter = (mail: MailInput) => readonly ParcelSnapshot[];

/** Turns a return or refund mail into return reports, also from the shared rules. */
export type MailReturnInterpreter = (mail: MailInput) => readonly ReturnSnapshot[];

/** Turns an order email (confirmation, update, receipt) into order reports. */
export type MailOrderInterpreter = (mail: MailInput) => readonly OrderSnapshot[];

export interface FetchedMessage {
  readonly uid: number;
  /** The raw RFC 822 message. */
  readonly source: Buffer;
  /** When the server received it (IMAP INTERNALDATE), if it said. */
  readonly receivedAt?: Date | null;
}

/** What the watcher needs from an IMAP connection; the real one wraps imapflow, tests use a fake. */
export interface MailboxClient {
  connect(): Promise<void>;
  /** Opens a folder read-only and returns its UIDVALIDITY. */
  open(folder: string): Promise<{ uidValidity: string }>;
  /** UIDs of messages received on or after `since`. */
  searchSince(since: Date): Promise<number[]>;
  /** Messages with a UID above `afterUid`, oldest first. */
  fetchAfter(afterUid: number): AsyncIterable<FetchedMessage>;
  fetchUids(uids: readonly number[]): AsyncIterable<FetchedMessage>;
  /** Called whenever the open folder reports new messages (IMAP IDLE). */
  onNewMail(listener: () => void): void;
  onClose(listener: (error: Error | undefined) => void): void;
  close(): Promise<void>;
}

export type MailboxClientFactory = (config: MailConfig, secret: MailSecret) => MailboxClient;
