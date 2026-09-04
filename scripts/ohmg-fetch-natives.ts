#!/usr/bin/env bun
/**
 * OhMyGoat release helper (downstream-owned, new file; not in the upstream graph).
 *
 * Installs the pinned native addons from the public npm registry as release
 * build inputs, per `packaging/native-inputs.lock.json`:
 *
 * 1. The lock version must equal `packages/natives/package.json` version, and
 *    the requested platform tags must exist in the lock (synced upstream never
 *    auto-selects a native version — lock edits require CODEOWNER review).
 * 2. Tarballs are fetched with `npm pack --ignore-scripts` against the locked
 *    registry only.
 * 3. The tarball's SHA-512 must match the locked `dist.integrity` before it is
 *    extracted.
 * 4. The tar is parsed in-memory: absolute paths, `..` traversal, link/device/
 *    directory entries, and any file kind outside `package.json`, license /
 *    README files, and the expected `*.node` addons abort the run.
 * 5. Only the expected `.node` addons are copied into the destination dir.
 *
 * Usage: bun scripts/ohmg-fetch-natives.ts --tag <platform-tag,...> [--dest packages/natives/native]
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";

interface LockPackage {
	name: string;
	integrity: string;
}
interface NativeLock {
	registry: string;
	version: string;
	packages: Record<string, LockPackage>;
}

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const EXPECTED_LEAF_NAMES = [
	"linux-x64",
	"linux-arm64",
	"darwin-x64",
	"darwin-arm64",
	"win32-x64",
	"win32-arm64",
] as const;

function parseArgs(argv: string[]): { tags: string[]; dest: string; lockPath: string } {
	const tags: string[] = [];
	let dest = path.join("packages", "natives", "native");
	let lockPath = path.join("packaging", "native-inputs.lock.json");
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			const value = argv[++i];
			if (!value) throw new Error(`${arg} requires a value`);
			return value;
		};
		if (arg === "--tag") tags.push(...next().split(",").filter(Boolean));
		else if (arg.startsWith("--tag=")) tags.push(...arg.slice("--tag=".length).split(",").filter(Boolean));
		else if (arg === "--dest") dest = next();
		else if (arg === "--lock") lockPath = next();
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (tags.length === 0) throw new Error("At least one --tag is required");
	return { tags, dest, lockPath };
}

function loadLock(lockPath: string): NativeLock {
	const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as NativeLock;
	if (lock.registry !== "https://registry.npmjs.org") {
		throw new Error(`Unexpected native registry: ${lock.registry}`);
	}
	const names = Object.keys(lock.packages).sort();
	const expected = [...EXPECTED_LEAF_NAMES].sort();
	if (JSON.stringify(names) !== JSON.stringify(expected)) {
		throw new Error(`Lock package set diverges from the expected six leaf tags: ${names.join(", ")}`);
	}
	for (const [tag, entry] of Object.entries(lock.packages)) {
		if (entry.name !== `@oh-my-pi/pi-natives-${tag}`) {
			throw new Error(`Lock entry ${tag} has unexpected package name ${entry.name}`);
		}
		if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)) {
			throw new Error(`Lock entry ${tag} has no SHA-512 integrity`);
		}
	}
	const nativesManifest = JSON.parse(
		fs.readFileSync(path.join(REPO_ROOT, "packages", "natives", "package.json"), "utf8"),
	) as { version: string };
	if (nativesManifest.version !== lock.version) {
		throw new Error(
			`native-inputs.lock.json version ${lock.version} diverges from packages/natives/package.json ${nativesManifest.version}`,
		);
	}
	return lock;
}

function expectedAddonFiles(tag: string): string[] {
	// Mirrors packages/natives/scripts/gen-npm-packages.ts expectedAddonFilenames():
	// x64 leaves ship baseline + modern (plus a possible default), others one file.
	return tag.endsWith("-x64")
		? [`pi_natives.${tag}-baseline.node`, `pi_natives.${tag}-modern.node`, `pi_natives.${tag}.node`]
		: [`pi_natives.${tag}.node`];
}

function npmPack(lock: NativeLock, tag: string, cwd: string): string {
	const entry = lock.packages[tag];
	if (!entry) throw new Error(`Tag ${tag} is not in the native inputs lock`);
	const proc = Bun.spawnSync(
		[
			"npm",
			"pack",
			`${entry.name}@${lock.version}`,
			"--ignore-scripts",
			"--registry",
			lock.registry,
			"--pack-destination",
			cwd,
		],
		{ cwd, stdout: "pipe", stderr: "pipe" },
	);
	if (proc.exitCode !== 0) {
		throw new Error(`npm pack ${entry.name}@${lock.version} failed:\n${proc.stderr.toString()}`);
	}
	const file = proc.stdout.toString().trim().split("\n").at(-1)!;
	const tarPath = path.join(cwd, file);
	if (!fs.existsSync(tarPath)) throw new Error(`npm pack did not produce ${tarPath}`);
	return tarPath;
}

function verifyIntegrity(tarPath: string, integrity: string): void {
	const digest = createHash("sha512").update(fs.readFileSync(tarPath)).digest("base64");
	if (`sha512-${digest}` !== integrity) {
		throw new Error(`SHA-512 mismatch for ${path.basename(tarPath)}: locked ${integrity}, got sha512-${digest}`);
	}
}

interface TarEntry {
	name: string;
	typeFlag: string;
	size: number;
	data: Buffer;
}

/** Minimal ustar reader: enough for npm tarballs, strict about anything odd. */
function readTar(gz: Buffer): TarEntry[] {
	const tar = gunzipSync(gz);
	const entries: TarEntry[] = [];
	let offset = 0;
	while (offset + 512 <= tar.length) {
		const header = tar.subarray(offset, offset + 512);
		offset += 512;
		if (header.every(byte => byte === 0)) continue;
		const cstring = (start: number, len: number) => {
			const slice = header.subarray(start, start + len);
			const end = slice.indexOf(0);
			return slice.toString("utf8", 0, end === -1 ? slice.length : end);
		};
		let name = cstring(0, 100);
		const prefix = cstring(345, 155);
		if (prefix) name = `${prefix}/${name}`;
		const size = parseInt(cstring(124, 12).trim() || "0", 8);
		const typeFlag = String.fromCharCode(header[156] ?? 0x30);
		if (!Number.isFinite(size) || size < 0) throw new Error(`Unparsable tar size for ${name}`);
		const data = tar.subarray(offset, offset + size);
		offset += Math.ceil(size / 512) * 512;
		if (name) entries.push({ name, typeFlag, size, data: Buffer.from(data) });
	}
	return entries;
}

function sanitizeName(name: string): string {
	if (name.startsWith("/") || /^[A-Za-z]:[\\/]/.test(name)) throw new Error(`Absolute tar path: ${name}`);
	const parts = name.split("/");
	if (parts.some(part => part === "..")) throw new Error(`Traversal in tar path: ${name}`);
	return parts.slice(1).join("/"); // strip leading package/
}

function isAllowedRelPath(rel: string): boolean {
	const base = path.basename(rel);
	if (rel.startsWith("package/") || path.dirname(rel) !== ".") return false;
	if (base.endsWith(".node")) return true;
	if (base === "package.json") return true;
	return /^(LICENSE|LICEN[CS]E|COPYING|NOTICE|THIRD-PARTY|README|CHANGELOG)/i.test(base);
}

async function main(): Promise<void> {
	const { tags, dest, lockPath } = parseArgs(process.argv.slice(2));
	const lock = loadLock(path.resolve(REPO_ROOT, lockPath));
	const destDir = path.resolve(REPO_ROOT, dest);
	const workDir = fs.mkdtempSync(path.join(REPO_ROOT, ".ohmg-natives-"));
	try {
		for (const tag of tags) {
			const tarPath = npmPack(lock, tag, workDir);
			verifyIntegrity(tarPath, lock.packages[tag].integrity);
			const entries = readTar(fs.readFileSync(tarPath));
			const expected = new Set(expectedAddonFiles(tag));
			const seen = new Map<string, Buffer>();
			for (const entry of entries) {
				if (!entry.name.startsWith("package/")) throw new Error(`Unexpected tar root: ${entry.name}`);
				if (entry.typeFlag === "5") continue; // directory entries are inert
				if (entry.typeFlag !== "0" && entry.typeFlag !== "\0") {
					throw new Error(`Refusing non-regular tar entry (${entry.typeFlag}): ${entry.name}`);
				}
				const rel = sanitizeName(entry.name);
				if (!isAllowedRelPath(rel)) throw new Error(`Disallowed tar member: ${entry.name}`);
				if (rel.endsWith(".node")) {
					const file = path.basename(rel);
					if (!expected.has(file)) throw new Error(`Unexpected addon file ${file} for ${tag}`);
					seen.set(file, entry.data);
				}
			}
			// x64 leaves always ship the baseline addon; the default-name file may
			// coexist with baseline+modern. At minimum the primary addon must be there.
			const primary = seen.has(`pi_natives.${tag}.node`)
				? `pi_natives.${tag}.node`
				: seen.has(`pi_natives.${tag}-baseline.node`)
					? `pi_natives.${tag}-baseline.node`
					: null;
			if (!primary) throw new Error(`Tarball for ${tag} contained no expected addon file`);
			fs.mkdirSync(destDir, { recursive: true });
			for (const [file, data] of seen) {
				const out = path.join(destDir, file);
				fs.writeFileSync(out, data, { mode: 0o644 });
				console.log(
					`staged ${path.relative(REPO_ROOT, out)} (${data.length} bytes, sha256 ${createHash("sha256").update(data).digest("hex").slice(0, 12)})`,
				);
			}
		}
	} finally {
		fs.rmSync(workDir, { recursive: true, force: true });
	}
}

await main();
