import { mkdirSync } from "node:fs";
import { HealthWatch } from "./status/health-watch.js";
import { fileURLToPath } from "node:url";
import { buildApp, type App } from "./api/app.js";
import { HA_INGRESS_ADDRESS } from "./api/auth-plugin.js";
import { systemClock } from "./clock.js";
import { loadConfig } from "./config.js";
import { loadSecretKey, SecretBox } from "./crypto/secrets.js";
import { migrateToLatest, openDatabase } from "./db/database.js";
import { cleanupMailFalsePositives } from "./engine/mail-cleanup.js";
import { loadRules } from "open-parcels-rules";
import {
  announceToHomeAssistant,
  appOptionKeys,
  isSupervised,
  settingsTokenVault,
  supervisedEnvironment,
} from "./ha/supervisor.js";
import { createLogger, type Logger } from "./log/logger.js";
import { createServices, repairOnStart, type Services } from "./services.js";

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_MAINTENANCE_DELAY_MS = 60 * 1000;

/** A started server: its services, and the one way to stop it cleanly. */
export interface RunningServer {
  readonly services: Services;
  readonly logger: Logger;
  stop(): Promise<void>;
}

async function runMaintenance(services: Services): Promise<void> {
  const sessions = await services.auth.pruneExpiredSessions();
  const logins = await services.logins.pruneExpired();
  const tombstones = await services.sync.pruneTombstones();
  const events = await services.bus.pruneExpired();
  const images = await services.images.prune();
  const tiles = await services.tiles.prune();
  const collages = await services.collages.prune();
  const retention = await services.parcels.applyRetention(services.config.retention);
  const notifications = await services.notifications.prune();
  services.logger.debug(
    { sessions, logins, tombstones, events, images, tiles, collages, notifications, ...retention },
    "Maintenance finished.",
  );
}

/**
 * Opens the database, starts the API (and the Home Assistant ingress listener) and every background
 * service, in the order that keeps clients from seeing state a start-up repair is about to change.
 */
export async function startServer(processEnv: NodeJS.ProcessEnv): Promise<RunningServer> {
  const supervised = isSupervised(processEnv);
  const env = supervised ? supervisedEnvironment(processEnv) : processEnv;
  const config = loadConfig(env, supervised ? appOptionKeys(processEnv, env) : new Set());
  const logger = createLogger(config.logLevel);
  mkdirSync(config.dataDir, { recursive: true });

  const { db } = openDatabase(config.databasePath);
  const applied = await migrateToLatest(db);
  if (applied.length > 0) {
    logger.info({ migrations: applied }, "Database migrated.");
  }

  const { key, created } = loadSecretKey(config.secretKey, config.dataDir);
  if (created) {
    logger.warn(
      "Created a new encryption key in the data directory. Back it up together with the database.",
    );
  }

  const services = await createServices({
    config,
    db,
    logger,
    clock: systemClock,
    secrets: new SecretBox(key),
  });
  if (services.access.setupCode !== undefined) {
    logger.warn(
      `First start: open the web UI and enter the setup code ${services.access.setupCode} to set the admin password (or set OPENPARCELS_ADMIN_PASSWORD).`,
    );
  }

  // Before listening, so no client loads the state it is about to change.
  await repairOnStart(services);
  const cleanup = await cleanupMailFalsePositives(db, systemClock, loadRules());
  if (cleanup.ran) {
    logger.info(
      { archived: cleanup.archived, boilerplateItemsRemoved: cleanup.boilerplateItemsRemoved },
      "Mail false-positive cleanup finished.",
    );
    await services.bus.notify();
  }

  // server/dist/server.js → web/dist at the repository (or image) root.
  const webDir = config.webDir ?? fileURLToPath(new URL("../../web/dist", import.meta.url));
  const servers: App[] = [await buildApp(services, { webDir })];
  await servers[0]?.listen({ host: config.host, port: config.port });
  if (config.ingressPort !== undefined) {
    const ingress = await buildApp(services, {
      trustedIngressAddress: HA_INGRESS_ADDRESS,
      webDir,
    });
    await ingress.listen({ host: config.host, port: config.ingressPort });
    servers.push(ingress);
  }

  await services.reconciler.repair();
  await services.backups.secure().catch((error: unknown) => {
    logger.error({ err: error }, "Restricting the backup files' permissions failed.");
  });
  services.scheduler.start();
  await services.jobs.start();
  services.live.start();
  services.places.start();
  await services.mail.start();
  services.notifications.start();
  const health = new HealthWatch(services);
  health.start();

  const supervisorToken = processEnv["SUPERVISOR_TOKEN"];
  if (supervised && supervisorToken !== undefined) {
    announceToHomeAssistant({
      token: supervisorToken,
      auth: services.auth,
      vault: settingsTokenVault(services.db, services.secrets, services.clock),
      port: config.port,
      logger,
    }).catch((error: unknown) => {
      logger.warn(
        { err: error },
        "Announcing to Home Assistant failed; add the integration by hand.",
      );
    });
  }

  const maintain = (): void => {
    runMaintenance(services).catch((error: unknown) => {
      logger.error({ err: error }, "Maintenance failed.");
    });
    // On its own, so a failing clean-up never holds up a backup or the other way round.
    services.backups.runIfDue().catch((error: unknown) => {
      logger.error({ err: error }, "Checking for a due backup failed.");
    });
  };
  const maintenance = setInterval(maintain, MAINTENANCE_INTERVAL_MS);
  // Also once shortly after start: a server restarted more often than hourly would otherwise
  // never prune sessions, events and caches, apply retention or take a due backup.
  const firstMaintenance = setTimeout(maintain, FIRST_MAINTENANCE_DELAY_MS);

  return {
    services,
    logger,
    async stop() {
      clearInterval(maintenance);
      clearTimeout(firstMaintenance);
      services.scheduler.stop();
      services.jobs.stop();
      services.live.stop();
      services.places.stop();
      services.notifications.stop();
      services.providerPool?.stop();
      health.stop();
      await services.mail.stop();
      await Promise.all(servers.map((server) => server.close()));
      await db.destroy();
    },
  };
}
