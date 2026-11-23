import type { GraphicsChoice, GraphicsStatus } from './graphics'
import type { ProviderId, ProviderSettings } from './ai-providers'
import type { FormatPrefs } from './format'
import type { LanguageCode } from './languages'
import type { Effort, ReasoningLevel } from './reasoning'
import type { PermissionSettings } from './permissions'
export type Theme = 'system' | 'light' | 'dark'
export type CategoryKind = 'expense' | 'income' | 'transfer'
export type Actor = 'user' | 'assistant' | 'system'


export const ACCOUNT_KINDS = ['current', 'savings', 'investment', 'cash', 'credit_card', 'loan', 'other'] as const
export type AccountKind = (typeof ACCOUNT_KINDS)[number]

export interface Account {
  id: number
  name: string
  kind: AccountKind
  /** The bank's name as the person typed it (may be empty). */
  bank: string
  iban: string | null
  currency: string
  openingBalanceCents: number
  archived: boolean
  createdAt: string
  /** What the bank charges on top of the reference rate when converting currency (%), if known. */
  fxCostPct: number | null
}

export interface Category {
  id: number
  name: string
  kind: CategoryKind
  parentId: number | null
  color: string | null
  sortOrder: number
  archived: boolean
}

export interface FxRate {
  currency: string
  date: string
  /** Units of `currency` for 1 euro. */
  perEur: number
  source: 'ecb' | 'manual'
}

export interface FxCurrencyInfo {
  currency: string
  latest: { date: string; perEur: number; source: 'ecb' | 'manual' } | null
  ecbRates: number
  manualRates: number
  /** False when transactions are older than the first known rate (the first rate is used for them). */
  coversOldest: boolean
}

export interface FxStatus {
  main: string
  currencies: FxCurrencyInfo[]
  lastEcbUpdateAt: string | null
  autoUpdate: boolean
}

export interface Valuation {
  accountId: number
  date: string
  valueCents: number
  note: string | null
}

export interface NetWorthAccount {
  id: number
  name: string
  kind: AccountKind
  currency: string
  archived: boolean
  /** Today, in the account's currency. */
  valueCents: number
  valueMainCents: number | null
  /** Opening balance plus payments in and out; only for accounts with recorded values. */
  investedCents: number | null
  gainCents: number | null
  lastValuation: { date: string; valueCents: number } | null
}

export interface NetWorth {
  main: string
  totalCents: number
  assetsCents: number
  liabilitiesCents: number
  /** Accounts left out because their currency has no exchange rate. */
  unconverted: number
  accounts: NetWorthAccount[]
  /** Net worth at the end of each month (this month: today). */
  history: { month: string; cents: number; unconverted: number }[]
  /** The first month with any data (oldest transaction or recorded value): history can't go further back. */
  firstMonth: string | null
}

export interface YearSummary {
  year: number
  months: { month: string; incomeCents: number; spendingCents: number }[]
  categories: { categoryId: number | null; name: string; kind: 'income' | 'expense'; months: number[]; totalCents: number }[]
  incomeCents: number
  spendingCents: number
  budgetedCents: number
  /** Totals for every year with transactions. */
  years: { year: number; incomeCents: number; spendingCents: number }[]
}

export interface SyncDevice {
  id: string
  label: string
  lastSeen: string | null
  thisComputer: boolean
}

export interface SyncStatus {
  /** off: not syncing. on: syncing. detached: this data syncs, but this computer hasn't chosen the folder yet. */
  state: 'off' | 'on' | 'detached'
  /** The folder, or the WebDAV server's address. */
  folder: string | null
  kind: 'folder' | 'webdav' | null
  devices: SyncDevice[]
  lastSyncAt: string | null
  /** A problem with the last sync, in plain words. */
  error: string | null
  conflicts: { id: number; at: string; summary: string }[]
  busy: boolean
}

/** Data settings, stored in the encrypted database. */
/** A named set of Transactions filters. */
export interface SavedSearch {
  name: string
  filter: { accountId?: number; categoryId?: number | 'none'; month?: string; from?: string; to?: string; search?: string; direction?: 'in' | 'out' }
}

export interface Settings {
  /** Main currency: totals, budgets and net worth are shown in it. */
  currency: string
  /** Download the ECB reference rates by itself (at most once a day) when other currencies are in use. */
  fxAutoUpdate: boolean
  fxLastEcbUpdateAt: string | null
  autoBackupEnabled: boolean
  autoBackupFolder: string | null
  autoBackupKeep: number
  lastBackupAt: string | null
  lastBackupFile: string | null
  chatModel: AssistantModel
  chatEffort: Effort
  csvModel: AssistantModel
  csvEffort: Effort
  /** Allow Claude Desktop / Claude Code to use Kasboek through MCP while it is unlocked. */
  mcpEnabled: boolean
  /** Which AI the in-app assistant uses. */
  aiProvider: ProviderId
  /** Base URL for providers where it can be changed (local servers, custom); null = the preset's. */
  aiBaseUrl: string | null
  /** Model names for OpenAI-compatible providers (Claude uses chatModel/csvModel). */
  aiChatModel: string
  aiCsvModel: string
  /** The model that reads PDF statements; empty = Haiku for Claude, else the model for reading files. */
  aiPdfModel: string
  /** The saved values of the providers that are not in use (address, models, and a custom one's name), by provider id. */
  aiProviders: Record<string, ProviderSettings>
  /** Saved searches on the Transactions page (this computer only). */
  savedSearches: SavedSearch[]
  /** Other providers: how much the model reasons, in the chat and in CSV checks. */
  aiReasoning: ReasoningLevel
  aiCsvReasoning: ReasoningLevel
  /** What the assistant may change without asking. */
  permissions: PermissionSettings
  /**
   * The assistant as a whole (panel, buttons, checks, tips and the main process behind them). Off: nothing is sent to any AI
   * provider and nothing about it is shown. This computer only; an import never switches it on (see resetImportedSettings).
   */
  assistantEnabled: boolean
  /** The assistant remembers facts and preferences between conversations (this computer only). */
  memoryEnabled: boolean
  /** The chat tells the assistant which page is open (see shared/page-context.ts). */
  pageContextEnabled: boolean
  /** Account numbers show as BE…1234 on screen until the person reveals one (this computer only; an import cannot switch it off). */
  hideAccountNumbers: boolean
  /**
   * The person agreed to send the tips summary to this AI provider at this address with this model (see
   * core/insight-plan.ts for what is sent); null = not asked yet. `baseUrl` (normalised) and `model` are
   * missing in records written before they were kept: those count as not agreed.
   */
  aiInsightsConsent: { provider: string; version: number; at: string; baseUrl?: string; model?: string } | null
  /**
   * The person agreed to send the rows of a CSV file to this AI provider at this address with this model
   * for "Check with AI" (see main/assistant/csv.ts for what is sent); null = not asked yet. A record that
   * differs in any field, or is from an older list of what is sent, counts as not agreed.
   */
  aiCheckConsent: { provider: string; baseUrl: string; model: string; version: number; at: string } | null
}

/** Something the assistant remembers between conversations. */
export interface Memory {
  id: number
  text: string
  /** Typed by the person in Settings, or saved by the assistant (with their OK or permission). */
  source: 'person' | 'assistant'
  createdAt: string
  updatedAt: string
}

export interface MemoryState {
  enabled: boolean
  items: Memory[]
  limit: number
}

export const ASSISTANT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'] as const
export type AssistantModel = (typeof ASSISTANT_MODELS)[number]
export type { Effort } from './reasoning'

export interface AssistantStatus {
  configured: boolean
  keyHint: string | null
  provider: ProviderId
  /** Shown as the assistant's name ("Claude", "Mistral", …). */
  providerName: string
  /** Who receives the data; null when the model runs on this computer or network. */
  company: string | null
  busy: boolean
  /** What the assistant is doing while busy: waiting for the model, running a tool, or waiting for the person's approval. */
  activity: { kind: 'model' } | { kind: 'tool'; tool: string } | { kind: 'approval' } | null
  messages: ChatMessage[]
  /** The chat model refused the reasoning setting, so it is sent without it. */
  reasoningUnsupported?: boolean
}

export type ChatMessage =
  | { id: string; role: 'user'; text: string }
  | {
      id: string
      role: 'assistant'
      text: string
      tools: { name: string; ok: boolean }[]
      error?: string
      /** The model's reasoning, as far as the provider shares it. */
      thinking?: string
      /** A CSV check from the import screen, shown here while it runs and with its result. */
      check?: { fileName: string; groupsDone: number; groupsTotal: number; done: boolean; categorised?: number; renamed?: number; rules?: number; existing?: number }
    }
  | { id: string; role: 'confirm'; op: string; summary: string; state: 'pending' | 'approved' | 'declined' | 'auto'; /** An allowed change that then failed. */ failed?: boolean }

/** A change to the preferences; `formats` may hold only the parts that change. */
export type PrefsPatch = Partial<Omit<Prefs, 'formats'>> & { formats?: Partial<FormatPrefs> }

/** Interface preferences, stored outside the database so the lock screen can use them. */
export interface Prefs {
  theme: Theme
  /** UI language (i18n resource key). */
  language: LanguageCode
  /** Number, money and date formats; each part is chosen separately. */
  formats: FormatPrefs
  /** Lock after this many minutes without keyboard or mouse use. 0 = never. */
  autoLockMinutes: number
  /** Look for a new Kasboek release on GitHub at start and once a day. */
  updateCheck: boolean
  /** The welcome window (assistant and update choice) was finished on this computer. */
  welcomeDone: boolean
  /** Draw with the graphics card: automatic, always or never. Takes effect at the next start. */
  graphics: GraphicsChoice
  /** Closing the window keeps Kasboek running in the tray instead of quitting. Off unless chosen. */
  keepInTray: boolean
  /** Show the Suggestions card on the Overview (tips found from the person's own data, nothing is sent anywhere). */
  insights: boolean
  /** Set by Kasboek when the graphics card failed to show its window; "automatic" then draws in software. */
  graphicsFailed: boolean
  /** Nothing is waiting for the one-time tip on the Overview (give uncategorised transactions a category): it was closed, or there was no first import or transaction to follow up. Set to false by the first import or manual transaction. */
  firstTipDone: boolean
  /** The assistant panel was left open (true) or closed (false); null = never chosen, then it is open only when the assistant is on. */
  assistantOpen: boolean | null
}

/** How the update for this computer is installed. */
export type UpdateKind = 'msi' | 'appimage' | 'deb' | 'dmg'

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'preparing' | 'installing' | 'opened' | 'error'
  /** This version and the newest release. */
  current: string
  latest: string | null
  /** The release's notes (Markdown) and its page on GitHub. */
  notes: string | null
  pageUrl: string | null
  /** How it installs here; null when the release has no file for this computer. */
  kind: UpdateKind | null
  sizeBytes: number | null
  /** Download progress, 0–1. */
  progress: number
  /** While downloading: nothing came in for a while (`stalled`), or the connection broke and it tries again (`retrying`). */
  downloadNote: 'stalled' | 'retrying' | null
  error: string | null
  lastCheckedAt: string | null
  /** False in development runs, where nothing is checked. */
  supported: boolean
}

export type AuthMode = 'password' | 'device'
export type DeviceAuthKind = 'windows-hello' | 'touch-id' | null

/** What an import did not take over from the file (see resetImportedSettings); each has to be set up again in Settings. */
export type ImportReset = 'aiKey' | 'aiEndpoint' | 'permissions' | 'mcp' | 'autoBackup' | 'memory' | 'sync'

/** One quarantined copy: `name` is what restoring refers to, `erasedAt` is when it was set aside (ISO). */
export interface ErasedCopy {
  name: string
  erasedAt: string
}

export interface AuthStatus {
  state: 'setup' | 'locked' | 'unlocked'
  mode: AuthMode | null
  twoFactor: boolean
  /** 2FA is remembered on this computer until this time (ISO), or null. */
  rememberedUntil: string | null
  device: DeviceAuthKind
  /** Still finding out whether Windows Hello / Touch ID is available. */
  deviceChecking: boolean
  throttleSeconds: number
  /** Unlocked with the recovery key; a new password should be chosen. */
  recovered: boolean
  /** The current password doesn't meet today's rules; a stronger one must be chosen. */
  weakPassword: boolean
  /** Data from an earlier version exists and will be kept at setup. */
  legacyData: boolean
  /** Erased copies that can still be restored (kept 30 days), newest first. */
  erased: ErasedCopy[]
  /** The account file was restored from its safety copy, which was written at this time (ISO): a later password or two-step change may be lost. Until the next unlock. */
  restoredFrom: string | null
  keyProtection: KeyProtection
  error: { code: string; message: string } | null
}

export type KeyProtection = 'os' | 'weak'

export interface AppInfo {
  name: string
  version: string
  /** The commit the build was made from (empty in a development run without git). */
  commit: string
  platform: NodeJSPlatform
  dataDir: string
  /** Whether this run draws with the graphics card, and if not, why. */
  graphics: GraphicsStatus
  /** Command and arguments to run Kasboek as an MCP server. */
  mcpCommand: { command: string; args: string[] }
}

/** Narrowed copy of `NodeJS.Platform`, so the renderer does not need Node types. */
export type NodeJSPlatform = 'win32' | 'darwin' | 'linux' | 'aix' | 'android' | 'freebsd' | 'haiku' | 'openbsd' | 'sunos' | 'cygwin' | 'netbsd'

export interface BackupStatus {
  autoEnabled: boolean
  folder: string | null
  keep: number
  lastBackupAt: string | null
  lastBackupFile: string | null
}

export interface PickedTransfer {
  token: string
  fileName: string
  kind: 'export' | 'backup'
  createdAt: string
  appVersion: string
  mode: AuthMode
  twoFactor: boolean
  hasPassword: boolean
  /** Passwordless export, but this computer has no Windows Hello / Touch ID. */
  needsNewPassword: boolean
}

export interface Transaction {
  id: number
  accountId: number
  accountName: string
  bookingDate: string
  valueDate: string | null
  amountCents: number
  currency: string
  description: string
  counterpartyName: string | null
  counterpartyIban: string | null
  communication: string | null
  categoryId: number | null
  categoryName: string | null
  notes: string | null
  importBatchId: number | null
  /** The other account, when this is one half of a transfer between own accounts. */
  transferAccount: string | null
  /** Parts, when the transaction is split over several categories (0 = not split). */
  splitCount: number
}

/** Facts for a monthly review (the assistant writes it from these). */
export interface MonthReview {
  month: string
  incomeCents: number
  spendingCents: number
  /** Averages of the three months before. */
  averageIncomeCents: number
  averageSpendingCents: number
  uncategorised: number
  /** Spending per category against the three months before, biggest change first. */
  categories: { categoryId: number | null; name: string; cents: number; averageCents: number; changeCents: number }[]
  overBudget: { categoryId: number; name: string; budgetCents: number; spentCents: number }[]
  /** Payments far above what the payee usually costs ("higher"), or a large first payment ("new"). */
  unusual: { id: number; date: string; name: string; cents: number; usualCents: number | null; category: string | null; reason: 'higher' | 'new' }[]
}

/** A payment (or income) that comes back at a steady rhythm. */
export interface RecurringItem {
  key: string
  name: string
  direction: 'in' | 'out'
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  /** The usual amount (negative = money out). */
  typicalCents: number
  /** That amount per month (a yearly one divided by 12). */
  monthlyCents: number
  lastCents: number
  lastDate: string
  nextDate: string
  count: number
  /** paid: already this month; due: still expected this month; late: expected and not seen; later: next month or after. */
  status: 'paid' | 'due' | 'late' | 'later'
  /** The last amount minus the one before, when it changed. */
  priceChangeCents: number | null
  categoryId: number | null
  categoryName: string | null
  accountId: number
  accountName: string
  transactionIds: number[]
}

/** A savings goal and how far along it is (amounts in the main currency). */
export interface Goal {
  id: number
  name: string
  targetCents: number
  targetDate: string | null
  /** Tracked by this account's balance; otherwise by savedCents, kept by hand. */
  accountId: number | null
  accountName: string | null
  savedCents: number | null
  currentCents: number
  remainingCents: number
  reached: boolean
  /** What to put aside per month to reach it by the date (null without a date or when reached). */
  perMonthCents: number | null
  overdue: boolean
  archived: boolean
}

/** Something to warn about: a budget nearly or fully spent, or a balance heading below zero. */
export type Alert =
  | { kind: 'budget'; key: string; categoryId: number; name: string; budgetCents: number; spentCents: number; level: 'near' | 'over' }
  | { kind: 'balance'; key: string; accountId: number; name: string; currency: string; balanceCents: number; lowestCents: number; until: string; dueCents: number }

/** What a tip on the Overview is about. */
export type InsightKind =
  | 'price_up'
  | 'charged_twice'
  | 'late'
  | 'upcoming'
  | 'over_budget'
  | 'near_budget'
  | 'category_up'
  | 'unusual'
  | 'no_budget'
  | 'balance_low'
  | 'subscriptions'

/** One value of a tip. Money is in cents of its own currency, so it is never mixed with another. */
export type InsightValue = { money: number; currency: string } | { date: string } | { count: number } | { text: string }

/** A fact found from the person's own data. The tip texts are made from these on screen. */
export interface InsightFact {
  id: string
  /** Stable for the same situation (same payee and month, same category and month), so a hidden tip stays hidden. */
  key: string
  kind: InsightKind
  values: Record<string, InsightValue>
  categoryId: number | null
  recurringKey: string | null
  /** The payments behind it (at most 20). */
  transactionIds: number[]
  /** How much money it is about, in cents of the main currency: the biggest come first. */
  weight: number
}

/** A tip written by the assistant and checked by Kasboek. Numbers and dates in the texts are placeholders like {f3.amount}, filled in at display time. */
export interface InsightSuggestion {
  kind: InsightKind
  severity: 'warning' | 'tip' | 'info'
  /** Keys (not ids) of the facts it is about; the first decides the button. */
  factKeys: string[]
  title: string
  body: string
}

/** The tips last written by the assistant for a month, kept on this computer. */
export interface InsightsAi {
  createdAt: string
  providerName: string
  model: string
  language: string
  /** The data changed, or the interface language did, since the tips were written. */
  stale: 'data' | 'language' | null
  suggestions: InsightSuggestion[]
  /** The facts that were sent (the ids in the placeholders refer to them). */
  facts: InsightFact[]
}

export interface InsightsView {
  facts: InsightFact[]
  ai: InsightsAi | null
}

/** Exactly what would be sent to the assistant to write tips. */
export interface InsightsPreview {
  text: string
  approxTokens: number
  facts: number
  providerName: string
  /** Who receives it; null when the model runs on this computer or network. */
  company: string | null
  /** Where it goes: the host of an online provider, the whole address of a local or custom one. */
  address: string
  model: string
}

/** Exactly what "Check with AI" would send for an open import. */
export interface CheckAssistPreview {
  /** Every request's text, the same as is sent; several requests are separated by a line. */
  text: string
  approxTokens: number
  /** Rows of the file. */
  rows: number
  /** The text is sent in this many requests. */
  parts: number
  providerName: string
  company: string | null
  address: string
  model: string
}

export interface RecurringSummary {
  /** What counts as fixed (everything below is worked out from these). */
  items: RecurringItem[]
  /** Detected, but the person said they are not fixed: left out of the totals and the warnings. */
  hidden: RecurringItem[]
  /** Fixed costs and fixed income per month. */
  monthlyOutCents: number
  monthlyInCents: number
  /** Fixed costs still expected this month (due or late). */
  dueThisMonthCents: number
}

/** One part of a split transaction. */
export interface SplitLine {
  categoryId: number | null
  categoryName: string | null
  amountCents: number
  note?: string | null
}

/** Two transactions that look like one transfer between the person's own accounts. */
export interface TransferPair {
  outId: number
  inId: number
  date: string
  /** What left the first account, in its currency. */
  amountCents: number
  currency: string
  /** What arrived, in the second account's currency (the same as above within one currency). */
  inAmountCents: number
  inCurrency: string
  /** Between currencies: the exchange cost in the first account's currency; null when it can't be worked out or there is none. */
  costCents: number | null
  fromAccount: string
  toAccount: string
  /** iban: the account number on one side is the other account's (sure); amount: same amount a few days apart. */
  confidence: 'iban' | 'amount'
  days: number
}

export interface TransactionPage {
  items: Transaction[]
  total: number
  inCents: number
  outCents: number
}

/** iban: the counterparty's account number (exact), e.g. to tell transfers to your own accounts apart. */
export type RuleField = 'counterparty' | 'description' | 'any' | 'iban'
/** contains: anywhere in the text; word: as a whole word; starts: at the start of the text. */
export type RuleMatch = 'contains' | 'word' | 'starts'

export interface Rule {
  id: number
  field: RuleField
  match: RuleMatch
  pattern: string
  categoryId: number
  categoryName: string
  priority: number
}

/** What a rule would do, shown before it is created. */
export interface RulePreview {
  /** Transactions it matches. */
  matches: number
  /** Of those, how many have no category yet (these it would categorise). */
  uncategorised: number
  /** Of those, how many already sit in another category (left as they are). */
  otherCategory: number
  /** The rule was made a whole-word rule because the text is short. */
  wholeWord: boolean
  examples: string[]
}

export interface BudgetRow {
  categoryId: number
  name: string
  budgetCents: number | null
  spentCents: number
}

export interface MonthSummary {
  month: string
  incomeCents: number
  spendingCents: number
  budgetedCents: number
  /** Budget left for the month; null when no budgets are set. */
  leftCents: number | null
  byCategory: { categoryId: number | null; name: string; cents: number }[]
  uncategorized: number
  /** Transactions this month in a currency without any exchange rate (left out of the totals). */
  unconverted: number
  history: { month: string; incomeCents: number; spendingCents: number }[]
}

export interface AccountWithBalance extends Account {
  /** The latest balance recorded from the bank (or read from a CSV). */
  lastBankBalance: { date: string; balanceCents: number; differenceCents: number | null } | null
  /** In the account's own currency. */
  balanceCents: number
  /** In the main currency at the latest rate; null when there is no rate. */
  balanceMainCents: number | null
  transactionCount: number
}

/** possible_duplicate: looks like a transaction already in Kasboek (same amount, a few days apart, similar text); not imported unless included. */
export type ImportRowStatus = 'ready' | 'duplicate' | 'possible_duplicate' | 'problem' | 'skipped'

export interface ImportRow {
  index: number
  line: number
  bookingDate: string | null
  amountCents: number | null
  description: string
  counterpartyName: string | null
  counterpartyIban: string | null
  communication: string | null
  categoryId: number | null
  /** Where the category came from. */
  categorySource: 'rule' | 'assistant' | 'user' | null
  issues: string[]
  status: ImportRowStatus
  /** The person chose to include or skip this row. */
  decided: 'include' | 'skip' | null
  note: string | null
  /** For a (possible) duplicate: the transaction already in Kasboek it matches. */
  match: { id: number; bookingDate: string; counterpartyName: string | null; description: string } | null
}

/** What an import did, and what it knows about the account's balance. */
export interface ImportCommitResult {
  batchId: number
  imported: number
  skipped: number
  /** Last date in the file: the day to compare the balance with the bank. */
  lastDate: string | null
  /** Kasboek's balance at the end of that day, after the import. */
  balanceOnLastDate: number | null
  /** A balance read from the CSV and recorded, compared with what Kasboek expected. */
  bankBalance: BankBalanceResult | null
  /** Why the file's closing balance wasn't recorded, if it wasn't. */
  balanceNote: string | null
  /** Transfers to or from another own account: paired at once (account number matches), and possible ones to check. */
  transfersPaired: number
  transfersSuggested: number
  /** The account has no recorded bank balance yet: ask for one. */
  askBalance: boolean
}

/** A balance the bank showed at the end of a day, compared with the one before it. */
export interface BankBalance {
  date: string
  balanceCents: number
  note: string | null
  /** What Kasboek expected from the previous recorded balance and the transactions since. */
  expectedCents: number | null
  /** Bank minus expected: not zero when a transaction is missing or counted twice. */
  differenceCents: number | null
  since: string | null
}

export interface BankBalanceResult {
  date: string
  balanceCents: number
  expectedCents: number | null
  differenceCents: number | null
}

/** What "Check" did to the open import, and what it proposes to change outside it. */
export interface CheckSummary {
  /** Who checked it (the assistant's name). */
  by: string
  /** Rows of this file already in Kasboek (not checked again). */
  alreadyImported: number
  total: number
  /** Changes made to the rows of this import; each part can be undone. */
  categorised: number
  renamed: number
  fixed: number
  mappingChanged: boolean
  /** Rules it suggests, checked against this file and what is already in Kasboek. */
  rules: ProposedRule[]
  /** Transactions already in Kasboek without a category that it would categorise. */
  existing: ProposedCategorisation[]
  /** Suggestions that were dropped, and why. */
  dropped: string[]
  /** What "Apply selected" already saved (not undone with the check; change it in Rules or Transactions). */
  applied: { rules: number; categorised: number } | null
}

export interface ProposedRule {
  id: number
  field: RuleField
  match: RuleMatch
  pattern: string
  categoryId: number
  categoryName: string
  /** Rows of this import it categorises. */
  rowsHere: number
  /** Uncategorised transactions already in Kasboek it would categorise. */
  existing: number
}

export interface ProposedCategorisation {
  id: number
  label: string
  categoryId: number
  categoryName: string
  count: number
  totalCents: number
}

export type CheckPart = 'categories' | 'names' | 'fixes' | 'all'

export interface ImportColumns {
  bookingDate: number
  valueDate?: number
  amount?: number
  debit?: number
  credit?: number
  /** Whether the amount is money out or in, as its own column ("Af/Bij", "S/H", "Debit/Credit"). */
  direction?: number
  currency?: number
  counterpartyName?: number
  counterpartyIban?: number
  description: number[]
  communication?: number
  bankReference?: number
  status?: number
  /** The account balance after each transaction, when the bank includes it. */
  balance?: number
}

export interface ImportMapping {
  delimiter: ';' | ',' | '\t' | '|'
  headerRow: number
  dateOrder: 'DMY' | 'YMD' | 'MDY'
  decimal: ',' | '.'
  invertSign: boolean
  columns: ImportColumns
}

/** How a PDF statement's printed balances and the rows read from it agree (cents). */
export interface Reconciliation {
  openingCents: number | null
  closingCents: number | null
  /** Sum of the rows' amounts (rows the person skipped are left out). */
  sumCents: number
  /** Closing minus (opening plus sum); 0 when the rows add up. Null when a balance is missing. */
  differenceCents: number | null
  rowsChecked: number
  /** Rows whose running balance doesn't follow from the one before. */
  runningMismatches: number
}

/** A remark about a PDF statement, as a code the screen words in the person's language. */
/** A remark about a CAMT (XML) statement, as a code the screen words in the person's language. */
export type XmlNote = { code: 'other_account'; iban: string } | { code: 'accounts_left_out'; count: number } | { code: 'not_booked'; count: number }

export type PdfNote = { code: 'other_account'; iban: string } | { code: 'dates_without_year' } | { code: 'pages_without_text'; count: number } | { code: 'no_table'; pages: number; lines: number }

export interface ImportPreview {
  sessionId: string
  fileName: string
  accountId: number
  accountName: string
  /** The account's currency; amounts in the preview are in it. */
  currency: string
  /** Internal id of a recognised file layout, or null. Not a bank list: any bank's CSV works. */
  layout: string | null
  encoding: string
  mappingSource: 'saved' | 'detected' | 'assistant' | 'manual' | 'none'
  headers: string[]
  sample: string[][]
  mapping: ImportMapping | null
  rows: ImportRow[]
  stats: {
    total: number
    ready: number
    duplicates: number
    possibleDuplicates: number
    problems: number
    skipped: number
    inCents: number
    outCents: number
    /** Period of the rows that will be imported. */
    from: string | null
    to: string | null
    /** Period of the whole file. */
    fileFrom: string | null
    fileTo: string | null
  }
  notes: string[]
  /** Rows the person changed by hand (what an assistant's check changed is not counted). */
  edited: number
  check: CheckSummary | null
  fileKind: 'csv' | 'pdf' | 'xml'
  /** Only for a PDF statement. */
  pdf: {
    pages: number
    readBy: 'kasboek' | 'assistant'
    /** False when no table of transactions was found in the text. */
    tableFound: boolean
    reconciliation: Reconciliation | null
    notes: PdfNote[]
  } | null
  /** Only for an XML (CAMT) statement. */
  xml: {
    reconciliation: Reconciliation | null
    notes: XmlNote[]
  } | null
}

/** What "Read with the assistant" would send for an open PDF statement. */
export interface PdfAssistPreview {
  /** Pages of text that are sent. */
  pages: number
  /** The text is sent in this many calls. */
  parts: number
  chars: number
  approxTokens: number
  /** Exactly the text that is sent, masked. */
  text: string
}

export interface ImportBatch {
  id: number
  fileName: string
  accountName: string
  rowCount: number
  committedAt: string
  remaining: number
}

export interface BackupEntryInfo {
  name: string
  createdAt: string
  size: number
  tier: 'recent' | 'daily' | 'monthly'
}

/** When each Claude app last reached Kasboek over MCP (ms since 1970), or null. */
export interface McpClientsSeen {
  desktop: number | null
  code: number | null
  /** An app that didn't say which it is. */
  other: number | null
}

export interface McpSetupStatus {
  entry: { command: string; args: string[] }
  helperFound: boolean
  /** null when Claude Desktop isn't available on this system. */
  desktop: { configPath: string; state: 'absent' | 'current' | 'outdated' } | null
  /** null when the `claude` command wasn't found. */
  /** Whether Claude Code has Kasboek, and with this installation's helper and data folder. */
  code: { path: string; state: 'absent' | 'current' | 'outdated' } | null
  devBuild: boolean
  /** Why the connection for Claude apps couldn't start, if it failed. */
  bridgeError: string | null
}
