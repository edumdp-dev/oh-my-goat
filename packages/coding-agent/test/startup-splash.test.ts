import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { GOAT_LOGO, gradientLogo } from "@oh-my-pi/pi-coding-agent/modes/components/welcome";
import { renderSetupSplash } from "@oh-my-pi/pi-coding-agent/modes/setup-wizard/scenes/splash";
import { runStartupSplash } from "@oh-my-pi/pi-coding-agent/modes/setup-wizard/startup-splash";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { shouldShowStartupSplash } from "@oh-my-pi/pi-coding-agent/startup-splash";
import { type Component, TERMINAL, visibleWidth } from "@oh-my-pi/pi-tui";

beforeAll(async () => {
	await initTheme(false);
});

const originalTrueColor = TERMINAL.trueColor;
afterEach(() => {
	Object.assign(TERMINAL, { trueColor: originalTrueColor });
});

describe("startup splash", () => {
	it("requires the explicit setting and normal interactive TTY startup", () => {
		const base = {
			configured: true,
			isInteractive: true,
			resuming: false,
			quiet: false,
			timing: false,
			stdinIsTTY: true,
			stdoutIsTTY: true,
		};

		expect(shouldShowStartupSplash(base)).toBe(true);
		expect(shouldShowStartupSplash({ ...base, configured: false })).toBe(false);
		expect(shouldShowStartupSplash({ ...base, isInteractive: false })).toBe(false);
		expect(shouldShowStartupSplash({ ...base, resuming: true })).toBe(false);
		expect(shouldShowStartupSplash({ ...base, quiet: true })).toBe(false);
		expect(shouldShowStartupSplash({ ...base, timing: true })).toBe(false);
		expect(shouldShowStartupSplash({ ...base, stdinIsTTY: false })).toBe(false);
		expect(shouldShowStartupSplash({ ...base, stdoutIsTTY: false })).toBe(false);
	});

	it("shows and hides a fullscreen setup-splash overlay", async () => {
		const preSplashEditor: Component = { render: () => [] };
		let hidden = false;
		let renderRequests = 0;
		let focused: Component | undefined = preSplashEditor;
		let overlayComponent: Component | undefined;
		const ctx = {
			ui: {
				terminal: { rows: 8 },
				showOverlay: (component: Component) => {
					overlayComponent = component;
					const preFocus = focused;
					focused = component;
					return {
						hide: () => {
							hidden = true;
							if (focused === component) {
								focused = preFocus;
							}
						},
					};
				},
				setFocus: (component: Component) => {
					focused = component;
				},
				requestRender: () => {
					renderRequests += 1;
				},
			},
		} as unknown as InteractiveModeContext;

		await runStartupSplash(ctx, { durationMs: 0, tickMs: 1, now: () => 0 });

		expect(hidden).toBe(true);
		expect(renderRequests).toBeGreaterThan(0);
		expect(focused).toBe(preSplashEditor);
		expect(overlayComponent?.render(32)).toHaveLength(8);
	});

	it("renders responsive goat frames without clipping and always reserves the credit", () => {
		const cases = [
			{ width: 32, height: 8, expectArt: false },
			{ width: 80, height: 20, expectArt: true },
			{ width: 120, height: 30, expectArt: true },
		];
		for (const { width, height, expectArt } of cases) {
			const frame = renderSetupSplash(width, height, 2600);
			const plain = frame.map(line => Bun.stripANSI(line));
			expect(frame).toHaveLength(height);
			expect(plain.every(line => visibleWidth(line) <= width)).toBe(true);
			expect(plain.join("\n")).toContain("made by dudu");
			expect(plain.at(-2)?.trim()).toBe("made by dudu");
			expect(plain.at(-1)?.trim()).toBe("press enter to skip");
			expect(plain.join("\n").includes(GOAT_LOGO[6].trim())).toBe(expectArt);
			if (!expectArt) expect(plain.join("\n")).toContain("O h   M y   G o a t");
		}
	});

	it("uses only the downstream blue ramps in truecolor and ANSI-256 modes", () => {
		Object.assign(TERMINAL, { trueColor: true });
		const truecolor = gradientLogo(GOAT_LOGO).join("");
		const rgb = [...truecolor.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map(match => match.slice(1).map(Number));
		expect(rgb.length).toBeGreaterThan(0);
		expect(rgb).toContainEqual([11, 98, 196]);
		expect(rgb.every(([r, g, b]) => b >= g && g >= r)).toBe(true);

		Object.assign(TERMINAL, { trueColor: false });
		const ansi256 = gradientLogo(GOAT_LOGO).join("");
		const codes = [...ansi256.matchAll(/\x1b\[38;5;(\d+)m/g)].map(match => Number(match[1]));
		expect(codes.length).toBeGreaterThan(0);
		expect(codes.every(code => [25, 27, 33, 39, 45, 51, 87, 123].includes(code))).toBe(true);
	});
});
