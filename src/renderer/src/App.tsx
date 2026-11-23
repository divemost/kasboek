import { ArrowLeftRight, CalendarRange, FileUp, Landmark, LayoutDashboard, Lock as LockIcon, PanelRight, PiggyBank, Repeat, Settings as SettingsIcon, Target } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AssistantPanel } from './components/AssistantPanel'
import { Mark } from './components/Mark'
import { McpRequests } from './components/McpRequests'
import { UpdateButton } from './components/Update'
import { Tour } from './components/Tour'
import { openSettingsTab } from './lib/settings-tab'
import { Welcome } from './pages/Welcome'
import { ToastProvider, useToast } from './components/Toast'
import { cx } from './components/ui'
import { call } from './lib/api'
import { AuthProvider, useAuth } from './lib/auth'
import { PrefsProvider, SettingsProvider, useAssistantEnabled, usePrefs } from './lib/settings'
import { Lock } from './pages/auth/Lock'
import { RecoveredModal } from './pages/auth/RecoveredModal'
import { Setup } from './pages/auth/Setup'
import { Overview } from './pages/Overview'
import { Transactions, type TxFilter } from './pages/Transactions'
import { showSetup } from '@shared/setup-rules'
import { assistantPanelOpen, shellLayout } from '@shared/assistant-panel'

// Overview is the first screen and stays in the main bundle; the other pages load when first opened.
const Budgets = lazy(() => import('./pages/Budgets').then((m) => ({ default: m.Budgets })))
const ImportPage = lazy(() => import('./pages/Import').then((m) => ({ default: m.ImportPage })))
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })))
const AccountsPage = lazy(() => import('./pages/Accounts').then((m) => ({ default: m.AccountsPage })))
const RecurringPage = lazy(() => import('./pages/Recurring').then((m) => ({ default: m.RecurringPage })))
const GoalsPage = lazy(() => import('./pages/Goals').then((m) => ({ default: m.GoalsPage })))
const YearPage = lazy(() => import('./pages/Year').then((m) => ({ default: m.YearPage })))

export type Page = 'overview' | 'transactions' | 'budgets' | 'recurring' | 'goals' | 'year' | 'accounts' | 'import' | 'settings'

const NAV: { page: Page; icon: ReactNode }[] = [
  { page: 'overview', icon: <LayoutDashboard size={17} /> },
  { page: 'accounts', icon: <Landmark size={17} /> },
  { page: 'transactions', icon: <ArrowLeftRight size={17} /> },
  { page: 'budgets', icon: <Target size={17} /> },
  { page: 'recurring', icon: <Repeat size={17} /> },
  { page: 'goals', icon: <PiggyBank size={17} /> },
  { page: 'year', icon: <CalendarRange size={17} /> },
  { page: 'import', icon: <FileUp size={17} /> }
]

export function App() {
  return (
    <ToastProvider>
      <PrefsProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </PrefsProvider>
    </ToastProvider>
  )
}

function Gate() {
  const { status, setupFlowActive } = useAuth()
  // First screen is on display: the main process can swap the launch window for this one.
  useEffect(() => {
    void call('app.ready')
  }, [])
  if (showSetup(status.state, setupFlowActive)) return <Setup />
  if (status.state === 'locked') return <Lock />
  return (
    <SettingsProvider>
      <Main />
      <McpRequests />
      {(status.recovered || status.weakPassword) && <RecoveredModal weak={!status.recovered} />}
    </SettingsProvider>
  )
}

/** The welcome window comes first on a computer that hasn't seen it yet. */
function Main() {
  const { prefs } = usePrefs()
  return prefs.welcomeDone ? <Shell /> : <Welcome />
}

function Shell() {
  const { t } = useTranslation()
  const { info, prefs, updatePrefs } = usePrefs()
  const { set } = useAuth()
  const toast = useToast()
  const [page, setPageState] = useState<Page>('overview')
  const [txFilter, setTxFilter] = useState<TxFilter | undefined>()
  // Transactions opens a new transaction for this account (not part of the filter).
  const [openNew, setOpenNew] = useState<number | undefined>()
  const [navKey, setNavKey] = useState(0)
  const go = (p: Page, filter?: Record<string, unknown>): void => {
    const { openNew: account, ...rest } = filter ?? {}
    setOpenNew(typeof account === 'number' ? account : undefined)
    setTxFilter(filter ? (rest as TxFilter) : undefined)
    setPageState(p)
    setNavKey((k) => k + 1)
  }
  const setPage = (p: Page): void => go(p)
  const assistantEnabled = useAssistantEnabled()
  // The panel follows the click at once; remembering it for the next start happens after and may fail without harm.
  const [panelChoice, setPanelChoice] = useState(prefs.assistantOpen)
  // Narrow windows (or a big zoom): the panel floats over the page and the sidebar shows only icons.
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const { overlay, compact } = shellLayout(width)
  const assistantOpen = assistantPanelOpen(panelChoice, assistantEnabled, overlay)
  const setAssistantOpen = useCallback(
    (open: boolean, remember = true): void => {
      setPanelChoice(open)
      if (remember) void updatePrefs({ assistantOpen: open }).catch(() => undefined)
    },
    [updatePrefs]
  )
  // Pages can ask for the assistant panel (e.g. "Review this month").
  useEffect(() => {
    const open = (): void => setAssistantOpen(true)
    window.addEventListener('kasboek:open-assistant', open)
    return () => window.removeEventListener('kasboek:open-assistant', open)
  }, [setAssistantOpen])
  const isMac = info.platform === 'darwin'

  useEffect(
    () =>
      window.kasboek.onEvent((e) => {
        if (e.type === 'backup.completed') toast(t('settings.backupSaved', { file: e.file }))
        if (e.type === 'backup.failed') toast(e.message, 'error')
      }),
    [toast, t]
  )

  const navItem = (p: Page, icon: ReactNode) => (
    <button
      key={p}
      type="button"
      data-tour={p}
      onClick={() => setPage(p)}
      aria-current={page === p ? 'page' : undefined}
      title={compact ? t(`nav.${p}`) : undefined}
      className={cx(
        'flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
        compact && 'justify-center px-0',
        page === p ? 'bg-accent-soft text-accent-hover' : 'text-muted hover:bg-surface-2 hover:text-text'
      )}
    >
      {icon}
      <span className={compact ? 'sr-only' : undefined}>{t(`nav.${p}`)}</span>
    </button>
  )

  return (
    <div className="flex h-full">
      <aside className={cx('flex shrink-0 flex-col border-r border-border bg-bg', compact ? 'w-14' : 'w-56')}>
        <div className={cx('drag flex h-11 items-center gap-2.5', compact ? 'justify-center' : 'px-5', isMac && 'mt-7')}>
          <Mark size={15} className="text-accent" />
          <span className={cx('font-serif text-[17px] font-semibold tracking-[-0.01em]', compact && 'sr-only')}>{t('app.name')}</span>
        </div>
        <nav className="mt-4 flex flex-1 flex-col gap-0.5 px-2 min-[700px]:px-3">{NAV.map((n) => navItem(n.page, n.icon))}</nav>
        <div className="flex flex-col gap-0.5 px-2 pb-4 min-[700px]:px-3">
          {navItem('settings', <SettingsIcon size={17} />)}
          <button
            type="button"
            data-tour="lock"
            onClick={() => void call('auth.lock').then(set)}
            title={compact ? t('nav.lock') : undefined}
            className={cx('flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text', compact && 'justify-center px-0')}
          >
            <LockIcon size={17} />
            <span className={compact ? 'sr-only' : undefined}>{t('nav.lock')}</span>
          </button>
          {/* The version, quietly; a click opens "About Kasboek" in Settings. */}
          <button
            type="button"
            title={t('settings.about')}
            onClick={() => {
              openSettingsTab('about')
              setPage('settings')
            }}
            className={cx('num mt-2 self-start rounded px-3 text-[11px] text-muted transition-colors hover:text-text', compact && 'sr-only')}
          >
            {t('app.versionShort', { version: info.version })}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className={cx('drag flex h-11 shrink-0 items-center justify-end', isMac ? 'pr-3' : 'pr-[148px]')}>
          <UpdateButton />
          <button
            type="button"
            data-tour="importBar"
            onClick={() => setPage('import')}
            title={t('nav.importHint')}
            className={cx(
              'no-drag inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
              page === 'import' ? 'text-accent' : 'text-muted hover:text-text'
            )}
          >
            <FileUp size={15} />
            {t('nav.import')}
          </button>
          {assistantEnabled && (
            <button
              type="button"
              data-tour="assistant"
              onClick={() => setAssistantOpen(!assistantOpen)}
              aria-pressed={assistantOpen}
              title={t('nav.toggleAssistant')}
              className={cx(
                'no-drag inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
                assistantOpen ? 'text-accent' : 'text-muted hover:text-text'
              )}
            >
              <PanelRight size={15} />
              {t('nav.assistant')}
            </button>
          )}
        </div>
        <div className="relative flex min-h-0 flex-1">
          <main className="@container min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-5xl px-6 pt-4 pb-16 @[800px]:px-10">
              <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
                {page === 'overview' && <Overview key={navKey} go={go} initialMonth={txFilter?.month} />}
                {page === 'transactions' && <Transactions key={navKey} go={setPage} initial={txFilter} openNew={openNew} />}
                {page === 'budgets' && <Budgets key={navKey} initial={txFilter} />}
                {page === 'year' && <YearPage key={navKey} />}
                {page === 'accounts' && <AccountsPage key={navKey} go={go} />}
                {page === 'recurring' && <RecurringPage key={navKey} go={go} />}
                {page === 'goals' && <GoalsPage key={navKey} />}
                {page === 'import' && <ImportPage go={go} />}
                {page === 'settings' && <SettingsPage key={navKey} />}
              </Suspense>
            </div>
          </main>
          {assistantEnabled && assistantOpen && <AssistantPanel go={setPage} overlay={overlay} />}
        </div>
      </div>
      <Tour go={setPage} openAssistant={() => setAssistantOpen(true, false)} />
    </div>
  )
}
