"use client";

import * as React from "react";
import { AiSidebar, MobileAiSheet, type AiSidebarMessage } from "@/components/ai-sidebar";

const RESEARCH_REPLY = `Here is a compact comparison of the minimum workout versions across all three days.

| Day | Focus | Minimum set | Rest |
| --- | --- | --- | --- |
| A | Push | 3 × 8 bench | 90s |
| B | Pull | 3 × 10 row | 75s |
| C | Legs | 2 × 12 squat | 120s |

> Keep the table as a durable record in the note; this companion thread clears when you switch pages.

\`\`\`ts
function summarizeMinimumSets(workouts: Workout[]) {
  return workouts.map((day) => ({
    day: day.label,
    sets: day.exercises.reduce((sum, move) => sum + move.sets, 0),
  }));
}
\`\`\`

The code block above is sized for comfortable reading in the companion column.`;

const SAMPLE_MESSAGES: AiSidebarMessage[] = [
  {
    id: "user-1",
    role: "user",
    content: "Summarize the minimum versions of workouts A, B, and C in a table.",
  },
  {
    id: "assistant-1",
    role: "assistant",
    content: RESEARCH_REPLY,
    modelLabel: "claude-haiku-4.5",
  },
];

interface AiScreensShowcaseProps {
  surface: "desktop" | "mobile";
}

export function AiScreensShowcase({ surface }: AiScreensShowcaseProps) {
  const [inputValue, setInputValue] = React.useState("");
  const sharedProps = {
    pageTitle: "Strength Training — Minimum Versions",
    scopeLabel: "Whole note",
    tokenLabel: "2.1k tokens",
    activeScope: "whole" as const,
    scopeOptions: [{ value: "whole" as const, label: "Whole note" }],
    keepConversation: false,
    onKeepConversationChange: () => undefined,
    activeProviderLabel: "Claude",
    activeModelLabel: "Sonnet",
    assistantLabel: "assistant",
    messages: SAMPLE_MESSAGES,
    inputValue,
    verboseEnabled: true,
    onInputChange: setInputValue,
    onSubmit: () => undefined,
    onScopeChange: () => undefined,
  };

  if (surface === "mobile") {
    return (
      <main className="min-h-screen bg-background text-foreground" data-testid="ai-screens-mobile">
        <MobileAiSheet open onOpenChange={() => undefined}>
          <AiSidebar {...sharedProps} mobile onClose={() => undefined} />
        </MobileAiSheet>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground" data-testid="ai-screens-desktop">
      <div className="mx-auto flex min-h-screen max-w-[1680px] flex-col">
        <div className="h-16 border-b border-border bg-background/95" />
        <div className="flex flex-1 overflow-hidden">
          <section className="flex min-w-0 flex-1 flex-col bg-surface" />
          <aside
            className="hidden w-[480px] border-l border-border bg-[color:var(--rail)] xl:flex xl:flex-col"
            data-testid="ai-sidebar-rail"
          >
            <AiSidebar {...sharedProps} />
          </aside>
        </div>
      </div>
    </main>
  );
}
