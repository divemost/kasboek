import { AlertTriangle, Check, PieChart, Sparkles, Tags, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { hasTransactions, overviewScreen } from '@shared/get-started'
import { monthOf } from '@shared/month'
import type { AccountWithBalance } from '@shared/types'
import type { Page } from '../App'
import { AccountModal } from '../components/AccountModal'
import { CategoryBars, MonthBars } from '../components/charts'
import { GetStarted } from '../components/GetStarted'
import { Button, Card, CardHeader, EmptyState, MonthNav, PageHeader, cx } from '../components/ui'
import { call, useOp } from '../lib/api'
import { usePublishPageContext } from '../lib/page-context'
import { useAssistant } from '../components/AssistantPanel'
import { Suggestions } from '../components/Suggestions'
import { useToast } from '../components/Toast'
import { errText } from './auth/parts'
import { formatDate, monthLabel, monthShort } from '../lib/format'
import { useSettings } from '../lib/settings'
import { openSettingsTab } from '../lib/settings-tab'

const toDate = (m: string): Date => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1)

type Go = (p: Page, filter?: Record<string, unknown>) => void

/** The get-started screen while there is no transaction at all, the Overview once there is one. */
export function Overview({ go, initialMonth }: { go: Go; initialMonth?: string }) {
  const { t } = useTranslation()
  const accounts = useOp('accounts.list')
  const screen = overviewScreen(accounts.data, accounts.error !== null)
  // The title and the three totals' places while the accounts load, instead of a blank page.
  if (screen === 'loading')
    return (
      <div aria-busy="true">
        <PageHeader title={t('overview.title')} />
        <div className="grid grid-cols-1 gap-4 @[560px]:grid-cols-3">
          {[0, 1, 2].map((i) => <Card key={i} className="h-[92px] motion-safe:animate-pulse">{null}</Card>)}
        </div>
      </div>
    )
  if (screen === 'start') return <GetStarted go={go} accounts={accounts.data!} />
  return <OverviewMonth go={go} initialMonth={initialMonth} accounts={accounts.data ?? []} reloadAccounts={() => void accounts.reload()} />
}

function OverviewMonth({ go, initialMonth, accounts, reloadAccounts }: { go: Go; initialMonth?: string; accounts: AccountWithBalance[]; reloadAccounts: () => void }) {
  const { t } = useTranslation()
  const { fmt, money, settings, prefs, updatePrefs } = useSettings()
  const [month, setMonth] = useState(initialMonth ?? monthOf())
  const [addingAccount, setAddingAccount] = useState(false)
  const summary = useOp('summary.month', { month })
  const backup = useOp('backup.status')
  const assistant = useAssistant()
  usePublishPageContext({ page: 'overview', filters: { month }, selectedIds: [], openId: null, rows: [] })
  const alerts = useOp('alerts.list')
  const toast = useToast()
  const s = summary.data
  const hasTx = hasTransactions(accounts)

  const steps: { done: boolean; title: string; body: string; label: string; open: () => void }[] = [
    { done: accounts.length > 0, title: t('overview.stepAccounts'), body: t('overview.stepAccountsBody'), label: t('overview.add'), open: () => setAddingAccount(true) },
    { done: !!backup.data?.autoEnabled, title: t('overview.stepBackup'), body: t('overview.stepBackupBody'), label: t('overview.open'), open: () => { openSettingsTab('data'); go('settings') } }
  ]
  const allDone = steps.every((x) => x.done)

  return (
    <div className="fade-in">
      <PageHeader
        title={t('overview.title')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {assistant?.configured && hasTx && (
              <Button
                size="sm"
                icon={<Sparkles size={14} />}
                disabled={assistant.busy}
                onClick={() => {
                  // Opens the assistant panel and asks for a review of the month shown.
                  window.dispatchEvent(new Event('kasboek:open-assistant'))
                  void call('assistant.send', { text: t('overview.reviewPrompt', { month: monthLabel(toDate(month), fmt), iso: month }) }).catch((e) => toast(errText(e), 'error'))
                }}
              >
                {t('overview.review', { ai: assistant.providerName })}
              </Button>
            )}
            <MonthNav month={month} label={monthLabel(toDate(month), fmt)} onChange={setMonth} />
          </div>
        }
      />

      {(alerts.data ?? []).length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {(alerts.data ?? []).map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => go(a.kind === 'budget' ? 'budgets' : 'recurring')}
              className={cx(
                'flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-[13px]',
                a.kind === 'budget' && a.level === 'near' ? 'border-border bg-surface' : 'border-negative/30 bg-negative/5'
              )}
            >
              <AlertTriangle size={15} className={a.kind === 'budget' && a.level === 'near' ? 'text-warning' : 'text-negative'} />
              <span className="flex-1">
                {a.kind === 'budget'
                  ? t(a.level === 'over' ? 'alerts.budgetOver' : 'alerts.budgetNear', { name: a.name, spent: money(a.spentCents), budget: money(a.budgetCents), pct: Math.round((a.spentCents / a.budgetCents) * 100) })
                  : t('alerts.balance', { name: a.name, date: formatDate(a.until, fmt), lowest: money(a.lowestCents, a.currency), due: money(a.dueCents, a.currency) })}
              </span>
            </button>
          ))}
        </div>
      )}
      {!prefs.firstTipDone && hasTx && !!s && s.uncategorized > 0 && (
        <p className="mb-4 flex items-center gap-2 text-[13px] text-muted">
          <span className="flex-1">{t('overview.firstTip')}</span>
          <button type="button" aria-label={t('overview.closeTip')} className="rounded p-1 hover:bg-surface-2 hover:text-text" onClick={() => void updatePrefs({ firstTipDone: true })}>
            <X size={14} />
          </button>
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 @[560px]:grid-cols-3">
        <Stat label={t('overview.income')} value={money(s?.incomeCents ?? 0)} />
        <Stat label={t('overview.spending')} value={money(s?.spendingCents ?? 0)} />
        <Stat
          label={t('overview.left')}
          value={s?.leftCents == null ? '—' : money(s.leftCents)}
          tone={s?.leftCents == null ? undefined : s.leftCents < 0 ? 'negative' : 'accent'}
          hint={s?.leftCents == null ? t('overview.noBudgets') : t('overview.ofBudget', { budget: money(s.budgetedCents) })}
        />
      </div>

      {prefs.insights && <Suggestions month={month} monthText={monthLabel(toDate(month), fmt)} go={go} />}

      {s && s.unconverted > 0 && (
        <button type="button" onClick={() => { openSettingsTab('general'); go('settings') }} className="mt-4 flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-left text-[13px] hover:bg-surface-2">
          <span className="font-medium text-warning">{t('fx.unconverted', { count: s.unconverted })}</span>
          <span className="text-muted">{t('fx.unconvertedHint')}</span>
        </button>
      )}

      {s && s.uncategorized > 0 && (
        <button
          type="button"
          onClick={() => go('transactions', { categoryId: 'none', month })}
          className="mt-4 flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-left text-[13px] hover:border-accent"
        >
          <Tags size={15} className="text-accent" />
          {t('overview.uncategorized', { count: s.uncategorized })}
          <span className="ml-auto font-medium text-accent">{t('overview.categorise')}</span>
        </button>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 @[720px]:grid-cols-5">
        <Card className="@[720px]:col-span-3">
          <CardHeader title={t('overview.byCategory')} description={monthLabel(toDate(month), fmt)} />
          {s && s.byCategory.length > 0 ? (
            <div className="px-5 py-4">
              <CategoryBars rows={s.byCategory.map((c) => ({ name: c.categoryId === null ? t('transactions.uncategorized') : c.name, cents: c.cents }))} format={money} />
            </div>
          ) : (
            <EmptyState icon={<PieChart size={20} />} title={t('overview.nothingYet')} body={t('overview.byCategoryEmpty')} />
          )}
        </Card>
        {!allDone ? (
          <Card className="@[720px]:col-span-2">
            <CardHeader title={t('overview.getStarted')} description={t('overview.getStartedHint')} />
            <ol className="flex flex-col">
              {steps.map((st, i) => (
                <li key={st.title} className="flex items-start gap-3 border-b border-border px-5 py-3.5 last:border-b-0">
                  <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', st.done ? 'bg-accent text-accent-fg' : 'border border-border-strong text-muted')}>
                    {st.done ? <Check size={12} strokeWidth={3} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cx('text-[13px] font-medium', st.done && 'text-muted line-through decoration-border-strong')}>{st.title}</p>
                    <p className="text-xs text-muted">{st.body}</p>
                  </div>
                  {!st.done && <Button size="sm" variant="ghost" onClick={st.open}>{st.label}</Button>}
                </li>
              ))}
            </ol>
          </Card>
        ) : (
          <Card className="@[720px]:col-span-2">
            <CardHeader title={t('overview.accounts')} action={<Button size="sm" variant="ghost" onClick={() => go('accounts')}>{t('accounts.allAccounts')}</Button>} />
            {accounts.filter((a) => !a.archived).map((a) => (
              <div key={a.id} className="flex items-center justify-between border-b border-border px-5 py-3 text-[13px] last:border-b-0">
                <span className="truncate">{a.name}</span>
                <span className="text-right">
                  <span className="num font-medium">{money(a.balanceCents, a.currency)}</span>
                  {a.currency !== settings.currency && (
                    <span className="num block text-xs text-muted">{a.balanceMainCents === null ? t('fx.noRateShort') : `≈ ${money(a.balanceMainCents)}`}</span>
                  )}
                </span>
              </div>
            ))}
          </Card>
        )}
      </div>

      <Card className="mt-4">
        <CardHeader title={t('overview.trend')} description={t('overview.trendHint')} />
        <div className="px-5 py-4">
          {s && (
            <MonthBars
              label={t('overview.trend')}
              legend={{ income: t('overview.income'), spending: t('overview.spending') }}
              format={money}
              data={s.history.map((h) => ({ month: h.month, label: monthShort(toDate(h.month), fmt), income: h.incomeCents, spending: h.spendingCents }))}
            />
          )}
        </div>
      </Card>
      <AccountModal
        account={addingAccount ? 'new' : null}
        onClose={() => setAddingAccount(false)}
        onSaved={() => {
          setAddingAccount(false)
          reloadAccounts()
        }}
      />
    </div>
  )
}

export function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: 'accent' | 'negative'; hint?: string }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className={cx('num mt-1 text-[26px] font-semibold tracking-[-0.02em]', tone === 'accent' && 'text-accent', tone === 'negative' && 'text-negative')}>{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </Card>
  )
}
