const fs = require("fs");
const path = require("path");

const testsDir = path.join(__dirname, "..", "tests");

for (const fileName of fs.readdirSync(testsDir)) {
  if (!fileName.endsWith(".test.ts")) continue;
  const filePath = path.join(testsDir, fileName);
  let source = fs.readFileSync(filePath, "utf8");

  source = source.replace(/\b([A-Za-z0-9][A-Za-z0-9_-]*)\.md\b/g, "$1.html");
  source = source.replace(/Page files must use the \.md extension/g, "Page files must use the .html extension");
  source = source.replace(/returns 400 for non-\.md path/g, "returns 400 for non-.html path");
  source = source.replace(/\.endsWith\("\.md"\)/g, '.endsWith(".html")');
  source = source.replace(/toMatch\(\/\\\.md\$\/\)/g, "toMatch(/\\.html$/)");

  source = source.replace(
    /# Seed\n\nInitial body\./g,
    "<h1>Seed</h1>\n<p>Initial body.</p>"
  );

  fs.writeFileSync(filePath, source);
  console.log("updated", fileName);
}

console.log("done");
