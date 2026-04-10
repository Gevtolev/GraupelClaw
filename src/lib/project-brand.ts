export const projectBrand = {
  appName: "GraupelClaw",
  shortName: "GraupelClaw",
  packageName: "graupelclaw",
  description:
    "A private OpenClaw workspace for agent chat, gateway management, and future session-first tooling.",
  loginDescription: "Sign in to your GraupelClaw workspace",
  loginRegistrationDescription: "Create access for your GraupelClaw workspace",
  welcomeTitle: "Welcome to your workspace",
  welcomeDescription:
    "Select an agent or team to work against your OpenClaw environment.",
  sessionNamespace: "graupelclaw",
  storage: {
    indexedDbName: "graupelclaw",
    sqliteFileName: "graupelclaw.db",
    profileKey: "graupelclaw-user-profile",
    themeKey: "graupelclaw-theme",
    legacyProfileKey: "chatclaw-user-profile",
    legacyThemeKey: "chatclaw-theme",
  },
  runtime: {
    deviceName: "GraupelClaw",
    userAgent: "graupelclaw/1.0",
  },
} as const;
