/**
 * Update CLI command handler.
 *
 * Handles `ohmg update` to check for and install updates.
 * OhMyGoat ships a standalone binary only: the updater resolves the latest
 * stable `ohmg-v<semver>` GitHub release of the fork and replaces the
 * PATH-resolved `ohmg` launcher in place. There are no npm, Homebrew, or Mise
 * channels and no upstream fallback.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { $env, $which, APP_NAME, compareVersions, isEnoent, PRODUCT_VERSION } from "@oh-my-pi/pi-utils";
import chalk from "@oh-my-pi/pi-utils/chalk";
import { withFileLock } from "@oh-my-pi/pi-utils/file-lock";
import { $ } from "bun";
import { settings } from "../config/settings";
import { theme } from "../modes/theme/theme";
import {
	isTimeoutError,
	isUnsupportedProxyError,
	unsupportedProxyMessage,
	withTimeoutSignal,
} from "../utils/fetch-timeout";

const REPO = "edumdp-dev/oh-my-goat";
/** Release tag prefix: OhMyGoat publishes `ohmg-v<semver>` tags. */
const TAG_PREFIX = "ohmg-v";
const GITHUB_API = "https://api.github.com";
const RELEASE_METADATA_TIMEOUT_MS = 30_000;
const BINARY_DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

/** OhMyGoat releases ship as standalone binaries; stable is the only channel. */
export type ReleaseDist = "binary";
export type UpdateChannel = "stable" | "canary";

export interface ReleaseInfo {
	tag: string;
	version: string;
	/** OhMyGoat releases are always binary-distributed. */
	dist: ReleaseDist;
}

export interface ReleaseBinaryAsset {
	url: string;
	size: number;
	digest: string;
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Select and validate the binary asset from GitHub release metadata.
 *
 * Draft releases are always rejected. Prereleases are rejected unless
 * `options.allowPrerelease` is set, which the canary channel passes: canary
 * GitHub releases are published as prereleases, and the exact-tag match below
 * still pins the download to the specific requested version.
 */
export function resolveReleaseBinaryAsset(
	release: unknown,
	expectedTag: string,
	binaryName: string,
	options: { allowPrerelease?: boolean } = {},
): ReleaseBinaryAsset {
	if (!isRecord(release)) {
		throw new Error("Invalid GitHub release metadata");
	}
	if (release.tag_name !== expectedTag) {
		throw new Error(`GitHub release tag mismatch: expected ${expectedTag}`);
	}
	if (release.draft !== false) {
		throw new Error(`GitHub release ${expectedTag} is a draft, not a published release`);
	}
	if (release.prerelease !== false && !options.allowPrerelease) {
		throw new Error(`GitHub release ${expectedTag} is a prerelease; only canary updates install prerelease assets`);
	}
	if (!Array.isArray(release.assets)) {
		throw new Error(`GitHub release ${expectedTag} has no asset list`);
	}

	const matches = release.assets.filter(asset => isRecord(asset) && asset.name === binaryName);
	if (matches.length !== 1) {
		throw new Error(`GitHub release ${expectedTag} has ${matches.length} assets named ${binaryName}`);
	}

	const asset = matches[0];
	if (!isRecord(asset) || asset.state !== "uploaded") {
		throw new Error(`GitHub release asset ${binaryName} is not fully uploaded`);
	}
	if (typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
		throw new Error(`GitHub release asset ${binaryName} has an invalid size`);
	}
	if (typeof asset.digest !== "string") {
		throw new Error(`GitHub release asset ${binaryName} has no digest`);
	}
	const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest)?.[1];
	if (!digest) {
		throw new Error(`GitHub release asset ${binaryName} has an unsupported digest`);
	}

	const expectedUrl = `https://github.com/${REPO}/releases/download/${expectedTag}/${binaryName}`;
	if (asset.browser_download_url !== expectedUrl) {
		throw new Error(`GitHub release asset ${binaryName} has an unexpected download URL`);
	}

	return {
		url: expectedUrl,
		size: asset.size,
		digest: `sha256:${digest.toLowerCase()}`,
	};
}

async function getReleaseBinaryAsset(
	expectedVersion: string,
	binaryName: string,
	fetchImpl: Fetch = fetch,
	githubToken: string | undefined = $env.GITHUB_TOKEN || $env.GH_TOKEN,
	allowPrerelease = false,
): Promise<ReleaseBinaryAsset> {
	const tag = `${TAG_PREFIX}${expectedVersion}`;
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

	let response: Response;
	try {
		response = await fetchImpl(`${GITHUB_API}/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`, {
			headers,
			signal: withTimeoutSignal(RELEASE_METADATA_TIMEOUT_MS),
		});
	} catch (err) {
		if (isTimeoutError(err)) {
			throw new Error("Timed out fetching GitHub release metadata after 30s", { cause: err });
		}
		if (isUnsupportedProxyError(err)) throw new Error(unsupportedProxyMessage(), { cause: err });
		throw err;
	}
	if ((response.status === 403 && !githubToken) || response.status === 429) {
		throw new Error(
			"GitHub API rate limit exceeded while fetching release metadata; retry later or set GITHUB_TOKEN or GH_TOKEN",
		);
	}
	if (!response.ok) {
		throw new Error(`Failed to fetch GitHub release metadata: ${response.statusText}`);
	}

	return resolveReleaseBinaryAsset(await response.json(), tag, binaryName, { allowPrerelease });
}

export interface VerifiedBinaryDownloadOptions {
	url: string;
	targetPath: string;
	expectedSize: number;
	expectedDigest: string;
	fetchImpl?: Fetch;
}

/**
 * Download a binary and verify its GitHub-reported size and SHA-256 digest.
 */
export async function downloadVerifiedBinary(options: VerifiedBinaryDownloadOptions): Promise<void> {
	const fetchImpl = options.fetchImpl ?? fetch;
	await unlinkIfExists(options.targetPath);

	let response: Response;
	try {
		response = await fetchImpl(options.url, {
			redirect: "follow",
			signal: withTimeoutSignal(BINARY_DOWNLOAD_TIMEOUT_MS),
		});
	} catch (err) {
		if (isTimeoutError(err)) {
			throw new Error("Timed out downloading release binary after 15 minutes", { cause: err });
		}
		if (isUnsupportedProxyError(err)) throw new Error(unsupportedProxyMessage(), { cause: err });
		throw err;
	}
	if (!response.ok || !response.body) {
		throw new Error(`Download failed: ${response.statusText}`);
	}

	const hash = createHash("sha256");
	let size = 0;
	const verifier = new Transform({
		transform(chunk, _encoding, callback) {
			size += chunk.byteLength;
			if (size > options.expectedSize) {
				callback(
					new Error(
						`Downloaded binary size mismatch: expected ${options.expectedSize} bytes, received at least ${size}`,
					),
				);
				return;
			}
			hash.update(chunk);
			callback(null, chunk);
		},
	});

	try {
		await pipeline(response.body, verifier, fs.createWriteStream(options.targetPath, { mode: 0o600 }));
		const digest = `sha256:${hash.digest("hex")}`;
		if (size !== options.expectedSize) {
			throw new Error(`Downloaded binary size mismatch: expected ${options.expectedSize} bytes, received ${size}`);
		}
		if (digest !== options.expectedDigest) {
			throw new Error(`Downloaded binary digest mismatch: expected ${options.expectedDigest}, received ${digest}`);
		}
		await fs.promises.chmod(options.targetPath, 0o755);
	} catch (err) {
		await unlinkIfExists(options.targetPath);
		if (isTimeoutError(err)) {
			throw new Error("Timed out downloading release binary after 15 minutes", { cause: err });
		}
		if (isUnsupportedProxyError(err)) throw new Error(unsupportedProxyMessage(), { cause: err });
		throw err;
	}
}

/** Result from running the installed binary and parsing its reported version. */
export interface InstalledVersionVerification {
	ok: boolean;
	actual?: string;
	path?: string;
}

/** Paths and verifier used while replacing a downloaded binary update. */
export interface BinaryReplacementOptions {
	targetPath: string;
	tempPath: string;
	backupPath: string;
	expectedVersion: string;
	verifyInstalledVersion: (expectedVersion: string) => Promise<InstalledVersionVerification>;
}

/**
 * Parse update subcommand arguments.
 * Returns undefined if not an update command.
 */
export function parseUpdateArgs(
	args: string[],
): { force: boolean; check: boolean; plugins: boolean; channel?: UpdateChannel } | undefined {
	if (args.length === 0 || args[0] !== "update") {
		return undefined;
	}

	const canary = args.includes("--canary");
	const stable = args.includes("--stable");
	if (canary && stable) throw new Error("--canary and --stable are mutually exclusive");

	return {
		force: args.includes("--force") || args.includes("-f"),
		check: args.includes("--check") || args.includes("-c"),
		plugins: args.includes("--plugins") || args.includes("-l"),
		channel: canary ? "canary" : stable ? "stable" : undefined,
	};
}

/** Windows script shims (npm's launchers) that a native executable cannot overwrite. */
function isWindowsScriptLauncherPath(launcherPath: string): boolean {
	const extension = path.extname(launcherPath).toLowerCase();
	return extension === ".cmd" || extension === ".ps1" || extension === ".bat";
}

/** OhMyGoat ships a standalone binary only, so every install updates in place. */
export type UpdateMethod = "binary";

export interface UpdateTarget {
	method: "binary";
	path: string;
}

/**
 * Test seam preserving the old `resolveUpdateMethodForTest(ompPath, bunBinDir)`
 * call shape. The classification inputs are ignored: without npm, Homebrew, or
 * Mise channels there is nothing to distinguish, so a symlinked launcher
 * (notably the Windows Scoop-junction layout from issue #845) updates the same
 * binary way as every other install.
 */
export function resolveUpdateMethodForTest(_ompPath: string, _bunBinDir?: string): UpdateMethod {
	return "binary";
}

/**
 * Resolve the binary to replace: the `ohmg` launcher on PATH, updated in
 * place. Package-manager probes are gone on purpose — a binary-only release
 * can never be reinstalled through a manager, so detecting one would only
 * misroute the update.
 */
async function resolveUpdateTarget(): Promise<UpdateTarget> {
	const launcherPath = resolveOmpPath();
	if (!launcherPath) throw new Error(`Could not resolve ${APP_NAME} binary path in PATH`);
	return { method: "binary", path: launcherPath };
}

/** Product tag pattern: `ohmg-v<semver>`, with an optional prerelease suffix. */
const TAG_PATTERN = /^ohmg-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * Parse an `ohmg-v<semver>` tag into its product version.
 * Returns undefined for anything else so foreign tags are never installed.
 */
export function parseProductTag(tag: unknown): string | undefined {
	if (typeof tag !== "string") return undefined;
	return TAG_PATTERN.exec(tag)?.[1];
}

/**
 * Get the latest stable OhMyGoat release from the fork's GitHub releases.
 *
 * Stable is the only channel: a canary request reports that no canary channel
 * exists instead of falling back to anything upstream. Only tags matching
 * `ohmg-v<semver>` are accepted; anything else is rejected rather than
 * installed. Uses the GitHub API (not npm) because nothing is published to a
 * registry.
 */
export async function getLatestRelease(
	options: { timeoutMs?: number; channel?: UpdateChannel; fetchImpl?: Fetch; githubToken?: string } = {},
): Promise<ReleaseInfo> {
	const timeoutMs = options.timeoutMs ?? RELEASE_METADATA_TIMEOUT_MS;
	const channel = options.channel ?? "stable";
	if (channel === "canary") {
		throw new Error(`No canary channel exists for ${APP_NAME}; stable is the only update channel.`);
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const githubToken = options.githubToken ?? $env.GITHUB_TOKEN ?? $env.GH_TOKEN;
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

	let response: Response;
	try {
		response = await fetchImpl(`${GITHUB_API}/repos/${REPO}/releases/latest`, {
			headers,
			signal: withTimeoutSignal(timeoutMs),
		});
	} catch (err) {
		if (isTimeoutError(err)) {
			throw new Error(`Timed out fetching release info for ${REPO} after ${Math.round(timeoutMs / 1000)}s`, {
				cause: err,
			});
		}
		if (isUnsupportedProxyError(err)) throw new Error(unsupportedProxyMessage(), { cause: err });
		throw err;
	}
	if ((response.status === 403 && !githubToken) || response.status === 429) {
		throw new Error(
			"GitHub API rate limit exceeded while fetching release metadata; retry later or set GITHUB_TOKEN or GH_TOKEN",
		);
	}
	if (!response.ok) {
		throw new Error(`Failed to fetch release info for ${REPO}: ${response.statusText}`);
	}

	const data: unknown = await response.json();
	if (!isRecord(data)) {
		throw new Error(`Malformed GitHub release response for ${REPO}: expected an object`);
	}
	if (data.prerelease === true) {
		throw new Error(`Latest ${REPO} release is a prerelease; refusing to install it on the stable channel`);
	}
	const version = parseProductTag(data.tag_name);
	if (!version) {
		const seen = typeof data.tag_name === "string" ? `"${data.tag_name}"` : "a missing tag";
		throw new Error(`GitHub release with ${seen} is not an ${TAG_PREFIX}<semver> release`);
	}

	return {
		tag: `${TAG_PREFIX}${version}`,
		version,
		dist: "binary",
	};
}

/**
 * Detect a musl-libc Linux host (Alpine, Void-musl) so self-update replaces a
 * musl binary with the musl release asset instead of the glibc build, which
 * would fail to start on the next run. The loader file alone is not sufficient:
 * glibc hosts may have musl installed for cross-compilation.
 */
interface MuslDetectionOptions {
	platform?: NodeJS.Platform;
	alpineRelease?: boolean;
	lddOutput?: string;
}

function detectLddOutput(): string | undefined {
	try {
		const result = Bun.spawnSync(["ldd", "--version"], { stdout: "pipe", stderr: "pipe" });
		return `${result.stdout.toString("utf-8")}\n${result.stderr.toString("utf-8")}`;
	} catch {
		return undefined;
	}
}

function isMuslLinux(options: MuslDetectionOptions = {}): boolean {
	if ((options.platform ?? process.platform) !== "linux") return false;
	if (options.alpineRelease ?? fs.existsSync("/etc/alpine-release")) return true;
	return /\bmusl\b/i.test(options.lddOutput ?? detectLddOutput() ?? "");
}

/** Test seam for libc detection. */
export function isMuslLinuxForTest(options: Required<MuslDetectionOptions>): boolean {
	return isMuslLinux(options);
}

/**
 * Get the appropriate binary name for this platform.
 */
function getBinaryName(): string {
	const platform = process.platform;
	const arch = process.arch;

	let os: string;
	switch (platform) {
		case "linux":
			os = isMuslLinux() ? "linux-musl" : "linux";
			break;
		case "darwin":
			os = "darwin";
			break;
		case "win32":
			os = "windows";
			break;
		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}

	let archName: string;
	switch (arch) {
		case "x64":
			archName = "x64";
			break;
		case "arm64":
			archName = "arm64";
			break;
		default:
			throw new Error(`Unsupported architecture: ${arch}`);
	}

	if (os === "windows") {
		return `${APP_NAME}-${os}-${archName}.exe`;
	}
	return `${APP_NAME}-${os}-${archName}`;
}

/**
 * Resolve the path that `ohmg` maps to in the user's PATH.
 */
function resolveOmpPath(): string | undefined {
	return $which(APP_NAME) ?? undefined;
}

/**
 * Parse the version a launcher reports from `ohmg --version` output
 * (`ohmg/X.Y.Z`, or a prerelease such as `ohmg/X.Y.Z-canary.1`).
 *
 * The prerelease suffix is preserved so a correctly installed canary build
 * verifies as up to date instead of appearing to report a stale `X.Y.Z` and
 * being mistaken for an unreplaced launcher.
 */
export function parseReportedVersion(output: string): string | undefined {
	return output.match(/\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)?.[1];
}

/**
 * Run a specific binary and check if it reports the expected version.
 */
async function verifyBinaryAtPath(binaryPath: string, expectedVersion: string): Promise<InstalledVersionVerification> {
	try {
		const result = await $`${binaryPath} --version`.quiet().nothrow();
		if (result.exitCode !== 0) return { ok: false, path: binaryPath };
		const actual = parseReportedVersion(result.text().trim());
		return { ok: actual === expectedVersion, actual, path: binaryPath };
	} catch {
		return { ok: false, path: binaryPath };
	}
}

/**
 * Run the PATH-resolved ohmg binary and check if it reports the expected version.
 */
async function verifyInstalledVersion(expectedVersion: string): Promise<InstalledVersionVerification> {
	const ompPath = resolveOmpPath();
	if (!ompPath) return { ok: false };
	return await verifyBinaryAtPath(ompPath, expectedVersion);
}

function printVerifiedVersion(expectedVersion: string): void {
	const icon = theme?.status?.success ?? "✔";
	console.log(chalk.green(`\n${icon} Updated to ${expectedVersion}`));
}

function formatVerificationFailure(result: InstalledVersionVerification, expectedVersion: string): string {
	if (result.actual) {
		return `${APP_NAME} at ${result.path} still reports ${result.actual} (expected ${expectedVersion})`;
	}
	return `could not verify updated version${result.path ? ` at ${result.path}` : ""}`;
}

async function unlinkIfExists(filePath: string): Promise<void> {
	try {
		await fs.promises.unlink(filePath);
	} catch (err) {
		if (!isEnoent(err)) throw err;
	}
}

/**
 * Remove a backup binary without letting the removal abort a completed update.
 *
 * On Windows the executable that was just moved aside is still mapped as the
 * running process image, so unlinking it fails with EPERM/EACCES until this
 * process exits (issue #845). The replacement and verification already
 * succeeded by the time we get here, so every error is swallowed; the leftover
 * is reclaimed by {@link sweepStaleUpdateArtifacts} on the next update once it
 * is no longer in use. Returns whether the file is gone.
 */
async function removeBackupBestEffort(filePath: string): Promise<boolean> {
	try {
		await fs.promises.unlink(filePath);
		return true;
	} catch (err) {
		return isEnoent(err);
	}
}

/**
 * Best-effort removal of binary-update leftovers from earlier runs.
 *
 * Each self-update writes to `<binary>.<timestamp>.<pid>.new` and moves the
 * previous executable to `<binary>.<timestamp>.<pid>.bak` before swapping the
 * new one in. On Windows a backup cannot be deleted while the updating process
 * is alive (it is the running process image), so it is left for a later run to
 * reclaim once its owning process has exited. A `.new` temp file only survives
 * a hard kill mid-download; it is reaped once older than the download window,
 * which a live download cannot exceed without timing out and cleaning up after
 * itself — so a concurrent run's in-progress temp is never deleted. Legacy
 * fixed `<binary>.bak` / `<binary>.new` names (from before suffixes were made
 * unique) are matched too, so users upgrading from a buggy release get the
 * orphaned files cleaned up.
 */
export async function sweepStaleUpdateArtifacts(targetPath: string): Promise<void> {
	const dir = path.dirname(targetPath);
	const base = path.basename(targetPath);
	let entries: string[];
	try {
		entries = await fs.promises.readdir(dir);
	} catch {
		return;
	}
	const now = Date.now();
	for (const entry of entries) {
		if (!entry.startsWith(`${base}.`)) continue;
		const suffix = entry.endsWith(".bak") ? ".bak" : entry.endsWith(".new") ? ".new" : undefined;
		if (!suffix) continue;
		// Legacy "<base><suffix>" → empty middle; new "<base>.<timestamp>.<pid><suffix>"
		// → dot-separated numeric run. Anything else is an unrelated file.
		const middle = entry.slice(base.length + 1, entry.length - suffix.length);
		if (middle.length > 0 && !/^\d+(\.\d+)*$/.test(middle)) continue;
		const full = path.join(dir, entry);
		if (suffix === ".new") {
			// A temp file may belong to a concurrent update still downloading, so
			// only reap ones older than the download window.
			let mtimeMs: number;
			try {
				mtimeMs = (await fs.promises.stat(full)).mtimeMs;
			} catch {
				continue;
			}
			if (now - mtimeMs < BINARY_DOWNLOAD_TIMEOUT_MS) continue;
		}
		await removeBackupBestEffort(full);
	}
}

/**
 * Atomically replace the installed binary and roll back if version verification fails.
 */
export async function replaceBinaryForUpdate(options: BinaryReplacementOptions): Promise<InstalledVersionVerification> {
	let backupReady = false;
	try {
		// `backupPath` is unique per attempt (see updateViaBinaryAt), so this rename
		// never has to overwrite — or unlink — a possibly-locked leftover from an
		// earlier run. Renaming the running executable itself is permitted on
		// Windows; only deleting its still-mapped image is not.
		// A missing target is tolerated: repairing a launcher that a failed
		// package-manager reinstall removed installs the binary at a vacant
		// path. There is then nothing to restore, so a verification failure
		// leaves the new binary in place rather than the previous nothing.
		try {
			await fs.promises.rename(options.targetPath, options.backupPath);
			backupReady = true;
		} catch (err) {
			if (!isEnoent(err)) throw err;
		}
		await fs.promises.rename(options.tempPath, options.targetPath);

		const verification = await options.verifyInstalledVersion(options.expectedVersion);
		if (!verification.ok) {
			throw new Error(
				`${formatVerificationFailure(verification, options.expectedVersion)}; restored previous ${APP_NAME} binary`,
			);
		}

		backupReady = false;
		// Swap done and verified. On Windows the backup is still the running
		// process image and cannot be unlinked until this process exits, so a
		// failure here must NOT fail an otherwise-successful update.
		await removeBackupBestEffort(options.backupPath);
		return verification;
	} catch (err) {
		if (backupReady) {
			await unlinkIfExists(options.targetPath);
			await fs.promises.rename(options.backupPath, options.targetPath);
		}
		await unlinkIfExists(options.tempPath);
		throw err;
	}
}

// Monotonic within this process so two updates started in the same millisecond
// (same pid, same `Date.now()`) still get distinct temp/backup paths. Kept
// numeric so the artifact sweep's `\d+(\.\d+)*` matcher still reclaims them.
let updateAttemptSeq = 0;

/**
 * Download a release binary to a target path, replacing an existing file.
 */
export async function updateViaBinaryAt(
	targetPath: string,
	expectedVersion: string,
	options: {
		binaryName?: string;
		fetchImpl?: Fetch;
		githubToken?: string;
		allowPrerelease?: boolean;
		verifyInstalledVersion?: typeof verifyInstalledVersion;
	} = {},
): Promise<void> {
	const binaryName = options.binaryName ?? getBinaryName();
	// Unique per attempt so two overlapping `omp update` runs never share a temp
	// or backup path. A fixed temp name (`<binary>.new`) let the second run's
	// pre-download unlink delete the first run's still-downloading temp file; the
	// first kept writing to its open fd (size + digest still passed), then chmod
	// hit the missing path and the update aborted (issue #8434). The backup needs
	// the same uniqueness: a stale backup from an earlier update may still be
	// locked (the previous process image on Windows), so a fixed name would force
	// the move-aside rename to overwrite it. pid, timestamp, and a process-local
	// counter keep two updates started in the same millisecond from colliding.
	const attempt = `${Date.now()}.${process.pid}.${updateAttemptSeq++}`;
	const tempPath = `${targetPath}.${attempt}.new`;
	const backupPath = `${targetPath}.${attempt}.bak`;
	const asset = await getReleaseBinaryAsset(
		expectedVersion,
		binaryName,
		options.fetchImpl,
		options.githubToken,
		options.allowPrerelease,
	);
	console.log(chalk.dim(`Downloading ${binaryName}…`));
	await downloadVerifiedBinary({
		url: asset.url,
		targetPath: tempPath,
		expectedSize: asset.size,
		expectedDigest: asset.digest,
		fetchImpl: options.fetchImpl,
	});
	console.log(chalk.dim(`Verified ${asset.digest}`));

	// Serialize the target swap and stale-artifact sweep per target so two
	// overlapping `omp update` runs never replace the same binary concurrently
	// or reclaim each other's live backup/temp files. The download above writes
	// to a unique temp path and is safe to overlap; only the swap is shared.
	await withFileLock(targetPath, async () => {
		console.log(chalk.dim("Installing update..."));
		await replaceBinaryForUpdate({
			targetPath,
			tempPath,
			backupPath,
			expectedVersion,
			verifyInstalledVersion: options.verifyInstalledVersion ?? verifyInstalledVersion,
		});
		// Reclaim backups from earlier updates whose owning process has since exited.
		await sweepStaleUpdateArtifacts(targetPath);
	});
	printVerifiedVersion(expectedVersion);
	console.log(chalk.dim(`Restart ${APP_NAME} to use the new version`));
}

/**
 * In-place forwarder bodies, by shim extension, for launchers that cannot be
 * renamed aside during a script-shim takeover; each execs the sibling
 * `omp.exe`. Rewriting matters for the shims that outrank `.exe` at command
 * resolution: PowerShell prefers `.ps1` and Git Bash resolves the
 * extensionless sh shim first, so leaving the old body behind would keep
 * launching the replaced install.
 */
const SHIM_FORWARDERS: Record<string, string> = {
	"": `#!/bin/sh\nexec "$(dirname "$0")/${APP_NAME}.exe" "$@"\n`,
	".cmd": `@"%~dp0${APP_NAME}.exe" %*\r\n`,
	".bat": `@"%~dp0${APP_NAME}.exe" %*\r\n`,
	".ps1": `& "$PSScriptRoot\\${APP_NAME}.exe" @args\nexit $LASTEXITCODE\n`,
};

/**
 * Take over a Windows script-launcher install for a binary-only release.
 *
 * npm-managed Windows installs are launched through script shims
 * (`omp`/`omp.cmd`/`omp.ps1`) that cannot be overwritten with a native
 * executable. The release binary is installed as `omp.exe` beside them and
 * the shims are then renamed aside: cmd.exe would already prefer `.exe` via
 * PATHEXT, but PowerShell resolves `.ps1` first, so the takeover only sticks
 * once the shims are out of the way. A working launcher exists at every
 * step — the exe lands before any shim moves, a shim that refuses to move
 * (a running `.cmd` can be renamed but may be held open some other way) is
 * rewritten in place as a forwarder to the exe, and a failed version
 * verification moves everything back.
 */
export async function updateViaShimTakeover(
	shimPath: string,
	expectedVersion: string,
	options: {
		binaryName?: string;
		fetchImpl?: Fetch;
		githubToken?: string;
		allowPrerelease?: boolean;
		verifyBinary?: typeof verifyBinaryAtPath;
	} = {},
): Promise<void> {
	const binaryName = options.binaryName ?? getBinaryName();
	const launcherDir = path.dirname(shimPath);
	const exePath = path.join(launcherDir, `${APP_NAME}.exe`);
	const attempt = `${Date.now()}.${process.pid}.${updateAttemptSeq++}`;
	const tempPath = `${exePath}.${attempt}.new`;
	const asset = await getReleaseBinaryAsset(
		expectedVersion,
		binaryName,
		options.fetchImpl,
		options.githubToken,
		options.allowPrerelease,
	);
	console.log(chalk.dim(`Downloading ${binaryName}…`));
	await downloadVerifiedBinary({
		url: asset.url,
		targetPath: tempPath,
		expectedSize: asset.size,
		expectedDigest: asset.digest,
		fetchImpl: options.fetchImpl,
	});
	console.log(chalk.dim(`Verified ${asset.digest}`));
	const forwarded: Array<{ launcher: string; original: string }> = [];
	const stuck: string[] = [];
	// Serialize the launcher swap and artifact sweep so two overlapping updates
	// never retire the same shims or reclaim a live run's backup before its
	// verification can roll it back.
	await withFileLock(exePath, async () => {
		console.log(chalk.dim(`Installing ${APP_NAME}.exe beside the script launcher...`));
		await fs.promises.rename(tempPath, exePath);
		// Retire the shims so PATH resolution lands on the new exe. Renamed, not
		// deleted: restorable on verification failure, and Windows permits
		// renaming a batch file that is still executing. A shim that cannot be
		// renamed (held open without delete sharing) is rewritten in place as a
		// forwarder to the exe — write and rename take different Windows locks,
		// so one can succeed where the other fails.
		const backupSuffix = `${attempt}.bak`;
		const retired: Array<{ launcher: string; backup: string }> = [];
		for (const ext of ["", ".cmd", ".ps1", ".bat"]) {
			const launcher = path.join(launcherDir, `${APP_NAME}${ext}`);
			const backup = `${launcher}.${backupSuffix}`;
			try {
				await fs.promises.rename(launcher, backup);
				retired.push({ launcher, backup });
			} catch (err) {
				if (isEnoent(err)) continue;
				try {
					const original = await Bun.file(launcher).text();
					await Bun.write(launcher, SHIM_FORWARDERS[ext]);
					forwarded.push({ launcher, original });
				} catch {
					stuck.push(launcher);
				}
			}
		}

		// Verify the exe by its explicit path: $which cached the shim path when
		// the update target was resolved, and the shim was just renamed away, so
		// a PATH re-resolution here would test a file that no longer exists.
		const verify = options.verifyBinary ?? verifyBinaryAtPath;
		const verification = await verify(exePath, expectedVersion);
		if (!verification.ok) {
			for (const { launcher, backup } of retired) {
				try {
					await fs.promises.rename(backup, launcher);
				} catch {}
			}
			for (const { launcher, original } of forwarded) {
				try {
					await Bun.write(launcher, original);
				} catch {}
			}
			await unlinkIfExists(exePath);
			throw new Error(
				`${formatVerificationFailure(verification, expectedVersion)}; restored previous ${APP_NAME} launcher`,
			);
		}
		for (const { backup } of retired) {
			await removeBackupBestEffort(backup);
		}
		// Reclaim exe backups and retired-shim leftovers from earlier attempts.
		for (const ext of [".exe", "", ".cmd", ".ps1", ".bat"]) {
			await sweepStaleUpdateArtifacts(path.join(launcherDir, `${APP_NAME}${ext}`));
		}
	});
	for (const { launcher } of forwarded) {
		console.log(chalk.dim(`Converted ${launcher} to a forwarder (it could not be removed).`));
	}
	for (const launcher of stuck) {
		console.log(
			chalk.yellow(
				`Could not retire ${launcher}; shells that prefer it may keep launching the old version until it is deleted manually.`,
			),
		);
	}
	printVerifiedVersion(expectedVersion);
	console.log(chalk.dim(`Restart ${APP_NAME} to use the new version`));
}

/**
 * Platform-appropriate installer one-liner for recovery instructions.
 *
 * Forces the installer's binary mode (`--binary` / `-Binary`): the default
 * mode prefers a bun-based install whenever bun is present, which would send
 * a user recovering from a binary-only release straight back through bun.
 */
function installerHint(): string {
	return process.platform === "win32"
		? "& ([scriptblock]::Create((irm https://ohmygoat.vercel.app/install.ps1))) -Binary"
		: "curl -fsSL https://ohmygoat.vercel.app/install | sh -s -- --binary";
}

/** Persisted channel, or undefined when settings are unavailable (SDK/test embedding without `Settings.init()`). */
function readPersistedChannel(): UpdateChannel | undefined {
	try {
		return settings.get("update.channel");
	} catch {
		return undefined;
	}
}

/** Persist an explicit channel switch; tolerated as a no-op when settings are unavailable. */
function persistChannel(channel: UpdateChannel): void {
	try {
		settings.set("update.channel", channel);
	} catch {
		// Outside a CLI host the explicit flag still applied for this run.
	}
}

/**
 * Run the update command.
 *
 * Binary-only: the release is always the fork's latest stable `ohmg-v<semver>`
 * GitHub release, compared against PRODUCT_VERSION, and the PATH-resolved
 * launcher is replaced in place. A leftover npm script shim on Windows is
 * taken over beside the launcher instead.
 */
export async function runUpdateCommand(opts: {
	force: boolean;
	check: boolean;
	channel?: UpdateChannel;
}): Promise<void> {
	console.log(chalk.dim(`Current version: ${PRODUCT_VERSION}`));
	const persistedChannel = readPersistedChannel() ?? "stable";
	const channel = opts.channel ?? persistedChannel;
	if (channel === "canary") {
		console.error(chalk.red(`No canary channel exists for ${APP_NAME}; stable is the only update channel.`));
		console.log(chalk.dim(`Run \`${APP_NAME} update --stable\` to switch back to stable.`));
		process.exit(1);
	}

	// Check for updates
	let release: ReleaseInfo;
	try {
		release = await getLatestRelease({ channel: "stable" });
	} catch (err) {
		console.error(chalk.red(`Failed to check for updates: ${err}`));
		process.exit(1);
	}

	const comparison = compareVersions(release.version, PRODUCT_VERSION);

	if (comparison <= 0 && !opts.force) {
		const icon = theme?.status?.success ?? "✔";
		console.log(chalk.green(`${icon} Already up to date`));
		return;
	}

	if (comparison > 0) {
		console.log(chalk.cyan(`New version available: ${release.version}`));
	} else {
		console.log(chalk.yellow(`Forcing reinstall of ${release.version}`));
	}

	if (opts.check) {
		// Just check, don't install
		return;
	}

	// The PATH-resolved launcher is always replaced in place with the release
	// binary verified against the SHA-256 digest the GitHub API reports.
	try {
		const target = await resolveUpdateTarget();
		if (process.platform === "win32" && isWindowsScriptLauncherPath(target.path)) {
			console.log(chalk.dim("This release ships as a standalone binary; replacing the script launcher."));
			await updateViaShimTakeover(target.path, release.version, {});
			console.log(
				chalk.yellow(
					`This install is no longer managed by a package manager. If the launcher breaks, reinstall with: ${installerHint()}`,
				),
			);
		} else {
			await updateViaBinaryAt(target.path, release.version, {});
		}
		if (opts.channel) persistChannel(channel);
	} catch (err) {
		console.error(chalk.red(`Update failed: ${err}`));
		process.exit(1);
	}
}

/**
 * Print update command help.
 */
export function printUpdateHelp(): void {
	console.log(`${chalk.bold(`${APP_NAME} update`)} - Check for and install updates

${chalk.bold("Usage:")}
  ${APP_NAME} update [options]

${chalk.bold("Options:")}
  -c, --check     Check for updates without installing
  -f, --force     Force reinstall even if up to date
  -l, --plugins   Update installed plugins
  --canary        Switch to the canary channel and update
  --stable        Switch back to the stable channel

${chalk.bold("Examples:")}
  ${APP_NAME} update              Update to latest version
  ${APP_NAME} update --check      Check if updates are available
  ${APP_NAME} update --force      Force reinstall
  ${APP_NAME} update -l           Update installed plugins
  ${APP_NAME} update --canary    Switch to the canary channel and update
`);
}
