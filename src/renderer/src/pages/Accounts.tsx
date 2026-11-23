import { ChevronDown, ChevronRight, Landmark, Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseAmount } from '@shared/amount'
import { archivedOnly, groupAccounts } from '@shared/account-groups'
import { centsToInput, currencySymbol } from '@shared/format'
import { localToday, monthOf } from '@shared/month'
import type { AccountKind, AccountWithBalance, NetWorthAccount } from '@shared/types'
import type { Page } from '../App'
import { AccountModal } from '../components/AccountModal'
import { BankBalanceModal } from '../components/BankBalance'
import { TrendLine } from '../components/charts'
import { DateInput } from '../components/DateInput'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, CardHeader, EmptyState, Field, FormError, Input, Modal, PageHeader, Segmented, cx } from '../components/ui'
import { call, useOp } from '../lib/api'
import { formatDate, formatNumber, monthLabel, monthShort } from '../lib/format'
import { Iban } from '../lib/hide-numbers'
import { useSettings } from '../lib/settings'
import { errText } from './auth/parts'
import { Stat } from './Overview'

const toDate = (m: string): Date => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1)
const GROUPS: { kinds: AccountKind[]; key: string }[] = [
  { kinds: ['current', 'cash', 'other'], key: 'everyday' },
  { kinds: ['savings'], key: 'savings' },
  { kinds: ['investment'], key: 'investments' },
  { kinds: ['credit_card', 'loan'], key: 'debts' }
]
const RANGES = [12, 24, 60, 0] as const
const monthsBetween = (a: string, b: string): number => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5)) - Number(a.slice(5))

/** An account with what the net worth summary knows about it (value, gain), when that has loaded. */
type Row = AccountWithBalance & { nw: NetWorthAccount | undefined; valueCents: number }

export function AccountsPage({ go }: { go: (p: Page, filter?: Record<string, unknown>) => void }) {
  const { t } = useTranslation()
  const { money, fmt, settings } = useSettings()
  const base = useId()
  const [range, setRange] = useState<(typeof RANGES)[number]>(24)
  const accounts = useOp('accounts.list')
  const data = useOp('networth.summary', { months: range })
  const [valuing, setValuing] = useState<NetWorthAccount | null>(null)
  const [balanceOf, setBalanceOf] = useState<AccountWithBalance | null>(null)
  const [editing, setEditing] = useState<AccountWithBalance | 'new' | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const toast = useToast()
  const nw = data.data
  const list = accounts.data
  const reload = (): void => {
    void accounts.reload()
    void data.reload()
  }
  const sym = currencySymbol(settings.currency)
  const compact = (c: number): string => {
    const v = c / 100
    const a = Math.abs(v)
    const n = a >= 1e6 ? `${formatNumber(v / 1e6, fmt, 1)}M` : a >= 1e4 ? `${formatNumber(v / 1e3, fmt, 0)}k` : formatNumber(v, fmt, 0)
    return fmt.formats.currencyPosition.startsWith('before') ? `${sym}${n}` : `${n} ${sym}`
  }
  // Months of history there are (from the first month with data up to now).
  const available = nw?.firstMonth ? monthsBetween(nw.firstMonth, monthOf()) + 1 : null
  // The chosen range has no more history than a shorter one: show the shorter one as chosen.
  useEffect(() => {
    if (available === null || range === 0) return
    const i = RANGES.indexOf(range)
    if (i <= 0 || available > RANGES[i - 1]!) return
    let k = i - 1
    while (k > 0 && available <= RANGES[k - 1]!) k--
    setRange(RANGES[k]!)
  }, [available, range])
  const change = nw && nw.history.length > 1 ? nw.history[nw.history.length - 1]!.cents - nw.history[0]!.cents : null
  const rows: Row[] = (list ?? []).map((a) => {
    const known = nw?.accounts.find((x) => x.id === a.id)
    return { ...a, nw: known, valueCents: known?.valueCents ?? a.balanceCents }
  })
  // Archived accounts that still have a value stay in their group, so the groups add up to the net worth above.
  const grouped = groupAccounts(rows, GROUPS)
  const archived = archivedOnly(rows)
  const empty = list !== null && list.length === 0
  const mainValue = (a: Row): number => a.nw?.valueMainCents ?? a.balanceMainCents ?? 0

  const addButton = <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing('new')}>{t('settings.addAccount')}</Button>
  const nameButton = (a: Row, muted = false) => (
    <button
      type="button"
      aria-label={t('accounts.showTransactions', { name: a.name })}
      onClick={() => go('transactions', { accountId: a.id })}
      className={cx('block max-w-full truncate rounded text-left font-medium hover:underline', muted && 'text-muted')}
    >
      {a.name}
    </button>
  )
  // What the row's buttons are about: just the name (the name button's own label says "Show transactions of …").
  const nameFor = (a: Row) => <span hidden id={`${base}-${a.id}`}>{a.name}</span>
  const restore = (a: Row): void => {
    void call('accounts.update', { id: a.id, archived: false }).then(reload, (e) => toast(errText(e), 'error'))
  }

  return (
    <>
      <PageHeader title={t('accounts.title')} subtitle={t('accounts.subtitle')} action={addButton} />
      {empty ? (
        <Card>
          <EmptyState
            icon={<Landmark size={20} />}
            title={t('accounts.emptyTitle')}
            body={t('accounts.emptyBody')}
            action={addButton}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 @[640px]:grid-cols-3">
            <Stat label={t('networth.total')} value={nw ? money(nw.totalCents) : '—'} hint={change === null ? undefined : t('networth.change', { amount: (change >= 0 ? '+' : '') + money(change), months: nw!.history.length - 1 })} />
            <Stat label={t('networth.assets')} value={nw ? money(nw.assetsCents) : '—'} />
            <Stat label={t('networth.debts')} value={nw ? money(-nw.liabilitiesCents) : '—'} />
          </div>
          {nw && nw.unconverted > 0 && <p className="mt-3 text-[13px] text-warning">{t('networth.unconverted', { count: nw.unconverted })}</p>}

          {grouped.map(({ group: g, accounts: group }) => {
            return (
              <Card key={g.key} className="mt-4">
                <CardHeader title={t(`networth.group.${g.key}`)} action={<span className="num text-[15px] font-semibold">{money(group.reduce((s, a) => s + mainValue(a), 0))}</span>} />
                {group.map((a) => {
                  const value = a.valueCents
                  const valueMain = a.nw ? a.nw.valueMainCents : a.balanceMainCents
                  const describedBy = `${base}-${a.id}`
                  const details = [
                    t(`accountKind.${a.kind}`),
                    a.bank,
                    a.iban ? <Iban key="iban" value={a.iban} name={a.name} /> : '',
                    a.currency !== settings.currency ? a.currency : '',
                    a.kind === 'investment'
                      ? a.nw?.lastValuation ? t('networth.valuedOn', { date: formatDate(a.nw.lastValuation.date, fmt) }) : ''
                      : a.lastBankBalance ? t('balance.checkedOn', { date: formatDate(a.lastBankBalance.date, fmt) }) : t('balance.notChecked')
                  ].filter(Boolean)
                  return (
                    <div key={a.id} className={cx('flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3 text-[13px] last:border-b-0', a.archived && 'text-muted')}>
                      <div className="min-w-0 flex-1 basis-56">
                        {nameButton(a, a.archived)}
                        {nameFor(a)}
                        <p className="text-xs text-muted">{details.flatMap((p, i) => (i ? [' · ', p] : [p]))}</p>
                      </div>
                      {a.nw && a.nw.gainCents !== null && (
                        <span className="num text-right text-xs">
                          <span className="block text-muted">{t('networth.gain')}</span>
                          <span className={cx('font-medium', a.nw.gainCents >= 0 ? 'text-accent' : 'text-negative')}>
                            {(a.nw.gainCents >= 0 ? '+' : '') + money(a.nw.gainCents, a.currency)}
                            {a.nw.investedCents ? ` (${formatNumber((a.nw.gainCents / Math.abs(a.nw.investedCents)) * 100, fmt, 1)}%)` : ''}
                          </span>
                        </span>
                      )}
                      <span className="num w-36 text-right">
                        <span className="block font-medium">{money(value, a.currency)}</span>
                        {a.currency !== settings.currency && <span className="block text-xs text-muted">{valueMain === null ? t('fx.noRateShort') : `≈ ${money(valueMain)}`}</span>}
                        {!!a.lastBankBalance?.differenceCents && <span className="block text-xs text-warning">{t('balance.off', { difference: money(a.lastBankBalance.differenceCents, a.currency) })}</span>}
                      </span>
                      <div className="flex shrink-0 gap-1">
                        {a.archived ? (
                          <Button size="sm" variant="ghost" aria-describedby={describedBy} onClick={() => restore(a)}>{t('budgets.restore')}</Button>
                        ) : a.kind === 'investment' ? (
                          <Button size="sm" variant="ghost" aria-describedby={describedBy} disabled={!a.nw} onClick={() => a.nw && setValuing(a.nw)}>{t('networth.setValue')}</Button>
                        ) : (
                          <Button size="sm" variant="ghost" aria-describedby={describedBy} onClick={() => setBalanceOf(a)}>{t('balance.button')}</Button>
                        )}
                        <Button size="sm" variant="ghost" aria-describedby={describedBy} onClick={() => setEditing(a)}>{t('settings.edit')}</Button>
                      </div>
                    </div>
                  )
                })}
              </Card>
            )
          })}

          {archived.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((v) => !v)}
                className="flex items-center gap-1.5 rounded px-1 py-1 text-[13px] font-medium text-muted hover:text-text"
              >
                {showArchived ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {t('accounts.archivedTitle', { count: archived.length })}
              </button>
              {showArchived && (
                <Card className="mt-2">
                  {archived.map((a) => (
                    <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3 text-[13px] text-muted last:border-b-0">
                      <div className="min-w-0 flex-1 basis-56">
                        {nameButton(a, true)}
                        {nameFor(a)}
                        <p className="text-xs">{[t(`accountKind.${a.kind}`), a.bank].filter(Boolean).join(' · ')}</p>
                      </div>
                      <span className="num w-36 text-right">{money(a.valueCents, a.currency)}</span>
                      <Button size="sm" variant="ghost" aria-describedby={`${base}-${a.id}`} onClick={() => restore(a)}>{t('budgets.restore')}</Button>
                    </div>
                  ))}
                </Card>
              )}
            </div>
          )}

          <Card className="mt-4">
            <CardHeader
              title={t('networth.history')}
              description={t('networth.historyHint')}
              action={
                <Segmented
                  label={t('networth.range')}
                  value={String(range)}
                  onChange={(v) => setRange(Number(v) as (typeof RANGES)[number])}
                  // A longer range than the history there is would look the same as a shorter one.
                  options={RANGES.map((r, i) => {
                    const shorter = i > 0 ? RANGES[i - 1]! : 0
                    const none = r > 0 && available !== null && i > 0 && available <= shorter
                    return { value: String(r), label: r === 0 ? t('networth.all') : t('networth.years', { count: r / 12 }), disabled: none, title: none ? t('networth.noOlder') : undefined }
                  })}
                />
              }
            />
            <div className="px-5 py-4">
              {nw && nw.history.length > 0 ? (
                <TrendLine
                  label={t('networth.history')}
                  format={money}
                  compact={compact}
                  data={nw.history.map((h) => ({ key: h.month, label: `${monthShort(toDate(h.month), fmt)} ${h.month.slice(2, 4)}`, cents: h.cents, note: h.unconverted ? t('networth.missingRates', { count: h.unconverted }) : undefined }))}
                />
              ) : (
                <p className="text-[13px] text-muted">{t('networth.empty')}</p>
              )}
              {nw?.firstMonth && (range === 0 || (available !== null && available < range)) && (
                <p className="mt-2 text-xs text-muted">{t('networth.startsAt', { month: monthLabel(toDate(nw.firstMonth), fmt) })}</p>
              )}
            </div>
          </Card>
        </>
      )}
      <AccountModal
        account={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          reload()
        }}
      />
      <ValuationModal account={valuing} onClose={() => setValuing(null)} onSaved={reload} />
      <BankBalanceModal account={balanceOf} onClose={() => setBalanceOf(null)} onSaved={reload} />
    </>
  )
}

function ValuationModal({ account, onClose, onSaved }: { account: NetWorthAccount | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { money, fmt } = useSettings()
  const list = useOp('valuations.list', { accountId: account?.id ?? 0 })
  const today = localToday()
  const [form, setForm] = useState({ date: today, value: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setError(null)
    if (account) setForm({ date: today, value: centsToInput(account.valueCents, fmt.formats), note: '' })
  }, [account]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!account) return null
  const cents = parseAmount(form.value, 'auto', fmt.formats.decimal)
  const save = (): void => {
    if (cents === null || busy) return
    setBusy(true)
    setError(null)
    void call('valuations.set', { accountId: account.id, date: form.date, valueCents: cents, note: form.note.trim() || null })
      .then(() => {
        toast(t('networth.valueSaved'))
        void list.reload()
        onSaved()
      })
      .catch((e) => setError(errText(e)))
      .finally(() => setBusy(false))
  }
  return (
    <Modal open title={t('networth.valueTitle', { name: account.name })} onClose={onClose} dirty={form.note.trim() !== '' || form.value !== centsToInput(account.valueCents, fmt.formats)}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save() }}>
        <p className="text-[13px] text-muted">{t('networth.valueHelp')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('fx.date')}>{(id) => <DateInput id={id} value={form.date} onChange={(date) => setForm({ ...form, date })} required />}</Field>
          <Field label={t('networth.value', { currency: account.currency })}>{(id) => <Input id={id} inputMode="decimal" className="num" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required />}</Field>
        </div>
        <Field label={t('networth.note')}>{(id) => <Input id={id} value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} />}</Field>
        {error && <FormError>{error}</FormError>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('settings.cancel')}</Button>
          <Button type="submit" variant="primary" icon={<Plus size={14} />} disabled={cents === null || !form.date || busy}>{t('networth.saveValue')}</Button>
        </div>
      </form>
      {(list.data ?? []).length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-2 text-[13px] font-medium">{t('networth.recorded')}</p>
          {(list.data ?? []).map((v) => (
            <div key={v.date} className="flex items-center gap-3 py-1.5 text-[13px]">
              <span className="num w-28 text-muted">{formatDate(v.date, fmt)}</span>
              <span className="num flex-1 font-medium">{money(v.valueCents, account.currency)}</span>
              {v.note && <Badge>{v.note}</Badge>}
              <Button size="sm" variant="ghost" aria-label={t('fx.remove')} icon={<Trash2 size={14} />} onClick={() => { setError(null); void call('valuations.delete', { accountId: account.id, date: v.date }).then(() => { void list.reload(); onSaved() }, (e) => setError(errText(e))) }} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
