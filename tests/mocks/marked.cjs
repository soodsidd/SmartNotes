function basicMarkdownToHtml(body) {
  const trimmed = body.trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\n{2,}/)
    .map((block) => {
      const line = block.trim();
      if (/^#{1,6}\s/.test(line)) {
        const level = line.match(/^(#+)/)?.[1]?.length ?? 1;
        const text = line.replace(/^#+\s*/, "");
        return `<h${Math.min(level, 6)}>${text}</h${Math.min(level, 6)}>`;
      }
      if (line.startsWith("```")) {
        const code = line.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
        return `<pre><code>${code}</code></pre>`;
      }
      return `<p>${line.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

module.exports = {
  marked: {
    setOptions() {},
    parse: basicMarkdownToHtml,
  },
};
