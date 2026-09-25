/**
 * @jest-environment jsdom
 */

import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RuleEffect, type Categorization } from "@jsonforms/core";

import { LogJsonForms } from "@/components/log-jsonforms";
import type { LogFormDefinition } from "@/lib/log-form-contract";

const form = {
  version: 1 as const,
  schema: {
    type: "object" as const,
    properties: {
      mood: {
        type: "string",
        title: "Mood",
        enum: ["steady", "energized"],
      },
    },
  },
  uischema: {
    type: "VerticalLayout",
    elements: [{
      type: "Control",
      scope: "#/properties/mood",
      options: { hideEmptyOption: true },
    }],
  },
};

describe("LogJsonForms enum state", () => {
  it("shows an explicit placeholder instead of visually selecting an uncommitted first option", () => {
    render(<LogJsonForms form={form} data={{}} onChange={jest.fn()} />);

    const select = screen.getByRole("combobox", { name: "Mood" }) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]?.textContent).toBe("Select an option");
    expect(select.options[0]?.disabled).toBe(true);
    expect(select.options[1]?.textContent).toBe("steady");
  });

  it("shows and commits a declared value when form data contains it", async () => {
    const onChange = jest.fn();
    render(<LogJsonForms form={form} data={{ mood: "steady" }} onChange={onChange} />);

    const select = screen.getByRole("combobox", { name: "Mood" }) as HTMLSelectElement;
    expect(select.value).toBe("steady");
    fireEvent.change(select, { target: { value: "energized" } });

    await waitFor(() => {
      expect(onChange.mock.calls.some(([data]) => data.mood === "energized")).toBe(true);
    });
  });
});

const conditionalCategoryForm: LogFormDefinition = {
  version: 1,
  schema: {
    type: "object",
    properties: {
      showStrength: { type: "boolean" },
      showNutrition: { type: "boolean" },
      strengthNotes: { type: "string", title: "Strength notes" },
      nutritionNotes: { type: "string", title: "Nutrition notes" },
      tennisNotes: { type: "string", title: "Tennis notes" },
    },
  },
  uischema: {
    type: "Categorization",
    label: "Training & Health sections",
    elements: [
      {
        type: "Category",
        label: "Strength",
        rule: {
          effect: RuleEffect.SHOW,
          condition: {
            scope: "#/properties/showStrength",
            schema: { const: true },
          },
        },
        elements: [{ type: "Control", scope: "#/properties/strengthNotes" }],
      },
      {
        type: "Category",
        label: "Nutrition/Movement",
        rule: {
          effect: RuleEffect.SHOW,
          condition: {
            scope: "#/properties/showNutrition",
            schema: { const: true },
          },
        },
        elements: [{ type: "Control", scope: "#/properties/nutritionNotes" }],
      },
      {
        type: "Category",
        label: "Tennis/Running",
        elements: [{ type: "Control", scope: "#/properties/tennisNotes" }],
      },
    ],
  } satisfies Categorization,
};

describe("LogJsonForms conditional categorization", () => {
  it("renders Nutrition/Movement and Tennis/Running when their preceding categories are hidden", () => {
    const { rerender } = render(
      <LogJsonForms
        form={conditionalCategoryForm}
        data={{ showStrength: false, showNutrition: true }}
        onChange={jest.fn()}
      />
    );

    expect(screen.queryByRole("tab", { name: "Strength" })).toBeNull();

    const nutritionTab = screen.getByRole("tab", { name: "Nutrition/Movement" });
    const nutritionTabItem = nutritionTab.closest("li");
    expect(nutritionTabItem?.getAttribute("role")).toBe("presentation");
    expect(window.getComputedStyle(nutritionTabItem as HTMLElement).paddingLeft).toBe("0px");
    expect(window.getComputedStyle(nutritionTab).height).toBe("2rem");
    expect(window.getComputedStyle(nutritionTab).paddingLeft).toBe("0.75rem");
    fireEvent.click(nutritionTab);
    expect(nutritionTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(nutritionTab.id);
    expect(screen.getByRole("textbox", { name: "Nutrition notes" })).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Strength notes" })).toBeNull();

    rerender(
      <LogJsonForms
        form={conditionalCategoryForm}
        data={{ showStrength: false, showNutrition: false }}
        onChange={jest.fn()}
      />
    );

    expect(screen.queryByRole("tab", { name: "Nutrition/Movement" })).toBeNull();
    const tennisTab = screen.getByRole("tab", { name: "Tennis/Running" });
    fireEvent.click(tennisTab);
    expect(tennisTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tennisTab.id);
    expect(screen.getByRole("textbox", { name: "Tennis notes" })).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Nutrition notes" })).toBeNull();
  });

  it("falls back to the first visible category when rules hide the active category", async () => {
    const { rerender } = render(
      <LogJsonForms
        form={conditionalCategoryForm}
        data={{ showStrength: true, showNutrition: true }}
        onChange={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Strength" }));
    expect(screen.getByRole("textbox", { name: "Strength notes" })).not.toBeNull();

    rerender(
      <LogJsonForms
        form={conditionalCategoryForm}
        data={{ showStrength: false, showNutrition: true }}
        onChange={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Nutrition/Movement" })
        .getAttribute("aria-selected")).toBe("true");
    });
    expect(screen.getByRole("textbox", { name: "Nutrition notes" })).not.toBeNull();
  });

  it("keeps tab and panel semantics correct for keyboard selection", async () => {
    render(
      <LogJsonForms
        form={conditionalCategoryForm}
        data={{ showStrength: false, showNutrition: true }}
        onChange={jest.fn()}
      />
    );

    const nutritionTab = screen.getByRole("tab", { name: "Nutrition/Movement" });
    const tennisTab = screen.getByRole("tab", { name: "Tennis/Running" });
    expect(nutritionTab.getAttribute("tabindex")).toBe("0");
    expect(tennisTab.getAttribute("tabindex")).toBe("-1");

    nutritionTab.focus();
    fireEvent.keyDown(nutritionTab, { key: "ArrowRight" });

    await waitFor(() => {
      expect(document.activeElement).toBe(tennisTab);
    });
    expect(tennisTab.getAttribute("aria-selected")).toBe("true");
    expect(tennisTab.getAttribute("tabindex")).toBe("0");
    expect(nutritionTab.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tennisTab.id);
    expect(screen.getByRole("textbox", { name: "Tennis notes" })).not.toBeNull();
  });
});
