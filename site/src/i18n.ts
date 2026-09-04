export type Locale = "en" | "pt";

export const LOCALE_KEY = "ohmg:locale";

export function initLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === "pt" || stored === "en") return stored;
  } catch {
    /* storage unavailable: fall through to browser preference */
  }
  const langs: readonly string[] =
    typeof navigator !== "undefined" && navigator.languages?.length
      ? navigator.languages
      : [typeof navigator !== "undefined" ? navigator.language : ""];
  const first = (langs[0] ?? "").toLowerCase();
  return first.startsWith("pt") ? "pt" : "en";
}
const en = {
  skipLink: "Skip to content",
  wordmark: "OHMYGOAT",
  navLabel: "Sections",
  versionBadge: "v0.0.1",
  navFeatures: "Features",
  navPreset: "Preset",
  navLineage: "Lineage",
  navGithub: "GitHub",
  githubHref: "https://github.com/edumdp-dev/oh-my-goat",
  localeToggleLabel: "Language",
  themeToggleLabel: "Color theme",
  themeDark: "Dark",
  themeLight: "Light",

  heroEyebrow: "PUBLIC FORK OF OH MY PI",
  heroTitle: "Your terminal agent. Tuned for the herd.",
  heroLede:
    "OhMyGoat keeps Oh My Pi's power and adds a blue identity, Dudu's preset, a ready CommandCode catalog, and SnapCompact first.",
  heroInstallCta: "Install",
  heroChangesCta: "What changes",

  osMacos: "macOS",
  osWindows: "Windows",
  osTabLabel: "Operating system",
  methodVerified: "Verified",
  methodQuick: "Quick",
  methodLabel: "Install method",
  verifiedNote: "Default. Requires an authenticated GitHub CLI (gh auth login). Verifies the installer attestation before running it.",
  quickNote:
    "Convenience only, no independent verification. Pipes the installer straight from ohmygoat.vercel.app.",
  installHeading: "Install",
  installLede:
    "Binaries for macOS and Windows from the ohmg-v0.0.1 release. The installer seeds ~/.ohmg/agent/config.yml and models.yml only when they do not exist — reinstalling never overwrites your choices.",
  presetNote:
    "Preset ships Dudu's model roles and SnapCompact-first compaction with no secrets. CommandCode stays ready via COMMANDCODE_API_KEY but is never the default.",
  copyLabel: "Copy",
  copiedMessage: "Copied to clipboard",
  copyFailedMessage: "Copy failed — select the text manually",
  commandRegionLabel: "Install commands",
  stepLabel: "Step",

  providersEyebrow: "MODEL PROVIDERS",
  providersNote:
    "Bring your own keys. CommandCode is available when you set COMMANDCODE_API_KEY — it is not the default for any role.",
  providerOpenCodeGo: "OpenCode Go",
  providerOpenAiCodex: "OpenAI Codex",
  providerCommandCode: "CommandCode",

  featuresEyebrow: "CHANNELS",
  featuresHeading: "Features",
  featuresLede:
    "Oh My Pi capabilities, preserved by the fork — plus the OhMyGoat deltas.",
  featureDetailLabel: "Feature detail",
  featuresList: [
    {
      id: "goat",
      title: "Blue goat",
      body: "A blue Braille goat replaces the π mark in the TUI, with a truecolor and ANSI-256 blue palette and the ohmygoat v0.0.1 · made by dudu title.",
    },
    {
      id: "preset",
      title: "Dudu preset",
      body: "A portable config preset with Dudu's model roles, fallback chains, and SnapCompact-first compaction. No tokens, no secrets — only env var names like COMMANDCODE_API_KEY.",
    },
    {
      id: "commandcode",
      title: "CommandCode ready",
      body: "A ready-to-use model catalog ships with the install. Set COMMANDCODE_API_KEY and every CommandCode model lights up; nothing points at it by default.",
    },
    {
      id: "snapcompact",
      title: "SnapCompact first",
      body: "Compaction always tries SnapCompact first, then falls back through handoff, shake, and soft when the active model lacks image input.",
    },
    {
      id: "lsp",
      title: "LSP intelligence",
      body: "An Oh My Pi capability preserved by the fork: language-server aware editing, diagnostics, and navigation inside the terminal agent.",
    },
    {
      id: "debugger",
      title: "Debugger",
      body: "An Oh My Pi capability preserved by the fork: a built-in debugging workflow for inspecting program state without leaving the session.",
    },
    {
      id: "orchestration",
      title: "Agent orchestration",
      body: "An Oh My Pi capability preserved by the fork: plan, delegate, and coordinate background agents from one terminal session.",
    },
    {
      id: "upstream",
      title: "Upstream current",
      body: "A reviewable daily sync with can1357/oh-my-pi keeps the fork close to upstream v18.1.8. Nothing auto-merges; every sync lands as a reviewed PR.",
    },
  ] as Array<{ id: string; title: string; body: string }>,

  changesEyebrow: "DELTA",
  changesHeading: "What changes",
  changesLede: "Four deltas on top of Oh My Pi v18.1.8. Everything else stays byte-close to upstream.",
  changesList: [
    {
      title: "Blue brand",
      body: "ohmg command, ohmygoat TUI title, isolated ~/.ohmg config, and a blue goat identity — no π mark, no magenta.",
    },
    {
      title: "Portable preset, no secrets",
      body: "Dudu's model roles, fallback chains, and SnapCompact-first compaction ship as plain YAML. Reinstalls never overwrite; ~/.omp is never read or copied.",
    },
    {
      title: "Windows & macOS binaries",
      body: "Signed-by-attestation release assets for Windows x64/ARM64 and macOS Intel/Apple Silicon, installed via a Verified (gh attestation) or Quick path.",
    },
    {
      title: "Reviewable upstream sync",
      body: "A daily automation opens a sync PR against can1357/oh-my-pi main. Conflicts become issues; brand, presets, updater, installers, and this site never auto-resolve.",
    },
  ] as Array<{ title: string; body: string }>,

  lineageEyebrow: "LINEAGE",
  lineageHeading: "Origin",
  lineageChain: "Pi by Mario Zechner → Oh My Pi by Can Bölük / Stencil Labs → OhMyGoat by Eduardo M. D. P.",
  lineageLicense: "Released under the MIT license.",
  lineageDisclaimer: "Independent public fork; not affiliated with Stencil Labs.",

  footerTagline: "made by dudu",
  footerLicenses: "Third-party notices",
  footerRelease: "Release ohmg-v0.0.1",
  socialX: "X",
  socialGithub: "GitHub",
  socialLinkedin: "LinkedIn",
  socialLabel: "Social links",
};

export type Strings = typeof en;

const pt: Strings = {
  skipLink: "Pular para o conteúdo",
  wordmark: "OHMYGOAT",
  navLabel: "Seções",
  versionBadge: "v0.0.1",
  navFeatures: "Recursos",
  navPreset: "Configuração",
  navLineage: "Origem",
  navGithub: "GitHub",
  githubHref: "https://github.com/edumdp-dev/oh-my-goat",
  localeToggleLabel: "Idioma",
  themeToggleLabel: "Tema de cor",
  themeDark: "Escuro",
  themeLight: "Claro",

  heroEyebrow: "FORK PÚBLICO DE OH MY PI",
  heroTitle: "Seu agente de terminal. Afinado para o rebanho.",
  heroLede:
    "OhMyGoat mantém a potência do Oh My Pi e adiciona identidade azul, o preset de Dudu, catálogo CommandCode pronto e SnapCompact em primeiro lugar.",
  heroInstallCta: "Instalar",
  heroChangesCta: "O que muda",

  osMacos: "macOS",
  osWindows: "Windows",
  osTabLabel: "Sistema operacional",
  methodVerified: "Verificado",
  methodQuick: "Rápido",
  methodLabel: "Método de instalação",
  verifiedNote:
    "Padrão. Exige GitHub CLI autenticado (gh auth login). Verifica a attestation do instalador antes de executá-lo.",
  quickNote:
    "Apenas conveniência, sem verificação independente. Canaliza o instalador direto de ohmygoat.vercel.app.",
  installHeading: "Instalação",
  installLede:
    "Binários para macOS e Windows da release ohmg-v0.0.1. O instalador cria ~/.ohmg/agent/config.yml e models.yml somente quando não existem — reinstalar nunca sobrescreve suas escolhas.",
  presetNote:
    "O preset traz os model roles de Dudu e compactação SnapCompact-first sem segredos. CommandCode fica pronto via COMMANDCODE_API_KEY, mas nunca é o padrão.",
  copyLabel: "Copiar",
  copiedMessage: "Copiado para a área de transferência",
  copyFailedMessage: "Falha ao copiar — selecione o texto manualmente",
  commandRegionLabel: "Comandos de instalação",
  stepLabel: "Passo",

  providersEyebrow: "PROVEDORES DE MODELO",
  providersNote:
    "Traga suas próprias chaves. CommandCode fica disponível ao definir COMMANDCODE_API_KEY — não é o padrão de nenhum role.",
  providerOpenCodeGo: "OpenCode Go",
  providerOpenAiCodex: "OpenAI Codex",
  providerCommandCode: "CommandCode",

  featuresEyebrow: "CANAIS",
  featuresHeading: "Recursos",
  featuresLede:
    "Capacidades do Oh My Pi, preservadas pelo fork — mais os deltas do OhMyGoat.",
  featureDetailLabel: "Detalhe do recurso",
  featuresList: [
    {
      id: "goat",
      title: "Cabra azul",
      body: "Uma cabra Braille azul substitui a marca π no TUI, com paleta azul truecolor e ANSI-256 e o título ohmygoat v0.0.1 · made by dudu.",
    },
    {
      id: "preset",
      title: "Preset do Dudu",
      body: "Preset de configuração portátil com os model roles de Dudu, cadeias de fallback e compactação SnapCompact-first. Sem tokens, sem segredos — só nomes de variáveis como COMMANDCODE_API_KEY.",
    },
    {
      id: "commandcode",
      title: "CommandCode pronto",
      body: "Um catálogo de modelos pronto acompanha a instalação. Defina COMMANDCODE_API_KEY e todos os modelos CommandCode acendem; nada aponta para ele por padrão.",
    },
    {
      id: "snapcompact",
      title: "SnapCompact primeiro",
      body: "A compactação sempre tenta SnapCompact primeiro, depois recua por handoff, shake e soft quando o modelo ativo não tem entrada de imagem.",
    },
    {
      id: "lsp",
      title: "Inteligência LSP",
      body: "Uma capacidade do Oh My Pi preservada pelo fork: edição com language server, diagnósticos e navegação dentro do agente de terminal.",
    },
    {
      id: "debugger",
      title: "Depurador",
      body: "Uma capacidade do Oh My Pi preservada pelo fork: fluxo de depuração embutido para inspecionar o estado do programa sem sair da sessão.",
    },
    {
      id: "orchestration",
      title: "Orquestração de agentes",
      body: "Uma capacidade do Oh My Pi preservada pelo fork: planeje, delegue e coordene agentes em segundo plano a partir de uma sessão de terminal.",
    },
    {
      id: "upstream",
      title: "Upstream atualizado",
      body: "Uma sincronização diária revisável com can1357/oh-my-pi mantém o fork próximo do upstream v18.1.8. Nada faz auto-merge; cada sync vira um PR revisado.",
    },
  ] as Array<{ id: string; title: string; body: string }>,

  changesEyebrow: "DELTA",
  changesHeading: "O que muda",
  changesLede: "Quatro deltas sobre o Oh My Pi v18.1.8. Todo o resto continua byte a byte próximo do upstream.",
  changesList: [
    {
      title: "Marca azul",
      body: "Comando ohmg, título ohmygoat no TUI, config isolada em ~/.ohmg e identidade visual da cabra azul — sem marca π, sem magenta.",
    },
    {
      title: "Preset portátil, sem segredos",
      body: "Os model roles de Dudu, cadeias de fallback e compactação SnapCompact-first viajam como YAML puro. Reinstalações nunca sobrescrevem; ~/.omp nunca é lido nem copiado.",
    },
    {
      title: "Binários Windows e macOS",
      body: "Assets de release com attestation para Windows x64/ARM64 e macOS Intel/Apple Silicon, instalados pelo caminho Verificado (attestation via gh) ou Rápido.",
    },
    {
      title: "Sync upstream revisável",
      body: "Uma automação diária abre um PR de sincronização com a main de can1357/oh-my-pi. Conflitos viram issues; marca, presets, updater, instaladores e este site nunca se resolvem sozinhos.",
    },
  ] as Array<{ title: string; body: string }>,

  lineageEyebrow: "ORIGEM",
  lineageHeading: "Origem",
  lineageChain: "Pi por Mario Zechner → Oh My Pi por Can Bölük / Stencil Labs → OhMyGoat por Eduardo M. D. P.",
  lineageLicense: "Publicado sob a licença MIT.",
  lineageDisclaimer: "Fork público independente; sem afiliação com a Stencil Labs.",

  footerTagline: "made by dudu",
  footerLicenses: "Avisos de terceiros",
  footerRelease: "Release ohmg-v0.0.1",
  socialX: "X",
  socialGithub: "GitHub",
  socialLinkedin: "LinkedIn",
  socialLabel: "Redes sociais",
};

export const dict: Record<Locale, Strings> = { en, pt };
