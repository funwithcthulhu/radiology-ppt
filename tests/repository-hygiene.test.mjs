import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";

const PUBLIC_TEXT_PATHS = [
  "README.md",
  "SECURITY.md",
  "docs",
  ".github",
  "examples",
];

const personalPathPatterns = [
  { label: "Windows user profile path", pattern: /C:[\\/]+Users[\\/]/i },
  { label: "OneDrive desktop path", pattern: /OneDrive[\\/]+Desktop/i },
  {
    label: "local project checkout path",
    pattern: /radiopaedia_case_powerpoint_builder/i,
  },
];

test("public documentation avoids machine-specific paths", async () => {
  const files = execFileSync("git", ["ls-files", "--", ...PUBLIC_TEXT_PATHS], {
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter((file) => /\.(md|ya?ml)$/i.test(file));

  const findings = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    for (const { label, pattern } of personalPathPatterns) {
      if (pattern.test(text)) {
        findings.push(`${file}: ${label}`);
      }
    }
  }

  assert.deepEqual(findings, []);
});
