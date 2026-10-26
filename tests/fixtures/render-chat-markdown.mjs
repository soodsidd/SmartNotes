// SN-369: render chat markdown through the REAL Companion pipeline
// (normalizeChatMath → react-markdown + remark-gfm + remark-math{singleDollarTextMath:false} + rehype-katex).
// Usage: node tests/fixtures/render-chat-markdown.mjs < json-array-of-strings  → json array of HTML strings
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeChatMath, CHAT_REMARK_MATH_OPTIONS } from "../../src/lib/math-delimiters.ts";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const inputs = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const out = inputs.map((text) =>
  renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm, [remarkMath, CHAT_REMARK_MATH_OPTIONS]],
        rehypePlugins: [[rehypeKatex, { throwOnError: false, strict: "ignore" }]],
      },
      normalizeChatMath(text)
    )
  )
);
process.stdout.write(JSON.stringify(out));
