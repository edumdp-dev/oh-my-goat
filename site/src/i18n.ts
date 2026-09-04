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
  versionBadge: "v0.0.3",
  navFeatures: "Features",
  navPreset: "Preset",
  navLineage: "Lineage",
  navGithub: "GitHub",
  githubHref: "https://github.com/edumdp-dev/oh-my-goat",
  localeToggleLabel: "Language",
  themeToggleLabel: "Color theme",
  themeDark: "Dark",
  themeLight: "Light",

  heroEyebrow: "TERMINAL CODING AGENT",
  heroTitle: "Your terminal agent. Tuned for the herd.",
  heroLede:
    "Install in minutes, code for hours. OhMyGoat ships with a curated model setup, automatic fallbacks, and long sessions that stay sharp — no configuration rabbit hole.",
  heroInstallCta: "Install",
  heroChangesCta: "Why OhMyGoat",

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
    "Pick your platform below. Verified is the safe default; Quick trades verification for speed. Either way you are running in minutes — and your existing config is never touched.",
  presetNote:
    "Ships with a curated starting setup: model roles, fallbacks, long-session compaction. Your keys, your choices — nothing phones home.",
  copyLabel: "Copy",
  copiedMessage: "Copied to clipboard",
  copyFailedMessage: "Copy failed — select the text manually",
  commandRegionLabel: "Install commands",
  stepLabel: "Step",

  providersEyebrow: "MODEL PROVIDERS",
  providersNote:
    "Works with the providers you already pay for. Bring your own keys.",
  providerOpenCodeGo: "OpenCode Go",
  providerOpenAiCodex: "OpenAI Codex",
  providerCommandCode: "CommandCode",

  featuresEyebrow: "CHANNELS",
  featuresHeading: "Features",
  featuresLede:
    "Everything you need to ship from the terminal.",
  featureDetailLabel: "Feature detail",
  featuresList: [
    {
      id: "goat",
      title: "Own identity",
      body: "A goat mark, a clean terminal aesthetic, and a config that lives in its own ~/.ohmg — your setup never fights another tool's.",
    },
    {
      id: "preset",
      title: "Ready-to-run models",
      body: "Roles, fallbacks, and thinking levels arrive preconfigured. Bring your own API keys — nothing secret ever ships in the box.",
    },
    {
      id: "commandcode",
      title: "More models on demand",
      body: "A 47-model CommandCode catalog is one env var away. Nothing uses it until you say so.",
    },
    {
      id: "snapcompact",
      title: "Long sessions stay sharp",
      body: "Compaction keeps big sessions coherent instead of degrading. SnapCompact first, graceful fallbacks after.",
    },
    {
      id: "lsp",
      title: "Understands your code",
      body: "Language-server aware edits, diagnostics, and navigation — the agent sees what your IDE sees.",
    },
    {
      id: "debugger",
      title: "Debug without leaving",
      body: "Inspect real program state mid-session instead of sprinkling print statements.",
    },
    {
      id: "orchestration",
      title: "Delegate the grind",
      body: "Fan work out to background agents and get typed results back — no babysitting.",
    },
    {
      id: "upstream",
      title: "Maintained, not frozen",
      body: "Daily upstream syncs land as reviewed PRs, so you get fixes without surprises.",
    },
  ] as Array<{ id: string; title: string; body: string }>,

  changesEyebrow: "WHY OHMYGOAT",
  changesHeading: "Why OhMyGoat",
  changesLede: "Built on the excellent Oh My Pi engine — plus everything needed to go from zero to shipping.",
  changesList: [
    {
      title: "Running in minutes",
      body: "One command installs the ohmg CLI on Windows or macOS. Verified binaries, checksums checked before anything touches your system.",
    },
    {
      title: "Setup that survives reinstalls",
      body: "Your models and preferences live in plain YAML under ~/.ohmg — and reinstalls never overwrite them.",
    },
    {
      title: "Install you can trust",
      body: "Every release asset carries build-provenance attestations you can verify yourself before running anything.",
    },
    {
      title: "Kept current",
      body: "Upstream improvements arrive as reviewable PRs. Conflicts become issues, never silent breakage.",
    },
  ] as Array<{ title: string; body: string }>,

  lineageEyebrow: "LINEAGE",
  lineageHeading: "Built on open source",
  lineageChain: "Pi by Mario Zechner → Oh My Pi by Can Bölük / Stencil Labs → OhMyGoat by Eduardo M. D. P.",
  lineageLicense: "Released under the MIT license.",
  lineageDisclaimer: "Independent public fork; not affiliated with Stencil Labs.",

  footerTagline: "made by dudu",
  footerLicenses: "Third-party notices",
  footerRelease: "Release ohmg-v0.0.3",
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
  versionBadge: "v0.0.3",
  navFeatures: "Recursos",
  navPreset: "Configuração",
  navLineage: "Origem",
  navGithub: "GitHub",
  githubHref: "https://github.com/edumdp-dev/oh-my-goat",
  localeToggleLabel: "Idioma",
  themeToggleLabel: "Tema de cor",
  themeDark: "Escuro",
  themeLight: "Claro",

  heroEyebrow: "AGENTE DE CODIFICAÇÃO PARA TERMINAL",
  heroTitle: "Seu agente de terminal. Afinado para o rebanho.",
  heroLede:
    "Instale em minutos, programe por horas. OhMyGoat já vem com modelos configurados, fallbacks automáticos e sessões longas que não perdem o fio — sem labirinto de configuração.",
  heroInstallCta: "Instalar",
  heroChangesCta: "Por que OhMyGoat",

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
    "Escolha sua plataforma abaixo. Verificado é o padrão seguro; Rápido troca verificação por velocidade. De qualquer forma, em minutos você está rodando — e sua config existente nunca é tocada.",
  presetNote:
    "Acompanha uma configuração inicial curada: model roles, fallbacks, compactação para sessões longas. Suas chaves, suas escolhas — nada liga para casa.",
  copyLabel: "Copiar",
  copiedMessage: "Copiado para a área de transferência",
  copyFailedMessage: "Falha ao copiar — selecione o texto manualmente",
  commandRegionLabel: "Comandos de instalação",
  stepLabel: "Passo",

  providersEyebrow: "PROVEDORES DE MODELO",
  providersNote:
    "Funciona com os provedores que você já paga. Traga suas próprias chaves.",
  providerOpenCodeGo: "OpenCode Go",
  providerOpenAiCodex: "OpenAI Codex",
  providerCommandCode: "CommandCode",

  featuresEyebrow: "CANAIS",
  featuresHeading: "Recursos",
  featuresLede:
    "Tudo que você precisa para entregar código pelo terminal.",
  featureDetailLabel: "Detalhe do recurso",
  featuresList: [
    {
      id: "goat",
      title: "Identidade própria",
      body: "Marca da cabra, estética limpa de terminal e config isolada em ~/.ohmg — sua configuração nunca briga com outra ferramenta.",
    },
    {
      id: "preset",
      title: "Modelos prontos para rodar",
      body: "Roles, fallbacks e níveis de raciocínio já vêm configurados. Traga suas próprias chaves de API — nenhum segredo viaja na caixa.",
    },
    {
      id: "commandcode",
      title: "Mais modelos sob demanda",
      body: "Um catálogo CommandCode de 47 modelos a uma variável de ambiente de distância. Nada usa sem você mandar.",
    },
    {
      id: "snapcompact",
      title: "Sessões longas afiadas",
      body: "A compactação mantém sessões grandes coerentes em vez de degradar. SnapCompact primeiro, fallbacks graciosos depois.",
    },
    {
      id: "lsp",
      title: "Entende seu código",
      body: "Edição, diagnósticos e navegação com language server — o agente vê o que sua IDE vê.",
    },
    {
      id: "debugger",
      title: "Depure sem sair",
      body: "Inspecione o estado real do programa no meio da sessão em vez de espalhar prints.",
    },
    {
      id: "orchestration",
      title: "Delegue o trabalho pesado",
      body: "Distribua tarefas para agentes em segundo plano e receba resultados tipados — sem babá.",
    },
    {
      id: "upstream",
      title: "Mantido, não congelado",
      body: "Syncs diários do upstream viram PRs revisados — você recebe correções sem surpresas.",
    },
  ] as Array<{ id: string; title: string; body: string }>,

  changesEyebrow: "POR QUE OHMYGOAT",
  changesHeading: "Por que OhMyGoat",
  changesLede: "Construído sobre o excelente motor do Oh My Pi — mais tudo que falta para sair do zero ao shipping.",
  changesList: [
    {
      title: "Rodando em minutos",
      body: "Um comando instala o CLI ohmg no Windows ou macOS. Binários verificados, checksums conferidos antes de tocar no seu sistema.",
    },
    {
      title: "Configuração que sobrevive a reinstalações",
      body: "Seus modelos e preferências vivem em YAML puro sob ~/.ohmg — e reinstalações nunca sobrescrevem.",
    },
    {
      title: "Instalação em que dá para confiar",
      body: "Cada asset de release traz attestations de proveniência que você mesmo pode verificar antes de executar.",
    },
    {
      title: "Sempre atualizado",
      body: "Melhorias do upstream chegam como PRs revisáveis. Conflitos viram issues, nunca quebra silenciosa.",
    },
  ] as Array<{ title: string; body: string }>,

  lineageEyebrow: "ORIGEM",
  lineageHeading: "Feito sobre código aberto",
  lineageChain: "Pi por Mario Zechner → Oh My Pi por Can Bölük / Stencil Labs → OhMyGoat por Eduardo M. D. P.",
  lineageLicense: "Publicado sob a licença MIT.",
  lineageDisclaimer: "Fork público independente; sem afiliação com a Stencil Labs.",

  footerTagline: "made by dudu",
  footerLicenses: "Avisos de terceiros",
  footerRelease: "Release ohmg-v0.0.3",
  socialX: "X",
  socialGithub: "GitHub",
  socialLinkedin: "LinkedIn",
  socialLabel: "Redes sociais",
};

export const dict: Record<Locale, Strings> = { en, pt };
