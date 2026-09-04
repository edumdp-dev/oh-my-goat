import { useEffect, useRef, useState } from "react";
import { siGithub, siLinkedin, siX } from "simple-icons";
import { LOCALE_KEY, dict, initLocale } from "./i18n";
import type { Locale, Strings } from "./i18n";
import { applyTheme, initTheme } from "./theme";
import type { Theme } from "./theme";
import { startTopo } from "./topo";

type OS = "mac" | "win";
type Method = "verified" | "quick";

const COMMANDS: Record<OS, Record<Method, string[]>> = {
  mac: {
    verified: [
      "curl -fSLO https://github.com/edumdp-dev/oh-my-goat/releases/download/ohmg-v0.0.1/install.sh",
      "gh attestation verify install.sh --repo edumdp-dev/oh-my-goat --signer-workflow edumdp-dev/oh-my-goat/.github/workflows/release-ohmg.yml --source-ref refs/tags/ohmg-v0.0.1 --deny-self-hosted-runners",
      "sh install.sh",
    ],
    quick: ["curl -fsSL https://ohmygoat.vercel.app/install | sh"],
  },
  win: {
    verified: [
      "irm https://github.com/edumdp-dev/oh-my-goat/releases/download/ohmg-v0.0.1/install.ps1 -OutFile install.ps1",
      "gh attestation verify install.ps1 --repo edumdp-dev/oh-my-goat --signer-workflow edumdp-dev/oh-my-goat/.github/workflows/release-ohmg.yml --source-ref refs/tags/ohmg-v0.0.1 --deny-self-hosted-runners",
      "& ([scriptblock]::Create((Get-Content .\\install.ps1 -Raw)))",
    ],
    quick: ["irm https://ohmygoat.vercel.app/install.ps1 | iex"],
  },
};

const SOCIALS = [
  { icon: siX, key: "socialX", href: "https://x.com/soupraga" },
  { icon: siGithub, key: "socialGithub", href: "https://github.com/edumdp-dev" },
  { icon: siLinkedin, key: "socialLinkedin", href: "https://www.linkedin.com/in/eduardomdp/" },
] as const;

function fallbackCopy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "copy-fallback";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function HornMark() {
  return (
    <svg className="horn-mark" viewBox="0 0 48 32" aria-hidden="true" focusable="false">
      <path
        d="M8 29 C 11 19, 14 12, 22 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M40 29 C 37 19, 34 12, 26 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.65"
      />
    </svg>
  );
}

function BrandIcon({ path }: { path: string }) {
  return (
    <svg className="brand-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(initLocale);
  const [theme, setTheme] = useState<Theme>(initTheme);
  const [os, setOs] = useState<OS>("mac");
  const [method, setMethod] = useState<Method>("verified");
  const [feature, setFeature] = useState(0);
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const [noticeOk, setNoticeOk] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const t: Strings = dict[locale];
  const activeFeature = t.featuresList[Math.min(feature, t.featuresList.length - 1)];

  useEffect(() => {
    document.documentElement.lang = locale === "pt" ? "pt-BR" : "en";
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      /* storage unavailable: locale still applies to this session */
    }
  }, [locale]);

  useEffect(() => {
    applyTheme(theme);
    document.documentElement.dispatchEvent(new Event("ohmg:theme"));
  }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startTopo(canvas);
  }, []);

  const copy = (id: string, text: string) => {
    const done = (ok: boolean) => {
      setNoticeId(id);
      setNoticeOk(ok);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => done(true),
        () => done(fallbackCopy(text)),
      );
    } else {
      done(fallbackCopy(text));
    }
  };

  const steps = COMMANDS[os][method];
  const noticeText = noticeOk ? t.copiedMessage : t.copyFailedMessage;

  return (
    <>
      <a className="skip-link" href="#main">
        {t.skipLink}
      </a>
      <canvas ref={canvasRef} className="topo" aria-hidden="true" />
      <div className="page">
        <header className="site-header">
          <div className="wrap header-inner">
            <a className="brand" href="#top" aria-label={t.wordmark}>
              <HornMark />
              <span className="wordmark">{t.wordmark}</span>
              <span className="version-badge">{t.versionBadge}</span>
            </a>
            <nav className="site-nav" aria-label={t.navLabel}>
              <a href="#features">{t.navFeatures}</a>
              <a href="#install">{t.navPreset}</a>
              <a href="#lineage">{t.navLineage}</a>
              <a href={t.githubHref} target="_blank" rel="noopener noreferrer">
                {t.navGithub}
              </a>
            </nav>
            <div className="header-controls">
              <div className="locale-control" role="group" aria-label={t.localeToggleLabel}>
                <button
                  type="button"
                  aria-pressed={locale === "pt"}
                  onClick={() => setLocale("pt")}
                >
                  PT
                </button>
                <button
                  type="button"
                  aria-pressed={locale === "en"}
                  onClick={() => setLocale("en")}
                >
                  EN
                </button>
              </div>
              <div
                className="theme-control horn-frame"
                role="group"
                aria-label={t.themeToggleLabel}
              >
                <button
                  type="button"
                  aria-pressed={theme === "dark"}
                  onClick={() => setTheme("dark")}
                >
                  {t.themeDark}
                </button>
                <button
                  type="button"
                  aria-pressed={theme === "light"}
                  onClick={() => setTheme("light")}
                >
                  {t.themeLight}
                </button>
              </div>
            </div>
          </div>
        </header>

        <main id="main">
          <div className="wrap" id="top">
            <section className="hero" aria-labelledby="hero-title">
              <p className="eyebrow">
                <HornMark />
                {t.heroEyebrow}
              </p>
              <h1 id="hero-title">{t.heroTitle}</h1>
              <p className="lede">{t.heroLede}</p>
              <p className="hero-ctas">
                <a className="btn btn-primary" href="#install">
                  {t.heroInstallCta}
                </a>
                <a className="btn btn-ghost" href="#changes">
                  {t.heroChangesCta}
                </a>
              </p>
            </section>

            <section className="install" id="install" aria-labelledby="install-title">
              <h2 id="install-title">{t.installHeading}</h2>
              <p className="section-lede">{t.installLede}</p>
              <div className="terminal">
                <div className="terminal-bar" aria-hidden="true">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                  <span className="terminal-title">ohmg — {t.installHeading.toLowerCase()}</span>
                </div>
                <div className="terminal-body">
                  <div className="tabs" role="tablist" aria-label={t.osTabLabel}>
                    {(["mac", "win"] as const).map((key) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={os === key}
                        onClick={() => setOs(key)}
                        className={os === key ? "tab horn" : "tab"}
                      >
                        {key === "mac" ? t.osMacos : t.osWindows}
                      </button>
                    ))}
                  </div>
                  <div
                    className="methods"
                    role="group"
                    aria-label={t.methodLabel}
                  >
                    {(["verified", "quick"] as const).map((key) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={method === key}
                        onClick={() => setMethod(key)}
                        className={method === key ? "method is-active" : "method"}
                      >
                        {key === "verified" ? t.methodVerified : t.methodQuick}
                      </button>
                    ))}
                  </div>
                  <p className="method-note">
                    {method === "verified" ? t.verifiedNote : t.quickNote}
                  </p>
                  <div aria-label={t.commandRegionLabel}>
                    {steps.map((cmd, i) => {
                      const id = `${os}-${method}-${i}`;
                      return (
                        <div className="cmd-block" key={id}>
                          <p className="cmd-step">
                            {t.stepLabel} {steps.length > 1 ? `${i + 1}/${steps.length}` : ""}
                          </p>
                          <pre className="cmd">
                            <code>{cmd}</code>
                          </pre>
                          <p className="cmd-actions">
                            <button
                              type="button"
                              className="btn btn-copy"
                              onClick={() => copy(id, cmd)}
                              aria-label={`${t.copyLabel}: ${cmd}`}
                            >
                              {t.copyLabel}
                            </button>
                            {noticeId === id && (
                              <span role="status" className="copied">
                                {noticeText}
                              </span>
                            )}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <p className="preset-note">{t.presetNote}</p>
            </section>

            <section className="providers" aria-label={t.providersEyebrow}>
              <p className="eyebrow">{t.providersEyebrow}</p>
              <ul className="provider-list">
                <li>{t.providerOpenCodeGo}</li>
                <li>{t.providerOpenAiCodex}</li>
                <li>{t.providerCommandCode}</li>
              </ul>
              <p className="providers-note">{t.providersNote}</p>
            </section>

            <section className="features" id="features" aria-labelledby="features-title">
              <p className="eyebrow">{t.featuresEyebrow}</p>
              <h2 id="features-title">{t.featuresHeading}</h2>
              <p className="section-lede">{t.featuresLede}</p>
              <div className="features-grid">
                <div
                  className="rail"
                  role="tablist"
                  aria-label={t.featuresHeading}
                  aria-orientation="vertical"
                >
                  {t.featuresList.map((f, i) => (
                    <button
                      key={f.id}
                      type="button"
                      role="tab"
                      id={`feature-tab-${f.id}`}
                      aria-selected={feature === i}
                      aria-controls="feature-panel"
                      onClick={() => setFeature(i)}
                      className={feature === i ? "rail-item horn" : "rail-item"}
                    >
                      <span className="rail-index" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>{f.title}</span>
                    </button>
                  ))}
                </div>
                <article
                  className="feature-detail"
                  role="tabpanel"
                  id="feature-panel"
                  aria-labelledby={`feature-tab-${activeFeature.id}`}
                  aria-label={t.featureDetailLabel}
                  tabIndex={0}
                >
                  <h3>{activeFeature.title}</h3>
                  <p>{activeFeature.body}</p>
                </article>
              </div>
            </section>

            <section className="changes" id="changes" aria-labelledby="changes-title">
              <p className="eyebrow">{t.changesEyebrow}</p>
              <h2 id="changes-title">{t.changesHeading}</h2>
              <p className="section-lede">{t.changesLede}</p>
              <dl className="delta-list">
                {t.changesList.map((d) => (
                  <div className="delta" key={d.title}>
                    <dt>{d.title}</dt>
                    <dd>{d.body}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="lineage" id="lineage" aria-labelledby="lineage-title">
              <p className="eyebrow">{t.lineageEyebrow}</p>
              <h2 id="lineage-title">{t.lineageHeading}</h2>
              <p className="lineage-chain">{t.lineageChain}</p>
              <p className="lineage-meta">{t.lineageLicense}</p>
              <p className="lineage-meta">{t.lineageDisclaimer}</p>
            </section>
          </div>
        </main>

        <footer className="site-footer">
          <div className="wrap footer-inner">
            <p className="footer-tagline">
              <HornMark />
              {t.footerTagline}
            </p>
            <div className="socials" role="group" aria-label={t.socialLabel}>
              {SOCIALS.map((s) => (
                <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer">
                  <BrandIcon path={s.icon.path} />
                  <span>{t[s.key]}</span>
                </a>
              ))}
            </div>
            <p className="footer-meta">
              <a href="/NOTICES.txt">{t.footerLicenses}</a>
              <span aria-hidden="true"> · </span>
              <a href={t.githubHref} target="_blank" rel="noopener noreferrer">
                {t.footerRelease}
              </a>
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}
