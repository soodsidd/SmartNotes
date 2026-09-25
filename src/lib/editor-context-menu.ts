import type { Editor } from "@tiptap/react";

export interface EditorContextMenuAction {
  id: string;
  label: string;
  testId: string;
  disabled?: boolean;
  hint?: string;
  active?: boolean;
  run: () => void;
}

export interface EditorContextMenuOpenInput {
  pointerType?: string;
  coarsePointer?: boolean;
  viewportWidth?: number;
}

export function shouldOpenEditorContextMenu({
  pointerType,
  coarsePointer = false,
  viewportWidth,
}: EditorContextMenuOpenInput): boolean {
  if (pointerType && pointerType !== "mouse") {
    return false;
  }

  if (coarsePointer) {
    return false;
  }

  if (typeof viewportWidth === "number" && viewportWidth < 768) {
    return false;
  }

  return true;
}

export function buildEditorContextMenuActions(
  editor: Editor,
  options: {
    canAddComment: boolean;
    canCopy: boolean;
    canPaste: boolean;
    onAddComment: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onSelectAll: () => void;
    onOpenLink: () => void;
  }
): EditorContextMenuAction[] {
  const run = (fn: () => void) => () => {
    fn();
  };

  return [
    {
      id: "copy",
      label: "Copy",
      testId: "ctx-copy",
      disabled: !options.canCopy,
      run: run(() => {
        if (!options.canCopy) return;
        void options.onCopy();
      }),
    },
    {
      id: "paste",
      label: "Paste",
      testId: "ctx-paste",
      disabled: !options.canPaste,
      hint: !options.canPaste ? "Clipboard unavailable" : undefined,
      run: run(() => {
        if (!options.canPaste) return;
        void options.onPaste();
      }),
    },
    {
      id: "selectAll",
      label: "Select all",
      testId: "ctx-select-all",
      run: run(() => options.onSelectAll()),
    },
    {
      id: "bold",
      label: "Bold",
      testId: "ctx-bold",
      active: editor.isActive("bold"),
      run: run(() => editor.chain().focus().toggleBold().run()),
    },
    {
      id: "italic",
      label: "Italic",
      testId: "ctx-italic",
      active: editor.isActive("italic"),
      run: run(() => editor.chain().focus().toggleItalic().run()),
    },
    {
      id: "strike",
      label: "Strikethrough",
      testId: "ctx-strike",
      active: editor.isActive("strike"),
      run: run(() => editor.chain().focus().toggleStrike().run()),
    },
    {
      id: "code",
      label: "Code",
      testId: "ctx-code",
      active: editor.isActive("code"),
      run: run(() => editor.chain().focus().toggleCode().run()),
    },
    {
      id: "h1",
      label: "Heading 1",
      testId: "ctx-h1",
      active: editor.isActive("heading", { level: 1 }),
      run: run(() => editor.chain().focus().toggleHeading({ level: 1 }).run()),
    },
    {
      id: "h2",
      label: "Heading 2",
      testId: "ctx-h2",
      active: editor.isActive("heading", { level: 2 }),
      run: run(() => editor.chain().focus().toggleHeading({ level: 2 }).run()),
    },
    {
      id: "h3",
      label: "Heading 3",
      testId: "ctx-h3",
      active: editor.isActive("heading", { level: 3 }),
      run: run(() => editor.chain().focus().toggleHeading({ level: 3 }).run()),
    },
    {
      id: "bullet",
      label: "Bullet list",
      testId: "ctx-bullet",
      active: editor.isActive("bulletList"),
      run: run(() => editor.chain().focus().toggleBulletList().run()),
    },
    {
      id: "ordered",
      label: "Numbered list",
      testId: "ctx-ordered",
      active: editor.isActive("orderedList"),
      run: run(() => editor.chain().focus().toggleOrderedList().run()),
    },
    {
      id: "task",
      label: "Task list",
      testId: "ctx-task",
      active: editor.isActive("taskList"),
      run: run(() => editor.chain().focus().toggleTaskList().run()),
    },
    {
      id: "link",
      label: "Insert link",
      testId: "ctx-link",
      active: editor.isActive("link"),
      run: run(() => options.onOpenLink()),
    },
    {
      id: "comment",
      label: "Add comment",
      testId: "ctx-add-comment",
      disabled: !options.canAddComment,
      hint: !options.canAddComment ? "Select text first" : undefined,
      run: run(() => {
        if (!options.canAddComment) return;
        options.onAddComment();
      }),
    },
  ];
}
