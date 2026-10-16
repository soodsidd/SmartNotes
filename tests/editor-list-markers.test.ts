/**
 * @jest-environment jsdom
 *
 * SN-317: editor list markers restored against Tailwind preflight,
 * per-depth marker cycling, checklist behavior preserved.
 */

import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { createEditorExtensions } from "@/lib/rich-text-editor-config";

const globalsCss = fs.readFileSync(
  path.resolve(__dirname, "../src/app/globals.css"),
  "utf8"
);
const pageExportSrc = fs.readFileSync(
  path.resolve(__dirname, "../src/lib/page-export.ts"),
  "utf8"
);

function makeEditor(content: string) {
  const el = document.createElement("div");
  el.className = "editor-content";
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: createEditorExtensions(),
    content,
  });
}

/** Inject the SN-317 list rules so getComputedStyle reflects editor CSS in jsdom. */
function injectListMarkerStyles() {
  const style = document.createElement("style");
  style.setAttribute("data-testid", "sn-317-list-marker-styles");
  style.textContent = `
    .editor-content ul,
    .editor-content ol {
      padding-left: 1.5em;
      list-style-position: outside;
    }
    .editor-content ul:not([data-type="taskList"]) { list-style-type: disc; }
    .editor-content ol { list-style-type: decimal; }
    .editor-content ul:not([data-type="taskList"]) ul:not([data-type="taskList"]) {
      list-style-type: circle;
    }
    .editor-content ul:not([data-type="taskList"]) ul:not([data-type="taskList"]) ul:not([data-type="taskList"]) {
      list-style-type: square;
    }
    .editor-content ol ol { list-style-type: lower-alpha; }
    .editor-content ol ol ol { list-style-type: lower-roman; }
    .editor-content ul[data-type="taskList"] {
      list-style-type: none;
      list-style-image: none;
      padding-left: 0.25em;
    }
    .editor-content ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; }
    .editor-content ul[data-type="taskList"] li[data-checked="true"] > div {
      text-decoration: line-through;
      color: var(--muted-foreground);
    }
  `;
  document.head.appendChild(style);
  return style;
}

describe("editor list markers (SN-317)", () => {
  afterEach(() => {
    document.querySelectorAll('[data-testid="sn-317-list-marker-styles"]').forEach((n) => n.remove());
    document.body.replaceChildren();
  });

  test("globals.css restores list-style and cycles markers by depth", () => {
    expect(globalsCss).toContain('ul:not([data-type="taskList"])');
    expect(globalsCss).toContain("list-style-type: disc");
    expect(globalsCss).toContain("list-style-type: circle");
    expect(globalsCss).toContain("list-style-type: square");
    expect(globalsCss).toContain("list-style-type: decimal");
    expect(globalsCss).toContain("list-style-type: lower-alpha");
    expect(globalsCss).toContain("list-style-type: lower-roman");
    expect(globalsCss).toContain('ul[data-type="taskList"]');
    expect(globalsCss).toMatch(
      /\.editor-content ul\[data-type="taskList"\]\s*\{[^}]*list-style:\s*none/s
    );
    expect(globalsCss).toMatch(
      /li\[data-checked="true"\]\s*>\s*div\s*\{[^}]*text-decoration:\s*line-through/s
    );
  });

  test("page-export CSS mirrors the same marker cycling and checklist rules", () => {
    expect(pageExportSrc).toContain("list-style-type: disc");
    expect(pageExportSrc).toContain("list-style-type: circle");
    expect(pageExportSrc).toContain("list-style-type: square");
    expect(pageExportSrc).toContain("list-style-type: decimal");
    expect(pageExportSrc).toContain("list-style-type: lower-alpha");
    expect(pageExportSrc).toContain("list-style-type: lower-roman");
    expect(pageExportSrc).toMatch(
      /\.editor-content ul\[data-type="taskList"\]\s*\{[^}]*list-style:\s*none/s
    );
    expect(pageExportSrc).toMatch(
      /li\[data-checked="true"\]\s*>\s*div\s*\{[^}]*text-decoration:\s*line-through/s
    );
  });

  test("bullet and numbered lists render markers at depth 1–3", () => {
    injectListMarkerStyles();
    const root = document.createElement("div");
    root.className = "editor-content";
    root.innerHTML = `
      <ul>
        <li>Bullet 1
          <ul>
            <li>Bullet 2
              <ul><li>Bullet 3</li></ul>
            </li>
          </ul>
        </li>
      </ul>
      <ol>
        <li>Num 1
          <ol>
            <li>Num 2
              <ol><li>Num 3</li></ol>
            </li>
          </ol>
        </li>
      </ol>
    `;
    document.body.appendChild(root);

    const bullets = root.querySelectorAll("ul");
    expect(getComputedStyle(bullets[0]).listStyleType).toBe("disc");
    expect(getComputedStyle(bullets[1]).listStyleType).toBe("circle");
    expect(getComputedStyle(bullets[2]).listStyleType).toBe("square");

    const numbers = root.querySelectorAll("ol");
    expect(getComputedStyle(numbers[0]).listStyleType).toBe("decimal");
    expect(getComputedStyle(numbers[1]).listStyleType).toBe("lower-alpha");
    expect(getComputedStyle(numbers[2]).listStyleType).toBe("lower-roman");
  });

  test("toolbar toggles produce list markers; nested depths and checklist stay intact", () => {
    injectListMarkerStyles();
    const editor = makeEditor("<p>Item</p>");

    editor.commands.toggleBulletList();
    expect(editor.isActive("bulletList")).toBe(true);
    const bulletUl = editor.view.dom.querySelector("ul:not([data-type='taskList'])");
    expect(bulletUl).not.toBeNull();
    expect(getComputedStyle(bulletUl!).listStyleType).toBe("disc");

    editor.commands.setContent(
      "<ul><li><p>A</p><ul><li><p>B</p><ul><li><p>C</p></li></ul></li></ul></li></ul>"
    );
    const nestedBullets = editor.view.dom.querySelectorAll("ul:not([data-type='taskList'])");
    expect(nestedBullets.length).toBeGreaterThanOrEqual(3);
    expect(getComputedStyle(nestedBullets[0]).listStyleType).toBe("disc");
    expect(getComputedStyle(nestedBullets[1]).listStyleType).toBe("circle");
    expect(getComputedStyle(nestedBullets[2]).listStyleType).toBe("square");

    editor.commands.setContent(
      "<ol><li><p>A</p><ol><li><p>B</p><ol><li><p>C</p></li></ol></li></ol></li></ol>"
    );
    const nestedNumbers = editor.view.dom.querySelectorAll("ol");
    expect(nestedNumbers.length).toBeGreaterThanOrEqual(3);
    expect(getComputedStyle(nestedNumbers[0]).listStyleType).toBe("decimal");
    expect(getComputedStyle(nestedNumbers[1]).listStyleType).toBe("lower-alpha");
    expect(getComputedStyle(nestedNumbers[2]).listStyleType).toBe("lower-roman");

    editor.commands.setContent("<p>Task</p>");
    editor.commands.toggleTaskList();
    expect(editor.isActive("taskList")).toBe(true);
    const taskUl = editor.view.dom.querySelector('ul[data-type="taskList"]');
    expect(taskUl).not.toBeNull();
    expect(getComputedStyle(taskUl!).listStyleType).toBe("none");

    const taskLi = editor.view.dom.querySelector('ul[data-type="taskList"] li');
    expect(taskLi).not.toBeNull();
    expect(taskLi!.getAttribute("data-checked")).toBe("false");

    const checkbox = taskLi!.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();
    checkbox!.click();
    expect(taskLi!.getAttribute("data-checked")).toBe("true");

    const contentDiv = taskLi!.querySelector(":scope > div");
    expect(contentDiv).not.toBeNull();
    expect(getComputedStyle(contentDiv!).textDecoration).toMatch(/line-through/);

    editor.destroy();
  });
});
