"use client";

import * as React from "react";
import {
  categorizationHasCategory,
  defaultTranslator,
  deriveLabelForUISchemaElement,
  Generate,
  getAjv,
  isEnumControl,
  isObjectControl,
  isOneOfEnumControl,
  isVisible,
  rankWith,
  type Categorization,
  type Category,
  type ControlProps,
  type JsonFormsCellRendererRegistryEntry,
  type JsonFormsCore,
  type JsonFormsRendererRegistryEntry,
  type JsonSchema,
  type LayoutProps,
  type Translator,
  type UISchemaElement,
} from "@jsonforms/core";
import {
  JsonForms,
  JsonFormsDispatch,
  useJsonForms,
  withJsonFormsControlProps,
  withJsonFormsEnumCellProps,
  withJsonFormsLayoutProps,
  withJsonFormsOneOfEnumCellProps,
} from "@jsonforms/react";
import {
  JsonFormsStyleContext,
  useStyles,
  vanillaCells,
  vanillaRenderers,
  type StyleContext,
} from "@jsonforms/vanilla-renderers";

import type { LogFormDefinition } from "@/lib/log-form-contract";

/**
 * Design-token-aligned class map for JSON Forms vanilla renderers.
 * Keeps Form visuals on the existing Smart Notes surface without Material UI.
 */
const logFormStyles: StyleContext["styles"] = [
  {
    name: "control",
    classNames: ["flex", "flex-col", "gap-1.5", "mb-3"],
  },
  {
    name: "control.label",
    classNames: ["text-sm", "font-medium", "text-foreground"],
  },
  {
    name: "control.input",
    classNames: [
      "h-8",
      "w-full",
      "min-w-0",
      "rounded-lg",
      "border",
      "border-input",
      "bg-background",
      "px-2.5",
      "py-1",
      "text-sm",
      "outline-none",
      "focus-visible:border-ring",
      "focus-visible:ring-3",
      "focus-visible:ring-ring/50",
    ],
  },
  {
    name: "control.select",
    classNames: [
      "h-8",
      "w-full",
      "min-w-0",
      "rounded-lg",
      "border",
      "border-input",
      "bg-background",
      "px-2.5",
      "py-1",
      "text-sm",
      "outline-none",
      "focus-visible:border-ring",
      "focus-visible:ring-3",
      "focus-visible:ring-ring/50",
    ],
  },
  {
    name: "control.checkbox",
    classNames: ["size-4", "accent-[var(--accent)]"],
  },
  {
    name: "control.validation",
    classNames: ["text-xs", "text-destructive"],
  },
  {
    name: "control.validation.error",
    classNames: ["text-xs", "text-destructive"],
  },
  {
    name: "input.description",
    classNames: ["text-xs", "text-muted-foreground"],
  },
  {
    name: "vertical.layout",
    classNames: ["flex", "flex-col", "gap-1"],
  },
  {
    name: "vertical.layout.item",
    classNames: ["w-full"],
  },
  {
    name: "horizontal.layout",
    classNames: ["grid", "grid-cols-1", "gap-3", "sm:grid-cols-2"],
  },
  {
    name: "horizontal.layout.item",
    classNames: ["min-w-0"],
  },
  {
    name: "group.layout",
    classNames: ["flex", "flex-col", "gap-2", "rounded-lg", "border", "border-border/60", "bg-surface/40", "p-3"],
  },
  {
    name: "group.label",
    classNames: ["px-0.5", "text-sm", "font-semibold", "text-foreground"],
  },
  {
    name: "group.layout.item",
    classNames: ["w-full"],
  },
  {
    name: "array.layout",
    classNames: ["flex", "flex-col", "gap-2", "rounded-lg", "border", "border-border/60", "p-3"],
  },
  {
    name: "array.button",
    classNames: [
      "inline-flex",
      "h-8",
      "items-center",
      "justify-center",
      "rounded-lg",
      "border",
      "border-input",
      "bg-transparent",
      "px-3",
      "text-sm",
      "text-foreground",
      "hover:bg-surface",
    ],
  },
  {
    name: "array.children",
    classNames: ["flex", "flex-col", "gap-2"],
  },
  {
    name: "array.table",
    classNames: ["mb-3", "flex", "w-full", "flex-col", "gap-2"],
  },
  {
    name: "array.table.table",
    classNames: ["w-full", "border-collapse", "text-sm"],
  },
  {
    name: "array.table.label",
    classNames: ["text-sm", "font-medium", "text-foreground"],
  },
  {
    name: "array.table.button",
    classNames: [
      "inline-flex",
      "h-7",
      "items-center",
      "justify-center",
      "rounded-md",
      "border",
      "border-input",
      "bg-transparent",
      "px-2.5",
      "text-xs",
      "text-foreground",
      "hover:bg-surface",
    ],
  },
  {
    name: "array.table.validation",
    classNames: ["text-xs", "text-muted-foreground"],
  },
  {
    name: "array.table.validation.error",
    classNames: ["text-xs", "text-destructive"],
  },
  {
    name: "categorization",
    classNames: ["log-jsonforms-categorization", "flex", "flex-col", "gap-3", "w-full"],
  },
  {
    name: "categorization.master",
    classNames: ["log-jsonforms-tabs", "border-b", "border-border/60", "pb-2"],
  },
  {
    name: "categorization.detail",
    classNames: ["w-full", "pt-1"],
  },
  {
    name: "category.subcategories",
    classNames: ["m-0", "flex", "list-none", "flex-wrap", "gap-1", "p-0"],
  },
  {
    name: "category.group",
    classNames: ["text-sm", "font-medium", "text-foreground"],
  },
  {
    name: "label-control",
    classNames: ["mb-3", "block", "text-sm", "text-muted-foreground"],
  },
];

const styleContextValue: StyleContext = {
  styles: logFormStyles,
};

/**
 * Vanilla EnumCell sets option label= but leaves text content empty, so browsers
 * show blank dropdown items. Put the label in the option body instead.
 */
function EnumSelectCell(props: {
  data: unknown;
  className?: string;
  id?: string;
  enabled: boolean;
  uischema: { options?: { focus?: boolean; hideEmptyOption?: boolean } };
  path: string;
  handleChange: (path: string, value: unknown) => void;
  options?: Array<{ value: string; label: string }>;
  t?: (key: string, defaultMessage: string) => string;
}) {
  const { data, className, id, enabled, uischema, path, handleChange, options = [], t } = props;
  const noneOptionLabel = t ? t("enum.none", "None") : "None";
  const hideEmpty = uischema.options?.hideEmptyOption === true;
  const placeholderLabel = t ? t("enum.placeholder", "Select an option") : "Select an option";
  return (
    <select
      className={className}
      id={id}
      disabled={!enabled}
      autoFocus={Boolean(uischema.options?.focus)}
      value={typeof data === "string" || typeof data === "number" ? String(data) : ""}
      onChange={(event) => {
        handleChange(path, event.target.value === "" ? undefined : event.target.value);
      }}
    >
      <option value="" disabled={hideEmpty}>
        {hideEmpty ? placeholderLabel : noneOptionLabel}
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

const FixedEnumCell = withJsonFormsEnumCellProps(EnumSelectCell);
const FixedOneOfEnumCell = withJsonFormsOneOfEnumCellProps(EnumSelectCell);

/**
 * Vanilla renderers have no object control — nested objects otherwise render blank.
 * Expand each object into a labeled group of child controls.
 */
function ObjectControlRenderer({
  schema,
  path,
  visible,
  enabled,
  label,
  rootSchema,
  renderers,
  cells,
}: ControlProps) {
  const detailUiSchema = React.useMemo(
    () => Generate.uiSchema(schema, "VerticalLayout", undefined, rootSchema),
    [rootSchema, schema]
  );

  if (!visible) return null;

  return (
    <fieldset
      className="mb-3 flex flex-col gap-2 rounded-lg border border-border/60 bg-surface/30 p-3"
      data-testid="log-jsonforms-object"
    >
      {label ? (
        <legend className="px-0.5 text-sm font-semibold text-foreground">{label}</legend>
      ) : null}
      <JsonFormsDispatch
        schema={schema}
        uischema={detailUiSchema}
        path={path}
        enabled={enabled}
        renderers={renderers}
        cells={cells}
      />
    </fieldset>
  );
}

const ObjectControl = withJsonFormsControlProps(ObjectControlRenderer);

type VisibleCategory = {
  category: Category;
  key: string;
  label: string;
};

function visibleCategories(
  categorization: Categorization,
  data: unknown,
  path: string,
  t: Translator,
  ajv: ReturnType<typeof getAjv>,
  config: unknown,
  parentKey = ""
): VisibleCategory[] {
  return categorization.elements.flatMap((element, index) => {
    const key = parentKey ? `${parentKey}.${index}` : String(index);
    if (!isVisible(element, data, path, ajv, config)) return [];
    if (element.type === "Categorization") {
      return visibleCategories(element, data, path, t, ajv, config, key);
    }
    return [{
      category: element,
      key,
      label: deriveLabelForUISchemaElement(element, t) ?? element.label,
    }];
  });
}

/**
 * The stock vanilla categorization renderer indexes its unfiltered category
 * array with a position from the rule-filtered tab list. Keep the original
 * UI-schema path as category identity instead, and expose a complete ARIA tabs
 * interaction model while preserving the existing visual class contract.
 */
function ConditionalCategorizationRenderer({
  data,
  uischema,
  schema,
  path,
  visible,
  renderers,
  cells,
}: LayoutProps) {
  const categorization = uischema as Categorization;
  const jsonForms = useJsonForms();
  const styles = useStyles();
  const getStyleAsClassName = React.useCallback((name: string) => {
    const definition = styles.find((style) => style.name === name);
    const classNames = typeof definition?.classNames === "function"
      ? definition.classNames()
      : definition?.classNames;
    return (classNames ?? []).join(" ");
  }, [styles]);
  const ajv = getAjv({ jsonforms: jsonForms });
  const t = jsonForms.i18n?.translate ?? defaultTranslator;
  const categories = visibleCategories(
    categorization,
    data,
    path,
    t,
    ajv,
    jsonForms.config
  );
  const [activeKey, setActiveKey] = React.useState(() => categories[0]?.key ?? null);
  const activeCategory = categories.find((entry) => entry.key === activeKey) ?? categories[0] ?? null;
  const tabRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const instanceId = React.useId().replace(/:/g, "");

  React.useEffect(() => {
    const resolvedKey = activeCategory?.key ?? null;
    if (activeKey !== resolvedKey) setActiveKey(resolvedKey);
  }, [activeCategory?.key, activeKey]);

  const selectCategory = React.useCallback((entry: VisibleCategory, focus = false) => {
    setActiveKey(entry.key);
    if (focus) tabRefs.current.get(entry.key)?.focus();
  }, []);

  const handleTabKeyDown = React.useCallback((
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % categories.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + categories.length) % categories.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = categories.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    selectCategory(categories[nextIndex], true);
  }, [categories, selectCategory]);

  const categorizationClassName = getStyleAsClassName("categorization");
  const masterClassName = getStyleAsClassName("categorization.master");
  const detailClassName = getStyleAsClassName("categorization.detail");
  const tabsClassName = getStyleAsClassName("category.subcategories");

  return (
    <div className={categorizationClassName} hidden={!visible}>
      <div className={masterClassName}>
        <ul
          className={tabsClassName}
          role="tablist"
          aria-label={deriveLabelForUISchemaElement(categorization, t) ?? "Form sections"}
        >
          {categories.map((entry, index) => {
            const selected = entry.key === activeCategory?.key;
            const tabId = `${instanceId}-tab-${entry.key.replace(/\./g, "-")}`;
            const panelId = `${instanceId}-panel-${entry.key.replace(/\./g, "-")}`;
            return (
              <li key={entry.key} className="log-jsonforms-tab-item" role="presentation">
                <button
                  ref={(node) => {
                    if (node) tabRefs.current.set(entry.key, node);
                    else tabRefs.current.delete(entry.key);
                  }}
                  id={tabId}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  className="log-jsonforms-tab-button outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => selectCategory(entry)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {entry.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {activeCategory ? (
        <div
          id={`${instanceId}-panel-${activeCategory.key.replace(/\./g, "-")}`}
          className={detailClassName}
          role="tabpanel"
          aria-labelledby={`${instanceId}-tab-${activeCategory.key.replace(/\./g, "-")}`}
          tabIndex={0}
        >
          {(activeCategory.category.elements ?? []).map((child, index) => (
            <JsonFormsDispatch
              key={`${activeCategory.key}-${index}`}
              uischema={child}
              schema={schema}
              path={path}
              renderers={renderers}
              cells={cells}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const ConditionalCategorization = withJsonFormsLayoutProps(ConditionalCategorizationRenderer);

const logRenderers: JsonFormsRendererRegistryEntry[] = [
  {
    tester: rankWith(
      3,
      (uischema) => uischema.type === "Categorization" && categorizationHasCategory(uischema)
    ),
    renderer: ConditionalCategorization,
  },
  { tester: rankWith(3, isObjectControl), renderer: ObjectControl },
  ...vanillaRenderers,
];

const logCells: JsonFormsCellRendererRegistryEntry[] = [
  { tester: rankWith(4, isEnumControl), cell: FixedEnumCell },
  { tester: rankWith(4, isOneOfEnumControl), cell: FixedOneOfEnumCell },
  ...vanillaCells,
];

export interface LogJsonFormsProps {
  form: LogFormDefinition;
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>, errors: JsonFormsCore["errors"]) => void;
  readonly?: boolean;
  /** Defaults to ValidateAndHide so empty required fields don't scream on first paint. */
  validationMode?: "ValidateAndShow" | "ValidateAndHide" | "NoValidation";
}

function imageValues(schema: JsonSchema, data: Record<string, unknown>) {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  return Object.entries(properties).flatMap(([id, rawProperty]) => {
    if (!rawProperty || typeof rawProperty !== "object" || Array.isArray(rawProperty)) return [];
    const property = rawProperty as JsonSchema;
    const isImage = property.type === "string" && property.format === "image";
    const item = property.items && typeof property.items === "object" && !Array.isArray(property.items)
      ? property.items as JsonSchema
      : null;
    const isSequence = property.type === "array" && item?.type === "string" && item.format === "image";
    if (!isImage && !isSequence) return [];
    const rawValue = data[id];
    const values: unknown[] = isSequence && Array.isArray(rawValue) ? rawValue : [rawValue];
    const urls = values
      .filter((value): value is string => typeof value === "string" && value.startsWith("/vault/"));
    return urls.length ? [{ id, title: typeof property.title === "string" ? property.title : id, urls }] : [];
  });
}

/**
 * Renders a log page's JSON Forms script with design-system-aligned vanilla
 * renderers. Layout richness (including two-column HorizontalLayout) comes from
 * the script — not from hand-rolled Form fields.
 */
export function LogJsonForms({
  form,
  data,
  onChange,
  readonly,
  validationMode = "ValidateAndHide",
}: LogJsonFormsProps) {
  const schema = form.schema as JsonSchema;
  const uischema = form.uischema as UISchemaElement;
  const images = imageValues(schema, data);

  return (
    <JsonFormsStyleContext.Provider value={styleContextValue}>
      <div data-testid="log-jsonforms" className="log-jsonforms w-full">
        <style>{`
          .log-jsonforms-categorization > div:first-child ul,
          .log-jsonforms-tabs ul,
          .log-jsonforms ul.m-0 {
            display: flex;
            flex-wrap: wrap;
            gap: 0.25rem;
            list-style: none;
            margin: 0;
            padding: 0;
          }
          .log-jsonforms-categorization > div:first-child ul li,
          .log-jsonforms-tabs ul li,
          .log-jsonforms ul.m-0 li {
            display: inline-flex;
            align-items: center;
            height: 2rem;
            padding: 0 0.75rem;
            border-radius: 0.5rem;
            border: 1px solid transparent;
            font-size: 0.875rem;
            color: var(--muted-foreground);
            cursor: pointer;
            user-select: none;
          }
          .log-jsonforms-categorization > div:first-child ul li:hover,
          .log-jsonforms-tabs ul li:hover,
          .log-jsonforms ul.m-0 li:hover {
            background: var(--surface);
            color: var(--foreground);
          }
          .log-jsonforms-categorization > div:first-child ul li.selected,
          .log-jsonforms-tabs ul li.selected,
          .log-jsonforms ul.m-0 li.selected {
            border-color: var(--border);
            background: var(--surface);
            color: var(--foreground);
            font-weight: 500;
          }
          .log-jsonforms ul.m-0 li.log-jsonforms-tab-item {
            height: auto;
            padding: 0;
            border: 0;
            border-radius: 0;
            color: inherit;
            cursor: default;
          }
          .log-jsonforms ul.m-0 li.log-jsonforms-tab-item:hover {
            background: transparent;
            color: inherit;
          }
          .log-jsonforms [role="tab"] {
            appearance: none;
            border: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            cursor: pointer;
            outline: none;
          }
          .log-jsonforms [role="tab"].log-jsonforms-tab-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            height: 2rem;
            padding: 0 0.75rem;
            border: 1px solid transparent;
            border-radius: 0.5rem;
            color: var(--muted-foreground);
            font-size: 0.875rem;
            user-select: none;
          }
          .log-jsonforms [role="tab"].log-jsonforms-tab-button:hover {
            background: var(--surface);
            color: var(--foreground);
          }
          .log-jsonforms [role="tab"].log-jsonforms-tab-button[aria-selected="true"] {
            border-color: var(--border);
            background: var(--surface);
            color: var(--foreground);
            font-weight: 500;
          }
          .log-jsonforms table {
            width: 100%;
            border-collapse: collapse;
          }
          .log-jsonforms table th,
          .log-jsonforms table td {
            padding: 0.35rem 0.4rem;
            text-align: left;
            vertical-align: middle;
            border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
          }
          .log-jsonforms table th {
            font-size: 0.75rem;
            font-weight: 500;
            color: var(--muted-foreground);
          }
          .log-jsonforms input[type="checkbox"] {
            width: 1rem;
            height: 1rem;
            accent-color: var(--accent);
          }
        `}</style>
        <JsonForms
          schema={schema}
          uischema={uischema}
          data={data}
          renderers={logRenderers}
          cells={logCells}
          readonly={readonly}
          validationMode={validationMode}
          onChange={({ data: next, errors }) => {
            onChange((next ?? {}) as Record<string, unknown>, errors);
          }}
        />
        {images.map((image) => (
          <section key={image.id} data-testid={`log-image-preview-${image.id}`} className="mt-3">
            <p className="mb-1.5 text-sm font-medium text-foreground">{image.title}</p>
            <div className="flex flex-wrap gap-2">
              {image.urls.map((url) => (
                <img key={url} src={url} alt="" className="size-20 rounded-md border border-border object-cover" />
              ))}
            </div>
          </section>
        ))}
      </div>
    </JsonFormsStyleContext.Provider>
  );
}
