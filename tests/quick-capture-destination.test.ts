import { captureDestinationLabel } from "@/lib/quick-capture-destination";
import type { VaultNotebook } from "@/lib/api/pages";

const tree: VaultNotebook[] = [{
  path: "Research",
  name: "Research",
  pages: [],
  sections: [{ path: "Research/Ideas", name: "Ideas", pages: [] }],
}];

it("shows the actual notebook and Inbox before saving", () => {
  expect(captureDestinationLabel({ destination: "inbox", notebookPath: "Research", sectionPath: "" }, tree))
    .toBe("Research / Inbox");
  expect(captureDestinationLabel({ destination: "inbox", notebookPath: "", sectionPath: "" }, []))
    .toBe("Personal Notebook / Inbox (created on save)");
});

it("shows the selected section and flags unavailable destinations", () => {
  expect(captureDestinationLabel({ destination: "page", notebookPath: "", sectionPath: "Research/Ideas" }, tree))
    .toBe("Research / Ideas");
  expect(captureDestinationLabel({ destination: "page", notebookPath: "", sectionPath: "Missing" }, tree))
    .toBe("Choose a section");
  expect(captureDestinationLabel({ destination: "inbox", notebookPath: "Missing", sectionPath: "" }, tree))
    .toBe("Notebook unavailable / Inbox");
});
