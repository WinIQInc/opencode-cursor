import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCursorSdkEntry } from "../src/cursor-runtime.js";

/** A fake install: <root>/node_modules/@cursor/sdk next to <root>/node_modules/plugin/dist/chunk.js. */
function fakeInstall(exportsField: unknown, files: string[]): { root: string; chunk: string } {
	const root = mkdtempSync(join(tmpdir(), "cursor-runtime-"));
	const sdk = join(root, "node_modules", "@cursor", "sdk");
	mkdirSync(sdk, { recursive: true });
	writeFileSync(join(sdk, "package.json"), JSON.stringify({ name: "@cursor/sdk", exports: exportsField }));
	for (const file of files) {
		mkdirSync(join(sdk, file, ".."), { recursive: true });
		writeFileSync(join(sdk, file), "export {};\n");
	}
	const chunkDir = join(root, "node_modules", "plugin", "dist");
	mkdirSync(chunkDir, { recursive: true });
	const chunk = join(chunkDir, "chunk.js");
	writeFileSync(chunk, "");
	return { root, chunk };
}

const CONDITIONAL = {
	".": {
		bun: "./dist/bundled/index.js",
		import: "./dist/esm/index.js",
		default: "./dist/esm/index.js",
	},
};

describe("findCursorSdkEntry", () => {
	it("walks up to the package and picks the bun export under Bun", () => {
		const { root, chunk } = fakeInstall(CONDITIONAL, ["dist/bundled/index.js", "dist/esm/index.js"]);
		expect(findCursorSdkEntry(chunk, true)).toBe(
			join(root, "node_modules", "@cursor", "sdk", "dist", "bundled", "index.js"),
		);
	});

	it("picks the import export outside Bun", () => {
		const { root, chunk } = fakeInstall(CONDITIONAL, ["dist/bundled/index.js", "dist/esm/index.js"]);
		expect(findCursorSdkEntry(chunk, false)).toBe(
			join(root, "node_modules", "@cursor", "sdk", "dist", "esm", "index.js"),
		);
	});

	it("accepts a plain string export", () => {
		const { root, chunk } = fakeInstall("./index.js", ["index.js"]);
		expect(findCursorSdkEntry(chunk, true)).toBe(join(root, "node_modules", "@cursor", "sdk", "index.js"));
	});

	it("returns undefined when the export target is missing on disk", () => {
		const { chunk } = fakeInstall(CONDITIONAL, []);
		expect(findCursorSdkEntry(chunk, true)).toBeUndefined();
	});

	it("returns undefined when no @cursor/sdk is installed above the file", () => {
		const dir = mkdtempSync(join(tmpdir(), "cursor-runtime-empty-"));
		expect(findCursorSdkEntry(join(dir, "chunk.js"), true)).toBeUndefined();
	});
});
