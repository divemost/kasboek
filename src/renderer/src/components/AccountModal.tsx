import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseAmount } from '@shared/amount'
import { localToday } from '@shared/month'
import { ACCOUNT_KINDS, type Account, type AccountKind, type AccountWithBalance } from '@shared/types'
import { call } from '../lib/api'
import { formatNumber } from '../lib/format'
import { IbanInput } from '../lib/hide-numbers'
import { useSettings } from '../lib/settings'
import { errText } from '../pages/auth/parts'
import { BalanceFields } from './BankBalance'
import { CurrencySelect } from './CurrencySelect'
import { useToast } from './Toast'
import { Button, Field, FormError, Input, Modal, Select } from './ui'

interface Form {
  name: string
  bank: string
  iban: string
  currency: string
  kind: AccountKind
  balance: string
  balanceDate: string
  fxCost: string
}

/** The form to add an account ('new') or change one. Used wherever an account is added, so nobody has to go to another page first. */
export function AccountModal({ account, intro, onClose, onSaved }: { account: AccountWithBalance | 'new' | null; intro?: string; onClose: () => void; onSaved: (a: Account) => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { settings, fmt } = useSettings()
  const blank = (): Form => ({ name: '', bank: '', iban: '', currency: settings.currency, kind: 'current', balance: '', balanceDate: localToday(), fxCost: '' })
  const [form, setForm] = useState<Form>(blank)
  const [initial, setInitial] = useState<Form>(form)
  const errorId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [askArchive, setAskArchive] = useState(false)
  useEffect(() => {
    setError(null)
    setAskArchive(false)
    if (!account) return
    const next: Form =
      account === 'new'
        ? blank()
        : { name: account.name, bank: account.bank, iban: account.iban ?? '', currency: account.currency, kind: account.kind, balance: '', balanceDate: localToday(), fxCost: account.fxCostPct === null ? '' : formatNumber(account.fxCostPct, fmt, 2).replace(/[.,]?0+$/, '') }
    setForm(next)
    setInitial(next)
  }, [account]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!account) return null
  const isNew = account === 'new'
  const dirty = (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== initial[k])
  const balanceCents = form.balance.trim() ? parseAmount(form.balance, 'auto', fmt.formats.decimal) : null
  // A percentage like "1,5" or "1.5"; empty = not known.
  const fxCostPct = form.fxCost.trim() === '' ? null : Number(form.fxCost.trim().replace('%', '').replace(',', '.'))
  const fxCostBad = fxCostPct !== null && (!Number.isFinite(fxCostPct) || fxCostPct < 0 || fxCostPct > 20)
  const save = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const saved = isNew
        ? await call('accounts.create', {
            name: form.name,
            bank: form.bank,
            iban: form.iban || null,
            currency: form.currency,
            kind: form.kind,
            fxCostPct,
            ...(balanceCents !== null ? { bankBalance: { date: form.balanceDate, cents: balanceCents } } : {})
          })
        : await call('accounts.update', { id: account.id, name: form.name, bank: form.bank, iban: form.iban || null, currency: form.currency, kind: form.kind, fxCostPct })
      toast(isNew ? t('settings.accountAdded') : t('settings.accountSaved'))
      onSaved(saved)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const archive = async (a: AccountWithBalance): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    setAskArchive(false)
    try {
      const saved = await call('accounts.update', { id: a.id, archived: true })
      toast(t('accounts.archivedToast', { name: a.name }))
      onSaved(saved)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open title={isNew ? t('settings.addAccount') : t('settings.editAccount')} onClose={onClose} dirty={dirty}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save() }}>
        {intro && <p className="text-[13px] text-muted">{intro}</p>}
        <Field label={t('settings.accountName')}>{(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('settings.accountNamePlaceholder')} aria-describedby={error ? errorId : undefined} aria-invalid={error ? true : undefined} autoFocus required />}</Field>
        <Field label={t('settings.bankName')} hint={t('settings.bankNameHint')}>{(id) => <Input id={id} value={form.bank} maxLength={60} onChange={(e) => setForm({ ...form, bank: e.target.value })} />}</Field>
        <Field label={t('settings.accountKind')} hint={form.kind === 'investment' ? t('settings.accountKindInvestment') : undefined}>
          {(id) => (
            <Select id={id} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AccountKind })}>
              {ACCOUNT_KINDS.map((k) => <option key={k} value={k}>{t(`accountKind.${k}`)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('settings.accountCurrency')} hint={!isNew && account.transactionCount > 0 && form.currency !== account.currency ? t('settings.accountCurrencyChange', { from: account.currency, to: form.currency }) : undefined}>
          {(id) => <CurrencySelect id={id} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />}
        </Field>
        <Field label={t('settings.iban')} hint={t('settings.ibanOptional')}>{(id) => <IbanInput id={id} value={form.iban} onChange={(iban) => setForm({ ...form, iban })} placeholder="BE68 5390 0754 7034" className="num" />}</Field>
        <Field label={t('settings.fxCost')} hint={fxCostBad ? <span className="text-negative">{t('settings.fxCostBad')}</span> : t('settings.fxCostHint')}>
          {(id) => <Input id={id} value={form.fxCost} inputMode="decimal" aria-invalid={fxCostBad ? true : undefined} className="num w-32!" placeholder={formatNumber(1.5, fmt, 1)} onChange={(e) => setForm({ ...form, fxCost: e.target.value })} />}
        </Field>
        {isNew && (
          <div>
            <p className="mb-1 text-[13px] font-medium">{t(form.kind === 'investment' ? 'balance.newInvestment' : 'balance.newTitle')}</p>
            <p className="mb-2 text-xs text-muted">{t('balance.newHint')}</p>
            <BalanceFields value={form.balance} date={form.balanceDate} currency={form.currency} onValue={(balance) => setForm({ ...form, balance })} onDate={(balanceDate) => setForm({ ...form, balanceDate })} />
            {form.balance.trim() !== '' && balanceCents === null && <p className="mt-1 text-xs text-negative">{t('budgets.invalid')}</p>}
          </div>
        )}
        {error && <FormError id={errorId}>{error}</FormError>}
        <div className="flex items-start justify-between gap-4">
          {!isNew && !account.archived ? (
            <div className="flex max-w-56 flex-col items-start gap-1">
              {askArchive ? (
                <>
                  <p className="px-3 text-xs">{t('accounts.archiveDiscardAsk')}</p>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setAskArchive(false)}>{t('modal.keepEditing')}</Button>
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => void archive(account)}>{t('accounts.archive')}</Button>
                  </div>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => (dirty ? setAskArchive(true) : void archive(account))}>{t('accounts.archive')}</Button>
                  <p className="px-3 text-xs text-muted">{t('accounts.archiveHint')}</p>
                </>
              )}
            </div>
          ) : <span />}
          <div className="flex gap-2">
            <Button onClick={onClose}>{t('settings.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={busy || !form.name.trim() || fxCostBad || (form.balance.trim() !== '' && balanceCents === null) || (balanceCents !== null && !form.balanceDate)}>{t('settings.save')}</Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
