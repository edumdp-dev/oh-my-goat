import { describe, expect, it } from "bun:test";
import { resolveUpdateMethodForTest } from "@oh-my-pi/pi-coding-agent/cli/update-cli";

// Issue #845: on Windows with Bun installed via Scoop, ~/.bun is a junction
// to scoop\persist\Oven-sh.Bun\.bun. The old package-manager-aware updater
// compared the launcher path against `bun pm bin -g` lexically (without
// following links), misclassified a bun-managed omp as "binary", and tried to
// swap omp.exe in place — which fails on Windows because Bun has the file
// open (EPERM on unlink of .bak).
//
// OhMyGoat updates are binary-only: there are no manager channels left to
// distinguish, so every layout — symlinked bin dir or not — resolves to
// "binary" and this misclassification class is gone by construction. These
// tests pin that invariant with the original symlink fixture.

describe("issue-845: binary-only updates ignore symlinked bin dirs", () => {
	it("classifies ohmg reached through a symlinked bin dir as binary", () => {
		expect(resolveUpdateMethodForTest("/tmp/link-bin/ohmg", "/tmp/real/bin")).toBe("binary");
	});

	it("classifies ohmg at the real bin dir as binary when bunBinDir is symlinked", () => {
		expect(resolveUpdateMethodForTest("/tmp/real/bin/ohmg", "/tmp/link-bin")).toBe("binary");
	});
});
