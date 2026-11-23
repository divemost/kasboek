import { AlertTriangle, CheckCircle2, Landmark, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { parseAmount } from '@shared/amount'
import { centsToInput } from '@shared/format'
import type { BankBalanceResult } from '@shared/types'
import { errText } from '../pages/auth/parts'
import { call, useOp } from '../lib/api'
import { formatDate } from '../lib/format'
import { useSettings } from '../lib/settings'
import { DateInput } from './DateInput'
import { useToast } from './Toast'
import { Badge, Button, Field, Input, Modal, cx } from './ui'
import { localToday } from '@shared/month'

const today = (): string => localToday()

/** "Matches your bank" or "€40.00 difference since 14/11: a transaction may be missing". */
export function BalanceVerdict({ result, currency, since }: { result: Pick<BankBalanceResult, 'expectedCents' | 'differenceCents'>; currency: string; since?: string | null }): ReactNode {
  const { t } = useTranslation()
  const { money, fmt } = useSettings()
  if (result.differenceCents === null || result.expectedCents === null) return null
  if (result.differenceCents === 0)
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-accent">
        <CheckCircle2 size={14} /> {t('balance.matches')}
      </p>
    )
  return (
    <p className="flex items-start gap-1.5 text-[13px] text-warning">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>
        {t(since ? 'balance.differsSince' : 'balance.differs', { expected: money(result.expectedCents, currency), difference: money(Math.abs(result.differenceCents), currency), date: since ? formatDate(since, fmt) : '' })}{' '}
        {t(result.differenceCents > 0 ? 'balance.moreAtBank' : 'balance.lessAtBank')}
      </span>
    </p>
  )
}

/** Amount and date fields for "the balance your bank shows". */
export function BalanceFields({ value, date, currency, onValue, onDate, dateLabel = true }: { value: string; date: string; currency: string; onValue: (v: string) => void; onDate: (d: string) => void; dateLabel?: boolean }) {
  const { t } = useTranslation()
  const { fmt } = useSettings()
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('balance.amount', { currency })}>{(id) => <Input id={id} inputMode="decimal" className="num" value={value} onChange={(e) => onValue(e.target.value)} placeholder={centsToInput(0, fmt.formats)} />}</Field>
      <Field label={dateLabel ? t('balance.onDate') : ''}>{(id) => <DateInput id={id} max={today()} value={date} onChange={onDate} />}</Field>
    </div>
  )
}

/** The balances recorded from the bank for one account, and a form to add one. */
export function BankBalanceModal({ account, onClose, onSaved }: { account: { id: number; name: string; currency: string } | null; onClose: () => void; onSaved?: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { money, fmt } = useSettings()
  const list = useOp('balances.list', { accountId: account?.id ?? 0 })
  const [form, setForm] = useState({ date: today(), value: '' })
  const [result, setResult] = useState<BankBalanceResult | null>(null)
  useEffect(() => {
    setForm({ date: today(), value: '' })
    setResult(null)
  }, [account?.id])
  if (!account) return null
  const cents = parseAmount(form.value, 'auto', fmt.formats.decimal)
  const save = (): void => {
    if (cents === null) return
    void call('balances.set', { accountId: account.id, date: form.date, balanceCents: cents })
      .then((r) => {
        setResult(r)
        setForm({ date: today(), value: '' })
        void list.reload()
        onSaved?.()
      })
      .catch((e) => toast(errText(e), 'error'))
  }
  return (
    <Modal open title={t('balance.title', { name: account.name })} onClose={onClose} dirty={form.value.trim() !== ''}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save() }}>
        <p className="text-[13px] text-muted">{t('balance.help')}</p>
        <BalanceFields value={form.value} date={form.date} currency={account.currency} onValue={(value) => setForm({ ...form, value })} onDate={(date) => setForm({ ...form, date })} />
        {result && <BalanceVerdict result={result} currency={account.currency} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('mcp.close')}</Button>
          <Button type="submit" variant="primary" icon={<Landmark size={14} />} disabled={cents === null || !form.date}>{t('balance.save')}</Button>
        </div>
      </form>
      {(list.data ?? []).length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-2 text-[13px] font-medium">{t('balance.recorded')}</p>
          {(list.data ?? []).map((b) => (
            <div key={b.date} className="border-b border-border py-2 text-[13px] last:border-b-0">
              <div className="flex items-center gap-3">
                <span className="num w-28 text-muted">{formatDate(b.date, fmt)}</span>
                <span className="num flex-1 font-medium">{money(b.balanceCents, account.currency)}</span>
                {b.note && <Badge>{b.note === 'From the CSV' ? t('balance.fromCsv') : b.note}</Badge>}
                {b.differenceCents !== null && (
                  <span className={cx('text-xs', b.differenceCents === 0 ? 'text-accent' : 'text-warning')}>
                    {b.differenceCents === 0 ? t('balance.ok') : t('balance.off', { difference: money(b.differenceCents, account.currency) })}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t('fx.remove')}
                  icon={<Trash2 size={14} />}
                  onClick={() => void call('valuations.delete', { accountId: account.id, date: b.date }).then(() => { void list.reload(); onSaved?.() })}
                />
              </div>
              {b.differenceCents !== null && b.differenceCents !== 0 && <div className="mt-1 pl-31"><BalanceVerdict result={b} currency={account.currency} since={b.since} /></div>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

/**
 * After an import: the balance on the file's last day, compared with the bank. Asks for the bank's
 * balance when the account has none yet; otherwise offers the comparison.
 */
export function ImportBalanceCheck({ accountId, currency, date, kasboekCents, ask, fromCsv }: { accountId: number; currency: string; date: string; kasboekCents: number; ask: boolean; fromCsv: BankBalanceResult | null }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { money, fmt } = useSettings()
  const [open, setOpen] = useState(ask)
  const [value, setValue] = useState('')
  const [result, setResult] = useState<BankBalanceResult | null>(null)
  const cents = parseAmount(value, 'auto', fmt.formats.decimal)
  const day = formatDate(date, fmt)
  if (fromCsv)
    return (
      <div className="mt-2 text-[13px]">
        <p>{t('balance.readFromCsv', { date: day, amount: money(fromCsv.balanceCents, currency) })}</p>
        <BalanceVerdict result={fromCsv} currency={currency} />
      </div>
    )
  if (result)
    return (
      <div className="mt-2 text-[13px]">
        <p>{t('balance.saved', { date: day })}</p>
        <BalanceVerdict result={result} currency={currency} />
      </div>
    )
  if (!open)
    return (
      <p className="mt-2 text-[13px] text-muted">
        {t('balance.kasboekOn', { date: day, amount: money(kasboekCents, currency) })}{' '}
        <button type="button" className="font-medium text-accent-hover hover:underline" onClick={() => setOpen(true)}>{t('balance.compare')}</button>
      </p>
    )
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2 text-[13px]"
      onSubmit={(e) => {
        e.preventDefault()
        if (cents === null) return
        void call('balances.set', { accountId, date, balanceCents: cents }).then(setResult, (err) => toast(errText(err), 'error'))
      }}
    >
      <label className="flex flex-col gap-1">
        <span>{ask ? t('balance.ask', { date: day }) : t('balance.askCompare', { date: day })}</span>
        <Input inputMode="decimal" className="num w-44!" value={value} onChange={(e) => setValue(e.target.value)} placeholder={money(kasboekCents, currency)} autoFocus />
      </label>
      <Button size="sm" type="submit" variant="primary" disabled={cents === null}>{t('balance.save')}</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('balance.skip')}</Button>
      {ask && <p className="w-full text-xs text-muted">{t('balance.why')}</p>}
    </form>
  )
}
