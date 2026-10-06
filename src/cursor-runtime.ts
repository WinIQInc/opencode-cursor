/**
 * Lazy loader for the official Cursor SDK (`@cursor/sdk`).
 *
 * The SDK is heavy and only needed once a Cursor model is actually used or
 * models are discovered, so it is imported on demand. A failed import (e.g. the
 * dependency is missing) degrades gracefully into a clear error instead of
 * crashing opencode at startup.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type CursorSdkModule = typeof import("@cursor/sdk");

let cached: Promise<CursorSdkModule> | undefined;

export async function loadCursorSdk(): Promise<CursorSdkModule> {
  if (!cached) {
    cached = importCursorSdk().catch((err: unknown) => {
      // Allow a later retry if the failure was transient.
      cached = undefined;
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[opencode-cursor] Failed to load "@cursor/sdk". Make sure it is installed ` +
          `(\`npm install @cursor/sdk\`). Original error: ${detail}`,
      );
    });
  }
  return cached;
}

/**
 * opencode's compiled Bun runtime (1.18.x) does not resolve bare specifiers in
 * a dynamic `import()` against the plugin's own `node_modules`: the package is
 * installed next to the plugin, yet `import("@cursor/sdk")` throws "Cannot find
 * module". Importing the same entry by absolute path works, so fall back to
 * locating the package from this module's location.
 */
async function importCursorSdk(): Promise<CursorSdkModule> {
  try {
    return await import("@cursor/sdk");
  } catch (err) {
    const entry = findCursorSdkEntry(fileURLToPath(import.meta.url));
    if (!entry) throw err;
    return (await import(pathToFileURL(entry).href)) as CursorSdkModule;
  }
}

/**
 * The `@cursor/sdk` entry file for this runtime, found by walking up from
 * `fromFile` through `node_modules` directories the way Node resolution would:
 * the package's `bun` export under Bun, otherwise its `import` export.
 */
export function findCursorSdkEntry(
  fromFile: string,
  isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined",
): string | undefined {
  for (let dir = dirname(fromFile); ; dir = dirname(dir)) {
    const packageDir = join(dir, "node_modules", "@cursor", "sdk");
    const entry = packageEntry(packageDir, isBun);
    if (entry) return entry;
    if (dirname(dir) === dir) return undefined;
  }
}

function packageEntry(packageDir: string, isBun: boolean): string | undefined {
  const manifest = join(packageDir, "package.json");
  if (!existsSync(manifest)) return undefined;
  let exports: unknown;
  try {
    exports = (JSON.parse(readFileSync(manifest, "utf8")) as { exports?: unknown }).exports;
  } catch {
    return undefined;
  }
  const root =
    typeof exports === "object" && exports !== null && "." in exports
      ? (exports as Record<string, unknown>)["."]
      : exports;
  const target =
    typeof root === "string"
      ? root
      : typeof root === "object" && root !== null
        ? pickCondition(root as Record<string, unknown>, isBun)
        : undefined;
  if (!target) return undefined;
  const entry = join(packageDir, target);
  return existsSync(entry) ? entry : undefined;
}

function pickCondition(conditions: Record<string, unknown>, isBun: boolean): string | undefined {
  for (const name of isBun ? ["bun", "import", "default"] : ["import", "default"]) {
    const value = conditions[name];
    if (typeof value === "string") return value;
  }
  return undefined;
}
