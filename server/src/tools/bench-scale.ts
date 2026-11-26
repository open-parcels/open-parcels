/**
 * Measures the main read endpoints against a database filled by `seed-scale` (docs/performance.md).
 *
 * Usage, from `server/` after `npm run build`, with the same OPENPARCELS_* environment as the seed:
 *   OPENPARCELS_BENCH_TOKEN=<token printed by seed-scale> node dist/tools/bench-scale.js [--runs 30]
 * Starts the server (`dist/main.js`) as a child, waits until it is ready, asks every endpoint
 * `runs` times one after another, and prints p50/p95/max per endpoint and the server's memory
 * (resident set) before and after. Run it without network access: the seeded connections are
 * made up, and a server that cannot reach a carrier only logs network errors.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runTool, type ToolMain } from "./cli.js";

const DAY = 86_400_000;

function endpoints(now: number): readonly (readonly [string, string])[] {
  const from = new Date(now - 14 * DAY).toISOString();
  const to = new Date(now + 28 * DAY).toISOString();
  return [
    ["parcels, first page (100)", "/api/v1/parcels?limit=100"],
    ["parcels, web UI page (200)", "/api/v1/parcels?active=true&limit=200"],
    [
      "parcels + archived, search and sort by name",
      "/api/v1/parcels?include_archived=true&q=SC00000&sort=name&limit=200",
    ],
    [
      "parcels + archived, sort by expected, page at 4000",
      "/api/v1/parcels?include_archived=true&sort=-expected&limit=200&offset=4000",
    ],
    ["parcel counts", "/api/v1/parcels/counts"],
    [
      "parcels + archived, page at 5000",
      "/api/v1/parcels?include_archived=true&limit=100&offset=5000",
    ],
    ["parcels, status filter", "/api/v1/parcels?status=in_transit&limit=100"],
    [
      "parcels + archived, carrier filter",
      "/api/v1/parcels?include_archived=true&carrier=dhl&limit=100",
    ],
    ["parcels, active (map)", "/api/v1/parcels?active=true&limit=1000"],
    ["orders, open (100)", "/api/v1/orders?limit=100"],
    ["orders, web UI page (500)", "/api/v1/orders?limit=500"],
    ["orders, all, page at 2000", "/api/v1/orders?view=all&limit=100&offset=2000"],
    ["returns, open", "/api/v1/returns"],
    ["calendar, six weeks", `/api/v1/calendar?from=${from}&to=${to}`],
    ["status", "/api/v1/status"],
    ["sync from the start", "/api/v1/sync"],
    ["sync since a cursor", "/api/v1/sync?since=50000"],
  ];
}

function residentMb(pid: number): { rss: number; peak: number } {
  const status = readFileSync(`/proc/${String(pid)}/status`, "utf8");
  const kb = (field: string) => Number(new RegExp(`${field}:\\s+(\\d+)`).exec(status)?.[1] ?? 0);
  return { rss: Math.round(kb("VmRSS") / 1024), peak: Math.round(kb("VmHWM") / 1024) };
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

async function ready(base: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const ok = await fetch(`${base}/api/v1/health/ready`).then(
      (response) => response.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The server did not get ready within 60 s.");
}

/** `runs` timed calls after two unmeasured ones (as on a running server, statements are warm). */
async function measure(
  url: string,
  token: string,
  runs: number,
): Promise<{ times: number[]; bytes: number }> {
  const times: number[] = [];
  let bytes = 0;
  for (let n = 0; n < runs + 2; n += 1) {
    const start = performance.now();
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const body = await response.arrayBuffer();
    if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
    if (n >= 2) times.push(performance.now() - start);
    bytes = body.byteLength;
  }
  return { times: times.sort((a, b) => a - b), bytes };
}

export const main: ToolMain = async (argv, output) => {
  const { values } = parseArgs({ args: [...argv], options: { runs: { type: "string" } } });
  const runs = Number(values.runs ?? 30);
  const token = process.env["OPENPARCELS_BENCH_TOKEN"];
  if (token === undefined) throw new Error("Set OPENPARCELS_BENCH_TOKEN (printed by seed-scale).");
  const port = process.env["OPENPARCELS_PORT"] ?? "3000";
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["dist/main.js"], {
    env: { ...process.env, OPENPARCELS_HOST: "127.0.0.1", OPENPARCELS_LOG_LEVEL: "warn" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    await ready(base);
    const pid = server.pid ?? 0;
    const before = residentMb(pid);
    output.out(`server memory after start: ${String(before.rss)} MB\n`);
    output.out("endpoint | p50 ms | p95 ms | max ms | KB\n");
    for (const [name, path] of endpoints(Date.now())) {
      const { times, bytes } = await measure(`${base}${path}`, token, runs);
      const row = [percentile(times, 50), percentile(times, 95), times.at(-1) ?? 0].map((ms) =>
        ms.toFixed(0),
      );
      output.out(`${name} | ${row.join(" | ")} | ${String(Math.round(bytes / 1024))}\n`);
    }
    const after = residentMb(pid);
    output.out(
      `server memory after the runs: ${String(after.rss)} MB (peak ${String(after.peak)} MB)\n`,
    );
  } finally {
    server.kill("SIGTERM");
  }
};

if (import.meta.main) {
  runTool("Measuring failed", main);
}
