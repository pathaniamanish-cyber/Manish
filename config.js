/* Manish Expense & Income Manager: configuration. Contains NO secrets.
   googleClientId is a public identifier (not a password). Arunesh pastes it here once. */
self.APP_CONFIG = {
  appName: "Manish Expense Manager",
  ownerName: "Manish",
  version: "1.0.0",
  storagePrefix: "mmm",
  googleClientId: "", // e.g. 123456-abc.apps.googleusercontent.com
  sheetTitle: "Manish Expense Manager - Data",
  receiptsFolder: "Manish Expense Manager - Receipts",
  timeZone: "America/Toronto",
  reportCurrency: "CAD",
  currencies: ["CAD", "USD", "INR", "GBP", "EUR"],
  // Six expense tabs. The tab IS the category. defaultCurrency is pre-selected when no currency is spoken.
  expenseTabs: [
    { id: "llc",        name: "Cognotic AI LLC",        short: "AI LLC",        icon: "🌎", color: "#6366f1", defaultCurrency: "USD", note: "USA & Canada business",
      voiceKeys: ["cognotic ai llc", "cognitive ai llc", "cognotic llc", "cognitive llc", "ai llc", "llc"] },
    { id: "consulting", name: "Cognotic AI Consulting", short: "AI Consulting", icon: "🧠", color: "#8b5cf6", defaultCurrency: "INR", note: "India consulting",
      voiceKeys: ["cognotic ai consulting", "cognitive ai consulting", "cognotic consulting", "cognitive consulting", "ai consulting"] },
    { id: "storysharks",name: "Story Sharks INC",       short: "Story Sharks",  icon: "🦈", color: "#06b6d4", defaultCurrency: "CAD", note: "Publishing",
      voiceKeys: ["story sharks inc", "story sharks", "storysharks", "story shark", "storyshark"] },
    { id: "personal",   name: "Manish Personal",        short: "Personal",      icon: "👤", color: "#ec4899", defaultCurrency: "CAD", note: "Personal expenses",
      voiceKeys: ["manish personal", "personal"] },
    { id: "canada",     name: "Canada Family",          short: "Canada Family", icon: "🍁", color: "#ef4444", defaultCurrency: "CAD", note: "Canada household",
      voiceKeys: ["canada family", "canadian family", "canada household"] },
    { id: "india",      name: "India Family",           short: "India Family",  icon: "🪔", color: "#f59e0b", defaultCurrency: "INR", note: "India household",
      voiceKeys: ["india family", "indian family", "india household"] },
  ],
  // Exactly five income source buttons. No Personal income source.
  incomeSources: [
    { id: "inc",         name: "Cognotic AI INC",        color: "#10b981", defaultCurrency: "CAD" },
    { id: "llc",         name: "Cognotic AI LLC",        color: "#6366f1", defaultCurrency: "USD" },
    { id: "consulting",  name: "Cognotic AI Consulting", color: "#8b5cf6", defaultCurrency: "INR" },
    { id: "storysharks", name: "Story Sharks INC",       color: "#06b6d4", defaultCurrency: "CAD" },
    { id: "other",       name: "Other Income",           color: "#f97316", defaultCurrency: "CAD", needsDetail: true },
  ],
  maxReceiptMB: 10,
  receiptTypes: { "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WEBP" },
  speechLang: "en-CA",
  rateApi: "https://api.frankfurter.dev",
  rateSourceLabel: "Frankfurter (central-bank reference rates)",
  ocrScript: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
};
