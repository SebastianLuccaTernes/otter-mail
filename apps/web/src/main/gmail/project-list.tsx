/**
 * The Projects page, in the list pane (the sidebar's Projects row): every
 * project, the active ones first, the settled ones folded at the end.
 * Picking one opens it: its conversations here, its page next to them.
 */

import { useState, type ReactNode } from "react";
import {
  ChevronDownIcon,
  CircleCheckIcon,
  FolderIcon,
  FolderKanbanIcon,
  PlusIcon,
  StarIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { requestNewProject } from "./project-menus";
import { useFavoriteProjects, useProjectUnreadCounts, useProjects, type Project } from "./projects";
import { HintTooltip, IconBtn, UnreadPill, cn } from "./ui";

const SETTLED_OPEN_KEY = "gmail:projects:settled-open";

function ago(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

function ProjectRow({
  project,
  unread,
  favorite,
  onOpen,
}: {
  project: Project;
  unread: number;
  favorite: boolean;
  onOpen: () => void;
}) {
  const settled = project.status === "settled";
  const count = project.threads.length;
  return (
    <div className="px-1 py-px">
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left outline-none transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          {settled ? <CircleCheckIcon className="size-4" /> : <FolderIcon className="size-4" />}
        </span>
        <span className={cn("flex min-w-0 flex-1 flex-col gap-0.5", settled && "opacity-80")}>
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {project.name}
            </span>
            {favorite ? (
              <StarIcon className="size-3 shrink-0 fill-current text-muted-foreground" />
            ) : null}
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            {count} conversation{count === 1 ? "" : "s"} ·{" "}
            {settled && project.settledAt
              ? `settled ${ago(project.settledAt)}`
              : `updated ${ago(project.updatedAt)}`}
          </span>
        </span>
        {unread > 0 ? <UnreadPill count={unread} /> : null}
      </button>
    </div>
  );
}

export function ProjectList({
  headerLeading,
  onOpenProject,
}: {
  headerLeading?: ReactNode;
  onOpenProject: (id: string) => void;
}) {
  const projects = useProjects();
  const unread = useProjectUnreadCounts().data ?? {};
  const favorites = useFavoriteProjects();
  const [settledOpen, setSettledOpen] = useState(
    () => localStorage.getItem(SETTLED_OPEN_KEY) === "1",
  );
  const all = projects.data ?? [];
  const active = all.filter((p) => p.status === "active");
  const settled = all
    .filter((p) => p.status === "settled")
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0));
  const row = (project: Project) => (
    <ProjectRow
      key={project.id}
      project={project}
      unread={unread[project.id] ?? 0}
      favorite={favorites.isFavorite(project.id)}
      onOpen={() => onOpenProject(project.id)}
    />
  );

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      <div className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-1 px-4">
        {headerLeading}
        <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {active.length === 1 ? "1 active project" : `${active.length} active projects`}
        </div>
        <HintTooltip label="New project">
          <IconBtn label="New project" onClick={() => requestNewProject({ open: true })}>
            <PlusIcon className="size-4" />
          </IconBtn>
        </HintTooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-1 pt-[9px] [scrollbar-gutter:stable_both-edges]">
        {projects.isSuccess && all.length === 0 ? (
          <EmptyState
            className="h-full px-8"
            media={<FolderKanbanIcon className="size-10 stroke-[1.25] text-muted-foreground" />}
            title="No projects yet"
            description="A project keeps a piece of work's conversations, from any mailbox, with its documents, links and notes, until it's settled."
            actions={
              <Button variant="accent" onClick={() => requestNewProject({ open: true })}>
                New project
              </Button>
            }
          />
        ) : (
          <>
            {active.map(row)}
            {settled.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setSettledOpen((open) => {
                      localStorage.setItem(SETTLED_OPEN_KEY, open ? "0" : "1");
                      return !open;
                    })
                  }
                  aria-expanded={settledOpen}
                  className="mx-1 mt-3 flex h-8 w-[calc(100%-0.5rem)] items-center gap-1.5 rounded-lg px-3 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  <span className="flex-1 text-left">Settled</span>
                  <span className="tabular-nums">{settled.length}</span>
                  <ChevronDownIcon
                    className={cn("size-3.5 transition-transform", !settledOpen && "-rotate-90")}
                  />
                </button>
                {settledOpen ? settled.map(row) : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
