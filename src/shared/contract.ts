/**
 * The single list of operations the app supports.
 *
 * The UI calls these over IPC. The in-app Claude chat and the MCP server call the same
 * operations (only those marked as assistant tools), so every path is validated the same way.
 */
import { z } from 'zod'
import { ASSISTANT_MODELS } from './types'
import type { ErrorDetails } from './error-text'
import { mappingSchema } from './import-mapping'
import { MONTH } from './month'
import { CURRENCY_POSITIONS, CURRENCY_STYLES, DATE_PATTERNS, DECIMAL_SEPARATORS, GROUP_SEPARATORS, GROUPINGS, NEGATIVE_STYLES, TIME_FORMATS } from './format'
import { checkPassword } from './password'
import { CURRENCIES } from './currency'
import { LANGUAGE_CODES, type LanguageCode } from './languages'
import { checkBaseUrl, isProviderId, type ProviderId } from './ai-providers'
import { EFFORTS, REASONING_LEVELS } from './reasoning'
import { SENSITIVE_MESSAGE, looksSensitive } from './sensitive'
import { PERMISSION_KINDS, PERMISSION_MODES, type PermissionKind } from './permissions'
import { GRAPHICS_CHOICES } from './graphics'
import { PageContextSchema } from './page-context'

const currency = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((c) => CURRENCIES.includes(c), { message: 'Unknown currency code.' })
import { ACCOUNT_KINDS } from './types'
import type { Alert, Goal, InsightsPreview, InsightsView, McpClientsSeen, MemoryState, UpdateStatus, SavedSearch, MonthReview, RecurringSummary, SplitLine, TransferPair, Account, AccountWithBalance, BankBalance, BankBalanceResult, ImportCommitResult, AssistantStatus, AppInfo, AuthStatus, ImportReset, BackupEntryInfo, BackupStatus, BudgetRow, Category, FxRate, FxStatus, NetWorth, Valuation, YearSummary, ImportBatch, ImportPreview, CheckAssistPreview, PdfAssistPreview, McpSetupStatus, MonthSummary, PickedTransfer, Prefs, Rule, RulePreview, Settings, SyncStatus, Transaction, TransactionPage } from './types'

const out = <T>() => undefined as unknown as T

/** A step name for startup.log: lower-case words only, so the log can never hold anything else. */
export const MILESTONE_NAME = /^[a-z0-9 _-]{1,40}$/
const milestoneName = z.string().regex(MILESTONE_NAME)
const empty = z.object({}).strict()
const password = z
  .string()
  .max(256)
  .refine((p) => checkPassword(p).ok, 'This password doesn’t meet the requirements: at least 12 characters, three kinds of characters, and not a common or predictable password.')
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const month = z.string().regex(MONTH, 'Use YYYY-MM.')
const id = z.number().int().positive()
/** A bank's exchange cost on top of the reference rate, in percent; null clears it. */
const fxCostPct = z.number().min(0).max(20).nullable()
const cents = z.number().int().min(-1e12).max(1e12)
const code = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.')

/** An AI provider: a built-in one or a custom one (custom-…). */
const providerId = z.custom<ProviderId>(isProviderId, 'Unknown provider.')
const providerName = z.string().trim().min(1).max(60)
/** The address of an AI server; every custom provider's address passes the same check (https, or http on this computer or network). */
const baseUrl = z
  .string()
  .trim()
  .max(300)
  .refine((u) => !checkBaseUrl(u), { error: (iss) => checkBaseUrl(String(iss.input)) ?? 'Invalid address.' })

/** Where to sync: nothing (a folder, chosen in a dialog) or a WebDAV server. */
const syncPlace = z
  .object({
    webdav: z
      .object({
        url: z.string().trim().min(1).max(500),
        user: z.string().max(200),
        password: z.string().max(500)
      })
      .strict()
      .optional()
  })
  .strict()
  .default({})

export const contract = {
  /* ----- App & preferences (available while locked) ----- */
  'app.info': { input: empty, output: out<AppInfo>() },
  'app.ready': { input: empty, output: out<{ ok: true }>() },
  /** A timing fact from the page for startup.log (when the page got to a step). Only a fixed kind of text, never data. */
  'app.milestone': { input: z.object({ name: milestoneName, ms: z.number().finite().min(0).max(86_400_000) }).strict(), output: out<{ ok: true }>() },
  /** Start Kasboek again (after changing how it draws). */
  'app.restart': { input: empty, output: out<{ ok: true }>() },
  'prefs.get': { input: empty, output: out<Prefs>() },
  'prefs.update': {
    input: z
      .object({
        theme: z.enum(['system', 'light', 'dark']),
        language: z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]),
        formats: z
          .object({
            decimal: z.enum(DECIMAL_SEPARATORS),
            group: z.enum(GROUP_SEPARATORS),
            grouping: z.enum(GROUPINGS),
            currencyPosition: z.enum(CURRENCY_POSITIONS),
            currencyStyle: z.enum(CURRENCY_STYLES),
            negative: z.enum(NEGATIVE_STYLES),
            date: z.enum(DATE_PATTERNS),
            time: z.enum(TIME_FORMATS)
          })
          .partial()
          .strict(),
        autoLockMinutes: z.number().int().min(0).max(240),
        updateCheck: z.boolean(),
        welcomeDone: z.boolean(),
        graphics: z.enum(GRAPHICS_CHOICES),
        keepInTray: z.boolean(),
        insights: z.boolean(),
        firstTipDone: z.boolean(),
        assistantOpen: z.boolean().nullable()
      })
      .partial()
      .strict(),
    output: out<Prefs>()
  },

  /* ----- Updates (new releases on GitHub) ----- */
  'update.status': { input: empty, output: out<UpdateStatus>() },
  'update.check': { input: empty, output: out<UpdateStatus>() },
  'update.download': { input: empty, output: out<UpdateStatus>() },
  /** Stops a running download and removes what was downloaded. */
  'update.cancel': { input: empty, output: out<UpdateStatus>() },
  /** Backs up, then installs (Windows, AppImage: Kasboek closes and opens again) or opens the file. */
  'update.install': { input: empty, output: out<UpdateStatus>() },
  'update.openPage': { input: empty, output: out<{ ok: true }>() },

  /* ----- Login ----- */
  'auth.status': { input: empty, output: out<AuthStatus>() },
  /** Error screen, "Try again": reads the account file again (a plain status never does). */
  'auth.retry': { input: empty, output: out<AuthStatus>() },
  'auth.setup': {
    input: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('password'), password }).strict(),
      z.object({ mode: z.literal('device') }).strict()
    ]),
    output: out<{ recoveryKey: string }>()
  },
  'auth.unlock': {
    input: z.object({ password: z.string().max(256).optional(), code: z.string().max(12).optional(), remember: z.boolean().optional() }).strict(),
    output: out<AuthStatus>()
  },
  'auth.forgetComputer': { input: empty, output: out<AuthStatus>() },
  /** Error screen: opens the data folder in the file manager. Takes no path; the main process knows it. */
  'auth.showDataFolder': { input: empty, output: out<{ ok: boolean }>() },
  /** Error screen: a short text about the data files (names, sizes, dates; never contents) to copy for support. */
  'auth.diagnostics': { input: empty, output: out<{ text: string }>() },
  'auth.unlockRecovery': { input: z.object({ recoveryKey: z.string().min(10).max(80) }).strict(), output: out<AuthStatus>() },
  'auth.lock': { input: empty, output: out<AuthStatus>() },
  /** Moves the data, safety backups included, into quarantine for 30 days (restorable with the password or recovery key) and starts fresh. */
  'auth.erase': { input: z.object({ confirm: z.literal('ERASE') }).strict(), output: out<AuthStatus>() },
  /** First screen only: brings back one erased copy, by the name listed in AuthStatus.erased. */
  'auth.restoreErased': { input: z.object({ name: z.string().regex(/^\d{10,}$/) }).strict(), output: out<AuthStatus>() },
  'auth.changePassword': {
    input: z.object({ current: z.string().max(256).optional(), next: password }).strict(),
    output: out<AuthStatus>()
  },
  'auth.usePasswordless': { input: z.object({ current: z.string().max(256).optional() }).strict(), output: out<AuthStatus>() },
  'auth.newRecoveryKey': { input: z.object({ current: z.string().max(256).optional() }).strict(), output: out<{ recoveryKey: string }>() },
  'auth.totpBegin': { input: empty, output: out<{ secret: string; uri: string; qrSvg: string }>() },
  'auth.totpEnable': { input: z.object({ code }).strict(), output: out<AuthStatus>() },
  'auth.totpDisable': { input: z.object({ code: z.string().max(12) }).strict(), output: out<AuthStatus>() },

  /* ----- Move computers, backups ----- */
  'transfer.export': { input: empty, output: out<{ file: string | null }>() },
  'transfer.pick': { input: empty, output: out<PickedTransfer | null>() },
  'transfer.import': {
    input: z
      .object({
        token: z.string().min(1),
        password: z.string().max(256).optional(),
        code: z.string().max(12).optional(),
        recoveryKey: z.string().max(80).optional(),
        newPassword: password.optional()
      })
      .strict(),
    output: out<{ status: AuthStatus; reset: ImportReset[] }>()
  },
  'backup.status': { input: empty, output: out<BackupStatus>() },
  'backup.chooseFolder': { input: empty, output: out<{ folder: string | null }>() },
  'backup.configureAuto': {
    input: z.object({ enabled: z.boolean(), keep: z.number().int().min(1).max(100).optional() }).strict(),
    output: out<BackupStatus>()
  },
  'backup.runNow': { input: empty, output: out<{ file: string }>() },
  'backup.list': { input: empty, output: out<BackupEntryInfo[]>() },
  'backup.pick': { input: z.object({ name: z.string().min(1).max(200) }).strict(), output: out<PickedTransfer>() },
  'backup.revealFolder': { input: empty, output: out<{ ok: boolean }>() },

  /* ----- Claude ----- */
  'assistant.status': { input: empty, output: out<AssistantStatus>() },
  'assistant.setKey': {
    input: z
      .object({ apiKey: z.string().trim().min(1).max(500), provider: providerId.optional() })
      .strict()
      .superRefine((v, ctx) => {
        if ((v.provider ?? 'anthropic') === 'anthropic' && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(v.apiKey))
          ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'That doesn’t look like an Anthropic API key (it starts with sk-ant-).' })
        else if (/\s/.test(v.apiKey) || v.apiKey.length < 8) ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'That doesn’t look like an API key.' })
      }),
    output: out<AssistantStatus>()
  },
  'assistant.models': { input: empty, output: out<string[]>() },
  'assistant.clearKey': { input: empty, output: out<AssistantStatus>() },
  'assistant.addProvider': {
    input: z.object({ name: providerName, baseUrl, chatModel: z.string().trim().max(200), csvModel: z.string().trim().max(200) }).strict(),
    output: out<Settings>()
  },
  'assistant.renameProvider': { input: z.object({ id: providerId, name: providerName }).strict(), output: out<Settings>() },
  'assistant.removeProvider': { input: z.object({ id: providerId }).strict(), output: out<Settings>() },
  'assistant.configure': {
    input: z
      .object({
        chatModel: z.enum(ASSISTANT_MODELS),
        chatEffort: z.enum(EFFORTS),
        csvModel: z.enum(ASSISTANT_MODELS),
        csvEffort: z.enum(EFFORTS),
        aiReasoning: z.enum(REASONING_LEVELS),
        aiCsvReasoning: z.enum(REASONING_LEVELS),
        permissions: z
          .object({
            mode: z.enum(PERMISSION_MODES),
            rules: z.partialRecord(z.enum(PERMISSION_KINDS.map((k) => k.id) as [PermissionKind, ...PermissionKind[]]), z.enum(['ask', 'allow'])),
            mcpAlwaysAsk: z.boolean()
          })
          .strict(),
        mcpEnabled: z.boolean(),
        pageContextEnabled: z.boolean(),
        aiProvider: providerId,
        aiBaseUrl: baseUrl.nullable(),
        aiChatModel: z.string().trim().max(200),
        aiCsvModel: z.string().trim().max(200),
        aiPdfModel: z.string().trim().max(200)
      })
      .partial()
      .strict(),
    output: out<Settings>()
  },
  'assistant.send': { input: z.object({ text: z.string().trim().min(1).max(8000), pageContext: PageContextSchema.optional() }).strict(), output: out<AssistantStatus>() },
  'assistant.confirm': { input: z.object({ id: z.string().uuid(), approve: z.boolean() }).strict(), output: out<AssistantStatus>() },
  'assistant.stop': { input: empty, output: out<AssistantStatus>() },
  'assistant.reset': { input: empty, output: out<AssistantStatus>() },
  'import.assist': { input: z.object({ sessionId: z.string().uuid(), consent: z.literal(true).optional() }).strict(), output: out<ImportPreview>() },
  'import.assistPreview': { input: z.object({ sessionId: z.string().uuid() }).strict(), output: out<CheckAssistPreview>() },
  'export.csv': {
    input: z
      .object({
        filter: z
          .object({ accountId: id.optional(), categoryId: z.union([id, z.literal('none')]).optional(), month: month.optional(), from: date.optional(), to: date.optional(), search: z.string().max(100).optional(), direction: z.enum(['in', 'out']).optional() })
          .strict(),
        labels: z.array(z.string().max(60)).length(10),
        defaultName: z.string().max(120)
      })
      .strict(),
    output: out<{ file: string | null; rows: number }>()
  },
  'export.pdf': { input: z.object({ html: z.string().max(2_000_000), defaultName: z.string().max(120) }).strict(), output: out<{ file: string | null }>() },
  'import.assistStatus': {
    input: z.object({ sessionId: z.string().uuid() }).strict(),
    output: out<{ kind: 'check' | 'pdf'; running: boolean; startedAt: number; groupsDone: number; groupsTotal: number; partsTotal: number; error: string | null } | null>()
  },
  'import.pdfAssistPreview': { input: z.object({ sessionId: z.string().uuid() }).strict(), output: out<PdfAssistPreview>() },
  'import.pdfAssist': { input: z.object({ sessionId: z.string().uuid(), consent: z.literal(true) }).strict(), output: out<ImportPreview>() },
  'import.assistCancel': { input: z.object({ sessionId: z.string().uuid() }).strict(), output: out<{ ok: true }>() },
  'mcp.setupStatus': { input: empty, output: out<McpSetupStatus>() },
  /** When each Claude app last reached Kasboek (cheap; polled while the setup is on screen). */
  'mcp.clients': { input: empty, output: out<McpClientsSeen>() },
  /** Claude Desktop rewrites its settings file when it quits, so it must be closed before Kasboek adds itself. */
  'mcp.desktopRunning': { input: empty, output: out<{ running: boolean }>() },
  'mcp.desktopAdd': { input: empty, output: out<{ path: string; backup: string | null }>() },
  'mcp.desktopRemove': { input: empty, output: out<{ path: string; backup: string | null }>() },
  'mcp.codeAdd': { input: empty, output: out<{ ok: true }>() },
  'mcp.codeRemove': { input: empty, output: out<{ ok: true }>() },
  'mcp.respond': { input: z.object({ id: z.string().uuid(), approve: z.boolean() }).strict(), output: out<{ ok: true }>() },

  /* ----- Data ----- */
  'settings.get': { input: empty, output: out<Settings>() },
  'settings.update': { input: z.object({ currency, fxAutoUpdate: z.boolean(), hideAccountNumbers: z.boolean(), assistantEnabled: z.boolean() }).partial().strict(), output: out<Settings>() },

  /* ----- Net worth, investments, year ----- */
  'networth.summary': {
    description: 'Net worth now (assets minus debts, in the main currency), each account with its value and, for investments with recorded values, the gain, plus net worth at the end of each month. months: how many months of history (0 = all).',
    input: z.object({ months: z.number().int().min(0).max(600).default(24) }).strict(),
    output: out<NetWorth>()
  },
  'valuations.list': {
    description: 'Recorded values of an account (e.g. an investment portfolio), newest first.',
    input: z.object({ accountId: id }).strict(),
    output: out<Valuation[]>()
  },
  'valuations.set': {
    description: 'Record what an account (e.g. a broker portfolio or savings plan) was worth on a date, in cents of the account currency. Payments after that date are added on top until the next value.',
    input: z.object({ accountId: id, date, valueCents: z.number().int(), note: z.string().trim().max(200).nullable().optional() }).strict(),
    output: out<Valuation[]>()
  },
  'balances.list': {
    description: 'Balances the bank showed for an account (end of day), newest first, each compared with what Kasboek expected from the one before: a difference means a missing or doubled transaction.',
    input: z.object({ accountId: id }).strict(),
    output: out<BankBalance[]>()
  },
  'balances.set': {
    description: 'Record the balance the bank shows for an account at the end of a day (today or earlier), in cents of the account currency. The account balance is then counted from it. Returns what Kasboek expected and the difference.',
    input: z.object({ accountId: id, date, balanceCents: z.number().int(), note: z.string().trim().max(200).nullable().optional() }).strict(),
    output: out<BankBalanceResult>()
  },
  'valuations.delete': { input: z.object({ accountId: id, date }).strict(), output: out<Valuation[]>() },
  'summary.year': {
    description: 'One year: income and spending per month and per category (main currency, transfers left out), and totals for every year with data.',
    input: z.object({ year: z.number().int().min(1900).max(2200) }).strict(),
    output: out<YearSummary>()
  },

  /* ----- Sync between computers ----- */
  'sync.status': { input: empty, output: out<SyncStatus>() },
  /** Choose a folder and start syncing this computer's data through it. */
  'sync.start': { input: syncPlace, output: out<SyncStatus>() },
  /** Choose an existing sync folder to join: returns its newest snapshot to open with Import. */
  'sync.pickJoin': { input: syncPlace, output: out<PickedTransfer>() },
  /** Drops a chosen join that is not going ahead, and its downloaded copy. */
  'sync.cancelJoin': { input: z.object({ token: z.string().min(1).max(100) }).strict(), output: out<{ ok: true }>() },
  /** For data that syncs: choose where the sync folder is on this computer. */
  'sync.attach': { input: syncPlace, output: out<SyncStatus>() },
  'sync.now': { input: empty, output: out<SyncStatus>() },
  'sync.stop': { input: empty, output: out<SyncStatus>() },
  'sync.dismissConflicts': { input: empty, output: out<SyncStatus>() },

  /* ----- Currencies ----- */
  'fx.status': {
    description: 'Currencies in use and the exchange rates Kasboek has for them (units per 1 euro). Totals are shown in the main currency.',
    input: empty,
    output: out<FxStatus>()
  },
  'fx.rates': {
    description: 'Exchange rates typed in by hand, newest first (units of the currency per 1 euro).',
    input: z.object({ currency: currency.optional() }).strict(),
    output: out<FxRate[]>()
  },
  'fx.setRate': {
    description: 'Set an exchange rate by hand: how many units of `currency` one euro was worth on `date`. Used from that date on, until the next rate.',
    input: z.object({ currency, date, perEur: z.number().positive().max(1e9) }).strict(),
    output: out<FxStatus>()
  },
  'fx.deleteRate': { input: z.object({ currency, date }).strict(), output: out<FxStatus>() },
  'fx.updateEcb': { input: empty, output: out<FxStatus & { added: number }>() },

  'accounts.list': {
    description: 'List bank accounts with their current balance (cents).',
    input: empty,
    output: out<AccountWithBalance[]>()
  },
  'accounts.update': {
    input: z
      .object({ id, name: z.string().trim().min(1).max(80).optional(), bank: z.string().trim().max(60).optional(), iban: z.string().trim().max(34).nullable().optional(), currency: currency.optional(), kind: z.enum(ACCOUNT_KINDS).optional(), archived: z.boolean().optional(), fxCostPct: fxCostPct.optional() })
      .strict(),
    output: out<Account>()
  },
  'accounts.create': {
    input: z
      .object({
        name: z.string().trim().min(1).max(80),
        bank: z.string().trim().max(60).default(''),
        iban: z.string().trim().max(34).nullable().optional(),
        currency: currency.default('EUR'),
        kind: z.enum(ACCOUNT_KINDS).default('current'),
        openingBalanceCents: z.number().int().default(0),
        /** What the bank charges on top of the reference rate when converting currency (%), if known. */
        fxCostPct: fxCostPct.optional(),
        /** What the bank shows on a day (usually today): the balance is counted from there. */
        bankBalance: z.object({ date, cents: z.number().int() }).strict().optional()
      })
      .strict(),
    output: out<Account>()
  },

  'categories.list': { description: 'List all categories (id, name, kind: expense/income/transfer).', input: empty, output: out<Category[]>() },
  'categories.create': {
    description: 'Create a new category.',
    input: z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(['expense', 'income', 'transfer']) }).strict(),
    output: out<Category[]>()
  },
  'categories.update': {
    input: z.object({ id, name: z.string().trim().min(1).max(60).optional(), archived: z.boolean().optional() }).strict(),
    output: out<Category[]>()
  },

  'transactions.list': {
    description:
      'Search transactions. Amounts are integer cents: negative = money out, positive = money in. Filter by account, category (or "none" for uncategorised), month (YYYY-MM), date range, free-text search or direction. Returns a page plus totals for the whole filter.',
    input: z
      .object({
        accountId: id.optional(),
        categoryId: z.union([id, z.literal('none')]).optional(),
        month: month.optional(),
        from: date.optional(),
        to: date.optional(),
        search: z.string().max(100).optional(),
        direction: z.enum(['in', 'out']).optional(),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0)
      })
      .strict(),
    output: out<TransactionPage>()
  },
  'transactions.create': {
    input: z
      .object({
        accountId: id,
        bookingDate: date,
        amountCents: cents.refine((v) => v !== 0, 'Amount can’t be zero.'),
        description: z.string().trim().min(1).max(300),
        counterpartyName: z.string().trim().max(120).nullable().optional(),
        categoryId: id.nullable().optional(),
        notes: z.string().max(1000).nullable().optional()
      })
      .strict(),
    output: out<Transaction>()
  },
  'transactions.update': {
    input: z
      .object({
        id,
        categoryId: id.nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
        description: z.string().trim().min(1).max(300).optional(),
        bookingDate: date.optional(),
        amountCents: cents.optional(),
        counterpartyName: z.string().trim().max(120).nullable().optional()
      })
      .strict(),
    output: out<Transaction>()
  },
  'transactions.edit': {
    description: 'Fix one transaction: its category, notes, readable description or counterparty name. Dates and amounts can only be changed by the person.',
    input: z
      .object({
        id,
        categoryId: id.nullable().optional(),
        notes: z.string().max(1000).nullable().optional(),
        description: z.string().trim().min(1).max(300).optional(),
        counterpartyName: z.string().trim().max(120).nullable().optional()
      })
      .strict(),
    output: out<Transaction>()
  },
  'transactions.splits': { description: 'The parts of a split transaction (empty when it isn’t split).', input: z.object({ id }).strict(), output: out<SplitLine[]>() },
  'transactions.split': {
    description: 'Split one transaction over categories (e.g. a receipt with groceries and household). The parts’ amountCents must add up to the transaction’s amount (same sign as the transaction). An empty list removes the split.',
    input: z
      .object({
        id,
        parts: z.array(z.object({ categoryId: id.nullable(), amountCents: cents, note: z.string().max(200).nullable().optional() }).strict()).max(20)
      })
      .strict(),
    output: out<SplitLine[]>()
  },
  'transactions.rename': {
    description: 'Give several transactions the same readable counterparty name (e.g. all "CRF MKT BRUGGE" rows → "Carrefour"). The bank’s own text is kept.',
    input: z.object({ ids: z.array(id).min(1).max(5000), counterpartyName: z.string().trim().min(1).max(120) }).strict(),
    output: out<{ updated: number }>()
  },
  'searches.save': {
    input: z
      .object({
        name: z.string().trim().min(1).max(60),
        filter: z
          .object({ accountId: id.optional(), categoryId: z.union([id, z.literal('none')]).optional(), month: month.optional(), from: date.optional(), to: date.optional(), search: z.string().max(100).optional(), direction: z.enum(['in', 'out']).optional() })
          .strict()
      })
      .strict(),
    output: out<SavedSearch[]>()
  },
  'searches.delete': { input: z.object({ name: z.string().max(60) }).strict(), output: out<SavedSearch[]>() },
  'transactions.categorize': {
    description: 'Set the category of one or more transactions (categoryId null = uncategorised).',
    input: z.object({ ids: z.array(id).min(1).max(5000), categoryId: id.nullable() }).strict(),
    output: out<{ updated: number }>()
  },
  'transactions.delete': { input: z.object({ ids: z.array(id).min(1).max(5000) }).strict(), output: out<{ deleted: number }>() },

  'goals.list': {
    description: 'Savings goals: target amount and date, how much is saved (an account’s balance or an amount kept by hand), what is left, and what to put aside per month to reach it by the date. Main currency, cents.',
    input: empty,
    output: out<Goal[]>()
  },
  'goals.create': {
    description: 'Create a savings goal: a name, a target in cents of the main currency, optionally a date (YYYY-MM-DD), and either an account whose balance counts as saved, or an amount saved so far.',
    input: z.object({ name: z.string().trim().min(1).max(80), targetCents: z.number().int().min(1).max(1e12), targetDate: date.nullable().optional(), accountId: id.nullable().optional(), savedCents: z.number().int().min(0).max(1e12).nullable().optional() }).strict(),
    output: out<Goal[]>()
  },
  'goals.update': {
    input: z
      .object({ id, name: z.string().trim().min(1).max(80).optional(), targetCents: z.number().int().min(1).max(1e12).optional(), targetDate: date.nullable().optional(), accountId: id.nullable().optional(), savedCents: z.number().int().min(0).max(1e12).nullable().optional(), archived: z.boolean().optional() })
      .strict(),
    output: out<Goal[]>()
  },
  'goals.delete': { input: z.object({ id }).strict(), output: out<Goal[]>() },
  'memory.list': { input: empty, output: out<MemoryState>() },
  'memory.remember': {
    description: 'Remember a lasting fact or preference for later conversations: one short sentence (max 300 characters) in the person’s language. No account or card numbers, passwords, or amounts you can look up.',
    // Refused before the person is asked to approve it.
    input: z.object({ text: z.string().trim().min(1).max(300).refine((t) => !looksSensitive(t), SENSITIVE_MESSAGE) }).strict(),
    output: out<MemoryState>()
  },
  'memory.add': { input: z.object({ text: z.string().trim().min(1).max(300) }).strict(), output: out<MemoryState>() },
  'memory.update': { input: z.object({ id, text: z.string().trim().min(1).max(300) }).strict(), output: out<MemoryState>() },
  'memory.forget': {
    description: 'Forget remembered items, by the ids shown in brackets in your memory.',
    input: z.object({ ids: z.array(id).min(1).max(50) }).strict(),
    output: out<MemoryState>()
  },
  'memory.forgetAll': { input: empty, output: out<MemoryState>() },
  'memory.setEnabled': { input: z.object({ enabled: z.boolean() }).strict(), output: out<MemoryState>() },
  'alerts.list': {
    description: 'Warnings now: budgets at 80% or more this month, and current accounts whose balance would go below zero before the next income (counting fixed costs still due).',
    input: empty,
    output: out<Alert[]>()
  },
  'summary.review': {
    description: 'Facts for a review of one month (YYYY-MM): income and spending against the average of the three months before, each spending category against its average (biggest change first), budgets that went over, and payments that stand out (far above what that payee usually costs, or a large first payment). All in cents of the main currency.',
    input: z.object({ month }).strict(),
    output: out<MonthReview>()
  },
  'insights.get': {
    description: 'Tips for the Overview found locally from the data of one month (YYYY-MM). Not offered to the assistant.',
    input: z.object({ month }).strict(),
    output: out<InsightsView>()
  },
  'insights.feedback': {
    description: 'Remember on this computer what the person did with a tip (hidden, not useful, useful). Never synced.',
    input: z.object({ key: z.string().trim().min(1).max(300), verdict: z.enum(['dismissed', 'not_useful', 'useful']) }).strict(),
    output: out<{ ok: true }>()
  },
  'insights.preview': {
    description: 'The exact text that would be sent to the assistant to write tips for one month. Not offered to the assistant.',
    input: z.object({ month }).strict(),
    output: out<InsightsPreview>()
  },
  'insights.run': {
    description: 'Have the assistant write tips for one month from the local facts; consent: true records the person’s agreement for this provider. Not offered to the assistant.',
    input: z.object({ month, consent: z.literal(true).optional() }).strict(),
    output: out<InsightsView>()
  },
  'insights.cancel': {
    description: 'Stop the assistant while it writes tips.',
    input: empty,
    output: out<{ ok: true }>()
  },
  'insights.status': {
    description: 'Whether the assistant is writing tips now, for which month and since when. Not offered to the assistant.',
    input: empty,
    output: out<{ running: boolean; month: string | null; startedAt: string | null }>()
  },
  'insights.restoreDismissed': {
    description: 'Show the tips the person hid on this computer again.',
    input: empty,
    output: out<{ restored: number }>()
  },
  'recurring.list': {
    description: 'Payments and income that come back at a steady rhythm (subscriptions, rent, insurance, energy, salary), found from the last 14 months: usual amount, rhythm, last and next date, whether it is paid, due or late this month, and price changes. Plus fixed costs per month and what is still due this month.',
    input: empty,
    output: out<RecurringSummary>()
  },
  'recurring.hide': {
    description: 'Stop counting a detected fixed cost or fixed income (by its key from recurring_list) when the person says it is not fixed, or count it again with hidden: false. Hidden items are left out of fixed-cost totals and balance warnings; transactions are not changed.',
    input: z.object({ key: z.string().trim().regex(/^(in|out):/).max(200), hidden: z.boolean().default(true) }).strict(),
    output: out<RecurringSummary>()
  },
  'transfers.find': {
    description:
      'Transfers between the person’s own accounts that aren’t paired yet: money out of one account and into another within 3 days, the same amount, or between currencies its value at that day’s rate minus the bank’s cost. confidence "iban" means the account number matches (sure); "amount" only the amount and date. costCents: between currencies, the exchange cost in the sending account’s currency.',
    input: empty,
    output: out<TransferPair[]>()
  },
  'transfers.pair': {
    description:
      'Pair transfers between own accounts (from transfers_find). Both halves go into a transfer category, so they count as neither income nor spending. Between currencies, the exchange cost (costCents, or worked out from the rate) is booked as a fee on the sending half.',
    input: z.object({ pairs: z.array(z.object({ outId: id, inId: id, costCents: z.number().int().min(0).max(1e10).optional() }).strict()).min(1).max(2000) }).strict(),
    output: out<{ paired: number }>()
  },
  'transfers.unpair': { input: z.object({ id }).strict(), output: out<{ ok: true }>() },
  'transfers.cost': { input: z.object({ id }).strict(), output: out<{ cross: boolean; currency: string | null; costCents: number | null }>() },
  'transfers.setCost': {
    description: 'Change the exchange cost of a paired transfer between currencies (e.g. the exact cost from the bank statement), in cents of the sending account’s currency. Either half’s id.',
    input: z.object({ id, costCents: z.number().int().min(0).max(1e10) }).strict(),
    output: out<{ costCents: number }>()
  },
  'rules.list': { description: 'List categorisation rules ("text in counterparty/description → category").', input: empty, output: out<Rule[]>() },
  'rules.create': {
    description:
      'Create a rule that puts transactions whose counterparty and/or description matches `pattern` (case-insensitive) into a category. match: contains (anywhere, default), word (as a whole word) or starts (at the start); texts shorter than 4 characters always match as a whole word. field iban: the counterparty’s account number, matched exactly (good for transfers to the person’s own accounts); account numbers are hidden from you, so give fromTransactionId (a transaction with that counterparty) instead of a pattern. New imports use it; applyToExisting also categorises uncategorised transactions now. Check first with rules_preview.',
    input: z
      .object({
        field: z.enum(['counterparty', 'description', 'any', 'iban']),
        pattern: z.string().trim().min(2).max(100).optional(),
        /** For field iban: fill the pattern with this transaction’s counterparty account number. */
        fromTransactionId: id.optional(),
        match: z.enum(['contains', 'word', 'starts']).default('contains'),
        categoryId: id,
        applyToExisting: z.boolean().default(true)
      })
      .strict(),
    output: out<{ rule: Rule; applied: number }>()
  },
  'rules.preview': {
    description:
      'Shows what a rule would match before creating it: how many transactions, how many are uncategorised, how many already sit in another category, and a few examples. For field iban, give fromTransactionId (a transaction with that counterparty) instead of a pattern, as with rules_create.',
    input: z
      .object({
        field: z.enum(['counterparty', 'description', 'any', 'iban']),
        pattern: z.string().trim().min(1).max(100).optional(),
        /** For field iban: look for this transaction’s counterparty account number. */
        fromTransactionId: id.optional(),
        match: z.enum(['contains', 'word', 'starts']).default('contains'),
        categoryId: id.nullable().default(null)
      })
      .strict(),
    output: out<RulePreview>()
  },
  'rules.update': {
    description: 'Change a rule (its text, where it looks, how it matches, or its category). applyToExisting also categorises uncategorised transactions it now matches.',
    input: z
      .object({
        id,
        field: z.enum(['counterparty', 'description', 'any', 'iban']).optional(),
        pattern: z.string().trim().min(2).max(100).optional(),
        /** For field iban: fill the pattern with this transaction’s counterparty account number. */
        fromTransactionId: id.optional(),
        match: z.enum(['contains', 'word', 'starts']).optional(),
        categoryId: id.optional(),
        applyToExisting: z.boolean().default(false)
      })
      .strict(),
    output: out<{ rule: Rule; applied: number }>()
  },
  'rules.reorder': { input: z.object({ ids: z.array(id).min(1).max(5000) }).strict(), output: out<Rule[]>() },
  'rules.delete': { description: 'Delete a rule. Transactions it already categorised keep their category.', input: z.object({ id }).strict(), output: out<Rule[]>() },

  'budgets.list': { description: 'Budgets and spending per spending category for a month (cents).', input: z.object({ month }).strict(), output: out<BudgetRow[]>() },
  'budgets.set': {
    description: 'Set (or clear with null) the monthly budget for a spending category, in cents.',
    input: z.object({ categoryId: id, month, amountCents: z.number().int().min(0).max(1e10).nullable() }).strict(),
    output: out<BudgetRow[]>()
  },
  'budgets.copyPrevious': { input: z.object({ month }).strict(), output: out<{ copied: number }>() },

  'import.analyze': {
    input: z.object({ fileName: z.string().min(1).max(260), contentBase64: z.string().min(1).max(14_000_000), accountId: id }).strict(),
    output: out<ImportPreview>()
  },
  'import.analyzePdf': {
    input: z.object({ fileName: z.string().min(1).max(260), contentBase64: z.string().min(1).max(14_000_000), accountId: id }).strict(),
    output: out<ImportPreview>()
  },
  'import.analyzeXml': {
    input: z.object({ fileName: z.string().min(1).max(260), contentBase64: z.string().min(1).max(28_000_000), accountId: id }).strict(),
    output: out<ImportPreview>()
  },
  'import.pdfCancel': { input: empty, output: out<{ ok: true }>() },
  'import.preview': { input: z.object({ sessionId: z.string().uuid() }).strict(), output: out<ImportPreview>() },
  'import.current': {
    description:
      'The CSV import the person has open: detected bank, column mapping, totals and every row with its status (ready / duplicate / problem / skipped), issues and category. Returns null when no import is open.',
    input: empty,
    output: out<ImportPreview | null>()
  },
  'import.raw': {
    description: 'Raw cells of the open CSV import (header row, how many info lines sit above it (their text is not shown), and a window of data rows by index). Use it to understand the file before changing the mapping.',
    input: z.object({ from: z.number().int().min(0).default(0), count: z.number().int().min(1).max(200).default(40) }).strict(),
    output: out<{ headerRow: number; header: string[]; rows: { index: number; cells: string[] }[]; totalRows: number; preambleLines: number }>()
  },
  'import.remap': {
    description:
      'Change the column mapping of the open import: zero-based column indexes, headerRow (index of the header line in the file), dateOrder (DMY/YMD/MDY), decimal mark, invertSign. Nothing is saved until the import is committed.',
    input: z.object({ sessionId: z.string().uuid().optional(), mapping: mappingSchema }).strict(),
    output: out<ImportPreview>()
  },
  'import.updateRows': {
    description:
      'Fix rows of the open import before it is saved: set a category, correct a date (YYYY-MM-DD), amount (cents) or description, include a duplicate on purpose, or skip a row. Add a short note saying why. Nothing is saved until commit.',
    input: z
      .object({
        sessionId: z.string().uuid().optional(),
        changes: z
          .array(
            z
              .object({
                index: z.number().int().min(0),
                decided: z.enum(['include', 'skip']).nullable().optional(),
                categoryId: id.nullable().optional(),
                bookingDate: date.optional(),
                amountCents: cents.optional(),
                description: z.string().trim().min(1).max(300).optional(),
                counterpartyName: z.string().trim().max(120).nullable().optional(),
                note: z.string().max(200).nullable().optional()
              })
              .strict()
          )
          .min(1)
          .max(5000)
      })
      .strict(),
    output: out<ImportPreview>()
  },
  'import.commit': {
    description: 'Save the ready rows of the open import as transactions. Only after the person has reviewed the preview.',
    input: z.object({ sessionId: z.string().uuid().optional(), saveProfile: z.boolean().default(true) }).strict(),
    output: out<ImportCommitResult>()
  },
  'import.checkApply': {
    input: z.object({ sessionId: z.string().uuid(), rules: z.array(z.number().int()).max(1000), existing: z.array(z.number().int()).max(1000) }).strict(),
    output: out<{ preview: ImportPreview; rules: number; categorised: number; skipped: number }>()
  },
  'import.checkUndo': { input: z.object({ sessionId: z.string().uuid(), part: z.enum(['categories', 'names', 'fixes', 'all']) }).strict(), output: out<ImportPreview>() },
  'import.discard': { input: z.object({ sessionId: z.string().uuid() }).strict(), output: out<{ ok: true }>() },
  'import.batches': { input: empty, output: out<ImportBatch[]>() },
  'import.undo': { input: z.object({ batchId: id }).strict(), output: out<{ deleted: number }>() },

  'summary.month': {
    description: 'Income, spending, budget left, spending per category and the last 6 months, for one month (cents).',
    input: z.object({ month }).strict(),
    output: out<MonthSummary>()
  }
} as const

export type Contract = typeof contract
export type ContractEntry = { input: z.ZodType; output: unknown; description?: string }
export type OpName = keyof Contract
export type OpInput<K extends OpName> = z.input<Contract[K]['input']>
export type OpParsedInput<K extends OpName> = z.output<Contract[K]['input']>
export type OpOutput<K extends OpName> = Contract[K]['output']

/** Operations that work while Kasboek is locked. Everything else needs a login. */
export const PUBLIC_OPS: readonly OpName[] = [
  'app.info',
  'app.ready',
  'app.milestone',
  'prefs.get',
  'prefs.update',
  'auth.status',
  'auth.retry',
  'auth.setup',
  'sync.pickJoin',
  'sync.cancelJoin',
  'auth.unlock',
  'auth.unlockRecovery',
  'auth.erase',
  'auth.showDataFolder',
  'auth.diagnostics',
  'auth.restoreErased',
  'transfer.pick',
  'transfer.import'
]

/** Result sent back over IPC. Errors are values, not thrown across the bridge. */
export type OpResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: ErrorDetails } }

export interface KasboekBridge {
  invoke<K extends OpName>(op: K, input: OpInput<K>): Promise<OpResult<OpOutput<K>>>
  onEvent(listener: (event: AppEvent) => void): () => void
}

export type AppEvent =
  | { type: 'backup.completed'; file: string }
  | { type: 'backup.failed'; message: string }
  | { type: 'auth.locked'; reason: 'user' | 'idle' | 'system' }
  | { type: 'auth.refresh' }
  | { type: 'assistant.update'; status: AssistantStatus }
  | { type: 'import.updated' }
  | { type: 'insights.updated'; month: string }
  | { type: 'settings.changed' }
  | { type: 'update.changed'; status: UpdateStatus }
  | { type: 'import.checkProgress'; sessionId: string; groupsDone: number; groupsTotal: number; partsTotal: number }
  | { type: 'import.pdfProgress'; page: number; pages: number }
  | { type: 'import.checkDone'; sessionId: string; error: { code: string; message: string; details?: ErrorDetails } | null }
  | { type: 'sync.updated'; status: SyncStatus }
  | { type: 'data.changed'; actor: 'user' | 'assistant' | 'system' }
  | { type: 'mcp.request'; id: string; op: string; summary: string }
  | { type: 'mcp.expired'; id: string }
