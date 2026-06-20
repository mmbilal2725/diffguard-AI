export type UnifiedDiffLineKind = "add" | "context" | "delete";

export type UnifiedDiffLine = {
  content: string;
  kind: UnifiedDiffLineKind;
  newLine?: number;
  oldLine?: number;
};

export type UnifiedDiffHunk = {
  header: string;
  lines: UnifiedDiffLine[];
  newStart: number;
  oldStart: number;
};

export type UnifiedDiffFile = {
  hunks: UnifiedDiffHunk[];
  newPath: string | null;
  oldPath: string | null;
};

export type UnifiedDiff = {
  files: UnifiedDiffFile[];
};

const DIFF_HEADER_PATTERN = /^diff --git a\/(.+) b\/(.+)$/;
const OLD_FILE_PATTERN = /^--- (.+)$/;
const NEW_FILE_PATTERN = /^\+\+\+ (.+)$/;
const RENAME_FROM_PATTERN = /^rename from (.+)$/;
const RENAME_TO_PATTERN = /^rename to (.+)$/;
const HUNK_PATTERN = /^@@ -(?<oldStart>\d+)(?:,\d+)? \+(?<newStart>\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(diff: string): UnifiedDiff {
  const files: UnifiedDiffFile[] = [];
  let currentFile: UnifiedDiffFile | undefined;
  let currentHunk: UnifiedDiffHunk | undefined;
  let oldLine: number | undefined;
  let newLine: number | undefined;

  for (const line of diff.split("\n")) {
    const diffHeader = DIFF_HEADER_PATTERN.exec(line);
    if (diffHeader !== null) {
      currentFile = {
        hunks: [],
        newPath: diffHeader[2] ?? null,
        oldPath: diffHeader[1] ?? null,
      };
      files.push(currentFile);
      currentHunk = undefined;
      oldLine = undefined;
      newLine = undefined;
      continue;
    }

    if (currentFile === undefined && HUNK_PATTERN.test(line)) {
      currentFile = {
        hunks: [],
        newPath: null,
        oldPath: null,
      };
      files.push(currentFile);
    }

    if (currentFile === undefined) {
      continue;
    }

    const oldFile = OLD_FILE_PATTERN.exec(line);
    if (oldFile !== null) {
      currentFile.oldPath = normalizeDiffPath(oldFile[1]);
      continue;
    }

    const newFile = NEW_FILE_PATTERN.exec(line);
    if (newFile !== null) {
      currentFile.newPath = normalizeDiffPath(newFile[1]);
      continue;
    }

    const renameFrom = RENAME_FROM_PATTERN.exec(line);
    if (renameFrom !== null) {
      currentFile.oldPath = renameFrom[1] ?? null;
      continue;
    }

    const renameTo = RENAME_TO_PATTERN.exec(line);
    if (renameTo !== null) {
      currentFile.newPath = renameTo[1] ?? null;
      continue;
    }

    const hunk = HUNK_PATTERN.exec(line);
    if (hunk !== null) {
      oldLine = Number.parseInt(hunk.groups?.oldStart ?? "0", 10);
      newLine = Number.parseInt(hunk.groups?.newStart ?? "0", 10);
      currentHunk = {
        header: line,
        lines: [],
        newStart: newLine,
        oldStart: oldLine,
      };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (
      currentHunk === undefined ||
      oldLine === undefined ||
      newLine === undefined ||
      line.startsWith("\\")
    ) {
      continue;
    }

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        content: line,
        kind: "add",
        newLine,
      });
      newLine += 1;
      continue;
    }

    if (line.startsWith("-")) {
      currentHunk.lines.push({
        content: line,
        kind: "delete",
        oldLine,
      });
      oldLine += 1;
      continue;
    }

    currentHunk.lines.push({
      content: line,
      kind: "context",
      newLine,
      oldLine,
    });
    oldLine += 1;
    newLine += 1;
  }

  return { files };
}

function normalizeDiffPath(path: string | undefined): string | null {
  if (path === undefined || path === "/dev/null") {
    return null;
  }

  return path.replace(/^[ab]\//, "");
}
