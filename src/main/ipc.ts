import { randomUUID } from 'node:crypto'
import { release } from 'node:os'
import { app, BrowserWindow, dialog, ipcMain, shell, type WebFrameMain } from 'electron'
import { AppError } from '@core/errors'
import { coreOps, fxStatus, runOp, type OpContext, type OpTable } from '@core/ops'
import { getSetting, getSettings, updateSettings } from '@core/settings'
import { TRANSFER_EXTENSION } from '@core/transfer-format'
import type { OpName } from '@shared/contract'
import { buildDiagnostics } from './diagnostics'
import { graphicsStatus, markPainted, startupLog } from './graphics'
import { lazy } from './lazy'
import { splashStep } from './splash'
import { milestoneLine, opWaitsForSession, stepForMilestone } from './startup-plan'
import { paths } from './paths'
import { getPrefs, updatePrefs } from './prefs'
import { syncTray } from './tray'
import { defaultCategoryNames } from './i18n-categories'
import { localizeDefaultCategories } from '@core/finance'
import { forgetFacts, insightsView } from '@core/insights'
import * as session from './session'
import * as jobs from './assistant/jobs'
import { applyTheme } from './theme'
import { assistantRefusal } from './assistant-guard'
import { lockedRefusal } from './lock-guard'
import { isTrustedFrameUrl } from './trusted-url'
import { backupList, backupStatus, describeTransfer, exportFileName, importTransfer, pickBackup, runAutoBackup, runAutoBackupIfDue, writeTransfer } from './transfer/service'
import { dataChanged, unlocked as backupAfterUnlock } from './transfer/scheduler'
import { shouldAutoUpdate, updateEcbRates } from './fx/ecb'
import { setSecret } from '@core/secrets'
import { addCustomProvider, isKnownProvider, newCustomId, removeCustomProvider, renameCustomProvider, resolveProvider, switchProvider } from '@shared/ai-provider-store'
import { isCustomId } from '@shared/ai-providers'
import { claudeEffort } from '@shared/reasoning'
import { mcpClientsSeen, respondMcp } from './mcp/bridge'
import { createReadSlot } from './pdf/handle'
import { helperPath } from './mcp/channel'
import * as mcpSetup from './mcp/setup'

/**
 * Modules that are not needed before the first screen load on first use (see lazy.ts): the assistant
 * (Anthropic SDK, CSV/PDF/tips checks), updates, sync, exports and the PDF reader. A module that is only
 * ever read with `loaded()` would never load: stopping jobs (./assistant/jobs) is imported directly instead.
 */
const chat = lazy(async () => {
  const m = await import('./assistant/chat')
  m.initAssistant((op, input, actor) => dispatch(op, input, actor))
  return m
})
const claude = lazy(() => import('./assistant/claude'))
const providerModule = lazy(() => import('./assistant/provider'))
const models = lazy(() => import('./assistant/models'))
const csvAssist = lazy(() => import('./assistant/csv'))
const pdfAssist = lazy(() => import('./assistant/pdf'))
const insights = lazy(() => import('./assistant/insights'))
const updates = lazy(() => import('./update'))
const exporter = lazy(() => import('./export'))
const pdfOpen = lazy(() => import('./pdf/open'))
const pdfReader = lazy(() => import('./pdf/read'))
const syncService = lazy(async () => {
  const m = await import('./sync/service')
  // Changes from another computer: refresh open pages.
  m.onRemoteChanges(() => notifyChanged('system'))
  return m
})

let syncScheduler: Promise<void> | null = null
/** Starts the sync timer and its before-lock hook, once. Never rejects: a failure is logged and the next call tries again. */
export function ensureSyncScheduler(): Promise<void> {
  syncScheduler ??= syncService.get().then(
    (m) => m.startSyncScheduler(),
    (err: unknown) => {
      syncScheduler = null
      console.error('[sync] could not start:', err)
    }
  )
  return syncScheduler
}

/** Starts the update checks (a module that is not needed before the first screen). */
export async function startUpdateChecks(): Promise<void> {
  ;(await updates.get()).startUpdateChecks()
}

/** Stops the assistant's running jobs (the app locking): modules that were never loaded have nothing to stop. */
export function cancelRunningJobs(): void {
  jobs.cancelAllAssists()
  insights.loaded()?.cancelInsights()
  pdfRead.abort()
}

/** The assistant being switched off: its running jobs and tips stop, the conversation is cleared. Nothing runs on afterwards. */
function stopAssistant(): void {
  cancelRunningJobs()
  chat.loaded()?.resetChat()
}

let milestonesLogged = 0

let readyListener: (() => void) | null = null
let pageReady = false
/** Called once the page has drawn its first screen (at once if it already has). */
export function onAppReady(fn: () => void): void {
  if (pageReady) fn()
  else readyListener = fn
}
function appReady(): void {
  markPainted()
  pageReady = true
  readyListener?.()
  readyListener = null
}

function focusedWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

async function openDialog(opts: Electron.OpenDialogOptions): Promise<string | null> {
  const win = focusedWindow()
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled ? null : (res.filePaths[0] ?? null)
}

/** The PDF read in progress, so the page can stop it. */
const pdfRead = createReadSlot()

const kasboekFilter = [{ name: 'Kasboek export', extensions: [TRANSFER_EXTENSION] }]

function notifyBackup(p: Promise<string | null>): void {
  p.then((file) => file && session.broadcast({ type: 'backup.completed', file })).catch((err: unknown) =>
    session.broadcast({ type: 'backup.failed', message: err instanceof Error ? err.message : String(err) })
  )
}

/** Operations that need the desktop (dialogs, keychain, files). None are offered to an assistant. */
const desktopOps: OpTable = {
  'app.info': {
    mutates: false,
    assistant: false,
    handler: () => ({
      name: app.getName(),
      version: app.getVersion(),
      commit: __BUILD_COMMIT__,
      platform: process.platform,
      dataDir: paths.dataDir,
      graphics: graphicsStatus(),
      mcpCommand: { command: helperPath(), args: ['--data-dir', paths.dataDir] }
    })
  },
  'update.status': { mutates: false, assistant: false, handler: async () => (await updates.get()).updateStatus() },
  'update.check': { mutates: false, assistant: false, handler: async () => (await updates.get()).checkForUpdate() },
  'update.download': { mutates: false, assistant: false, handler: async () => (await updates.get()).downloadUpdate() },
  'update.install': { mutates: false, assistant: false, handler: async () => (await updates.get()).installUpdate() },
  'update.openPage': {
    mutates: false,
    assistant: false,
    handler: async () => {
      ;(await updates.get()).openReleasePage()
      return { ok: true as const }
    }
  },
  'app.ready': {
    mutates: false,
    assistant: false,
    handler: () => {
      appReady()
      return { ok: true as const }
    }
  },
  // Timing facts from the page for startup.log; they also move the launch window's bar. Never any data.
  'app.milestone': {
    mutates: false,
    assistant: false,
    handler: (_c, { name, ms }) => {
      const line = milestoneLine(name, ms, milestonesLogged)
      if (line) {
        milestonesLogged++
        startupLog(line)
      }
      const step = stepForMilestone(name)
      if (step) splashStep(step)
      return { ok: true as const }
    }
  },
  'prefs.get': { mutates: false, assistant: false, handler: () => getPrefs() },
  'app.restart': {
    mutates: false,
    assistant: false,
    handler: () => {
      setTimeout(() => {
        app.relaunch()
        app.quit()
      }, 100)
      return { ok: true as const }
    }
  },
  'prefs.update': {
    mutates: false,
    assistant: false,
    handler: (_c, patch) => {
      // A new graphics choice also forgets an earlier failure, so "automatic" tries the graphics card again.
      const next = updatePrefs(patch.graphics ? { ...patch, graphicsFailed: false } : patch)
      if (patch.theme) applyTheme(next.theme)
      if (patch.keepInTray !== undefined) syncTray()
      return next
    }
  },

  // The core operation, plus: switching the assistant off stops what it is doing at once.
  'settings.update': {
    mutates: true,
    assistant: false,
    handler: (ctx, patch) => {
      const next = coreOps['settings.update']!.handler(ctx, patch) as ReturnType<typeof getSettings>
      if (patch.assistantEnabled === false) stopAssistant()
      return next
    }
  },

  'auth.status': { mutates: false, assistant: false, handler: () => session.status() },
  'auth.retry': { mutates: false, assistant: false, handler: () => session.retryRead() },
  'auth.setup': {
    mutates: true,
    assistant: false,
    handler: async (_c, input) => {
      await ensureSyncScheduler()
      const result = await session.setup(input.mode, input.mode === 'password' ? input.password : undefined)
      // A new database starts with its categories in the interface language.
      if (session.isUnlocked()) localizeDefaultCategories(session.db(), defaultCategoryNames(getPrefs().language))
      return result
    }
  },
  'auth.unlock': {
    mutates: false,
    assistant: false,
    handler: async (_c, input) => {
      await ensureSyncScheduler()
      await session.unlock(input)
      afterUnlock()
      return session.status()
    }
  },
  'auth.unlockRecovery': {
    mutates: false,
    assistant: false,
    handler: async (_c, { recoveryKey }) => {
      await ensureSyncScheduler()
      await session.unlockRecovery(recoveryKey)
      afterUnlock()
      return session.status()
    }
  },
  'auth.lock': {
    mutates: false,
    assistant: false,
    handler: () => {
      session.lock('user')
      return session.status()
    }
  },
  'auth.erase': {
    mutates: false,
    assistant: false,
    handler: async () => {
      await session.erase()
      return session.status()
    }
  },
  'auth.showDataFolder': { mutates: false, assistant: false, handler: async () => ({ ok: (await shell.openPath(paths.dataDir)) === '' }) },
  'auth.diagnostics': {
    mutates: false,
    assistant: false,
    handler: () => ({
      text: buildDiagnostics({ dataDir: paths.dataDir, appVersion: app.getVersion(), platform: process.platform, arch: process.arch, osRelease: release(), error: session.readFailure() })
    })
  },
  'auth.restoreErased': {
    mutates: false,
    assistant: false,
    handler: async (_c, { name }) => {
      await session.restoreErasedData(name)
      return session.status()
    }
  },
  'auth.changePassword': {
    mutates: true,
    assistant: false,
    handler: async (_c, { current, next }) => {
      await session.changePassword(current, next)
      return session.status()
    }
  },
  'auth.usePasswordless': {
    mutates: true,
    assistant: false,
    handler: async (_c, { current }) => {
      await session.switchToPasswordless(current)
      return session.status()
    }
  },
  'auth.newRecoveryKey': {
    mutates: true,
    assistant: false,
    handler: async (_c, { current }) => ({ recoveryKey: await session.newRecoveryKey(current) })
  },
  'auth.forgetComputer': {
    mutates: true,
    assistant: false,
    handler: async () => {
      await session.forgetThisComputer()
      return session.status()
    }
  },
  'auth.totpBegin': { mutates: false, assistant: false, handler: () => session.totpBegin() },
  'auth.totpEnable': {
    mutates: true,
    assistant: false,
    handler: async (_c, { code }) => {
      await session.totpEnable(code)
      return session.status()
    }
  },
  'auth.totpDisable': {
    mutates: true,
    assistant: false,
    handler: async (_c, { code }) => {
      await session.totpDisable(code)
      return session.status()
    }
  },

  'transfer.export': {
    mutates: true,
    assistant: false,
    handler: async () => {
      session.secrets()
      const win = focusedWindow()
      const opts = { title: 'Export Kasboek', defaultPath: exportFileName(), filters: kasboekFilter }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return { file: null }
      return { file: await writeTransfer(res.filePath, 'export') }
    }
  },
  'transfer.pick': {
    mutates: false,
    assistant: false,
    handler: async () => {
      // On the lock screen nobody may replace the data: only at first setup, once logged in, or when the account file can't be opened at all.
      if ((await session.status()).state === 'locked' && !session.accountUnreadable()) throw new AppError('auth.locked', 'Unlock Kasboek first.')
      const file = await openDialog({ title: 'Import a Kasboek export', properties: ['openFile'], filters: kasboekFilter })
      return file ? describeTransfer(file) : null
    }
  },
  'transfer.import': {
    mutates: true,
    assistant: false,
    handler: async (_c, input) => {
      if ((await session.status()).state === 'locked' && !session.accountUnreadable()) throw new AppError('auth.locked', 'Unlock Kasboek first.')
      await ensureSyncScheduler()
      const sync = await syncService.get()
      const reset = await importTransfer(input, { joining: sync.isPendingJoin(input.token) })
      // Joining a sync folder: from now on this computer syncs with it too.
      await sync.afterImport(input.token).catch((err: unknown) => console.warn('[sync] join failed:', err))
      return { status: await session.status(), reset }
    }
  },

  'assistant.status': { mutates: false, assistant: false, handler: async () => (await chat.get()).assistantStatus() },
  'assistant.setKey': {
    mutates: true,
    assistant: false,
    handler: async ({ db }, { apiKey, provider }) => {
      const settings = getSettings(db)
      const id = provider ?? settings.aiProvider
      if (!isKnownProvider(settings, id)) throw new AppError('assistant.unknown_provider', 'That provider is no longer in your list.')
      // Dev/test only: skip the online check.
      if (app.isPackaged || process.env['KASBOEK_SKIP_KEY_CHECK'] !== '1') {
        if (id === 'anthropic') await (await claude.get()).checkKey(apiKey)
        else {
          // Check the key against this provider's own address, whether or not it is the one in use.
          await (await models.get()).checkProviderKey({ ...resolveProvider(settings, id), key: apiKey })
        }
      }
      setSecret(db, (await providerModule.get()).keyName(id), apiKey)
      const assistant = await chat.get()
      assistant.publishStatus()
      return assistant.assistantStatus()
    }
  },
  'assistant.clearKey': {
    mutates: true,
    assistant: false,
    handler: async ({ db }) => {
      const { keyName } = await providerModule.get()
      setSecret(db, keyName(getSettings(db).aiProvider), null)
      const assistant = await chat.get()
      assistant.resetChat()
      return assistant.assistantStatus()
    }
  },
  'assistant.addProvider': {
    mutates: true,
    assistant: false,
    handler: async ({ db }, { name, ...rest }) => {
      const assistant = await chat.get()
      const next = updateSettings(db, addCustomProvider(getSettings(db), newCustomId(randomUUID()), { name, ...rest }))
      assistant.resetChat()
      return next
    }
  },
  'assistant.renameProvider': {
    mutates: true,
    assistant: false,
    handler: async ({ db }, { id, name }) => {
      const assistant = await chat.get()
      const settings = getSettings(db)
      if (!isCustomId(id) || !isKnownProvider(settings, id)) throw new AppError('assistant.unknown_provider', 'That provider is no longer in your list.')
      const next = updateSettings(db, renameCustomProvider(settings, id, name))
      assistant.publishStatus()
      return next
    }
  },
  'assistant.removeProvider': {
    mutates: true,
    assistant: false,
    handler: async ({ db }, { id }) => {
      const [assistant, { keyName }] = await Promise.all([chat.get(), providerModule.get()])
      const settings = getSettings(db)
      if (!isCustomId(id) || !isKnownProvider(settings, id)) throw new AppError('assistant.unknown_provider', 'That provider is no longer in your list.')
      const next = updateSettings(db, removeCustomProvider(settings, id))
      setSecret(db, keyName(id), null)
      assistant.resetChat()
      return next
    }
  },
  'assistant.configure': {
    mutates: true,
    assistant: false,
    handler: async ({ db }, patch) => {
      const assistant = await chat.get()
      const before = getSettings(db)
      // Another provider brings back its own address and models (or its suggested model the first time).
      if (patch.aiProvider && patch.aiProvider !== before.aiProvider) {
        if (!isKnownProvider(before, patch.aiProvider)) throw new AppError('assistant.unknown_provider', 'That provider is no longer in your list.')
        patch = { ...switchProvider(before, patch.aiProvider), ...patch }
      }
      // A model that can't stop thinking gets the lowest level instead of "off".
      const model = patch.chatModel ?? before.chatModel
      const effort = patch.chatEffort ?? before.chatEffort
      if (claudeEffort(model, effort) !== effort) patch = { ...patch, chatEffort: claudeEffort(model, effort) }
      const csvModel = patch.csvModel ?? before.csvModel
      const csvEffort = patch.csvEffort ?? before.csvEffort
      if (claudeEffort(csvModel, csvEffort) !== csvEffort) patch = { ...patch, csvEffort: claudeEffort(csvModel, csvEffort) }
      const next = updateSettings(db, patch)
      // The conversation is tied to one provider's message format.
      if (next.aiProvider !== before.aiProvider) assistant.resetChat()
      else assistant.publishStatus()
      return next
    }
  },
  'assistant.models': { mutates: false, assistant: false, handler: async (ctx) => (await models.get()).listProviderModels(ctx.db) },
  'assistant.send': { mutates: false, assistant: false, handler: async (_c, { text, pageContext }) => (await chat.get()).send(text, pageContext) },
  'assistant.confirm': {
    mutates: false,
    assistant: false,
    handler: async (_c, { id, approve }) => {
      const assistant = await chat.get()
      assistant.confirm(id, approve)
      return assistant.assistantStatus()
    }
  },
  'assistant.stop': {
    mutates: false,
    assistant: false,
    handler: async () => {
      const assistant = await chat.get()
      assistant.stopChat()
      return assistant.assistantStatus()
    }
  },
  'assistant.reset': {
    mutates: false,
    assistant: false,
    handler: async () => {
      const assistant = await chat.get()
      assistant.resetChat()
      return assistant.assistantStatus()
    }
  },
  'import.assist': { mutates: false, assistant: false, handler: async (ctx, { sessionId, consent }) => (await csvAssist.get()).assistImport(ctx.db, sessionId, { consent }) },
  'import.assistPreview': { mutates: false, assistant: false, handler: async (ctx, { sessionId }) => (await csvAssist.get()).checkPreview(ctx.db, sessionId) },
  'import.pdfAssistPreview': { mutates: false, assistant: false, handler: async (_c, { sessionId }) => (await pdfAssist.get()).pdfAssistPreview(sessionId) },
  'import.pdfAssist': { mutates: false, assistant: false, handler: async (ctx, { sessionId }) => (await pdfAssist.get()).assistPdf(ctx.db, sessionId) },
  // Tips on the Overview: the cached ones need the interface language, and the assistant writes them only when asked.
  'insights.get': { mutates: false, assistant: false, handler: ({ db }, { month }) => insightsView(db, month, getPrefs().language) },
  'insights.preview': { mutates: false, assistant: false, handler: async (ctx, { month }) => (await insights.get()).insightsPreview(ctx.db, month) },
  'insights.run': { mutates: false, assistant: false, handler: async (ctx, { month, consent }) => (await insights.get()).runInsights(ctx.db, month, { consent }) },
  // Nothing can be running, or be cancelled, in a module that was never loaded.
  'insights.cancel': { mutates: false, assistant: false, handler: () => insights.loaded()?.cancelInsights() ?? { ok: true as const } },
  'insights.status': { mutates: false, assistant: false, handler: () => insights.loaded()?.insightsStatus() ?? { running: false, month: null, startedAt: null } },
  'export.csv': { mutates: false, assistant: false, handler: async (_c, { filter, labels, defaultName }) => (await exporter.get()).exportCsv(filter, labels, defaultName) },
  'export.pdf': { mutates: false, assistant: false, handler: async (_c, { html, defaultName }) => (await exporter.get()).exportPdf(html, defaultName) },
  'import.assistStatus': { mutates: false, assistant: false, handler: (_c, { sessionId }) => jobs.assistStatus(sessionId) ?? null },
  'import.assistCancel': {
    mutates: false,
    assistant: false,
    handler: (_c, { sessionId }) => {
      jobs.cancelAssist(sessionId)
      return { ok: true as const }
    }
  },
  'import.analyzePdf': {
    mutates: false,
    assistant: false,
    handler: async ({ db }, i) => {
      const [{ openPdfSession }, { readPdf }] = await Promise.all([pdfOpen.get(), pdfReader.get()])
      const controller = pdfRead.claim()
      if (!controller) throw new AppError('import.pdf_busy', 'Another PDF is still being read. Wait a moment and try again.')
      try {
        return await openPdfSession(db, {
          fileName: i.fileName,
          accountId: i.accountId,
          contentBase64: i.contentBase64,
          read: (bytes) => readPdf(bytes, { signal: controller.signal, onPage: (page, pages) => session.broadcast({ type: 'import.pdfProgress', page, pages }) })
        })
      } finally {
        pdfRead.release(controller)
      }
    }
  },
  'import.pdfCancel': {
    mutates: false,
    assistant: false,
    handler: () => {
      pdfRead.abort()
      return { ok: true as const }
    }
  },
  'mcp.setupStatus': { mutates: false, assistant: false, handler: () => mcpSetup.setupStatus() },
  'mcp.clients': { mutates: false, assistant: false, handler: () => mcpClientsSeen() },
  'mcp.desktopRunning': { mutates: false, assistant: false, handler: async () => ({ running: await mcpSetup.claudeDesktopRunning() }) },
  'mcp.desktopAdd': { mutates: false, assistant: false, handler: () => mcpSetup.addToDesktop() },
  'mcp.desktopRemove': { mutates: false, assistant: false, handler: () => mcpSetup.removeFromDesktop() },
  'mcp.codeAdd': {
    mutates: false,
    assistant: false,
    handler: async () => {
      await mcpSetup.addToCode()
      return { ok: true as const }
    }
  },
  'mcp.codeRemove': {
    mutates: false,
    assistant: false,
    handler: async () => {
      await mcpSetup.removeFromCode()
      return { ok: true as const }
    }
  },
  'mcp.respond': {
    mutates: false,
    assistant: false,
    handler: (_c, { id, approve }) => {
      respondMcp(id, approve)
      return { ok: true as const }
    }
  },

  'backup.status': { mutates: false, assistant: false, handler: () => backupStatus() },
  'backup.chooseFolder': {
    mutates: true,
    assistant: false,
    handler: async ({ db }) => {
      const folder = await openDialog({ title: 'Choose a backup folder', properties: ['openDirectory', 'createDirectory'] })
      if (folder) updateSettings(db, { autoBackupFolder: folder })
      return { folder }
    }
  },
  'backup.configureAuto': {
    mutates: true,
    assistant: false,
    handler: ({ db }, { enabled, keep }) => {
      updateSettings(db, { autoBackupEnabled: enabled, ...(keep ? { autoBackupKeep: keep } : {}) })
      // Make the first automatic backup straight away instead of waiting for the next check.
      if (enabled) notifyBackup(runAutoBackupIfDue())
      return backupStatus()
    }
  },
  'fx.updateEcb': {
    mutates: true,
    assistant: false,
    handler: async ({ db }) => {
      const { added } = await updateEcbRates(db)
      return { ...fxStatus(db), added }
    }
  },
  'sync.status': { mutates: false, assistant: false, handler: async () => (await syncService.get()).syncStatus() },
  'sync.start': { mutates: false, assistant: false, handler: async (_c, input) => (await syncService.get()).startSync(input) },
  'sync.pickJoin': {
    mutates: false,
    assistant: false,
    handler: async (_c, input) => {
      // Same rule as transfer.pick: not on the lock screen. At first setup (no account yet) and once logged in it works.
      if ((await session.status()).state === 'locked') throw new AppError('auth.locked', 'Unlock Kasboek first.')
      return (await syncService.get()).pickJoin(input)
    }
  },
  'sync.cancelJoin': {
    mutates: false,
    assistant: false,
    handler: async (_c, { token }) => {
      ;(await syncService.get()).cancelJoin(token)
      return { ok: true as const }
    }
  },
  'sync.attach': { mutates: false, assistant: false, handler: async (_c, input) => (await syncService.get()).attach(input) },
  'sync.now': {
    mutates: false,
    assistant: false,
    handler: async () => {
      const sync = await syncService.get()
      await sync.runSync()
      return sync.syncStatus()
    }
  },
  'sync.stop': { mutates: false, assistant: false, handler: async () => (await syncService.get()).stopSync() },
  'sync.dismissConflicts': { mutates: false, assistant: false, handler: async () => (await syncService.get()).dismissConflicts() },
  'backup.runNow': { mutates: false, assistant: false, handler: async () => ({ file: await runAutoBackup() }) },
  'backup.list': { mutates: false, assistant: false, handler: () => backupList() },
  'backup.pick': { mutates: false, assistant: false, handler: (_c, { name }) => pickBackup(name) },
  'backup.revealFolder': {
    mutates: false,
    assistant: false,
    handler: async ({ db }) => {
      const folder = getSettings(db).autoBackupFolder
      return { ok: !!folder && (await shell.openPath(folder)) === '' }
    }
  }
}

export const allOps: OpTable = { ...coreOps, ...desktopOps }

/** Context whose database is only reachable while unlocked. */
export function opContext(actor: OpContext['actor']): OpContext {
  return {
    actor,
    get db() {
      return session.db()
    }
  }
}

/** Runs an operation, refusing everything but the login operations while locked. */
export async function dispatch(name: OpName, input: unknown, actor: OpContext['actor']) {
  // The account is read while the window starts: only the operations about the app and preferences go ahead of it.
  if (opWaitsForSession(name)) await session.whenSessionReady()
  const refusal = lockedRefusal(name, session.isUnlocked())
  if (refusal) return refusal
  // Checked here, in the main process, so a page that ignores the setting still can't reach a provider.
  const off = session.isUnlocked() ? assistantRefusal(name, actor, input, getSetting(session.db(), 'assistantEnabled')) : null
  if (off) return off
  const result = await runOp(allOps, opContext(actor), name, input)
  // Tell open pages to refresh, e.g. when Claude changed a budget.
  if (result.ok && allOps[name]?.mutates) {
    notifyChanged(actor)
    dataChanged(name, input)
    syncService.loaded()?.changedLocally()
  }
  return result
}

/** Work that waits for the database: due backups and, when switched on, fresh exchange rates. */
function afterUnlock(): void {
  backupAfterUnlock()
  void syncService
    .get()
    .then((sync) => sync.runSync())
    .catch((err: unknown) => console.warn('[sync] could not start a sync:', err instanceof Error ? err.message : err))
  if (!session.isUnlocked() || !shouldAutoUpdate(session.db())) return
  updateEcbRates(session.db())
    .then(({ added }) => added > 0 && notifyChanged('system'))
    .catch((err: unknown) => console.warn('[fx] automatic update failed:', err instanceof Error ? err.message : err))
}

let changeTimer: NodeJS.Timeout | null = null
function notifyChanged(actor: OpContext['actor']): void {
  if (session.isUnlocked()) forgetFacts(session.db())
  if (changeTimer) clearTimeout(changeTimer)
  changeTimer = setTimeout(() => session.broadcast({ type: 'data.changed', actor }), 50)
}

/** Only our own page may call operations; never a page that got navigated to. */
function isTrusted(frame: WebFrameMain | null): boolean {
  if (!frame) return false
  return isTrustedFrameUrl(frame.url, paths.rendererDir, process.env['ELECTRON_RENDERER_URL'], app.isPackaged)
}

export function registerIpc(): void {
  session.onLock(() => chat.loaded()?.resetChat())
  ipcMain.handle('kasboek:op', async (event, name: unknown, input: unknown) => {
    if (!isTrusted(event.senderFrame) || typeof name !== 'string') {
      return { ok: false, error: { code: 'ipc.denied', message: 'Not allowed.' } }
    }
    return dispatch(name as OpName, input, 'user')
  })
}
