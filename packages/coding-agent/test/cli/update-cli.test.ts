import { afterEach, describe, expect, it, vi } from "bun:test";
import { getLatestRelease, runUpdateCommand } from "../../src/cli/update-cli";

type FetchInput = string | URL | Request;
type FetchInit = RequestInit | BunFetchRequestInit;

describe("runUpdateCommand fetch cancellation", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("checks release metadata with a timeout signal", async () => {
		let requestSignal: AbortSignal | undefined;
		vi.spyOn(console, "log").mockImplementation(() => {});
		const fetchStub = Object.assign(
			async (_input: FetchInput, init?: FetchInit) => {
				requestSignal = init?.signal ?? undefined;
				return Response.json({ tag_name: "ohmg-v999.0.0", draft: false, prerelease: false });
			},
			{ preconnect: globalThis.fetch.preconnect },
		);
		vi.spyOn(globalThis, "fetch").mockImplementation(fetchStub);

		await runUpdateCommand({ force: false, check: true });

		expect(requestSignal).toBeInstanceOf(AbortSignal);
	});
});

describe("getLatestRelease fork releases", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function stubReleases(payload: Record<string, unknown>): string[] {
		const urls: string[] = [];
		const fetchStub = Object.assign(
			async (input: FetchInput) => {
				urls.push(String(input));
				return Response.json(payload);
			},
			{ preconnect: globalThis.fetch.preconnect },
		);
		vi.spyOn(globalThis, "fetch").mockImplementation(fetchStub);
		return urls;
	}

	it("resolves the fork's latest stable release without touching a registry", async () => {
		const urls = stubReleases({ tag_name: "ohmg-v0.0.1", draft: false, prerelease: false });

		const release = await getLatestRelease();

		expect(release).toEqual({ tag: "ohmg-v0.0.1", version: "0.0.1", dist: "binary" });
		expect(urls).toEqual(["https://api.github.com/repos/edumdp-dev/oh-my-goat/releases/latest"]);
	});

	it("reports that no canary channel exists instead of querying one", async () => {
		const urls = stubReleases({ tag_name: "ohmg-v0.0.1", draft: false, prerelease: false });

		await expect(getLatestRelease({ channel: "canary" })).rejects.toThrow("No canary channel exists");
		expect(urls).toEqual([]);
	});

	it("rejects a foreign tag instead of installing it", async () => {
		stubReleases({ tag_name: "v18.1.8", draft: false, prerelease: false });

		await expect(getLatestRelease()).rejects.toThrow("is not an ohmg-v<semver> release");
	});
});

describe("getLatestRelease proxy errors", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("translates Bun's UnsupportedProxyProtocol fetch failure into an actionable CLI message", async () => {
		const fetchStub = Object.assign(
			async () => {
				throw new Error(
					'UnsupportedProxyProtocol fetching "https://api.github.com/repos/edumdp-dev/oh-my-goat/releases/latest". ' +
						"For more information, pass `verbose: true` in the second argument to fetch()",
				);
			},
			{ preconnect: globalThis.fetch.preconnect },
		);
		vi.spyOn(globalThis, "fetch").mockImplementation(fetchStub);

		const err = await getLatestRelease({ timeoutMs: 5000 }).then(
			() => null,
			(e: unknown) => e as Error,
		);

		expect(err).toBeInstanceOf(Error);
		// The raw fetch() instruction the CLI user cannot act on must not leak through.
		expect(err?.message).not.toContain("verbose: true");
		expect(err?.message).not.toContain("fetch()");
		// Instead the user gets actionable guidance about supported proxy schemes.
		expect(err?.message).toMatch(/SOCKS/i);
		expect(err?.message).toMatch(/https?:\/\//i);
	});
});
