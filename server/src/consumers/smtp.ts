import { createTransport } from "nodemailer";
import type { HostAllowList } from "../provider/manifest.js";
import type { ConsumerSmtp, DeliveryOutcome } from "./api.js";
import { emailConfigSchema, emailSecretSchema } from "./builtin/email/index.js";

/**
 * The SMTP connection of the built-in email consumer, held by the core (an installed consumer gets
 * HTTP only). One connection per email; the host must be on the consumer's allow-list.
 */

const TIMEOUT_MS = 20_000;

/** An SMTP error's reply code, when the server gave one. */
function replyCode(error: unknown): number | undefined {
  const code = (error as { responseCode?: unknown } | null)?.responseCode;
  return typeof code === "number" ? code : undefined;
}

export function smtpSender(config: unknown, secret: unknown, hosts: HostAllowList): ConsumerSmtp {
  return async (email): Promise<DeliveryOutcome> => {
    const settings = emailConfigSchema.parse(config);
    const login = secret === null ? null : emailSecretSchema.parse(secret);
    if (!hosts.allows(settings.host)) {
      return { kind: "failed", message: `${settings.host} is not allowed for this consumer.` };
    }
    const transport = createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.security === "tls",
      requireTLS: settings.security === "starttls",
      ignoreTLS: settings.security === "none",
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
      ...(login === null ? {} : { auth: { user: login.user, pass: login.password } }),
    });
    try {
      await transport.sendMail({
        from: settings.from,
        to: settings.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
      return { kind: "ok" };
    } catch (error) {
      const code = replyCode(error);
      const message = `The SMTP server refused the email${code === undefined ? "" : ` (${String(code)})`}.`;
      // 5xx: the server will never take it (bad login, unknown recipient); else try again later.
      return code !== undefined && code >= 500
        ? { kind: "failed", message }
        : {
            kind: "retry",
            message: code === undefined ? "The SMTP server could not be reached." : message,
          };
    } finally {
      transport.close();
    }
  };
}
