"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatexImport from "rehype-katex";
// rehype-katex bundles an older vfile; cast away the type mismatch (works at runtime)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rehypeKatex = rehypeKatexImport as any;
import { AlignJustify, Check, ChevronDown, Code2, Copy, FileText, Paperclip, Send, Settings, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  COMPANION_DENSITY_OPTIONS,
  COMPANION_DENSITY_STORAGE_KEY,
  copyTextToClipboard,
  getAiProviderModelOptions,
  getAssistantMessageCopyText,
  getProviderModelPickerNote,
  getAiScopeSharedLabel,
  getAiScopeOptionDescription,
  normalizeCompanionDensity,
  providerSupportsEffort,
  type AiScope,
  type AiScopeOption,
  type AiSidebarTimelineEntry,
  type AiSidebarTraceEvent,
  type AiDocumentAttachmentKind,
  type CompanionDensity,
} from "@/lib/ai-sidebar";
import { cn } from "@/lib/utils";

export interface AiSidebarMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelLabel?: string;
  isStreaming?: boolean;
  errorMessage?: string | null;
  timeline?: AiSidebarTimelineEntry[];
}

interface AiProvider {
  id: string;
  name: string;
  models?: string[];
}

const EFFORT_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

const CHAT_MARKDOWN_COMPONENTS = {
  table: ({ children }: React.PropsWithChildren) => (
    <div className="chat-prose-table-wrap">
      <table>{children}</table>
    </div>
  ),
  img: ({ alt, src }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt ?? ""} src={src ?? ""} loading="lazy" />
  ),
};

const COMPOSER_MAX_HEIGHT_DESKTOP = 160;
const COMPOSER_MAX_HEIGHT_MOBILE = 128;
const COMPANION_ATTACHMENT_ACCEPT = "image/*,.txt,.md,.markdown,.html,.htm,.pdf,text/plain,text/markdown,text/html,application/pdf";

export type AiComposerAttachment =
  | { id: string; kind: "image"; name: string; path: string; url: string }
  | { id: string; kind: "pdf"; name: string; path: string; mimeType: "application/pdf" }
  | { id: string; kind: AiDocumentAttachmentKind; name: string; content: string };

export interface AiComposerSnapshot {
  draft: string;
  attachments: AiComposerAttachment[];
}

function getFileExtension(name: string) {
  const match = name.toLowerCase().match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

function getTextAttachmentKind(file: File): AiDocumentAttachmentKind | null {
  const extension = getFileExtension(file.name);
  const type = file.type.toLowerCase();
  if (extension === ".md" || extension === ".markdown" || type === "text/markdown") {
    return "markdown";
  }
  if (extension === ".html" || extension === ".htm" || type === "text/html") {
    return "html";
  }
  if (extension === ".txt" || type === "text/plain") {
    return "text";
  }
  return null;
}

function isPdfAttachment(file: File) {
  return getFileExtension(file.name) === ".pdf" || file.type.toLowerCase() === "application/pdf";
}

function isSupportedCompanionAttachment(file: File) {
  return file.type.startsWith("image/") || isPdfAttachment(file) || getTextAttachmentKind(file) !== null;
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsText(file);
  });
}

async function uploadChatAttachment(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/api/chat/upload", { method: "POST", body: formData });
  const payload = (await response.json()) as { path?: string; name?: string; error?: string; mimeType?: string };
  if (!response.ok || payload.error || !payload.path) {
    throw new Error(payload.error ?? `Could not attach ${file.name}.`);
  }
  return {
    path: payload.path,
    name: payload.name || file.name,
    mimeType: payload.mimeType || file.type,
  };
}

function useAutoResizeTextarea(value: string, maxHeight: number) {
  const ref = React.useRef<HTMLTextAreaElement | null>(null);

  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    node.style.height = "0px";
    const nextHeight = Math.min(node.scrollHeight, maxHeight);
    node.style.height = `${nextHeight}px`;
    node.style.overflowY = node.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxHeight, value]);

  return ref;
}

function AssistantMessageCopyButton({
  contentRef,
  fallbackText,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  fallbackText: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = React.useCallback(async () => {
    const renderedText = contentRef.current?.innerText?.trim() ?? "";
    const text = renderedText || fallbackText;
    const didCopy = await copyTextToClipboard(text);
    if (didCopy) {
      setCopied(true);
    }
  }, [contentRef, fallbackText]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 transition-[opacity,color,background-color] hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 [@media(hover:hover)]:group-focus-within/message:opacity-100"
      aria-label={copied ? "Copied response" : "Copy response"}
      title={copied ? "Copied" : "Copy response"}
      data-testid="ai-message-copy"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function ComposerTextarea({
  value,
  onChange,
  onKeyDown,
  onPaste,
  placeholder,
  disabled,
  mobile,
  "data-testid": dataTestId,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  disabled?: boolean;
  mobile?: boolean;
  "data-testid"?: string;
}) {
  const maxHeight = mobile ? COMPOSER_MAX_HEIGHT_MOBILE : COMPOSER_MAX_HEIGHT_DESKTOP;
  const textareaRef = useAutoResizeTextarea(value, maxHeight);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      placeholder={placeholder}
      rows={1}
      disabled={disabled}
      data-testid={dataTestId}
      className={cn(
        "companion-composer-input w-full resize-none border-0 bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-60",
        mobile ? "min-h-11 flex-1 text-[14px] leading-[1.45]" : "min-h-10 text-[13px] leading-[1.45]"
      )}
      style={{ maxHeight }}
    />
  );
}

const SIDEBAR_CHIP_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 px-[7px] py-[2px] text-[11px] leading-[1.4] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

const SIDEBAR_SCOPE_CHIP_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-full bg-[color:var(--accent)]/16 px-[7px] py-[2px] text-[11px] leading-[1.4] font-medium text-foreground transition-colors hover:bg-[color:var(--accent)]/22";

function useCompanionDensity() {
  const [density, setDensity] = React.useState<CompanionDensity>("normal");

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setDensity(
      normalizeCompanionDensity(window.localStorage.getItem(COMPANION_DENSITY_STORAGE_KEY))
    );
  }, []);

  const updateDensity = React.useCallback((nextDensity: CompanionDensity) => {
    setDensity(nextDensity);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(COMPANION_DENSITY_STORAGE_KEY, nextDensity);
    }
  }, []);

  return { density, updateDensity };
}

function CompanionDensityMenu({
  density,
  onDensityChange,
  mobile,
  positionerClassName,
}: {
  density: CompanionDensity;
  onDensityChange: (density: CompanionDensity) => void;
  mobile?: boolean;
  positionerClassName?: string;
}) {
  const activeLabel =
    COMPANION_DENSITY_OPTIONS.find((option) => option.value === density)?.label ?? "Normal";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(SIDEBAR_CHIP_CLASS, mobile ? "min-w-0 gap-1" : "px-1.5")}
        data-testid="companion-density-control"
        aria-label={`Companion reading density: ${activeLabel}`}
        title={`Reading density: ${activeLabel}`}
      >
        <AlignJustify className="size-2.5 shrink-0 opacity-70" />
        {mobile ? <span className="truncate">{activeLabel}</span> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[148px]" positionerClassName={positionerClassName}>
        <DropdownMenuRadioGroup
          value={density}
          onValueChange={(value) => onDensityChange(normalizeCompanionDensity(value))}
        >
          {COMPANION_DENSITY_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getEffortLabel(effort?: string) {
  return EFFORT_OPTIONS.find((option) => option.value === effort)?.label ?? "Medium";
}

function CompanionKeepToggle({
  checked,
  onChange,
  mobile,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  mobile?: boolean;
}) {
  return (
    <label
      className={cn(
        SIDEBAR_CHIP_CLASS,
        "cursor-pointer select-none",
        checked && "text-foreground",
        mobile ? "min-w-0" : "px-1.5"
      )}
      title="Keep this conversation — saved to the vault and restored when you return to this page and scope."
      data-testid={mobile ? "companion-keep-toggle-mobile-label" : "companion-keep-toggle-label"}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        style={{ accentColor: "var(--accent)" }}
        className="size-3 cursor-pointer rounded"
        data-testid={mobile ? "companion-keep-toggle-mobile" : "companion-keep-toggle"}
        aria-label="Keep conversation"
      />
      <span>Keep</span>
    </label>
  );
}

function AiScopeControl({
  scopeLabel,
  tokenLabel,
  scopeOptions,
  activeScope,
  onScopeChange,
  mobile,
  positionerClassName,
}: {
  scopeLabel: string;
  tokenLabel: string;
  scopeOptions: AiScopeOption[];
  activeScope: AiScope;
  onScopeChange: (scope: AiScope) => void;
  mobile?: boolean;
  positionerClassName?: string;
}) {
  const canChooseScope = scopeOptions.length > 1;
  // SN-202: make shared-scope behavior legible — section/page_tree are ONE chat
  // shared across pages, not a per-page chat. The chip carries a compact "Shared"
  // tag and the menu spells out each scope's sharing behavior.
  const activeSharedLabel = getAiScopeSharedLabel(activeScope);
  const chipTitle = activeSharedLabel
    ? `${scopeLabel} · ${tokenLabel} · ${activeSharedLabel} across pages`
    : `${scopeLabel} · ${tokenLabel}`;

  const sharedTag = activeSharedLabel ? (
    <span
      className="shrink-0 rounded-full bg-[color:var(--accent)]/24 px-[5px] py-px text-[10px] font-semibold uppercase tracking-wide leading-none text-[color:var(--accent-foreground)]"
      data-testid="ai-scope-shared-tag"
    >
      Shared
    </span>
  ) : null;

  if (!canChooseScope) {
    return (
      <span
        className={cn(SIDEBAR_SCOPE_CHIP_CLASS, mobile ? "min-w-0 flex-1" : "max-w-[min(100%,11rem)] truncate")}
        data-testid={mobile ? "ai-scope-control-mobile" : "ai-scope-control"}
        title={chipTitle}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" />
        <span className="truncate">{scopeLabel} · {tokenLabel}</span>
        {sharedTag}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(SIDEBAR_SCOPE_CHIP_CLASS, mobile ? "min-w-0 flex-1" : "max-w-[min(100%,11rem)] truncate")}
        data-testid={mobile ? "ai-scope-control-mobile" : "ai-scope-control"}
        title={chipTitle}
        aria-label={
          activeSharedLabel
            ? `Context scope: ${scopeLabel} (shared chat across pages)`
            : `Context scope: ${scopeLabel}`
        }
      >
        <span className="size-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" />
        <span className="truncate">{scopeLabel} · {tokenLabel}</span>
        {sharedTag}
        <ChevronDown className="size-2.5 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(100vw-2rem,17rem)]" positionerClassName={positionerClassName}>
        <DropdownMenuRadioGroup
          value={activeScope}
          onValueChange={(value) => onScopeChange(value as AiScope)}
        >
          {scopeOptions.map((option) => {
            const optionShared = getAiScopeSharedLabel(option.value);
            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                className="flex-col items-start gap-0.5 text-xs"
              >
                <span className="flex items-center gap-1.5">
                  <span>{option.label}</span>
                  {optionShared ? (
                    <span className="rounded-full bg-[color:var(--accent)]/24 px-[5px] py-px text-[10px] font-semibold uppercase tracking-wide leading-none text-[color:var(--accent-foreground)]">
                      Shared
                    </span>
                  ) : null}
                </span>
                <span className="text-[10px] leading-tight text-[color:var(--muted-foreground)]">
                  {getAiScopeOptionDescription(option.value)}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AiSettingsDialog({
  open,
  onOpenChange,
  providers,
  activeProviderId,
  activeProviderLabel,
  activeModelLabel,
  activeEffort,
  verboseEnabled,
  systemPrompt,
  defaultSystemPrompt,
  onProviderChange,
  onModelChange,
  onEffortChange,
  onVerboseChange,
  onSystemPromptSave,
  fastLaneProviderId,
  fastLaneProviderLabel,
  fastLaneModelLabel,
  onFastLaneProviderChange,
  onFastLaneModelChange,
  floatingLayerZ,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: AiProvider[];
  activeProviderId?: string;
  activeProviderLabel: string;
  activeModelLabel: string;
  activeEffort?: string;
  verboseEnabled: boolean;
  systemPrompt?: string;
  defaultSystemPrompt?: string;
  onProviderChange?: (providerId: string) => void;
  onModelChange?: (providerId: string, model: string) => void;
  onEffortChange?: (effort: string) => void;
  onVerboseChange?: (enabled: boolean) => void;
  onSystemPromptSave?: (prompt: string) => Promise<void> | void;
  fastLaneProviderId?: string;
  fastLaneProviderLabel?: string;
  fastLaneModelLabel?: string;
  onFastLaneProviderChange?: (providerId: string) => void;
  onFastLaneModelChange?: (providerId: string, model: string) => void;
  floatingLayerZ?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("flex max-h-[min(88vh,680px)] w-full flex-col gap-3 overflow-hidden sm:max-w-lg", floatingLayerZ)}
        overlayClassName={floatingLayerZ}
        data-testid="ai-settings-dialog"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>AI Settings</DialogTitle>
          <DialogDescription>
            Choose the provider and model, then customize the companion instructions.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <div className="space-y-4">
            <section aria-labelledby="companion-lane-heading">
              <div className="mb-3">
                <p id="companion-lane-heading" className="text-sm font-medium text-foreground">Companion</p>
                <p className="text-xs text-muted-foreground">Full note chat and tools</p>
              </div>
              <ChatSettingsPanel
                providers={providers}
                activeProviderId={activeProviderId}
                activeProviderLabel={activeProviderLabel}
                activeModelLabel={activeModelLabel}
                activeEffort={activeEffort}
                verboseEnabled={verboseEnabled}
                onProviderChange={onProviderChange}
                onModelChange={onModelChange}
                onEffortChange={onEffortChange}
                onVerboseChange={onVerboseChange}
              />
            </section>
            <section className="border-t border-border pt-4" aria-labelledby="fast-lane-heading" data-testid="ai-fast-lane-settings">
              <div className="mb-3">
                <p id="fast-lane-heading" className="text-sm font-medium text-foreground">Jupyter inline AI</p>
                <p className="text-xs text-muted-foreground">Fast lane · independent from Companion</p>
              </div>
              <ChatSettingsPanel
                providers={providers}
                activeProviderId={fastLaneProviderId}
                activeProviderLabel={fastLaneProviderLabel ?? "AI"}
                activeModelLabel={fastLaneModelLabel ?? ""}
                onProviderChange={onFastLaneProviderChange}
                onModelChange={onFastLaneModelChange}
                showVerbose={false}
              />
            </section>
          </div>
        </div>
        {onSystemPromptSave ? (
          <div className="shrink-0 border-t border-border pt-3">
            <SystemPromptEditor
              systemPrompt={systemPrompt}
              defaultSystemPrompt={defaultSystemPrompt}
              onSave={onSystemPromptSave}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
interface AiConversationProps {
  pageTitle: string;
  scopeLabel: string;
  tokenLabel: string;
  activeScope: AiScope;
  scopeOptions: AiScopeOption[];
  keepConversation: boolean;
  onKeepConversationChange: (checked: boolean) => void;
  activeProviderLabel: string;
  activeModelLabel: string;
  activeEffort?: string;
  assistantLabel: string;
  messages: AiSidebarMessage[];
  composerResetKey?: string | number;
  /** SN-254: bump to load `initialComposerDraft` into the live composer (inject, not clear). */
  composerInjectKey?: string | number;
  initialComposerDraft?: string;
  initialComposerAttachments?: AiComposerAttachment[];
  disabled?: boolean;
  isTurnActive?: boolean;
  mobile?: boolean;
  providers?: AiProvider[];
  activeProviderId?: string;
  verboseEnabled: boolean;
  systemPrompt?: string;
  defaultSystemPrompt?: string;
  onProviderChange?: (providerId: string) => void;
  onModelChange?: (providerId: string, model: string) => void;
  onEffortChange?: (effort: string) => void;
  onVerboseChange?: (enabled: boolean) => void;
  onSystemPromptSave?: (prompt: string) => Promise<void> | void;
  fastLaneProviderId?: string;
  fastLaneProviderLabel?: string;
  fastLaneModelLabel?: string;
  onFastLaneProviderChange?: (providerId: string) => void;
  onFastLaneModelChange?: (providerId: string, model: string) => void;
  onSubmit: (prompt: string, attachments?: AiComposerAttachment[]) => void;
  onCancel?: () => void;
  onScopeChange: (scope: AiScope) => void;
  onAttach?: (attachments: AiComposerAttachment[]) => void;
  onComposerSnapshot?: (snapshot: AiComposerSnapshot) => void;
  onClose?: () => void;
  /** Raises only companion-owned portaled dialogs and menus above the immersive reader. */
  elevateFloatingLayers?: boolean;
}

function EmptyConversation({ disabled }: { disabled?: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
      <div className="flex size-10 items-center justify-center rounded border border-border bg-background/80">
        <Sparkles className="size-4 text-[color:var(--accent)]" />
      </div>
      <p className="mt-4 text-sm font-medium text-foreground">
        {disabled ? "Open a note to chat with Smart Notes AI." : "Ask for a summary, critique, or next draft."}
      </p>
      <p className="mt-2 max-w-[22rem] text-sm text-muted-foreground">
        Vault writes save on disk immediately. Click Reload in the editor to view updates — the editor may still show your pre-save draft until you do.
      </p>
    </div>
  );
}

function ProviderSettingsMenu({
  providers,
  activeProviderId,
  activeProviderLabel,
  activeModelLabel,
  activeEffort,
  onProviderChange,
  onModelChange,
  onEffortChange,
  verboseEnabled,
  onVerboseChange,
  includeProviderSection = true,
  includeVerboseSection = true,
}: {
  providers: AiProvider[];
  activeProviderId?: string;
  activeProviderLabel: string;
  activeModelLabel: string;
  activeEffort?: string;
  onProviderChange?: (id: string) => void;
  onModelChange?: (id: string, model: string) => void;
  onEffortChange?: (effort: string) => void;
  verboseEnabled?: boolean;
  onVerboseChange?: (enabled: boolean) => void;
  includeProviderSection?: boolean;
  includeVerboseSection?: boolean;
}) {
  const activeProvider =
    providers.find((provider) => provider.id === activeProviderId) ??
    providers[0] ??
    null;
  const activeModels = getAiProviderModelOptions(activeProvider?.models, activeModelLabel);
  const modelPickerNote = getProviderModelPickerNote(activeProvider?.id ?? "", activeModels);
  const [draftModel, setDraftModel] = React.useState(activeModelLabel);
  const modelListId = React.useId();

  React.useEffect(() => {
    setDraftModel(activeModelLabel);
  }, [activeModelLabel]);

  const commitDraftModel = React.useCallback(() => {
    if (!onModelChange || !activeProvider?.id) {
      return;
    }

    const nextModel = draftModel.trim();
    if (nextModel === activeModelLabel.trim()) {
      return;
    }

    onModelChange(activeProvider.id, nextModel);
  }, [activeModelLabel, activeProvider?.id, draftModel, onModelChange]);

  return (
    <div className="w-[220px]">
      {includeProviderSection ? (
        <>
          <div className="px-2 pt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Provider
          </div>
          <DropdownMenuRadioGroup value={activeProviderId || ""} onValueChange={(value) => onProviderChange?.(value)}>
            {providers.map((provider) => (
              <DropdownMenuRadioItem key={provider.id} value={provider.id} className="text-xs">
                {provider.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
        </>
      ) : null}
      <div className="flex items-center justify-between px-2 pt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Model</span>
        <span className="truncate text-[9px] normal-case tracking-normal text-muted-foreground">
          {activeProviderLabel}
        </span>
      </div>
      {onModelChange ? (
        <div className="px-2 pb-1 pt-2" onPointerDown={(event) => event.stopPropagation()}>
          <Input
            value={draftModel}
            onChange={(event) => setDraftModel(event.target.value)}
            onBlur={commitDraftModel}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                commitDraftModel();
                event.currentTarget.blur();
              }
            }}
            placeholder="Default"
            list={modelListId}
            className="h-8 rounded border-border bg-background px-2 text-xs"
          />
          <datalist id={modelListId}>
            {activeModels.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </div>
      ) : null}
      {activeModels.length > 0 && onModelChange ? (
        <DropdownMenuRadioGroup
          value={activeModelLabel || ""}
          onValueChange={(model) => onModelChange(activeProvider?.id ?? "", model)}
        >
          {activeModels.map((model) => (
            <DropdownMenuRadioItem key={model} value={model} className="text-xs">
              {model}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      ) : (
        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
          No models available
        </DropdownMenuItem>
      )}
      {modelPickerNote ? (
        <div className="px-2 py-2 text-[10px] leading-relaxed text-muted-foreground">
          {modelPickerNote}
        </div>
      ) : null}
      {activeProviderId && providerSupportsEffort(activeProviderId) && onEffortChange ? (
        <>
          <DropdownMenuSeparator />
          <div className="px-2 pt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Effort
          </div>
          <DropdownMenuRadioGroup value={activeEffort || ""} onValueChange={(value) => onEffortChange(value)}>
            {EFFORT_OPTIONS.map((opt) => (
              <DropdownMenuRadioItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </>
      ) : null}
      {includeVerboseSection ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={verboseEnabled}
            onCheckedChange={(checked) => onVerboseChange?.(checked === true)}
            className="text-xs"
          >
            Verbose CLI
          </DropdownMenuCheckboxItem>
        </>
      ) : null}
    </div>
  );
}

function SystemPromptEditor({
  systemPrompt,
  defaultSystemPrompt,
  onSave,
}: {
  systemPrompt?: string;
  defaultSystemPrompt?: string;
  onSave?: (prompt: string) => Promise<void> | void;
}) {
  const [draftSystemPrompt, setDraftSystemPrompt] = React.useState(systemPrompt ?? "");
  const [systemPromptSaving, setSystemPromptSaving] = React.useState(false);
  const systemPromptId = React.useId();

  React.useEffect(() => {
    setDraftSystemPrompt(systemPrompt ?? "");
  }, [systemPrompt]);

  const systemPromptDirty =
    draftSystemPrompt.trim() !== (systemPrompt ?? "").trim();
  const canResetSystemPrompt =
    Boolean(defaultSystemPrompt) &&
    draftSystemPrompt.trim() !== (defaultSystemPrompt ?? "").trim();

  const handleSystemPromptSave = React.useCallback(async () => {
    if (!onSave || !systemPromptDirty || systemPromptSaving) return;
    setSystemPromptSaving(true);
    try {
      await onSave(draftSystemPrompt.trim());
    } finally {
      setSystemPromptSaving(false);
    }
  }, [draftSystemPrompt, onSave, systemPromptDirty, systemPromptSaving]);

  return (
    <div className="space-y-2.5 rounded-lg border border-border/80 bg-muted/15 p-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={systemPromptId} className="text-sm font-medium text-foreground">
            System prompt
          </label>
          {systemPromptDirty ? (
            <span className="text-[10px] font-medium text-[color:var(--accent)]">Unsaved</span>
          ) : null}
        </div>
        <p className="text-xs leading-snug text-muted-foreground">
          Injected at the start of every AI session. Per-turn operating context is still appended automatically.
        </p>
      </div>
      <Textarea
        id={systemPromptId}
        data-testid="ai-system-prompt"
        value={draftSystemPrompt}
        onChange={(e) => setDraftSystemPrompt(e.target.value)}
        rows={5}
        className="min-h-[108px] max-h-[132px] resize-none overflow-y-auto rounded-md border-border bg-background px-3 py-2.5 font-mono text-[11px] leading-[1.55] text-foreground"
        placeholder="Instructions injected at the start of every AI session"
      />
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="ai-system-prompt-reset"
          onClick={() => setDraftSystemPrompt(defaultSystemPrompt ?? "")}
          disabled={!canResetSystemPrompt || systemPromptSaving}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Reset default
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="ai-system-prompt-save"
          onClick={() => void handleSystemPromptSave()}
          disabled={!systemPromptDirty || systemPromptSaving}
          className="h-7 rounded px-3 text-xs"
        >
          {systemPromptSaving ? "Saving…" : "Save prompt"}
        </Button>
      </div>
    </div>
  );
}

function ChatSettingsPanel({
  providers,
  activeProviderId,
  activeProviderLabel,
  activeModelLabel,
  activeEffort,
  verboseEnabled,
  onProviderChange,
  onModelChange,
  onEffortChange,
  onVerboseChange,
  showVerbose = true,
}: {
  providers: AiProvider[];
  activeProviderId?: string;
  activeProviderLabel: string;
  activeModelLabel: string;
  activeEffort?: string;
  verboseEnabled?: boolean;
  onProviderChange?: (id: string) => void;
  onModelChange?: (id: string, model: string) => void;
  onEffortChange?: (effort: string) => void;
  onVerboseChange?: (enabled: boolean) => void;
  showVerbose?: boolean;
}) {
  const activeProvider =
    providers.find((p) => p.id === activeProviderId) ?? providers[0] ?? null;
  const activeModels = getAiProviderModelOptions(activeProvider?.models, activeModelLabel);
  const modelPickerNote = getProviderModelPickerNote(activeProvider?.id ?? "", activeModels);
  const [draftModel, setDraftModel] = React.useState(activeModelLabel);
  const modelListId = React.useId();

  React.useEffect(() => {
    setDraftModel(activeModelLabel);
  }, [activeModelLabel]);

  const commitDraftModel = React.useCallback(() => {
    if (!onModelChange || !activeProvider?.id) return;
    const next = draftModel.trim();
    if (next === activeModelLabel.trim()) return;
    onModelChange(activeProvider.id, next);
  }, [activeModelLabel, activeProvider?.id, draftModel, onModelChange]);

  return (
    <div className="space-y-4 pt-1">
      {providers.length > 0 ? (
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Provider</p>
          <div className="space-y-0.5">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => onProviderChange?.(provider.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                  provider.id === activeProviderId
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    provider.id === activeProviderId
                      ? "bg-[color:var(--accent)]"
                      : "bg-border"
                  )}
                />
                {provider.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Model</p>
          <span className="text-[9px] normal-case text-muted-foreground">{activeProviderLabel}</span>
        </div>
        {activeModels.length > 0 ? (
          <div className="space-y-0.5">
            {activeModels.map((model) => (
              <button
                key={model}
                type="button"
                onClick={() => onModelChange?.(activeProvider?.id ?? "", model)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                  model === activeModelLabel
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    model === activeModelLabel ? "bg-[color:var(--accent)]" : "bg-transparent"
                  )}
                />
                {model}
              </button>
            ))}
          </div>
        ) : onModelChange ? (
          <>
            <Input
              value={draftModel}
              onChange={(e) => setDraftModel(e.target.value)}
              onBlur={commitDraftModel}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitDraftModel();
                  e.currentTarget.blur();
                }
              }}
              placeholder="Default"
              list={modelListId}
              className="h-8 rounded border-border bg-background px-2 text-xs"
            />
            <datalist id={modelListId}>
              {activeModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </>
        ) : null}
        {modelPickerNote ? (
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{modelPickerNote}</p>
        ) : null}
      </div>

      {activeProviderId && providerSupportsEffort(activeProviderId) && onEffortChange ? (
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Effort</p>
          <div className="space-y-0.5">
            {EFFORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onEffortChange(opt.value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                  opt.value === activeEffort
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    opt.value === activeEffort ? "bg-[color:var(--accent)]" : "bg-border"
                  )}
                />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {showVerbose ? <div className="border-t border-border pt-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={verboseEnabled ?? false}
            onChange={(e) => onVerboseChange?.(e.target.checked)}
            style={{ accentColor: "var(--accent)" }}
            className="size-3.5 cursor-pointer rounded"
          />
          Verbose CLI
        </label>
      </div> : null}
    </div>
  );
}

function summarizeVerbosePreview(events: AiSidebarTraceEvent[]) {
  const lastLine = events
    .flatMap((event) => event.text.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!lastLine) {
    return null;
  }

  return lastLine.length > 72 ? `${lastLine.slice(0, 69)}...` : lastLine;
}

function VerboseSummary({
  live,
  count,
  unit,
  preview,
}: {
  live: boolean;
  count: number;
  unit: string;
  preview: string | null;
}) {
  return (
    <summary className="cursor-pointer text-[11px] font-mono text-muted-foreground" title={preview ?? undefined}>
      {[
        "CLI activity",
        live ? "live" : null,
        `${count} ${count === 1 ? unit : `${unit}s`}`,
        preview,
      ]
        .filter(Boolean)
        .join(" · ")}
    </summary>
  );
}

function ReasoningPanel({
  reasoning,
  live,
}: {
  reasoning: string;
  live: boolean;
}) {
  const [open, setOpen] = React.useState(live);
  const [showAll, setShowAll] = React.useState(false);
  const previousLive = React.useRef(live);
  const lines = reasoning.split("\n");
  const isLong = lines.length > 10 || reasoning.length > 900;
  const compactReasoning = isLong ? `${lines.slice(0, 10).join("\n")}\n[reasoning compacted]` : reasoning;

  React.useEffect(() => {
    if (live) {
      setOpen(true);
    } else if (previousLive.current) {
      setOpen(false);
    }
    previousLive.current = live;
  }, [live]);

  React.useEffect(() => {
    if (!isLong) {
      setShowAll(false);
    }
  }, [isLong, reasoning]);

  return (
    <details
      className="rounded-md border border-border/70 bg-background/70 px-2.5 py-2"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-[11px] font-mono text-muted-foreground">Reasoning</summary>
      <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[12px] leading-[1.5] text-muted-foreground">
        {showAll || !isLong ? reasoning : compactReasoning}
      </pre>
      {isLong ? (
        <button
          type="button"
          className="mt-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show less" : "Show all"}
        </button>
      ) : null}
    </details>
  );
}

function VerboseActivityBlock({
  events,
  live,
}: {
  events: AiSidebarTraceEvent[];
  live: boolean;
}) {
  if (!events.length) {
    return null;
  }

  const body = events
    .map((event) => {
      const prefix = event.label ? `${event.label}: ` : "";
      return `[${event.eventType}] ${prefix}${event.text}`;
    })
    .join("\n");
  const latestPreview = summarizeVerbosePreview(events);

  return (
    <details className="rounded-md border border-dashed border-border/70 bg-background/60 px-2.5 py-2" open={live}>
      <VerboseSummary live={live} count={events.length} unit="update" preview={latestPreview} />
      <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-muted-foreground">
        {body}
      </pre>
    </details>
  );
}

function AssistantMessageRow({
  message,
  assistantLabel,
  timeline,
  lastTextEntryId,
  live,
}: {
  message: AiSidebarMessage;
  assistantLabel: string;
  timeline: AiSidebarTimelineEntry[];
  lastTextEntryId: string | null | undefined;
  live: boolean;
}) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const copyFallback = getAssistantMessageCopyText(message);
  const showCopy = copyFallback.length > 0 || Boolean(message.isStreaming);

  return (
    <div className="group/message flex flex-col items-stretch">
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{message.modelLabel ?? assistantLabel}</span>
        {showCopy ? (
          <AssistantMessageCopyButton contentRef={contentRef} fallbackText={copyFallback} />
        ) : null}
      </div>

      <div
        ref={contentRef}
        className="w-full rounded-[var(--radius-lg)] border border-border/70 bg-[color:color-mix(in_srgb,var(--surface)_88%,var(--foreground)_6%)] px-3.5 py-3 text-[length:var(--chat-prose-size)] leading-[var(--chat-prose-leading)] text-foreground"
      >
        {timeline.length > 0 ? (
          <div className="space-y-2">
            {timeline.map((entry) => {
              if (entry.type === "text") {
                return (
                  <div key={entry.id} className="chat-prose break-words">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      components={CHAT_MARKDOWN_COMPONENTS}
                    >
                      {entry.text || (message.isStreaming && entry.id === lastTextEntryId ? "…" : "")}
                    </ReactMarkdown>
                    {message.isStreaming && entry.id === lastTextEntryId ? (
                      <span className="ml-0.5 inline-block text-[color:var(--accent)]">▍</span>
                    ) : null}
                  </div>
                );
              }

              if (entry.type === "reasoning") {
                return <ReasoningPanel key={entry.id} reasoning={entry.text.trim()} live={live} />;
              }

              return <VerboseActivityBlock key={entry.id} events={entry.events} live={live} />;
            })}
          </div>
        ) : (
          <div className="chat-prose break-words">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={CHAT_MARKDOWN_COMPONENTS}
            >
              {message.content || (message.isStreaming ? "…" : "")}
            </ReactMarkdown>
            {message.isStreaming ? (
              <span className="ml-0.5 inline-block text-[color:var(--accent)]">▍</span>
            ) : null}
          </div>
        )}
        {message.errorMessage ? (
          <p className="mt-2 text-xs text-destructive">{message.errorMessage}</p>
        ) : null}
      </div>
    </div>
  );
}

function AiConversation({
  pageTitle,
  scopeLabel,
  tokenLabel,
  activeScope,
  scopeOptions,
  keepConversation,
  onKeepConversationChange,
  activeProviderLabel,
  activeModelLabel,
  activeEffort,
  assistantLabel,
  messages,
  composerResetKey,
  composerInjectKey,
  initialComposerDraft = "",
  initialComposerAttachments = [],
  disabled,
  isTurnActive,
  mobile,
  providers,
  activeProviderId,
  verboseEnabled,
  systemPrompt,
  defaultSystemPrompt,
  onProviderChange,
  onModelChange,
  onEffortChange,
  onVerboseChange,
  onSystemPromptSave,
  fastLaneProviderId,
  fastLaneProviderLabel,
  fastLaneModelLabel,
  onFastLaneProviderChange,
  onFastLaneModelChange,
  onSubmit,
  onCancel,
  onScopeChange,
  onAttach,
  onComposerSnapshot,
  onClose,
  elevateFloatingLayers,
}: AiConversationProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const floatingLayerZ = elevateFloatingLayers
    ? "z-[var(--z-companion-overlay)]"
    : undefined;
  const attachmentsRef = React.useRef<AiComposerAttachment[]>(initialComposerAttachments);
  const composerDraftRef = React.useRef(initialComposerDraft);
  const onComposerSnapshotRef = React.useRef(onComposerSnapshot);
  const previousComposerResetKeyRef = React.useRef(composerResetKey);
  const previousComposerInjectKeyRef = React.useRef(composerInjectKey);
  const initialComposerDraftRef = React.useRef(initialComposerDraft);
  initialComposerDraftRef.current = initialComposerDraft;
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [composerDraft, setComposerDraft] = React.useState(initialComposerDraft);
  const [attachments, setAttachments] = React.useState<AiComposerAttachment[]>(initialComposerAttachments);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
  const [isAttaching, setIsAttaching] = React.useState(false);
  const { density, updateDensity } = useCompanionDensity();
  const composerLocked = Boolean(disabled || isTurnActive || isAttaching);

  const revokeAttachmentUrl = React.useCallback((attachment: AiComposerAttachment) => {
    if (attachment.kind === "image") {
      URL.revokeObjectURL(attachment.url);
    }
  }, []);

  const updateComposerDraft = React.useCallback((nextDraft: string) => {
    composerDraftRef.current = nextDraft;
    setComposerDraft(nextDraft);
  }, []);

  const removeAttachmentAt = React.useCallback((index: number) => {
    setAttachments((current) => {
      const removed = current[index];
      if (removed) {
        revokeAttachmentUrl(removed);
      }
      const nextAttachments = current.filter((_, itemIndex) => itemIndex !== index);
      attachmentsRef.current = nextAttachments;
      return nextAttachments;
    });
  }, [revokeAttachmentUrl]);

  const clearAttachments = React.useCallback((items: AiComposerAttachment[]) => {
    items.forEach(revokeAttachmentUrl);
    attachmentsRef.current = [];
    setAttachments([]);
  }, [revokeAttachmentUrl]);

  const addFilesAsAttachments = React.useCallback(async (files: File[]) => {
    const supportedFiles = files.filter(isSupportedCompanionAttachment);
    if (supportedFiles.length === 0) {
      return false;
    }

    setAttachmentError(null);
    setIsAttaching(true);
    try {
      const nextAttachments = await Promise.all(
        supportedFiles.map(async (file) => {
          const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const textKind = getTextAttachmentKind(file);
          if (textKind) {
            return {
              id,
              kind: textKind,
              name:
                file.name ||
                (textKind === "markdown"
                  ? "pasted-markdown.md"
                  : textKind === "html"
                    ? "pasted-html.html"
                    : "pasted-text.txt"),
              content: await readFileAsText(file),
            } satisfies AiComposerAttachment;
          }

          if (isPdfAttachment(file)) {
            const uploaded = await uploadChatAttachment(file);
            return {
              id,
              kind: "pdf",
              name: uploaded.name,
              path: uploaded.path,
              mimeType: "application/pdf",
            } satisfies AiComposerAttachment;
          }

          const uploaded = await uploadChatAttachment(file);
          return {
            id,
            kind: "image",
            name: uploaded.name,
            path: uploaded.path,
            url: URL.createObjectURL(file),
          } satisfies AiComposerAttachment;
        })
      );

      setAttachments((current) => {
        const mergedAttachments = [...current, ...nextAttachments];
        attachmentsRef.current = mergedAttachments;
        return mergedAttachments;
      });
      return true;
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Could not attach that file.");
      return false;
    } finally {
      setIsAttaching(false);
    }
  }, []);

  const handleComposerPaste = React.useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter(isSupportedCompanionAttachment);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    void addFilesAsAttachments(files);
  }, [addFilesAsAttachments]);

  React.useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  React.useEffect(() => {
    composerDraftRef.current = composerDraft;
  }, [composerDraft]);

  React.useEffect(() => {
    onComposerSnapshotRef.current = onComposerSnapshot;
  }, [onComposerSnapshot]);

  React.useEffect(() => {
    if (previousComposerResetKeyRef.current === composerResetKey) {
      return;
    }
    previousComposerResetKeyRef.current = composerResetKey;
    updateComposerDraft("");
    setAttachmentError(null);
    setAttachments((current) => {
      current.forEach(revokeAttachmentUrl);
      attachmentsRef.current = [];
      return [];
    });
    onComposerSnapshotRef.current?.({ draft: "", attachments: [] });
  }, [composerResetKey, revokeAttachmentUrl, updateComposerDraft]);

  // SN-254: inject a prefilled draft (e.g. Jupyter Answer-comment → Companion handoff)
  // without clearing via composerResetKey. Attachments stay untouched.
  React.useEffect(() => {
    if (
      composerInjectKey === undefined ||
      previousComposerInjectKeyRef.current === composerInjectKey
    ) {
      return;
    }
    previousComposerInjectKeyRef.current = composerInjectKey;
    const draft = initialComposerDraftRef.current ?? "";
    updateComposerDraft(draft);
    onComposerSnapshotRef.current?.({
      draft,
      attachments: attachmentsRef.current,
    });
  }, [composerInjectKey, updateComposerDraft]);

  React.useEffect(() => {
    return () => {
      if (onComposerSnapshotRef.current) {
        onComposerSnapshotRef.current({
          draft: composerDraftRef.current,
          attachments: attachmentsRef.current,
        });
        return;
      }
      attachmentsRef.current.forEach(revokeAttachmentUrl);
    };
  }, [revokeAttachmentUrl]);

  const submitComposer = React.useCallback(() => {
    if (isAttaching) {
      return;
    }

    const prompt = composerDraft;
    const currentAttachments = attachments;
    if (!prompt.trim() && currentAttachments.length === 0) {
      return;
    }
    if (currentAttachments.length > 0) {
      onAttach?.(currentAttachments);
      clearAttachments(currentAttachments);
    }
    onSubmit(prompt, currentAttachments);
    updateComposerDraft("");
    onComposerSnapshot?.({ draft: "", attachments: [] });
  }, [attachments, clearAttachments, composerDraft, isAttaching, onAttach, onComposerSnapshot, onSubmit, updateComposerDraft]);

  React.useEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [messages]);

  return (
    <div
      className={cn(
        "companion-surface flex h-full min-h-0 flex-col bg-[color:var(--rail)]",
        `companion-density-${density}`,
        mobile && "bg-[color:var(--surface)]"
      )}
      data-testid={mobile ? "mobile-ai-sheet" : "ai-sidebar"}
    >
      <div className={cn("flex shrink-0 items-center gap-2 border-b border-border px-2 py-2.5", mobile && "px-3 py-2.5")}>
        <Sparkles className="size-4 text-[color:var(--accent)]" />
        <div className="min-w-0 flex-1">
          <p className={cn("text-[13px] font-medium text-foreground", mobile && "text-[14px]")}>
            {mobile ? "Ask about this note" : "Smart Notes AI"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {mobile ? `${pageTitle} · ${tokenLabel}` : `Discussing · ${pageTitle}`}
          </p>
        </div>
        {mobile ? (
          <>
            <CompanionDensityMenu density={density} onDensityChange={updateDensity} mobile positionerClassName={floatingLayerZ} />
            <button
              type="button"
              aria-label="AI settings"
              data-testid="ai-settings-mobile"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Settings className="size-3.5" />
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-md"
              onClick={onClose}
              aria-label="Close AI sheet"
            >
              <X className="size-3.5" />
            </Button>
          </>
        ) : (
          <>
            <AiScopeControl
              scopeLabel={scopeLabel}
              tokenLabel={tokenLabel}
              scopeOptions={scopeOptions}
              activeScope={activeScope}
              onScopeChange={onScopeChange}
              positionerClassName={floatingLayerZ}
            />
            <CompanionKeepToggle checked={keepConversation} onChange={onKeepConversationChange} />
            <CompanionDensityMenu density={density} onDensityChange={updateDensity} positionerClassName={floatingLayerZ} />
            <button
              type="button"
              aria-label="AI settings"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Settings className="size-3.5" />
            </button>
            {onClose ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 rounded-md"
                onClick={onClose}
                aria-label="Close Smart Notes AI"
                data-testid="pdf-reader-ai-close"
              >
                <X className="size-3.5" />
              </Button>
            ) : null}
          </>
        )}
      </div>

      <AiSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        providers={providers ?? []}
        activeProviderId={activeProviderId}
        activeProviderLabel={activeProviderLabel}
        activeModelLabel={activeModelLabel}
        activeEffort={activeEffort}
        verboseEnabled={verboseEnabled}
        systemPrompt={systemPrompt}
        defaultSystemPrompt={defaultSystemPrompt}
        onProviderChange={onProviderChange}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
        onVerboseChange={onVerboseChange}
        onSystemPromptSave={onSystemPromptSave}
        fastLaneProviderId={fastLaneProviderId}
        fastLaneProviderLabel={fastLaneProviderLabel}
        fastLaneModelLabel={fastLaneModelLabel}
        onFastLaneProviderChange={onFastLaneProviderChange}
        onFastLaneModelChange={onFastLaneModelChange}
        floatingLayerZ={floatingLayerZ}
      />

      {mobile ? (
        <div className="flex shrink-0 items-center gap-1.5 px-4 pb-3">
          <AiScopeControl
            scopeLabel={scopeLabel}
            tokenLabel={tokenLabel}
            scopeOptions={scopeOptions}
            activeScope={activeScope}
            onScopeChange={onScopeChange}
            mobile
            positionerClassName={floatingLayerZ}
          />
          <CompanionKeepToggle checked={keepConversation} onChange={onKeepConversationChange} mobile />
          {activeProviderId && providerSupportsEffort(activeProviderId) && onEffortChange ? (
            <DropdownMenu>
              <DropdownMenuTrigger className={SIDEBAR_CHIP_CLASS}>
                <span>{getEffortLabel(activeEffort)}</span>
                <ChevronDown className="size-2.5 shrink-0 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[140px]" positionerClassName={floatingLayerZ}>
                <DropdownMenuRadioGroup
                  value={activeEffort || "medium"}
                  onValueChange={(value) => onEffortChange(value)}
                >
                  {EFFORT_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value} className="text-xs">
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {providers && providers.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger className={cn(SIDEBAR_CHIP_CLASS, "max-w-[132px] truncate")}>
                <span className="truncate">{activeProviderLabel} · {activeModelLabel || "default"}</span>
                <ChevronDown className="size-2.5 shrink-0 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[min(70vh,28rem)] w-[220px] overflow-y-auto" positionerClassName={floatingLayerZ}>
                <ProviderSettingsMenu
                  providers={providers}
                  activeProviderId={activeProviderId}
                  activeProviderLabel={activeProviderLabel}
                  activeModelLabel={activeModelLabel}
                  activeEffort={activeEffort}
                  verboseEnabled={verboseEnabled}
                  onProviderChange={onProviderChange}
                  onModelChange={onModelChange}
                  onEffortChange={onEffortChange}
                  onVerboseChange={onVerboseChange}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className={cn(
          "minimal-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 py-4",
          mobile && "px-4 pb-3"
        )}
        style={{ gap: "var(--chat-message-gap)" }}
      >
        {messages.length === 0 ? (
          <EmptyConversation disabled={disabled} />
        ) : (
          messages.map((message) => {
            const isUser = message.role === "user";
            const live = !isUser && Boolean(message.isStreaming);
            const timeline = isUser
              ? []
              : (message.timeline ?? []).filter((entry) => {
                  if (entry.type === "text") {
                    return true;
                  }

                  return verboseEnabled;
                });
            const lastTextEntryId = !isUser
              ? [...timeline].reverse().find((entry) => entry.type === "text")?.id
              : null;

            return (
              <div
                key={message.id}
                className={cn("flex flex-col", isUser ? "items-end" : "items-stretch")}
              >
                {isUser ? (
                  <>
                    <div className="mb-1.5 text-right text-[11px] text-muted-foreground">You</div>
                    <div className="max-w-[88%] rounded-[var(--radius-lg)] border border-border bg-[color:color-mix(in_oklab,var(--accent)_12%,var(--surface))] px-3.5 py-3 text-[length:var(--chat-prose-size)] leading-[var(--chat-prose-leading)] text-foreground">
                      <div className="whitespace-pre-wrap break-words">
                        {message.content || (message.isStreaming ? "…" : "")}
                      </div>
                    </div>
                  </>
                ) : (
                  <AssistantMessageRow
                    message={message}
                    assistantLabel={assistantLabel}
                    timeline={timeline}
                    lastTextEntryId={lastTextEntryId}
                    live={live}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      <div className={cn("shrink-0 px-3 pb-3", mobile && "border-t border-border px-3 pb-4 pt-2")}>
        <input
          ref={fileInputRef}
          type="file"
          accept={COMPANION_ATTACHMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            void addFilesAsAttachments(files);
            event.target.value = "";
          }}
        />
        <div
          className={cn(
            "border bg-[color:var(--surface)]",
            isTurnActive ? "border-[color:var(--accent)]/45" : "border-border",
            mobile ? "rounded px-3 py-2" : "rounded px-3 py-2.5"
          )}
          data-testid="ai-composer"
          data-turn-active={isTurnActive ? "true" : "false"}
        >
          {!mobile ? (
            <ComposerTextarea
              value={composerDraft}
              onChange={updateComposerDraft}
              placeholder="Ask anything about this note…"
              disabled={composerLocked}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !isTurnActive) {
                  event.preventDefault();
                  submitComposer();
                }
              }}
              onPaste={handleComposerPaste}
              data-testid="ai-input"
            />
          ) : null}
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pb-2 pt-1">
              {attachments.map((attachment, index) => (
                <div key={attachment.id} className="relative">
                  {attachment.kind === "image" ? (
                    <img
                      src={attachment.url}
                      alt={attachment.name}
                      className="h-12 w-12 rounded border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-9 max-w-[13rem] items-center gap-1.5 rounded border border-border bg-muted/45 px-2 pr-5 text-[11px] text-foreground">
                      {attachment.kind === "pdf" ? (
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <Code2 className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate" title={attachment.name}>{attachment.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => removeAttachmentAt(index)}
                    className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] leading-none text-destructive-foreground"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className={cn("flex items-end gap-2", !mobile && "mt-2")}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-md"
              aria-label="Attach file"
              disabled={composerLocked}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-3.5" />
            </Button>
            {!mobile ? (
              <span className="text-[10px] text-muted-foreground">
                {isTurnActive ? (
                  <span className="text-[color:var(--accent)]">Working…</span>
                ) : isAttaching ? (
                  <span>Attaching…</span>
                ) : (
                  <>
                    {activeProviderLabel}
                    {activeModelLabel ? ` · ${activeModelLabel}` : ""}
                  </>
                )}
              </span>
            ) : (
              <ComposerTextarea
                value={composerDraft}
                onChange={updateComposerDraft}
                placeholder={isTurnActive ? "Working…" : "Ask anything about this note…"}
                disabled={composerLocked}
                mobile
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !isTurnActive) {
                    event.preventDefault();
                    submitComposer();
                  }
                }}
                onPaste={handleComposerPaste}
                data-testid="ai-input"
              />
            )}
            {!mobile ? <div className="flex-1" /> : null}
            {isTurnActive ? (
              <Button
                type="button"
                variant="secondary"
                size={mobile ? "icon" : "icon-sm"}
                onClick={() => onCancel?.()}
                className={cn("rounded-md", mobile && "size-11 shrink-0")}
                aria-label="Stop AI response"
                data-testid="ai-stop-btn"
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                size={mobile ? "icon" : "icon-sm"}
                onClick={submitComposer}
                disabled={disabled || isAttaching || (!composerDraft.trim() && attachments.length === 0)}
                className={cn(
                  "rounded bg-[color:var(--accent)] text-[color:var(--accent-foreground)] hover:bg-[color:var(--accent)]/90",
                  mobile && "size-11 shrink-0"
                )}
                data-testid="ai-send-btn"
              >
                <Send className="size-3.5" />
              </Button>
            )}
          </div>
          {attachmentError ? (
            <p className="mt-1.5 text-[11px] text-destructive">{attachmentError}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AiSidebar(props: AiConversationProps) {
  return <AiConversation {...props} />;
}

export function MobileAiSheet(
  props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    overReader?: boolean;
    children: React.ReactNode;
  }
) {
  const { open, onOpenChange, overReader = false, children } = props;
  const readerLayerClassName = overReader
    ? "z-[var(--z-companion-rail)]"
    : undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        overlayClassName={readerLayerClassName}
        data-testid={overReader ? "pdf-reader-ai-sheet" : undefined}
        className={cn(
          "border-0 bg-[color:var(--surface)] p-0",
          "data-[side=bottom]:inset-0 data-[side=bottom]:top-0 data-[side=bottom]:bottom-0",
          "data-[side=bottom]:h-[100dvh] data-[side=bottom]:max-h-[100dvh]",
          "data-[side=bottom]:rounded-none data-[side=bottom]:border-t-0",
          readerLayerClassName
        )}
      >
        {children}
      </SheetContent>
    </Sheet>
  );
}
