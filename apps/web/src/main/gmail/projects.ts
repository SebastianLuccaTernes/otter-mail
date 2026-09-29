/**
 * Projects (contracts' projects.ts): the backend's channels and the hooks
 * the sidebar, the list and the project page read them with. A project is
 * shown like a mailbox: its label id is `project:<id>`.
 */

import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type {
  Project,
  ProjectDocument,
  ProjectLink,
  ProjectStatus,
  ProjectThread,
} from "@otter-mail/contracts/projects";

import { setSyncedPreference } from "../synced-preferences";
import type { GmailMessageSummary } from "./types";

export type { Project, ProjectDocument, ProjectLink, ProjectThread };

const PREFIX = "project:";

/** The Projects page: every project, from the sidebar's Projects row. */
export const PROJECTS_LABEL = "projects";

export const projectLabelId = (id: string) => `${PREFIX}${id}`;

/** The project a label id shows, or null for a mailbox. */
export const projectIdOf = (labelId: string): string | null =>
  labelId.startsWith(PREFIX) ? labelId.slice(PREFIX.length) : null;

const ipc = <T>(channel: string, params?: unknown): Promise<T> =>
  window.desktopBridge.invoke<T>(channel, params);

/** A long call: acknowledged at once, answered as `task:done` (api.ts' `task`). */
const task = <T>(channel: string, params: Record<string, unknown>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const taskId = crypto.randomUUID();
    const off = window.desktopBridge.on("task:done", (payload: unknown) => {
      const p = payload as { taskId?: string; result?: T; error?: string } | undefined;
      if (p?.taskId !== taskId) return;
      off();
      if (p.error) reject(new Error(p.error));
      else resolve(p.result as T);
    });
    ipc(channel, { ...params, taskId }).catch((err: unknown) => {
      off();
      reject(err);
    });
  });

export type ProjectThreadsResult = { messages: GmailMessageSummary[]; missing: ProjectThread[] };

export const projectsApi = {
  list: () => ipc<Project[]>("projects:list"),
  create: (name: string, threads: { accountId: string; threadId: string }[] = []) =>
    ipc<Project>("projects:create", { name, threads }),
  update: (id: string, patch: { name?: string; notes?: string; status?: ProjectStatus }) =>
    ipc<Project>("projects:update", { id, ...patch }),
  delete: (id: string) => ipc<void>("projects:delete", { id }),
  addThreads: (id: string, threads: { accountId: string; threadId: string }[]) =>
    ipc<Project>("projects:addThreads", { id, threads }),
  removeThread: (id: string, email: string, threadId: string) =>
    ipc<Project>("projects:removeThread", { id, email, threadId }),
  addLink: (id: string, url: string, title?: string) =>
    ipc<ProjectLink>("projects:addLink", { id, url, title }),
  removeLink: (id: string, linkId: string) => ipc<Project>("projects:removeLink", { id, linkId }),
  threads: (id: string) => ipc<ProjectThreadsResult>("projects:threads", { id }),
  documents: (id: string) => task<ProjectDocument[]>("projects:documents", { id }),
  unreadCounts: () => ipc<Record<string, number>>("projects:unreadCounts"),
};

const KEY = ["projects"] as const;
/** Under gmail:, so mail changes refresh it with the other lists (hooks.ts). */
const THREADS_KEY = "gmail:projectThreads";

/** Every project, newest change first; kept current by `projects:changed`. */
export function useProjects() {
  const qc = useQueryClient();
  useEffect(
    () =>
      window.desktopBridge.on("projects:changed", () => {
        void qc.invalidateQueries({ queryKey: KEY });
        void qc.invalidateQueries({ queryKey: [THREADS_KEY] });
      }),
    [qc],
  );
  return useQuery({ queryKey: [...KEY, "list"], queryFn: projectsApi.list, staleTime: 30_000 });
}

export function useProject(id: string | null): Project | null {
  const { data } = useProjects();
  return (id && data?.find((p) => p.id === id)) || null;
}

export function useProjectUnreadCounts() {
  return useQuery({
    queryKey: [THREADS_KEY, "unread"],
    queryFn: projectsApi.unreadCounts,
    staleTime: 10_000,
  });
}

/** The project's conversations as one page of list rows (the list's data shape). */
export function useProjectThreads(id: string | null) {
  return useInfiniteQuery<
    ProjectThreadsResult,
    Error,
    InfiniteData<ProjectThreadsResult>,
    readonly [string, string],
    undefined
  >({
    queryKey: [THREADS_KEY, id ?? ""] as const,
    queryFn: () => projectsApi.threads(id!),
    initialPageParam: undefined,
    getNextPageParam: () => undefined,
    enabled: id != null,
    staleTime: 10_000,
  });
}

export function useProjectDocuments(id: string | null, threadCount: number) {
  return useQuery({
    // New conversations can bring new documents.
    queryKey: [...KEY, "documents", id, threadCount],
    queryFn: () => projectsApi.documents(id!),
    enabled: id != null,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

/** "12 kB", "1.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const FAVORITES = "gmail:favorites";

function readFavorites(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES) ?? "[]") as unknown;
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** The projects pinned to the sidebar's Favorites (synced with the account), in pin order. */
export function useFavoriteProjects() {
  const [ids, setIds] = useState(readFavorites);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === FAVORITES) setIds(readFavorites());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const save = (next: string[]) => {
    setSyncedPreference(FAVORITES, JSON.stringify(next));
    setIds(next);
    // Other components holding the hook follow too.
    window.dispatchEvent(new StorageEvent("storage", { key: FAVORITES }));
  };
  return {
    ids,
    isFavorite: (id: string) => ids.includes(id),
    toggle: (id: string) => save(ids.includes(id) ? ids.filter((f) => f !== id) : [...ids, id]),
  };
}
