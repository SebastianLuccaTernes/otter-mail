/**
 * A project's page, in the main pane while none of its conversations is
 * open: where it stands (its notes), its documents (its conversations'
 * attachments, with their versions), its links, and settling it. The
 * conversations themselves are the list next to it.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BotMessageSquareIcon,
  EllipsisIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  FileTextIcon,
  LinkIcon,
  PlusIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { Text } from "~/components/ui/text";
import { Input } from "~/components/ui/input";
import { gmailApi } from "./api";
import { useAccounts } from "./hooks";
import {
  formatSize,
  projectsApi,
  useProjectDocuments,
  useProjectThreads,
  type Project,
  type ProjectDocument,
} from "./projects";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./menu";
import { toast } from "./toast";
import { cn } from "./ui";

const date = (ms: number) =>
  new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(new Date(ms).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });

function Heading({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="mb-2 mt-8 flex h-7 items-center gap-2">
      <h2 className="flex-1 text-[13px] text-muted-foreground">{children}</h2>
      {trailing}
    </div>
  );
}

/** A card of rows, like the reader's attachments. */
const CARD = "overflow-hidden rounded-2xl border border-border/60 bg-card";
const ROW =
  "group flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left outline-none transition-colors hover:bg-accent-surface/60 focus-visible:bg-accent-surface/60";

/** The name, edited in place. */
function ProjectName({ project }: { project: Project }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.name);
  const save = () => {
    setEditing(false);
    const name = value.trim();
    if (name && name !== project.name) void projectsApi.update(project.id, { name });
    else setValue(project.name);
  };
  if (editing) {
    return (
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            e.stopPropagation();
            setValue(project.name);
            setEditing(false);
          }
        }}
        autoFocus
        className="w-full rounded-md bg-transparent text-2xl font-semibold tracking-tight text-foreground outline-none"
      />
    );
  }
  return (
    <h1
      onClick={() => {
        setValue(project.name);
        setEditing(true);
      }}
      title="Rename"
      className="cursor-text truncate text-2xl font-semibold tracking-tight text-foreground"
    >
      {project.name}
    </h1>
  );
}

/** The notes, saved as you pause; another device's (or the agent's) edit shows unless you're typing. */
function Notes({ project }: { project: Project }) {
  const [value, setValue] = useState(project.notes);
  const focused = useRef(false);
  const timer = useRef(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focused.current) setValue(project.notes);
  }, [project.notes]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  const save = (notes: string) => {
    window.clearTimeout(timer.current);
    if (notes !== project.notes) void projectsApi.update(project.id, { notes });
  };
  return (
    <textarea
      ref={ref}
      value={value}
      rows={3}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        save(value);
      }}
      onChange={(e) => {
        setValue(e.target.value);
        window.clearTimeout(timer.current);
        const notes = e.target.value;
        timer.current = window.setTimeout(() => save(notes), 800);
      }}
      placeholder="Where things stand: what's agreed, what's open, who's waiting on whom…"
      className="w-full resize-none rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm leading-relaxed text-foreground outline-none placeholder:text-placeholder focus-visible:border-focus-ring/60 focus-visible:ring-[3px] focus-visible:ring-focus-ring/16"
    />
  );
}

function DocumentRow({
  doc,
  open,
  onOpenMessage,
}: {
  doc: ProjectDocument;
  open: (version: ProjectDocument["versions"][number]) => void;
  onOpenMessage: (version: ProjectDocument["versions"][number]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const latest = doc.versions[0];
  const many = doc.versions.length > 1;
  return (
    <div>
      <div role="button" tabIndex={0} onClick={() => open(latest)} className={ROW}>
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-foreground">{latest.filename}</span>
          <span className="truncate text-xs text-muted-foreground">
            {latest.from} · {date(latest.date)} · {formatSize(latest.size)}
          </span>
        </span>
        {many ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((x) => !x);
            }}
            aria-expanded={expanded}
            className="flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground hover:bg-accent-surface hover:text-foreground"
          >
            {doc.versions.length} versions
            <ChevronRightIcon
              className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
            />
          </button>
        ) : null}
      </div>
      {expanded
        ? doc.versions.map((version, i) => (
            <div
              key={`${version.messageId}:${version.attachmentId}`}
              role="button"
              tabIndex={0}
              onClick={() => open(version)}
              className={cn(ROW, "py-1.5 pl-11")}
            >
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
                {version.filename}
                {i === 0 ? <span className="text-muted-foreground"> · latest</span> : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {version.from} · {date(version.date)}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenMessage(version);
                }}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground opacity-0 hover:bg-accent-surface hover:text-foreground group-hover:opacity-100"
              >
                Show email
              </button>
            </div>
          ))
        : null}
    </div>
  );
}

function Links({ project }: { project: Project }) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const add = async () => {
    const value = url.trim();
    if (!value) return;
    try {
      await projectsApi.addLink(project.id, /^[a-z]+:/i.test(value) ? value : `https://${value}`);
      setUrl("");
      setAdding(false);
    } catch {
      toast.error("That isn't a link");
    }
  };
  return (
    <>
      <Heading
        trailing={
          <Button size="small" variant="ghost" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add link
          </Button>
        }
      >
        Links
      </Heading>
      {adding ? (
        <form
          className="mb-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setAdding(false);
              }
            }}
            placeholder="https://docs.google.com/…"
            autoFocus
          />
          <Button type="submit" variant="accent" disabled={!url.trim()}>
            Add
          </Button>
        </form>
      ) : null}
      {project.links.length > 0 ? (
        <div className={CARD}>
          {project.links.map((link) => (
            <div
              key={link.id}
              role="button"
              tabIndex={0}
              onClick={() => void window.desktopBridge.openExternal(link.url)}
              className={ROW}
            >
              <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-foreground">{link.title}</span>
                {link.title !== link.url ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {URL.canParse(link.url) ? new URL(link.url).host : link.url}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                aria-label={`Remove ${link.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void projectsApi.removeLink(project.id, link.id);
                }}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-accent-surface hover:text-foreground group-hover:opacity-100"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : adding ? null : (
        <p className="text-sm text-muted-foreground">
          Shared documents, a signing page, a data room: anything that isn't an email.
        </p>
      )}
    </>
  );
}

export function ProjectView({
  project,
  onOpenMessage,
  onAskAssistant,
  onDeleted,
}: {
  project: Project;
  onOpenMessage: (accountId: string, messageId: string) => void;
  onAskAssistant: () => void;
  /** The project was deleted: go somewhere else. */
  onDeleted: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const accounts = useAccounts().data ?? [];
  const accountOf = (email: string) => accounts.find((a) => a.email.toLowerCase() === email);
  const documents = useProjectDocuments(project.id, project.threads.length);
  const missing = useProjectThreads(project.id).data?.pages[0]?.missing ?? [];
  const settled = project.status === "settled";

  const openVersion = (version: ProjectDocument["versions"][number]) => {
    const account = accountOf(version.email);
    if (!account) return;
    gmailApi
      .openAttachment({
        accountId: account.id,
        messageId: version.messageId,
        attachmentId: version.attachmentId,
        filename: version.filename,
      })
      .catch(() => toast.error("Could not open the document"));
  };

  const setStatus = (status: Project["status"]) => {
    console.log("[ProjectView:setStatus]", { status });
    void projectsApi.update(project.id, { status }).then(
      () =>
        status === "settled"
          ? toast.success(`Settled “${project.name}”`, {
              action: {
                label: "Undo",
                onClick: () => void projectsApi.update(project.id, { status: "active" }),
              },
            })
          : undefined,
      () => toast.error("Couldn't change the project"),
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-8 pb-16 pt-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <ProjectName key={project.id} project={project} />
            <p className="mt-1 text-sm text-muted-foreground">
              {settled && project.settledAt
                ? `Settled ${date(project.settledAt)}`
                : `Started ${date(project.createdAt)}`}
              {" · "}
              {project.threads.length} conversation{project.threads.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button variant="ghost" onClick={onAskAssistant}>
            <BotMessageSquareIcon />
            Ask
          </Button>
          {settled ? (
            <Button onClick={() => setStatus("active")}>
              <RotateCcwIcon />
              Reopen
            </Button>
          ) : (
            <Button onClick={() => setStatus("settled")}>
              <CircleCheckIcon />
              Settle
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" aria-label="More">
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem color="red" onSelect={() => setConfirmDelete(true)}>
                Delete project…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Dialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete project"
          confirmLabel="Delete"
          confirmVariant="destructive"
          onConfirm={async () => {
            await projectsApi.delete(project.id);
            onDeleted();
          }}
        >
          <Text variant="small">
            Delete “{project.name}” on every device? Its conversations stay in your mailboxes; its
            notes and links go. To keep it, settle it instead.
          </Text>
        </Dialog>

        <Heading>Notes</Heading>
        <Notes key={project.id} project={project} />

        <Heading>Documents</Heading>
        {documents.data && documents.data.length > 0 ? (
          <div className={CARD}>
            {documents.data.map((doc) => (
              <DocumentRow
                key={`${doc.versions[0].messageId}:${doc.versions[0].attachmentId}`}
                doc={doc}
                open={openVersion}
                onOpenMessage={(version) => {
                  const account = accountOf(version.email);
                  if (account) onOpenMessage(account.id, version.messageId);
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {documents.isLoading
              ? "Gathering the attachments…"
              : documents.isError
                ? "Couldn't gather the attachments."
                : "The attachments of its conversations show here, versions together."}
          </p>
        )}

        <Links project={project} />

        {missing.length > 0 ? (
          <p className="mt-8 text-[13px] text-muted-foreground">
            {missing.length === 1
              ? "1 conversation isn't on this device"
              : `${missing.length} conversations aren't on this device`}
            {`: ${missing.map((t) => t.subject || t.email).join(", ")}.`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
