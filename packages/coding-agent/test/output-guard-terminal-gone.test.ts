import { afterEach, describe, expect, it, vi } from "vitest";
import { isStdoutTakenOver, restoreStdout, takeOverStdout, writeRawStdout } from "../src/core/output-guard.ts";

/**
 * A terminal that goes away makes stdout writes fail with EPIPE/ECONNRESET.
 * The old behaviour was `process.exit(1)`, which killed the TUI with no message,
 * no terminal restore, and no final transcript entry. This pins the graceful
 * path instead.
 *
 * `takeOverStdout` captures the *current* `process.stdout.write` as its raw
 * handle, so the broken write must be installed before the takeover runs.
 */
describe("writeRawStdout when the terminal is gone", () => {
	afterEach(() => {
		restoreStdout();
		vi.restoreAllMocks();
	});

	it("restores the terminal and reports once instead of exiting", async () => {
		const broken = (_chunk: string, cb?: (error?: Error | null) => void): boolean => {
			// Write streams report failures through the callback, asynchronously.
			queueMicrotask(() => cb?.(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })));
			return false;
		};
		vi.spyOn(process.stdout, "write").mockImplementation(broken as never);
		takeOverStdout();
		expect(isStdoutTakenOver()).toBe(true);

		const exit = vi.spyOn(process, "exit").mockImplementation((() => {
			throw new Error("process.exit called");
		}) as never);
		const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		// Every write now fails the way a gone terminal makes them fail.
		writeRawStdout("one");
		writeRawStdout("two");
		await vi.waitFor(() => expect(isStdoutTakenOver()).toBe(false));
		writeRawStdout("three");
		await new Promise((r) => setTimeout(r, 50));

		expect(exit).not.toHaveBeenCalled();

		const text = err.mock.calls.map((c) => String(c[0])).join("");
		expect(text).toContain("EPIPE");
		expect(text).toContain("--continue");
		// One shutdown line, not one per failed write.
		expect(text.split("pi: stdout write failed").length - 1).toBe(1);
	});
});
