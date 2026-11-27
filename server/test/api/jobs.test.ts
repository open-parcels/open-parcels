import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/api/app.js";
import {
  PageChangedError,
  RateLimitedError,
  SignInRejectedError,
  TransientError,
} from "../../src/provider/api.js";
import { fakeJobs, JobWorld } from "../fakes/jobs.js";
import { createTestContext, signIn, type TestContext } from "../helpers.js";

interface JobBody {
  id: string;
  state: string;
  reason: string | null;
  progress: { done: number | null; total: number | null; phase: string | null };
  summary: string | null;
  resume_at: string | null;
}

let context: TestContext;
let app: App;
let world: JobWorld;
let headers: Record<string, string>;

beforeEach(async () => {
  world = new JobWorld();
  context = await createTestContext({ providers: [fakeJobs(world)], fetchImpl: world.fetch });
  app = await context.app();
  const session = await signIn(context, app);
  headers = { cookie: session.cookie, "x-csrf-token": session.csrf };
});

afterEach(async () => {
  world.release();
  await context.services.jobs.settled();
  await context.close();
});

async function connection(config: Record<string, unknown> = {}): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/connections",
    headers,
    payload: { provider: "fakejobs", kind: "account", label: "Jobs", config },
  });
  return response.json<{ id: string }>().id;
}

function post(url: string, payload: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url, headers, payload });
}

async function start(id: string, action = "walk", input?: unknown): Promise<JobBody> {
  const response = await post(
    `/api/v1/connections/${id}/actions/${action}`,
    input === undefined ? {} : { input },
  );
  expect(response.statusCode).toBe(202);
  return response.json<{ job: JobBody }>().job;
}

async function job(id: string): Promise<JobBody> {
  await context.services.jobs.settled();
  return (await app.inject({ method: "GET", url: `/api/v1/jobs/${id}`, headers })).json<JobBody>();
}

async function outboxTypes(): Promise<string[]> {
  const rows = await context.services.db
    .selectFrom("outbox")
    .select("type")
    .where("type", "like", "job.%")
    .orderBy("seq")
    .execute();
  return rows.map((row) => row.type);
}

async function trackingNumbers(): Promise<string[]> {
  const rows = await context.services.db
    .selectFrom("parcels")
    .select("tracking_number")
    .orderBy("tracking_number")
    .execute();
  return rows.map((row) => row.tracking_number);
}

describe("connection actions", () => {
  it("lists the provider's actions with their input and the connection's with availability", async () => {
    const carriers = (await app.inject({ method: "GET", url: "/api/v1/carriers", headers })).json<
      { id: string; actions: { id: string; kind: string; input_required: boolean }[] }[]
    >();
    const actions = carriers.find((carrier) => carrier.id === "fakejobs")?.actions ?? [];
    expect(actions.map((a) => [a.id, a.kind, a.input_required])).toEqual([
      ["walk", "task", false],
      ["fetch", "task", false],
      ["rest", "task", false],
      ["needs_input", "task", true],
      ["open", "link", false],
    ]);
    const id = await connection({ host: "shop.example.com" });
    const own = await app.inject({
      method: "GET",
      url: `/api/v1/connections/${id}/actions`,
      headers,
    });
    expect(own.json<{ id: string; available: boolean }[]>().map((a) => a.available)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("answers a link with its address, only on the hosts the manifest allows", async () => {
    const good = await post(
      `/api/v1/connections/${await connection({ host: "shop.example.com" })}/actions/open`,
    );
    expect(good.statusCode).toBe(200);
    expect(good.json()).toEqual({ url: "https://shop.example.com/orders" });
    const bad = await post(
      `/api/v1/connections/${await connection({ host: "evil.invalid" })}/actions/open`,
    );
    expect(bad.statusCode).toBe(409);
    expect(bad.json()).toMatchObject({ error: "action_unavailable" });
    expect((await post(`/api/v1/connections/${await connection()}/actions/nope`)).statusCode).toBe(
      404,
    );
  });

  it("refuses input that does not fit the action", async () => {
    const id = await connection();
    const response = await post(`/api/v1/connections/${id}/actions/needs_input`, {});
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_input" });
    expect((await start(id, "needs_input", { year: 2024 })).state).toBe("queued");
  });
});

describe("jobs", () => {
  it("runs a task as a job: results as it goes, progress, summary and live events", async () => {
    const id = await connection();
    const started = await start(id, "walk", { pages: 3 });
    const done = await job(started.id);
    expect(done).toMatchObject({ state: "done", summary: "3 pages", reason: null });
    expect(done.progress).toEqual({ done: 3, total: 3, phase: "page 3" });
    expect(await trackingNumbers()).toEqual(["JOB0000", "JOB0001", "JOB0002"]);
    expect(await outboxTypes()).toEqual([
      "job.queued",
      "job.started",
      "job.progress",
      "job.finished",
    ]);
    const listed = await app.inject({
      method: "GET",
      url: `/api/v1/jobs?connection_id=${id}`,
      headers,
    });
    expect(listed.json<JobBody[]>().map((entry) => entry.id)).toEqual([started.id]);
  });

  it("allows one job per connection and keeps a cooldown after a finished one", async () => {
    const id = await connection();
    const held = world.hold();
    await start(id);
    await held;
    const second = await post(`/api/v1/connections/${id}/actions/rest`);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: "job_running" });
    world.release();
    await context.services.jobs.settled();
    const again = await post(`/api/v1/connections/${id}/actions/walk`);
    expect(again.statusCode).toBe(429);
    expect(again.headers["retry-after"]).toBe("3600");
    context.clock.advance(61 * 60_000);
    expect((await start(id)).state).toBe("queued");
  });

  it("cancels a running job at its next page and keeps what it emitted", async () => {
    const id = await connection();
    const held = world.hold();
    const started = await start(id, "walk", { pages: 5 });
    await held;
    const cancelled = await post(`/api/v1/jobs/${started.id}/cancel`);
    expect(cancelled.statusCode).toBe(200);
    world.release();
    expect(await job(started.id)).toMatchObject({
      state: "cancelled",
      summary: "stopped at page 0",
    });
    const resumed = await post(`/api/v1/jobs/${started.id}/resume`);
    expect(resumed.json<JobBody>().state).toBe("queued");
    expect((await job(started.id)).state).toBe("done");
    expect(world.pages).toEqual([0, 1, 2, 3, 4]);
  });

  it("drops a request in flight on cancel and refuses the next one at once", async () => {
    const id = await connection();
    const seen = world.requestSeen();
    const started = await start(id, "fetch");
    await seen;
    expect((await post(`/api/v1/jobs/${started.id}/cancel`)).statusCode).toBe(200);
    // Recorded as cancelled by the job's own end, not by the 30 s grace running out.
    expect(await job(started.id)).toMatchObject({ state: "cancelled", summary: "stopped" });
    expect(world.requested).toEqual(["/slow"]);
    expect(world.failures).toEqual(["HopAbortedError", "HopAbortedError"]);
  });

  it("pauses on a rate limit and resumes on its own from the checkpoint", async () => {
    const id = await connection();
    world.script = [undefined, new RateLimitedError("slow down", 120)];
    const started = await start(id);
    const paused = await job(started.id);
    expect(paused).toMatchObject({ state: "paused", reason: "rate_limited" });
    expect(Date.parse(paused.resume_at ?? "")).toBe(context.clock.now().getTime() + 120_000);
    context.clock.advance(121_000);
    context.services.jobs.wake();
    expect((await job(started.id)).state).toBe("done");
    expect(world.pages).toEqual([0, 1, 2]);
    expect(await outboxTypes()).toContain("job.paused");
  });

  it("fails with page_changed when a page changed its shape, keeping the checkpoint", async () => {
    const id = await connection();
    world.script = [undefined, new PageChangedError("no years")];
    const started = await start(id);
    expect(await job(started.id)).toMatchObject({ state: "failed", reason: "page_changed" });
    world.script = [];
    await post(`/api/v1/jobs/${started.id}/resume`);
    expect((await job(started.id)).state).toBe("done");
    expect(world.pages).toEqual([0, 1, 2]);
  });

  it("waits for a sign-in by hand, never starting one, and retries transient failures", async () => {
    const id = await connection();
    world.script = [new SignInRejectedError("expired")];
    const started = await start(id);
    expect(await job(started.id)).toMatchObject({
      state: "paused",
      reason: "needs_sign_in",
      resume_at: null,
    });
    world.script = [new TransientError("503")];
    await post(`/api/v1/jobs/${started.id}/resume`);
    expect(await job(started.id)).toMatchObject({ state: "paused", reason: "retrying" });
    context.clock.advance(60_000);
    context.services.jobs.wake();
    expect((await job(started.id)).state).toBe("done");
  });

  it("rests between legs when the action asks, and starts over from nothing on restart", async () => {
    const id = await connection();
    const resting = await start(id, "rest");
    expect(await job(resting.id)).toMatchObject({
      state: "paused",
      reason: "resting",
      summary: "resting",
    });
    await post(`/api/v1/jobs/${resting.id}/cancel`);
    const walk = await start(id, "walk", { pages: 2 });
    expect((await job(walk.id)).state).toBe("done");
    context.clock.advance(61 * 60_000);
    const restarted = await post(`/api/v1/jobs/${walk.id}/restart`);
    expect(restarted.json<JobBody>()).toMatchObject({ state: "queued", progress: { done: null } });
    expect((await job(walk.id)).state).toBe("done");
    expect(world.pages).toEqual([0, 1, 0, 1]);
    expect((await post(`/api/v1/jobs/${walk.id}/resume`)).statusCode).toBe(409);
  });

  it("continues jobs a stopped server left running", async () => {
    const id = await connection();
    const started = await start(id, "rest");
    await context.services.jobs.settled();
    await context.services.db
      .updateTable("jobs")
      .set({ state: "running", reason: null, resume_at: null })
      .where("id", "=", started.id)
      .execute();
    await context.services.jobs.start();
    expect((await job(started.id)).reason).toBe("resting");
    context.services.jobs.stop();
  });
});
