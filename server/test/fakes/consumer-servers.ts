import { createServer as createHttpServer, type IncomingHttpHeaders } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Server } from "node:net";

/**
 * Fake ntfy, webhook, apprise-api and SMTP servers on 127.0.0.1 for the consumer tests. Nothing
 * here reaches a real service.
 */

interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface FakeHttp {
  readonly url: string;
  readonly requests: ReceivedRequest[];
  /** The status (and headers) the next requests get; 200 by default. */
  answer(status: number, headers?: Readonly<Record<string, string>>): void;
  close(): Promise<void>;
}

function closing(server: Server | ReturnType<typeof createHttpServer>): () => Promise<void> {
  return () =>
    new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
      if ("closeAllConnections" in server) server.closeAllConnections();
    });
}

export async function startHttpFake(): Promise<FakeHttp> {
  const requests: ReceivedRequest[] = [];
  let status = 200;
  let extra: Readonly<Record<string, string>> = {};
  const server = createHttpServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({
        method: request.method ?? "",
        path: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(status, { "content-type": "application/json", ...extra });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    answer(next, headers = {}) {
      status = next;
      extra = headers;
    },
    close: closing(server),
  };
}

export interface FakeSmtp {
  readonly port: number;
  /** Each accepted email: envelope and the raw DATA. */
  readonly mails: { from: string; to: string[]; data: string }[];
  close(): Promise<void>;
}

/** A plain SMTP server (no TLS, no AUTH) that accepts every email. */
export async function startSmtpFake(): Promise<FakeSmtp> {
  const mails: FakeSmtp["mails"] = [];
  const server = createTcpServer((socket) => {
    let buffer = "";
    let inData = false;
    let current = { from: "", to: [] as string[], data: "" };
    const reply = (line: string): void => {
      socket.write(`${line}\r\n`);
    };
    reply("220 fake.smtp ESMTP");
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let end = buffer.indexOf("\r\n");
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\r\n");
        if (inData) {
          if (line === ".") {
            inData = false;
            mails.push(current);
            current = { from: "", to: [], data: "" };
            reply("250 queued");
          } else {
            current.data += `${line.startsWith("..") ? line.slice(1) : line}\n`;
          }
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") reply("250 fake.smtp");
        else if (verb === "MAIL") current.from = line.slice(10).trim();
        else if (verb === "RCPT") current.to.push(line.slice(8).trim());
        else if (verb === "DATA") {
          inData = true;
          reply("354 go ahead");
          continue;
        } else if (verb === "QUIT") {
          reply("221 bye");
          socket.end();
          continue;
        }
        if (verb === "MAIL" || verb === "RCPT" || verb === "RSET" || verb === "NOOP")
          reply("250 ok");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { port, mails, close: closing(server) };
}
