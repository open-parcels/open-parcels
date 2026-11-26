import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { RateLimitedError, TransientError } from "../../src/provider/errors.js";
import {
  HostLimiter,
  HostNotAllowedError,
  parseRetryAfter,
  coreHttp,
} from "../../src/provider/http.js";
import { networkAllowList } from "../../src/provider/manifest.js";
import { CookieJar, restoreJar, serializeJar } from "../../src/provider/cookies.js";
import { guardedFetch, publicOnlyLookup, type FetchLike } from "../../src/net/guarded-fetch.js";
import { userAgent } from "../../src/version.js";
import { FakeClock } from "../helpers.js";
import { ANY_HOST, testManifest } from "../manifests.js";

function setup(fetchImpl: FetchLike, userAgent?: { value: string; reason: string }) {
  const clock = new FakeClock();
  const waits: number[] = [];
  const limiter = new HostLimiter(clock, (ms) => {
    waits.push(ms);
    clock.advance(ms);
    return Promise.resolve();
  });
  const policy = {
    limits: { "*": { intervalMs: 1000, burst: 2 } },
    ...(userAgent === undefined ? {} : { userAgent }),
  };
  return {
    http: coreHttp(policy, ANY_HOST, limiter, clock, fetchImpl),
    waits,
    clock,
    limiter,
  };
}

const ok: FetchLike = () => Promise.resolve(new Response('{"a":1}', { status: 200 }));

describe("provider HTTP client", () => {
  it("reaches only the hosts the manifest allows, on every redirect hop too", async () => {
    const manifest = testManifest("hosts", {
      permissions: {
        network: [
          { host: ".carrier.example", reason: "Tracking data." },
          { host: "api.partner.example", reason: "Tracking data." },
          { config: "url", reason: "The user's own server." },
        ],
      },
    });
    const requested: string[] = [];
    const answer: FetchLike = (url) => {
      requested.push(url.hostname);
      return Promise.resolve(
        url.pathname === "/away"
          ? new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } })
          : new Response("{}", { status: 200 }),
      );
    };
    const clock = new FakeClock();
    const http = coreHttp(
      { limits: {} },
      networkAllowList(manifest, { url: "https://lookup.home.example/api" }),
      new HostLimiter(clock, () => Promise.resolve()),
      clock,
      answer,
    );
    for (const allowed of [
      "https://carrier.example/",
      "https://www.carrier.example/",
      "https://api.partner.example/",
      "https://lookup.home.example/api/parcel/1",
    ]) {
      await expect(http.request(new URL(allowed))).resolves.toMatchObject({ status: 200 });
    }
    for (const refused of [
      "https://www.partner.example/",
      "https://notcarrier.example/",
      "https://carrier.example.evil.example/",
    ]) {
      await expect(http.request(new URL(refused))).rejects.toBeInstanceOf(HostNotAllowedError);
    }
    await expect(http.request(new URL("https://carrier.example/away"))).rejects.toBeInstanceOf(
      HostNotAllowedError,
    );
    expect(requested).not.toContain("elsewhere.example");
    expect(requested).not.toContain("www.partner.example");
  });

  it("reaches a configured host on the user's network only when the connection opts in", async () => {
    const manifest = testManifest("lan", {
      permissions: {
        network: [
          {
            config: "url",
            reason: "The user's own server.",
            private_network_opt_in: "allow_private_network",
          },
        ],
      },
    });
    const answer: FetchLike = () => Promise.resolve(new Response("{}", { status: 200 }));
    const clock = new FakeClock();
    const http = (config: Record<string, unknown>) =>
      coreHttp(
        { limits: {} },
        networkAllowList(manifest, config),
        new HostLimiter(clock, () => Promise.resolve()),
        clock,
        answer,
      );
    const url = new URL("http://192.168.2.20:8080/api/parcel/1");
    await expect(http({ url: "http://192.168.2.20:8080/api" }).request(url)).rejects.toThrow(
      "non-public",
    );
    await expect(
      http({ url: "http://192.168.2.20:8080/api", allow_private_network: true }).request(url),
    ).resolves.toMatchObject({ status: 200 });
    // The opt-in covers that one host, never another inward address.
    await expect(
      http({ url: "http://192.168.2.20:8080/api", allow_private_network: true }).request(
        new URL("http://192.168.2.21/"),
      ),
    ).rejects.toThrow();
  });

  it("lets a burst through, then paces requests per host", async () => {
    const { http, waits } = setup(ok);
    const url = new URL("https://carrier.example.invalid/api");
    await http.request(url);
    await http.request(url);
    await http.request(url);
    await http.request(url);
    expect(waits).toEqual([1000, 1000]);
    await http.request(new URL("https://other.example.invalid/"));
    expect(waits).toEqual([1000, 1000]);
  });

  it("sends an honest User-Agent unless the provider documents why it needs another", async () => {
    const seen: (string | null)[] = [];
    const capture: FetchLike = (_url, init) => {
      seen.push(new Headers(init.headers).get("user-agent"));
      return Promise.resolve(new Response("ok"));
    };
    await setup(capture).http.request(new URL("https://a.example.invalid/"));
    await setup(capture, {
      value: "Browser/1",
      reason: "resets connections otherwise",
    }).http.request(new URL("https://a.example.invalid/"));
    expect(seen).toEqual([userAgent(), "Browser/1"]);
  });

  it("turns 429 and 503 with Retry-After into RateLimitedError", async () => {
    const limited: FetchLike = () =>
      Promise.resolve(new Response("", { status: 429, headers: { "retry-after": "120" } }));
    await expect(
      setup(limited).http.request(new URL("https://a.example.invalid/")),
    ).rejects.toMatchObject({ name: "RateLimitedError", retryAfterSeconds: 120 });
    const busy: FetchLike = () =>
      Promise.resolve(new Response("", { status: 503, headers: { "retry-after": "30" } }));
    await expect(
      setup(busy).http.request(new URL("https://a.example.invalid/")),
    ).rejects.toBeInstanceOf(RateLimitedError);
    const plain503: FetchLike = () => Promise.resolve(new Response("down", { status: 503 }));
    await expect(
      setup(plain503).http.request(new URL("https://a.example.invalid/")),
    ).resolves.toMatchObject({ status: 503 });
  });

  it("leaves a host alone for the pause it asked for, across every client of the limiter", async () => {
    const hosts: string[] = [];
    let status = 429;
    const answer: FetchLike = (url) => {
      hosts.push(url.hostname);
      return Promise.resolve(
        url.hostname === "busy.example.invalid"
          ? new Response("", { status, headers: { "retry-after": "120" } })
          : new Response("ok"),
      );
    };
    const { http, clock, limiter } = setup(answer);
    // A second connection of the same carrier shares the limiter.
    const other = coreHttp(
      { limits: { "*": { intervalMs: 1000, burst: 2 } } },
      ANY_HOST,
      limiter,
      clock,
      answer,
    );
    const busy = new URL("https://busy.example.invalid/");
    await expect(http.request(busy)).rejects.toMatchObject({ retryAfterSeconds: 120 });
    await expect(other.request(busy)).rejects.toMatchObject({
      name: "RateLimitedError",
      retryAfterSeconds: 120,
    });
    clock.advance(60_000);
    await expect(http.request(busy)).rejects.toMatchObject({ retryAfterSeconds: 60 });
    // Nothing was sent during the pause; other hosts were never held up.
    await http.request(new URL("https://calm.example.invalid/"));
    expect(hosts).toEqual(["busy.example.invalid", "calm.example.invalid"]);
    clock.advance(61_000);
    status = 200;
    await expect(other.request(busy)).resolves.toMatchObject({ status: 200 });
  });

  it("pauses a host for a minute when it asks to slow down without saying how long", async () => {
    let sent = 0;
    const limited: FetchLike = () => {
      sent += 1;
      return Promise.resolve(new Response("", { status: 429, headers: { "retry-after": "0" } }));
    };
    const { http, clock } = setup(limited);
    const url = new URL("https://a.example.invalid/");
    await expect(http.request(url)).rejects.toBeInstanceOf(RateLimitedError);
    clock.advance(59_000);
    await expect(http.request(url)).rejects.toMatchObject({ retryAfterSeconds: 1 });
    expect(sent).toBe(1);
    clock.advance(1_000);
    await expect(http.request(url)).rejects.toBeInstanceOf(RateLimitedError);
    expect(sent).toBe(2);
  });

  it("wraps network failures as transient errors", async () => {
    const broken: FetchLike = () => Promise.reject(new TypeError("fetch failed"));
    await expect(
      setup(broken).http.request(new URL("https://a.example.invalid/")),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("refuses responses larger than the cap", async () => {
    const big: FetchLike = () => Promise.resolve(new Response("x".repeat(2048)));
    await expect(
      setup(big).http.request(new URL("https://a.example.invalid/"), { maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("keeps cookies across redirects and only follows allowed hosts", async () => {
    const seenCookies: (string | null)[] = [];
    const site: FetchLike = (url, init) => {
      seenCookies.push(new Headers(init.headers).get("cookie"));
      if (url.pathname === "/login") {
        return Promise.resolve(
          new Response("", {
            status: 302,
            headers: {
              location: "https://www.example.invalid/home",
              "set-cookie": "session=abc; Path=/; Domain=example.invalid; Secure",
            },
          }),
        );
      }
      if (url.pathname === "/leave") {
        return Promise.resolve(
          new Response("", { status: 302, headers: { location: "https://evil.invalid/" } }),
        );
      }
      return Promise.resolve(new Response("welcome"));
    };
    const jar = new CookieJar();
    const result = await setup(site).http.request(new URL("https://login.example.invalid/login"), {
      jar,
      method: "POST",
      body: "x=1",
    });
    expect(result).toMatchObject({
      status: 200,
      body: "welcome",
      url: "https://www.example.invalid/home",
    });
    expect(seenCookies).toEqual([null, "session=abc"]);
    await expect(
      setup(site).http.request(new URL("https://www.example.invalid/leave"), { jar }),
    ).rejects.toBeInstanceOf(TransientError);
    // The jar survives a round trip through the session store format.
    expect(
      await restoreJar(serializeJar(jar)).getCookieString("https://www.example.invalid/"),
    ).toBe("session=abc");
    expect(await restoreJar("garbage").getCookieString("https://www.example.invalid/")).toBe("");
  });

  it("follows redirects itself, refusing non-public hops and endless chains (OP-002)", async () => {
    const seen: string[] = [];
    const site: FetchLike = (url, init) => {
      seen.push(`${url.toString()} ${String(init.redirect)}`);
      const to: Record<string, string> = {
        "/inward": "https://192.168.0.10/admin",
        "/loop": "https://a.example.invalid/loop",
      };
      const location = to[url.pathname];
      return Promise.resolve(
        location === undefined
          ? new Response("done")
          : new Response("", { status: 302, headers: { location } }),
      );
    };
    const { http } = setup(site);
    await expect(http.request(new URL("https://a.example.invalid/inward"))).rejects.toThrow(
      "non-public",
    );
    expect(seen).toEqual(["https://a.example.invalid/inward manual"]);
    await expect(http.request(new URL("https://a.example.invalid/loop"))).rejects.toThrow(
      "Too many redirects",
    );
  });

  it("does not send credentials on to another host (OP-105)", async () => {
    const sent: Record<string, string | null>[] = [];
    const site: FetchLike = (url, init) => {
      const headers = new Headers(init.headers);
      sent.push({
        host: url.host,
        authorization: headers.get("authorization"),
        csrf: headers.get("x-csrf-token"),
        accept: headers.get("accept"),
      });
      return Promise.resolve(
        url.host === "a.example.invalid"
          ? new Response("", { status: 302, headers: { location: "https://b.example.invalid/" } })
          : new Response("ok"),
      );
    };
    await setup(site).http.request(new URL("https://a.example.invalid/"), {
      headers: { authorization: "Bearer made-up", "x-csrf-token": "made-up", accept: "text/html" },
    });
    expect(sent).toEqual([
      {
        host: "a.example.invalid",
        authorization: "Bearer made-up",
        csrf: "made-up",
        accept: "text/html",
      },
      { host: "b.example.invalid", authorization: null, csrf: null, accept: "text/html" },
    ]);
  });

  it("refuses at connect time a name that resolves to a non-public address (OP-002)", async () => {
    const error = await new Promise<Error | null>((resolve) => {
      publicOnlyLookup("localhost", {}, (failure) => {
        resolve(failure);
      });
    });
    expect(error?.message).toMatch(/non-public/);

    // The default transport of provider HTTP uses it: a server on this machine is never reached.
    let reached = false;
    const server = createServer((_request, response) => {
      reached = true;
      response.end("inside");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      await expect(
        guardedFetch(new URL(`http://localhost:${port}/`), { method: "GET" }),
      ).rejects.toThrow();
      expect(reached).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("parses Retry-After as seconds or as an HTTP date", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    expect(parseRetryAfter("90", now)).toBe(90);
    expect(parseRetryAfter("Wed, 18 Nov 2026 12:02:00 GMT", now)).toBe(120);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});
