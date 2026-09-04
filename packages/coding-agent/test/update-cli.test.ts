import { afterEach, describe, expect, it, type Mock, spyOn, vi } from "bun:test";
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as pluginCli from "@oh-my-pi/pi-coding-agent/cli/plugin-cli";
import * as updateCli from "@oh-my-pi/pi-coding-agent/cli/update-cli";
import {
	downloadVerifiedBinary,
	getLatestRelease,
	isMuslLinuxForTest,
	parseProductTag,
	parseReportedVersion,
	parseUpdateArgs,
	replaceBinaryForUpdate,
	resolveReleaseBinaryAsset,
	resolveUpdateMethodForTest,
	sweepStaleUpdateArtifacts,
	updateViaBinaryAt,
	updateViaShimTakeover,
} from "@oh-my-pi/pi-coding-agent/cli/update-cli";
import Update from "@oh-my-pi/pi-coding-agent/commands/update";
import { removeWithRetries } from "@oh-my-pi/pi-utils";
import type { CliConfig } from "@oh-my-pi/pi-utils/cli";
import { getThemeByName, setThemeInstance } from "../src/modes/theme/theme";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-update-test-")));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	vi.restoreAllMocks();

	await Promise.all(tempDirs.splice(0).map(dir => removeWithRetries(dir)));
});
const TEST_CONFIG: CliConfig = {
	bin: "omp",
	version: "0.0.0-test",
	commands: new Map(),
};

describe("update command plugin dispatch", () => {
	it("routes -l to plugin upgrade instead of the app updater", async () => {
		const pluginSpy = spyOn(pluginCli, "runPluginCommand").mockResolvedValue(undefined);
		const updateSpy = spyOn(updateCli, "runUpdateCommand").mockResolvedValue(undefined);

		const command = new Update(["-l"], TEST_CONFIG);
		await command.run();

		expect(pluginSpy).toHaveBeenCalledWith({ action: "upgrade", args: [], flags: {} });
		expect(updateSpy).not.toHaveBeenCalled();
	});

	it("keeps normal update flags on the app updater path", async () => {
		const pluginSpy = spyOn(pluginCli, "runPluginCommand").mockResolvedValue(undefined);
		const updateSpy = spyOn(updateCli, "runUpdateCommand").mockResolvedValue(undefined);

		const command = new Update(["--check", "--force"], TEST_CONFIG);
		await command.run();

		expect(updateSpy).toHaveBeenCalledWith({ force: true, check: true, channel: undefined });
		expect(pluginSpy).not.toHaveBeenCalled();
	});
});

describe("parseUpdateArgs", () => {
	it("preserves the legacy plugin update shorthand", () => {
		expect(parseUpdateArgs(["update", "-l"])).toEqual({
			force: false,
			check: false,
			plugins: true,
			channel: undefined,
		});
	});

	it("parses update channels", () => {
		expect(parseUpdateArgs(["update", "--canary"])?.channel).toBe("canary");
		expect(parseUpdateArgs(["update", "--stable"])?.channel).toBe("stable");
		expect(parseUpdateArgs(["update"])?.channel).toBeUndefined();
	});

	it("rejects conflicting update channels", () => {
		expect(() => parseUpdateArgs(["update", "--canary", "--stable"])).toThrow(
			"--canary and --stable are mutually exclusive",
		);
	});
});

describe("parseReportedVersion", () => {
	it("preserves the prerelease suffix so a canary launcher verifies as up to date", () => {
		// Regression: dropping `-canary.1` made a correctly installed canary
		// build look like a stale `X.Y.Z` launcher, triggering a binary repair
		// that rejects the prerelease GitHub release.
		expect(parseReportedVersion("ohmg/0.0.1-canary.1")).toBe("0.0.1-canary.1");
		expect(parseReportedVersion("ohmg/0.0.5")).toBe("0.0.5");
		expect(parseReportedVersion("not a version")).toBeUndefined();
	});
});

describe("update-cli libc detection", () => {
	it("does not mistake an installed musl loader for a glibc host", () => {
		expect(
			isMuslLinuxForTest({
				platform: "linux",
				alpineRelease: false,
				lddOutput: "ldd (Ubuntu GLIBC 2.39-0ubuntu8.7) 2.39",
			}),
		).toBe(false);
	});

	it("recognizes a musl host from ldd output", () => {
		expect(
			isMuslLinuxForTest({
				platform: "linux",
				alpineRelease: false,
				lddOutput: "musl libc (x86_64)",
			}),
		).toBe(true);
	});
});

describe("update-cli binary-only target", () => {
	it("always updates in place, regardless of install layout or symlinks", () => {
		// No npm, Homebrew, or Mise channels exist, so there is nothing to
		// distinguish: a bun-managed path, a Nix store path, and a plain
		// binary all resolve the same way (issue #845's junction layout
		// included — misclassification is impossible by construction).
		expect(
			resolveUpdateMethodForTest("/Users/test/.bun/install/global/bin/ohmg", "/Users/test/.bun/install/global/bin"),
		).toBe("binary");
		expect(resolveUpdateMethodForTest("/nix/store/0123456789-ohmg-0.0.1/bin/ohmg", undefined)).toBe("binary");
		expect(resolveUpdateMethodForTest("C:/Users/test/AppData/Local/ohmg/ohmg.exe", undefined)).toBe("binary");
	});
});

describe("parseProductTag", () => {
	it("accepts ohmg-v<semver> tags", () => {
		expect(parseProductTag("ohmg-v0.0.3")).toBe("0.0.3");
	});

	it("rejects upstream and malformed tags", () => {
		expect(parseProductTag("v0.0.1")).toBeUndefined();
		expect(parseProductTag("v18.1.8")).toBeUndefined();
		expect(parseProductTag("ohmg-0.0.1")).toBeUndefined();
		expect(parseProductTag("ohmg-v0.0")).toBeUndefined();
		expect(parseProductTag(undefined)).toBeUndefined();
	});
});

describe("getLatestRelease fork resolution", () => {
	const METADATA_URL = "https://api.github.com/repos/edumdp-dev/oh-my-goat/releases/latest";

	function releaseFetch(payload: Record<string, unknown>, seen: string[]) {
		return async (input: string | URL | Request): Promise<Response> => {
			seen.push(String(input));
			return Response.json(payload);
		};
	}

	it("resolves the fork's latest stable release as a binary dist", async () => {
		const seen: string[] = [];
		const release = await getLatestRelease({
			fetchImpl: releaseFetch({ tag_name: "ohmg-v0.0.3", draft: false, prerelease: false }, seen),
			githubToken: "",
		});

		expect(release).toEqual({ tag: "ohmg-v0.0.3", version: "0.0.3", dist: "binary" });
		expect(seen).toEqual([METADATA_URL]);
	});

	it("sends the GitHub token when one is configured", async () => {
		const seen: string[] = [];
		const authHeaders: Array<string | null> = [];
		const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			seen.push(String(input));
			authHeaders.push(new Headers(init?.headers).get("Authorization"));
			return Response.json({ tag_name: "ohmg-v0.0.3", draft: false, prerelease: false });
		};

		await getLatestRelease({ fetchImpl, githubToken: "test-token" });

		expect(seen).toEqual([METADATA_URL]);
		expect(authHeaders).toEqual(["Bearer test-token"]);
	});

	it("rejects tags that are not ohmg-v<semver> releases", async () => {
		const seen: string[] = [];
		await expect(
			getLatestRelease({ fetchImpl: releaseFetch({ tag_name: "v18.1.8", draft: false, prerelease: false }, seen) }),
		).rejects.toThrow("is not an ohmg-v<semver> release");
	});

	it("refuses a prerelease on the stable channel", async () => {
		const seen: string[] = [];
		await expect(
			getLatestRelease({
				fetchImpl: releaseFetch({ tag_name: "ohmg-v0.0.4", draft: false, prerelease: true }, seen),
			}),
		).rejects.toThrow("prerelease");
	});

	it("reports that no canary channel exists without any network request", async () => {
		const seen: string[] = [];
		await expect(
			getLatestRelease({ channel: "canary", fetchImpl: releaseFetch({ tag_name: "ohmg-v0.0.3" }, seen) }),
		).rejects.toThrow("No canary channel exists");
		expect(seen).toEqual([]);
	});

	it("explains how to authenticate after an anonymous GitHub API rate limit", async () => {
		const fetchImpl = async () => new Response(null, { status: 403, statusText: "rate limit exceeded" });
		await expect(getLatestRelease({ fetchImpl, githubToken: "" })).rejects.toThrow(
			"retry later or set GITHUB_TOKEN or GH_TOKEN",
		);
	});
});

describe("update-cli never contacts upstream", () => {
	const tag = "ohmg-v0.0.3";
	const binaries = [
		"ohmg-darwin-x64",
		"ohmg-darwin-arm64",
		"ohmg-linux-x64",
		"ohmg-linux-arm64",
		"ohmg-windows-x64.exe",
		"ohmg-windows-arm64.exe",
	];

	function forkRelease(): Record<string, unknown> {
		return {
			tag_name: tag,
			draft: false,
			prerelease: false,
			assets: binaries.map(name => ({
				name,
				state: "uploaded",
				size: Buffer.byteLength(name),
				digest: `sha256:${createHash("sha256").update(name).digest("hex")}`,
				browser_download_url: `https://github.com/edumdp-dev/oh-my-goat/releases/download/${tag}/${name}`,
			})),
		};
	}

	it("resolves every release asset from the fork, with no upstream-shaped URL", () => {
		const release = forkRelease();
		for (const binaryName of binaries) {
			const asset = resolveReleaseBinaryAsset(release, tag, binaryName);
			expect(asset.url).toBe(`https://github.com/edumdp-dev/oh-my-goat/releases/download/${tag}/${binaryName}`);
		}
	});

	it("only ever requests fork URLs during a full check-and-download cycle", async () => {
		const seen: string[] = [];
		const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
			const requestUrl = String(input);
			seen.push(requestUrl);
			if (
				requestUrl === "https://api.github.com/repos/edumdp-dev/oh-my-goat/releases/latest" ||
				requestUrl === `https://api.github.com/repos/edumdp-dev/oh-my-goat/releases/tags/${tag}`
			) {
				return Response.json(forkRelease());
			}
			const assets = (forkRelease().assets ?? []) as Array<Record<string, unknown>>;
			const asset = assets.find(entry => entry.browser_download_url === requestUrl);
			if (typeof asset?.name === "string") return new Response(asset.name);
			throw new Error(`Unexpected request: ${requestUrl}`);
		};

		const dir = await makeTempDir();
		const targetPath = path.join(dir, "ohmg-linux-x64");
		await updateViaBinaryAt(targetPath, "0.0.3", {
			binaryName: "ohmg-linux-x64",
			fetchImpl,
			verifyInstalledVersion: async () => ({ ok: true, actual: "0.0.3", path: targetPath }),
		});

		expect(seen).toHaveLength(2);
		for (const requestUrl of seen) {
			expect(requestUrl).toContain("edumdp-dev/oh-my-goat");
			expect(requestUrl).not.toContain("can1357/oh-my-pi");
			expect(requestUrl).not.toContain("registry.npmjs.org");
			expect(requestUrl).not.toContain("omp.sh");
		}
		// No request may name an upstream `omp-*` asset.
		expect(seen.join("\n")).not.toMatch(/\/omp-[^/]*$/m);
	});
});

describe("update-cli release binary integrity", () => {
	const tag = "ohmg-v0.0.3";
	const binaryName = "ohmg-linux-x64";
	const url = `https://github.com/edumdp-dev/oh-my-goat/releases/download/${tag}/${binaryName}`;
	const content = "verified binary";
	const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;

	function releaseAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
		return {
			tag_name: tag,
			draft: false,
			prerelease: false,
			assets: [
				{
					name: binaryName,
					state: "uploaded",
					size: Buffer.byteLength(content),
					digest,
					browser_download_url: url,
					...overrides,
				},
			],
		};
	}

	it("selects an uploaded asset with a valid SHA-256 digest", () => {
		expect(resolveReleaseBinaryAsset(releaseAsset(), tag, binaryName)).toEqual({
			url,
			size: Buffer.byteLength(content),
			digest,
		});
	});

	it("rejects missing and unsupported release asset digests", () => {
		expect(() => resolveReleaseBinaryAsset(releaseAsset({ digest: null }), tag, binaryName)).toThrow("has no digest");
		expect(() => resolveReleaseBinaryAsset(releaseAsset({ digest: "sha512:abc" }), tag, binaryName)).toThrow(
			"has an unsupported digest",
		);
	});

	it("rejects a draft, a stable-channel prerelease, and metadata without one exact asset", () => {
		expect(() => resolveReleaseBinaryAsset({ ...releaseAsset(), draft: true }, tag, binaryName)).toThrow(
			"is a draft",
		);
		expect(() => resolveReleaseBinaryAsset({ ...releaseAsset(), prerelease: true }, tag, binaryName)).toThrow(
			"is a prerelease",
		);
		expect(() => resolveReleaseBinaryAsset({ ...releaseAsset(), assets: [] }, tag, binaryName)).toThrow(
			`has 0 assets named ${binaryName}`,
		);
		expect(() =>
			resolveReleaseBinaryAsset(
				{ ...releaseAsset(), assets: [releaseAsset().assets, releaseAsset().assets].flat() },
				tag,
				binaryName,
			),
		).toThrow(`has 2 assets named ${binaryName}`);
		expect(() =>
			resolveReleaseBinaryAsset(
				releaseAsset({ browser_download_url: "https://example.com/ohmg-linux-x64" }),
				tag,
				binaryName,
			),
		).toThrow("has an unexpected download URL");
	});

	it("installs a prerelease asset only when a canary update permits it", () => {
		// Canary GitHub releases are marked prerelease; a canary update passes
		// allowPrerelease so its exact-tag asset installs, while a draft stays
		// rejected even then.
		expect(
			resolveReleaseBinaryAsset({ ...releaseAsset(), prerelease: true }, tag, binaryName, { allowPrerelease: true }),
		).toEqual({ url, size: Buffer.byteLength(content), digest });
		expect(() =>
			resolveReleaseBinaryAsset({ ...releaseAsset(), draft: true }, tag, binaryName, { allowPrerelease: true }),
		).toThrow("is a draft");
	});

	it("writes a download only after its size and digest match", async () => {
		const dir = await makeTempDir();
		const targetPath = path.join(dir, binaryName);

		await downloadVerifiedBinary({
			url,
			targetPath,
			expectedSize: Buffer.byteLength(content),
			expectedDigest: digest,
			fetchImpl: async () => new Response(content),
		});

		expect(await Bun.file(targetPath).text()).toBe(content);
		if (process.platform !== "win32") {
			// NTFS reports 0o666 for freshly written files; POSIX mode bits only apply there.
			expect((await fs.stat(targetPath)).mode & 0o777).toBe(0o755);
		}
	});

	it("aborts the response stream as soon as it exceeds the expected size", async () => {
		const dir = await makeTempDir();
		const targetPath = path.join(dir, binaryName);
		let pulls = 0;
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					pulls++;
					controller.enqueue(new Uint8Array(pulls === 1 ? 2 : 1));
					if (pulls === 2) controller.close();
				},
			},
			{ highWaterMark: 0 },
		);

		await expect(
			downloadVerifiedBinary({
				url,
				targetPath,
				expectedSize: 1,
				expectedDigest: digest,
				fetchImpl: async () => new Response(body),
			}),
		).rejects.toThrow("received at least 2");
		expect(pulls).toBe(1);
		expect(await Bun.file(targetPath).exists()).toBe(false);
	});

	it("wraps a timeout during body streaming with a friendly message", async () => {
		const dir = await makeTempDir();
		const targetPath = path.join(dir, binaryName);
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					controller.enqueue(new Uint8Array(1));
					controller.error(new DOMException("The operation timed out.", "TimeoutError"));
				},
			},
			{ highWaterMark: 0 },
		);

		await expect(
			downloadVerifiedBinary({
				url,
				targetPath,
				expectedSize: Buffer.byteLength(content),
				expectedDigest: digest,
				fetchImpl: async () => new Response(body),
			}),
		).rejects.toThrow("Timed out downloading release binary after 15 minutes");
		expect(await Bun.file(targetPath).exists()).toBe(false);
	});

	it("removes downloads whose size or digest does not match", async () => {
		const dir = await makeTempDir();
		const targetPath = path.join(dir, binaryName);
		const fetchImpl = async () => new Response(content);

		await expect(
			downloadVerifiedBinary({
				url,
				targetPath,
				expectedSize: Buffer.byteLength(content) + 1,
				expectedDigest: digest,
				fetchImpl,
			}),
		).rejects.toThrow("size mismatch");
		expect(await Bun.file(targetPath).exists()).toBe(false);

		await expect(
			downloadVerifiedBinary({
				url,
				targetPath,
				expectedSize: Buffer.byteLength(content),
				expectedDigest: `sha256:${createHash("sha256").update("different binary").digest("hex")}`,
				fetchImpl,
			}),
		).rejects.toThrow("digest mismatch");
		expect(await Bun.file(targetPath).exists()).toBe(false);
	});

	it("rejects an altered version-reporting executable before replacing the installed binary", async () => {
		const dir = await makeTempDir();
		const targetPath = path.join(dir, binaryName);
		const installed = "#!/bin/sh\necho ohmg/0.0.0\n";
		const altered = "#!/bin/sh\necho ohmg/0.0.3\n";
		const expectedDigest = `sha256:${createHash("sha256")
			.update("x".repeat(Buffer.byteLength(altered)))
			.digest("hex")}`;
		await Bun.write(targetPath, installed);
		await fs.chmod(targetPath, 0o755);

		const metadataAuthorizations: Array<string | null> = [];
		const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const requestUrl = String(input);
			if (requestUrl.startsWith("https://api.github.com/")) {
				metadataAuthorizations.push(new Headers(init?.headers).get("Authorization"));
				return new Response(
					JSON.stringify(
						releaseAsset({
							size: Buffer.byteLength(altered),
							digest: expectedDigest,
						}),
					),
				);
			}
			if (requestUrl === url) return new Response(altered);
			throw new Error(`Unexpected request: ${requestUrl}`);
		};

		const previousGitHubToken = Bun.env.GITHUB_TOKEN;
		Bun.env.GITHUB_TOKEN = "test-token";
		try {
			await expect(
				updateViaBinaryAt(targetPath, "0.0.3", {
					binaryName,
					fetchImpl,
				}),
			).rejects.toThrow("digest mismatch");
			expect(metadataAuthorizations).toEqual(["Bearer test-token"]);
			expect(await Bun.file(targetPath).text()).toBe(installed);
			if (process.platform !== "win32") {
				// NTFS reports 0o666 for freshly written files; POSIX mode bits only apply there.
				expect((await fs.stat(targetPath)).mode & 0o777).toBe(0o755);
			}
			const newResidue = (await fs.readdir(dir)).filter(name => name.endsWith(".new"));
			expect(newResidue).toEqual([]);
		} finally {
			if (previousGitHubToken === undefined) delete Bun.env.GITHUB_TOKEN;
			else Bun.env.GITHUB_TOKEN = previousGitHubToken;
		}
	});

	it("explains how to authenticate after an anonymous GitHub API rate limit", async () => {
		const dir = await makeTempDir();
		const targetPath = path.join(dir, binaryName);
		const fetchImpl = async () => new Response(null, { status: 403, statusText: "rate limit exceeded" });

		await expect(
			updateViaBinaryAt(targetPath, "0.0.3", {
				binaryName,
				fetchImpl,
				githubToken: "",
			}),
		).rejects.toThrow("retry later or set GITHUB_TOKEN or GH_TOKEN");
		expect(await Bun.file(targetPath).exists()).toBe(false);
	});
});

describe("update-cli binary replacement", () => {
	it("restores the previous binary when the replacement fails verification", async () => {
		const dir = await makeTempDir();
		const targetPath = path.join(dir, "omp");
		const tempPath = `${targetPath}.new`;
		const backupPath = `${targetPath}.bak`;
		await Bun.write(targetPath, "old binary");
		await Bun.write(tempPath, "broken binary");

		await expect(
			replaceBinaryForUpdate({
				targetPath,
				tempPath,
				backupPath,
				expectedVersion: "15.1.8",
				verifyInstalledVersion: async () => ({ ok: false, path: targetPath }),
			}),
		).rejects.toThrow("restored previous ohmg binary");

		expect(await Bun.file(targetPath).text()).toBe("old binary");
		expect(await Bun.file(tempPath).exists()).toBe(false);
		expect(await Bun.file(backupPath).exists()).toBe(false);
	});

	it("keeps the replacement only after it reports the expected version", async () => {
		const dir = await makeTempDir();
		const targetPath = path.join(dir, "omp");
		const tempPath = `${targetPath}.new`;
		const backupPath = `${targetPath}.bak`;
		await Bun.write(targetPath, "old binary");
		await Bun.write(tempPath, "new binary");

		await replaceBinaryForUpdate({
			targetPath,
			tempPath,
			backupPath,
			expectedVersion: "15.1.8",
			verifyInstalledVersion: async () => ({ ok: true, actual: "15.1.8", path: targetPath }),
		});

		expect(await Bun.file(targetPath).text()).toBe("new binary");
		expect(await Bun.file(tempPath).exists()).toBe(false);
		expect(await Bun.file(backupPath).exists()).toBe(false);
	});
	it("installs at a vacated launcher path when the previous launcher is gone", async () => {
		// Repairing a launcher a failed package-manager reinstall deleted: there
		// is nothing to move aside, so the swap must still land instead of
		// aborting on ENOENT and leaving the user without a launcher.
		const dir = await makeTempDir();
		const targetPath = path.join(dir, "omp");
		const tempPath = `${targetPath}.new`;
		const backupPath = `${targetPath}.bak`;
		await Bun.write(tempPath, "new binary");

		const result = await replaceBinaryForUpdate({
			targetPath,
			tempPath,
			backupPath,
			expectedVersion: "15.1.8",
			verifyInstalledVersion: async () => ({ ok: true, actual: "15.1.8", path: targetPath }),
		});

		expect(result.ok).toBe(true);
		expect(await Bun.file(targetPath).text()).toBe("new binary");
		expect(await Bun.file(backupPath).exists()).toBe(false);
	});
});

describe("update-cli binary replacement on locked backups", () => {
	it("treats an EPERM on backup cleanup as a successful, completed update", async () => {
		// Regression: on Windows the binary moved aside during the swap is still
		// the running process image, so unlinking it throws EPERM. That cleanup
		// failure must not turn a verified swap into "Update failed" (issue #845).
		const dir = await makeTempDir();
		const targetPath = path.join(dir, "omp.exe");
		const tempPath = `${targetPath}.new`;
		const backupPath = `${targetPath}.1700000000000.4242.bak`;
		await Bun.write(targetPath, "old binary");
		await Bun.write(tempPath, "new binary");

		const realUnlink = nodeFs.promises.unlink.bind(nodeFs.promises);
		const spy = spyOn(nodeFs.promises, "unlink").mockImplementation(async (p: nodeFs.PathLike) => {
			if (String(p) === backupPath) {
				const err = new Error(`EPERM: operation not permitted, unlink '${p}'`) as NodeJS.ErrnoException;
				err.code = "EPERM";
				throw err;
			}
			return realUnlink(p);
		});
		try {
			const result = await replaceBinaryForUpdate({
				targetPath,
				tempPath,
				backupPath,
				expectedVersion: "15.1.8",
				verifyInstalledVersion: async () => ({ ok: true, actual: "15.1.8", path: targetPath }),
			});
			expect(result.ok).toBe(true);
		} finally {
			spy.mockRestore();
		}

		// New binary is installed and the temp consumed even though the locked
		// backup survives; the next run's sweep reclaims it once it is unlocked.
		expect(await Bun.file(targetPath).text()).toBe("new binary");
		expect(await Bun.file(tempPath).exists()).toBe(false);
		expect(await Bun.file(backupPath).text()).toBe("old binary");
	});
});

describe("update-cli stale update artifact sweep", () => {
	it("reclaims timestamped and legacy backups and orphaned temps while sparing in-progress temps and unrelated files", async () => {
		const dir = await makeTempDir();
		const targetPath = path.join(dir, "omp.exe");
		await Bun.write(targetPath, "current binary");
		await Bun.write(`${targetPath}.bak`, "legacy backup");
		await Bun.write(`${targetPath}.1700000000000.4242.bak`, "timestamped backup");
		await Bun.write(`${targetPath}.1800000000000.99.bak`, "another backup");
		// Orphaned temp files from a hard-killed download: reaped once older than
		// the download window. Legacy fixed name and timestamped name both count.
		const stale = new Date(Date.now() - 60 * 60 * 1000);
		await Bun.write(`${targetPath}.new`, "legacy temp");
		await fs.utimes(`${targetPath}.new`, stale, stale);
		await Bun.write(`${targetPath}.1700000000000.4242.new`, "timestamped temp");
		await fs.utimes(`${targetPath}.1700000000000.4242.new`, stale, stale);
		// Must survive: a fresh temp still belongs to a concurrent, in-progress
		// download (unique per attempt), plus foreign basenames and non-numeric
		// middle segments.
		await Bun.write(`${targetPath}.9999999999999.7.new`, "in-progress temp");
		await Bun.write(path.join(dir, "notes.bak"), "keep me");
		await Bun.write(`${targetPath}.config.bak`, "keep me too");
		await Bun.write(`${targetPath}.config.new`, "keep me three");

		await sweepStaleUpdateArtifacts(targetPath);

		expect(await Bun.file(targetPath).exists()).toBe(true);
		expect(await Bun.file(`${targetPath}.bak`).exists()).toBe(false);
		expect(await Bun.file(`${targetPath}.1700000000000.4242.bak`).exists()).toBe(false);
		expect(await Bun.file(`${targetPath}.1800000000000.99.bak`).exists()).toBe(false);
		expect(await Bun.file(`${targetPath}.new`).exists()).toBe(false);
		expect(await Bun.file(`${targetPath}.1700000000000.4242.new`).exists()).toBe(false);
		expect(await Bun.file(`${targetPath}.9999999999999.7.new`).exists()).toBe(true);
		expect(await Bun.file(path.join(dir, "notes.bak")).exists()).toBe(true);
		expect(await Bun.file(`${targetPath}.config.bak`).exists()).toBe(true);
		expect(await Bun.file(`${targetPath}.config.new`).exists()).toBe(true);
	});
});

describe("update-cli fork release contract", () => {
	it("pins asset URLs to the fork's ohmg-v tag", () => {
		const binaryName = "ohmg-darwin-arm64";
		const tag = "ohmg-v0.0.3";
		const url = `https://github.com/edumdp-dev/oh-my-goat/releases/download/${tag}/${binaryName}`;
		const digest = `sha256:${createHash("sha256").update("goat").digest("hex")}`;
		expect(
			resolveReleaseBinaryAsset(
				{
					tag_name: tag,
					draft: false,
					prerelease: false,
					assets: [{ name: binaryName, state: "uploaded", size: 4, digest, browser_download_url: url }],
				},
				tag,
				binaryName,
			),
		).toEqual({ url, size: 4, digest });
	});

	it("rejects an upstream-shaped download URL for a fork tag", () => {
		const binaryName = "ohmg-linux-x64";
		const tag = "ohmg-v0.0.3";
		const digest = `sha256:${createHash("sha256").update("goat").digest("hex")}`;
		expect(() =>
			resolveReleaseBinaryAsset(
				{
					tag_name: tag,
					draft: false,
					prerelease: false,
					assets: [
						{
							name: binaryName,
							state: "uploaded",
							size: 4,
							digest,
							browser_download_url: `https://github.com/can1357/oh-my-pi/releases/download/${tag}/${binaryName}`,
						},
					],
				},
				tag,
				binaryName,
			),
		).toThrow("has an unexpected download URL");
	});
});

describe("update-cli script-shim takeover", () => {
	// Tests that execute a text-file `ohmg.exe` stub are skipped on Windows:
	// CreateProcess rejects them (error 193), so only POSIX hosts exercise the
	// real spawn-and-verify path. Linux CI covers them fully.
	const version = "0.0.3";
	const binaryName = "ohmg-windows-x64.exe";
	const url = `https://github.com/edumdp-dev/oh-my-goat/releases/download/ohmg-v${version}/${binaryName}`;

	function makeFetch(content: string, prerelease = false): (input: string | URL | Request) => Promise<Response> {
		const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
		return async (input: string | URL | Request): Promise<Response> => {
			const requestUrl = String(input);
			if (requestUrl.startsWith("https://api.github.com/")) {
				return new Response(
					JSON.stringify({
						tag_name: `ohmg-v${version}`,
						draft: false,
						prerelease,
						assets: [
							{
								name: binaryName,
								state: "uploaded",
								size: Buffer.byteLength(content),
								digest,
								browser_download_url: url,
							},
						],
					}),
				);
			}
			if (requestUrl === url) return new Response(content);
			throw new Error(`Unexpected request: ${requestUrl}`);
		};
	}

	const shims: Record<string, string> = {
		ohmg: "#!/bin/sh\nnode ohmg.js\n",
		"ohmg.cmd": "@node ohmg.js %*\n",
		"ohmg.ps1": "node ohmg.js @args\n",
	};

	async function writeShims(dir: string): Promise<void> {
		for (const name in shims) {
			await Bun.write(path.join(dir, name), shims[name]);
		}
	}

	it.skipIf(process.platform === "win32")("installs ohmg.exe beside the shims and retires them", async () => {
		const dir = await makeTempDir();
		await writeShims(dir);
		// Real executable, no injected verifier: the takeover must verify the
		// exe by explicit path — $which cached the shim path before it was
		// renamed away, so a PATH re-resolution would fail here.
		const exe = `#!/bin/sh\necho ohmg/${version}\n`;

		await updateViaShimTakeover(path.join(dir, "ohmg.cmd"), version, {
			binaryName,
			fetchImpl: makeFetch(exe),
			githubToken: "test-token",
		});

		expect(await Bun.file(path.join(dir, "ohmg.exe")).text()).toBe(exe);
		for (const name in shims) {
			expect(await Bun.file(path.join(dir, name)).exists()).toBe(false);
		}
		const residue = (await fs.readdir(dir)).filter(name => name.endsWith(".bak") || name.endsWith(".new"));
		expect(residue).toEqual([]);
	});

	it.skipIf(process.platform === "win32")(
		"installs a canary prerelease binary only when the caller opts in",
		async () => {
			const dir = await makeTempDir();
			await writeShims(dir);
			const exe = `#!/bin/sh\necho ohmg/${version}\n`;

			// A canary release is published as a prerelease: without opt-in the
			// takeover refuses the asset and leaves the shims intact.
			await expect(
				updateViaShimTakeover(path.join(dir, "ohmg.cmd"), version, {
					binaryName,
					fetchImpl: makeFetch(exe, true),
					githubToken: "test-token",
				}),
			).rejects.toThrow("is a prerelease");
			expect(await Bun.file(path.join(dir, "ohmg.exe")).exists()).toBe(false);

			// allowPrerelease threads through to the asset resolver, so the canary
			// exe installs and the shims are retired.
			await updateViaShimTakeover(path.join(dir, "ohmg.cmd"), version, {
				binaryName,
				fetchImpl: makeFetch(exe, true),
				allowPrerelease: true,
				githubToken: "test-token",
			});
			expect(await Bun.file(path.join(dir, "ohmg.exe")).text()).toBe(exe);
		},
	);

	it("replaces the launcher in place with the verified binary, ignoring any manager metadata", async () => {
		// Binary-only updates never consult package managers: a stale
		// `ohmg.bunx` beside the launcher is inert and left untouched while
		// the launcher itself is replaced with the verified release binary.
		const dir = await makeTempDir();
		const targetPath = path.join(dir, "ohmg.exe");
		const marker = path.join(dir, "ohmg.bunx");
		await Bun.write(targetPath, "bun shim");
		await Bun.write(marker, "bun launcher metadata");
		const exe = `#!/bin/sh\necho ohmg/${version}\n`;

		await updateViaBinaryAt(targetPath, version, {
			binaryName,
			fetchImpl: makeFetch(exe),
			githubToken: "test-token",
			verifyInstalledVersion: async () => ({ ok: true, actual: version, path: targetPath }),
		});

		expect(await Bun.file(targetPath).text()).toBe(exe);
		expect(await Bun.file(marker).text()).toBe("bun launcher metadata");
	});

	it.skipIf(process.platform === "win32")(
		"restores the shims and removes the exe when the exe reports the wrong version",
		async () => {
			const dir = await makeTempDir();
			await writeShims(dir);
			// Executable runs but reports the previous version -> full rollback.
			const exe = "#!/bin/sh\necho ohmg/0.0.0\n";

			await expect(
				updateViaShimTakeover(path.join(dir, "ohmg.cmd"), version, {
					binaryName,
					fetchImpl: makeFetch(exe),
					githubToken: "test-token",
				}),
			).rejects.toThrow(/still reports 0\.0\.0 \(expected 0\.0\.2\); restored previous ohmg launcher/);

			expect(await Bun.file(path.join(dir, "ohmg.exe")).exists()).toBe(false);
			for (const name in shims) {
				expect(await Bun.file(path.join(dir, name)).text()).toBe(shims[name]);
			}
			const residue = (await fs.readdir(dir)).filter(name => name.endsWith(".bak") || name.endsWith(".new"));
			expect(residue).toEqual([]);
		},
	);

	function renameLockingPs1(): Mock<typeof nodeFs.promises.rename> {
		const realRename = nodeFs.promises.rename;
		return spyOn(nodeFs.promises, "rename").mockImplementation(async (from, to) => {
			if (path.basename(String(from)) === "ohmg.ps1") {
				throw Object.assign(new Error("EPERM: file is locked"), { code: "EPERM" });
			}
			return await realRename(from, to);
		});
	}

	it.skipIf(process.platform === "win32")(
		"rewrites an immovable precedence-winning shim as a forwarder to the exe",
		async () => {
			const dir = await makeTempDir();
			await writeShims(dir);
			const exe = `#!/bin/sh\necho ohmg/${version}\n`;
			const renameSpy = renameLockingPs1();
			try {
				await updateViaShimTakeover(path.join(dir, "ohmg.cmd"), version, {
					binaryName,
					fetchImpl: makeFetch(exe),
					githubToken: "test-token",
				});
			} finally {
				renameSpy.mockRestore();
			}

			expect(await Bun.file(path.join(dir, "ohmg.exe")).text()).toBe(exe);
			expect(await Bun.file(path.join(dir, "ohmg")).exists()).toBe(false);
			expect(await Bun.file(path.join(dir, "ohmg.cmd")).exists()).toBe(false);
			// PowerShell resolves .ps1 before .exe: the locked shim must now exec
			// the new binary instead of keeping its old body.
			expect(await Bun.file(path.join(dir, "ohmg.ps1")).text()).toContain('& "$PSScriptRoot\\ohmg.exe" @args');
		},
	);

	it("restores a forwarded shim's original body when verification fails", async () => {
		const dir = await makeTempDir();
		await writeShims(dir);
		const exe = "#!/bin/sh\necho ohmg/0.0.0\n";
		const renameSpy = renameLockingPs1();
		try {
			await expect(
				updateViaShimTakeover(path.join(dir, "ohmg.cmd"), version, {
					binaryName,
					fetchImpl: makeFetch(exe),
					githubToken: "test-token",
				}),
			).rejects.toThrow("restored previous ohmg launcher");
		} finally {
			renameSpy.mockRestore();
		}

		expect(await Bun.file(path.join(dir, "ohmg.exe")).exists()).toBe(false);
		for (const name in shims) {
			expect(await Bun.file(path.join(dir, name)).text()).toBe(shims[name]);
		}
	});
});

describe("update-cli concurrent binary updates", () => {
	const version = "999.0.0";
	const binaryName = "ohmg-linux-x64";
	const url = `https://github.com/edumdp-dev/oh-my-goat/releases/download/ohmg-v${version}/${binaryName}`;
	const payload = Buffer.alloc(2048, 0x41);
	const digest = `sha256:${createHash("sha256").update(payload).digest("hex")}`;

	function metadata(): Response {
		return Response.json({
			tag_name: `ohmg-v${version}`,
			draft: false,
			prerelease: false,
			assets: [{ name: binaryName, state: "uploaded", size: payload.byteLength, digest, browser_download_url: url }],
		});
	}

	const fastFetch = async (input: string | URL | Request): Promise<Response> => {
		const requestUrl = String(input);
		if (requestUrl.startsWith("https://api.github.com/")) return metadata();
		if (requestUrl === url) return new Response(payload);
		throw new Error(`Unexpected request: ${requestUrl}`);
	};

	const verify = async () => ({ ok: true, actual: version });

	async function prepare(): Promise<{ dir: string; targetPath: string }> {
		const loadedTheme = await getThemeByName("dark");
		if (!loadedTheme) throw new Error("theme unavailable");
		setThemeInstance(loadedTheme);
		vi.spyOn(console, "log").mockImplementation(() => {});
		const dir = await makeTempDir();
		const targetPath = path.join(dir, "omp");
		await Bun.write(targetPath, "old binary");
		return { dir, targetPath };
	}

	// Regression for #8434: two overlapping `omp update` runs must not share a
	// temp path. Run A downloads slowly and only finishes after run B has fully
	// installed. With the old fixed `<binary>.new` temp name, B's pre-download
	// unlink deleted A's temp file, so A's chmod failed with ENOENT even though
	// its size + digest passed. Unique temp paths keep the two runs independent.
	it("lets an overlapping slow run install after a fast run completes, instead of failing chmod with ENOENT", async () => {
		const { dir, targetPath } = await prepare();

		const aWroteFirstChunk = Promise.withResolvers<void>();
		const letAFinish = Promise.withResolvers<void>();
		const slowFetch = async (input: string | URL | Request): Promise<Response> => {
			const requestUrl = String(input);
			if (requestUrl.startsWith("https://api.github.com/")) return metadata();
			if (requestUrl === url) {
				return new Response(
					new ReadableStream<Uint8Array>({
						async start(controller) {
							controller.enqueue(payload.subarray(0, 1024));
							aWroteFirstChunk.resolve();
							await letAFinish.promise;
							controller.enqueue(payload.subarray(1024));
							controller.close();
						},
					}),
				);
			}
			throw new Error(`Unexpected request: ${requestUrl}`);
		};

		const runA = updateViaBinaryAt(targetPath, version, {
			binaryName,
			fetchImpl: slowFetch,
			verifyInstalledVersion: verify,
		});
		await aWroteFirstChunk.promise;
		await updateViaBinaryAt(targetPath, version, {
			binaryName,
			fetchImpl: fastFetch,
			verifyInstalledVersion: verify,
		});
		letAFinish.resolve();
		await runA;

		expect(await Bun.file(targetPath).bytes()).toEqual(new Uint8Array(payload));
		const residue = (await fs.readdir(dir)).filter(name => name.endsWith(".new"));
		expect(residue).toEqual([]);
	});

	// Regression: a failed verification must still roll back its own backup even
	// when another update completes while it is held. The per-target lock
	// serializes the swap + sweep, so the concurrent run's sweep cannot reclaim
	// the live backup before the rollback renames it back.
	it("rolls back its backup when verification fails while another update runs", async () => {
		const { dir, targetPath } = await prepare();

		const enteredVerify = Promise.withResolvers<void>();
		const releaseVerify = Promise.withResolvers<void>();
		const failingVerify = async () => {
			enteredVerify.resolve();
			await releaseVerify.promise;
			return { ok: false, actual: "0.0.0", path: targetPath };
		};

		const runA = updateViaBinaryAt(targetPath, version, {
			binaryName,
			fetchImpl: fastFetch,
			verifyInstalledVersion: failingVerify,
		});
		await enteredVerify.promise;
		const runB = updateViaBinaryAt(targetPath, version, {
			binaryName,
			fetchImpl: fastFetch,
			verifyInstalledVersion: verify,
		});
		releaseVerify.resolve();
		await expect(runA).rejects.toThrow(/still reports 0\.0\.0 \(expected 999\.0\.0\)/);
		await runB;

		expect(await Bun.file(targetPath).bytes()).toEqual(new Uint8Array(payload));
		const residue = (await fs.readdir(dir)).filter(name => name.endsWith(".bak") || name.endsWith(".new"));
		expect(residue).toEqual([]);
	});
});
