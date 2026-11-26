import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  deleteApiV1ProvidersKindId,
  getApiV1ProvidersAvailable,
  getApiV1ProvidersInstalled,
  patchApiV1ProvidersKindId,
  postApiV1ProvidersCheck,
  postApiV1ProvidersInstall,
  type GetApiV1ProvidersAvailableSource,
  type PostApiV1ProvidersCheckBody,
  type PostApiV1ProvidersInstallBody,
} from "./generated";
import type { InstallKind } from "./types";

/** The Providers page's queries: installed and available items, checking and installing. */

const installKeys = {
  installed: ["installs", "installed"] as const,
  available: (source: string) => ["installs", "available", source] as const,
};

export function useInstalledItems() {
  return useQuery({
    queryKey: installKeys.installed,
    queryFn: ({ signal }) => getApiV1ProvidersInstalled({ signal }),
  });
}

export function useAvailableItems(source: GetApiV1ProvidersAvailableSource, enabled: boolean) {
  return useQuery({
    queryKey: installKeys.available(source),
    queryFn: ({ signal }) => getApiV1ProvidersAvailable({ source }, { signal }),
    enabled,
  });
}

/** A changed install also changes the themes the Settings page offers. */
async function invalidate(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ["installs"] }),
    client.invalidateQueries({ queryKey: ["themes"] }),
  ]);
}

export function useRefreshAvailable() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (source: GetApiV1ProvidersAvailableSource) =>
      getApiV1ProvidersAvailable({ source, refresh: "true" }),
    onSuccess: (data, source) => {
      client.setQueryData(installKeys.available(source), data);
    },
  });
}

export function useCheckRepository() {
  return useMutation({
    mutationFn: (body: PostApiV1ProvidersCheckBody) => postApiV1ProvidersCheck(body),
  });
}

export function useInstallItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PostApiV1ProvidersInstallBody) => postApiV1ProvidersInstall(body),
    onSuccess: () => invalidate(client),
  });
}

export function useSetAutoUpdate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: InstallKind; id: string; on: boolean }) =>
      patchApiV1ProvidersKindId(input.kind, input.id, { auto_update: input.on }),
    onSuccess: () => invalidate(client),
  });
}

export function useUninstallItem() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: InstallKind; id: string }) =>
      deleteApiV1ProvidersKindId(input.kind, input.id),
    onSuccess: () => invalidate(client),
  });
}
