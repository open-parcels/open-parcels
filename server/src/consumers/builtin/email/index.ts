import { z } from "zod";
import type { Consumer, ConsumerCall, DeliveryOutcome, Message, MessageItem } from "../../api.js";
import { parseConsumerManifest } from "../../manifest.js";
import raw from "./open-parcels-consumer.json" with { type: "json" };

/** Email over SMTP: an HTML and a text part. The core holds the SMTP connection (`smtp.ts`). */

const manifest = parseConsumerManifest(raw, "email");

export const emailConfigSchema = z.strictObject({
  host: z
    .string()
    .regex(/^[A-Za-z0-9.-]{1,253}$/, "a host name")
    .meta({ title: "SMTP server", description: "e.g. smtp.example.com" }),
  port: z.number().int().min(1).max(65535).default(587).meta({ title: "Port" }),
  security: z.enum(["starttls", "tls", "none"]).default("starttls").meta({
    title: "Security",
    description: "starttls (port 587), tls (port 465) or none (a server on your own network).",
  }),
  from: z.email().meta({ title: "From", description: "Sender address." }),
  to: z.email().meta({ title: "To", description: "Who receives the emails." }),
});

export const emailSecretSchema = z.strictObject({
  user: z.string().min(1).meta({ title: "Username" }),
  password: z.string().min(1).meta({ title: "Password" }),
});

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => `&#${String(char.codePointAt(0))};`);

function htmlItem(item: MessageItem): string {
  const title = escape(item.title);
  const heading = item.url === null ? title : `<a href="${escape(item.url)}">${title}</a>`;
  const body = escape(item.body).replaceAll("\n", "<br>");
  return `<h2 style="font-size:16px;margin:16px 0 4px">${heading}</h2><p style="margin:0">${body}</p>`;
}

function html(message: Message): string {
  const items =
    message.items.length === 0
      ? `<p>${escape(message.body)}</p>`
      : message.items.map(htmlItem).join("\n");
  return [
    "<!doctype html>",
    `<html lang="${message.language}"><head><meta charset="utf-8"><title>${escape(message.title)}</title></head>`,
    '<body style="font-family:system-ui,sans-serif;line-height:1.4">',
    `<h1 style="font-size:18px">${escape(message.title)}</h1>`,
    items,
    "</body></html>",
  ].join("\n");
}

function text(message: Message): string {
  if (message.items.length === 0) return message.body;
  return message.items
    .map((item) => [item.title, item.body, item.url ?? ""].filter((line) => line !== "").join("\n"))
    .join("\n\n");
}

function send(message: Message, call: ConsumerCall): Promise<DeliveryOutcome> {
  if (call.smtp === undefined) {
    return Promise.resolve({
      kind: "failed",
      message: "The email consumer needs the core's SMTP connection.",
    });
  }
  return call.smtp({ subject: message.title, text: text(message), html: html(message) });
}

export const email: Consumer = {
  describe: () => ({ manifest, configSchema: emailConfigSchema, secretSchema: emailSecretSchema }),
  deliver: send,
  test: send,
};
