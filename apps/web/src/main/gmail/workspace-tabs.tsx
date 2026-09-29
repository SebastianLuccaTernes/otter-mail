/**
 * Workspaces as browser tabs, across the top of the window: Mail (every
 * mailbox, as always), then a tab per open project, above any one mailbox.
 * Which projects are open is this device's (like a browser's tabs); closing
 * a tab keeps the project, and the Projects menu opens any of them again.
 */

import { useState, type DragEvent } from "react";
import {
  CheckIcon,
  CircleCheckIcon,
  FolderIcon,
  FolderOpenIcon,
  InboxIcon,
  LayoutGridIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";

import { Dialog } from "~/components/ui/dialog";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./menu";
import { requestNewProject } from "./project-menus";
import { projectsApi, useProjectUnreadCounts, useProjects, type Project } from "./projects";
import { isThreadDrag, readThreadDrag } from "./thread-drag";
import { toast } from "./toast";
import { HintTooltip, UnreadPill, cn } from "./ui";

/** The Mail tab's id; a project's tab is its id. */
export const MAIL_TAB = "mail";

const OPEN_KEY = "gmail:workspace-tabs";

function loadOpen(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as unknown;
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** The projects open as tabs, in tab order. */
export function useOpenProjectTabs() {
  const [open, setOpenState] = useState(loadOpen);
  const setOpen = (next: string[]) => {
    localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    setOpenState(next);
  };
  return {
    open,
    add: (id: string) => {
      if (!open.includes(id)) setOpen([...open, id]);
    },
    remove: (id: string) => setOpen(open.filter((t) => t !== id)),
  };
}

const TAB =
  "no-drag group/tab relative flex h-8 min-w-0 shrink items-center gap-2 rounded-lg px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring";

function Tab({
  icon,
  title,
  active,
  unread,
  onSelect,
  onClose,
  onDropThreads,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  active: boolean;
  unread?: number;
  onSelect: () => void;
  onClose?: () => void;
  onDropThreads?: (threads: { accountId: string; threadId: string }[]) => void;
  className?: string;
}) {
  const [dropActive, setDropActive] = useState(false);
  const drop = onDropThreads
    ? {
        onDragOver: (e: DragEvent) => {
          if (!isThreadDrag(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropActive(true);
        },
        onDragLeave: () => setDropActive(false),
        onDrop: (e: DragEvent) => {
          setDropActive(false);
          const payload = readThreadDrag(e.dataTransfer);
          if (!payload) return;
          e.preventDefault();
          onDropThreads(payload.threads);
        },
      }
    : {};
  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
      onAuxClick={(e) => {
        // Middle-click closes, as in a browser.
        if (e.button === 1 && onClose) onClose();
      }}
      {...drop}
      className={cn(
        TAB,
        "max-w-60",
        active
          ? "border border-border/70 bg-canvas text-foreground shadow-[0_1px_2px_rgb(0_0_0/4%)]"
          : "border border-transparent text-sidebar-foreground/80 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        dropActive && "ring-1 ring-inset ring-primary/70",
        className,
      )}
    >
      <span className="flex shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {unread ? (
        <span className={cn(onClose && "group-hover/tab:hidden")}>
          <UnreadPill count={unread} />
        </span>
      ) : null}
      {onClose ? (
        <button
          type="button"
          aria-label={`Close ${title}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="-me-1 hidden size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground group-hover/tab:flex group-focus-within/tab:flex"
        >
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The tab strip, in the window's top band (the traffic lights and the pinned
 * sidebar and panel toggles keep their places at its ends).
 */
export function WorkspaceTabs({
  active,
  openIds,
  onSelect,
  onClose,
}: {
  /** MAIL_TAB or a project id. */
  active: string;
  openIds: string[];
  onSelect: (tab: string) => void;
  onClose: (projectId: string) => void;
}) {
  const projects = useProjects().data ?? [];
  const unread = useProjectUnreadCounts().data ?? {};
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const tabs = openIds.flatMap((id) => projects.filter((p) => p.id === id));
  const activeProjects = projects.filter((p) => p.status === "active");
  const settled = projects
    .filter((p) => p.status === "settled")
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0));

  const addThreads = (project: Project, threads: { accountId: string; threadId: string }[]) =>
    void projectsApi
      .addThreads(project.id, threads)
      .then(() =>
        toast.success(
          threads.length === 1
            ? `Added to “${project.name}”`
            : `Added ${threads.length} conversations to “${project.name}”`,
        ),
      )
      .catch(() => toast.error("Couldn't add to the project"));
  const setStatus = (project: Project, status: Project["status"]) =>
    void projectsApi
      .update(project.id, { status })
      .catch(() => toast.error("Couldn't change the project"));

  const projectItem = (project: Project) => (
    <DropdownMenuItem
      key={project.id}
      icon={
        openIds.includes(project.id) ? (
          <CheckIcon />
        ) : project.status === "settled" ? (
          <CircleCheckIcon />
        ) : (
          <FolderIcon />
        )
      }
      onSelect={() => onSelect(project.id)}
    >
      {project.name}
    </DropdownMenuItem>
  );

  return (
    <div
      role="tablist"
      aria-label="Workspaces"
      className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-1 pl-(--workspace-titlebar-content-left) pr-[calc(var(--workspace-controls-right)+var(--workspace-titlebar-control-size)+0.5rem)]"
    >
      <Tab
        icon={<InboxIcon className="size-4" />}
        title="Mail"
        active={active === MAIL_TAB}
        onSelect={() => onSelect(MAIL_TAB)}
        className="shrink-0"
      />
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
      {tabs.map((project) => (
        <ContextMenu key={project.id}>
          <ContextMenuTrigger>
            <Tab
              icon={
                project.status === "settled" ? (
                  <CircleCheckIcon className="size-4" />
                ) : active === project.id ? (
                  <FolderOpenIcon className="size-4" />
                ) : (
                  <FolderIcon className="size-4" />
                )
              }
              title={project.name}
              active={active === project.id}
              unread={project.status === "active" ? unread[project.id] : undefined}
              onSelect={() => onSelect(project.id)}
              onClose={() => onClose(project.id)}
              onDropThreads={(threads) => addThreads(project, threads)}
            />
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() => {
                setRenameValue(project.name);
                setRenameTarget(project);
              }}
            >
              Rename…
            </ContextMenuItem>
            {project.status === "settled" ? (
              <ContextMenuItem onSelect={() => setStatus(project, "active")}>
                Reopen project
              </ContextMenuItem>
            ) : (
              <ContextMenuItem onSelect={() => setStatus(project, "settled")}>
                Settle project
              </ContextMenuItem>
            )}
            <ContextMenuItem onSelect={() => onClose(project.id)}>Close tab</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem color="red" onSelect={() => setDeleteTarget(project)}>
              Delete project…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
      <HintTooltip label="New project" side="bottom">
        <button
          type="button"
          aria-label="New project"
          onClick={() => requestNewProject({ open: true })}
          className="no-drag flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <PlusIcon className="size-4" />
        </button>
      </HintTooltip>
      <span className="min-w-4 flex-1" />
      {projects.length > 0 ? (
        <DropdownMenu>
          <HintTooltip label="All projects" side="bottom">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="All projects"
                className="no-drag flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-sidebar-foreground/80 outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring data-[state=open]:bg-sidebar-row-hover"
              >
                <LayoutGridIcon className="size-4 text-sidebar-muted-foreground" />
                Projects
              </button>
            </DropdownMenuTrigger>
          </HintTooltip>
          <DropdownMenuContent align="end" className="max-h-[70vh] w-64 overflow-y-auto">
            {activeProjects.map(projectItem)}
            {settled.length > 0 ? (
              <>
                {activeProjects.length > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel>Settled</DropdownMenuLabel>
                {settled.map(projectItem)}
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<PlusIcon />}
              onSelect={() => requestNewProject({ open: true })}
            >
              New project…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Dialog
        open={renameTarget != null}
        onOpenChange={(o) => {
          if (!o) setRenameTarget(null);
        }}
        title="Rename project"
        confirmLabel="Rename"
        confirmDisabled={!renameValue.trim()}
        onConfirm={async () => {
          if (!renameTarget) return;
          await projectsApi.update(renameTarget.id, { name: renameValue.trim() });
          setRenameTarget(null);
        }}
      >
        <Field label="Name" orientation="vertical">
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
        </Field>
      </Dialog>

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
        title="Delete project"
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          onClose(deleteTarget.id);
          await projectsApi.delete(deleteTarget.id);
          setDeleteTarget(null);
        }}
      >
        <Text variant="small">
          Delete “{deleteTarget?.name}” on every device? Its conversations stay in your mailboxes;
          its notes and links go. To keep it, settle it instead.
        </Text>
      </Dialog>
    </div>
  );
}
