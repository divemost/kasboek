import { ArrowLeftRight, Bookmark, Download, PenLine, Plus, Search, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseAmount } from '@shared/amount'
import { centsToInput } from '@shared/format'
import { isFirstTransaction } from '@shared/get-started'
import { addMonths, monthOf } from '@shared/month'
import type { TransferPair, Category, Transaction } from '@shared/types'
import type { Page } from '../App'
import { AccountModal } from '../components/AccountModal'
import { DateInput } from '../components/DateInput'
import { PromptModal } from '../components/PromptModal'
import { Button, Card, EmptyState, Field, FormError, Input, Modal, PageHeader, Select, cx } from '../components/ui'
import { useToast } from '../components/Toast'
import { call, useOp } from '../lib/api'
import { exportTransactions } from '../lib/export'
import { formatDate, monthLabel } from '../lib/format'
import { Iban, Masked, MaskedInput, useMasked, useRevealable } from '../lib/hide-numbers'
import { useSettings } from '../lib/settings'
import { errText } from './auth/parts'
import { localToday } from '@shared/month'
import { MAX_CONTEXT_ROWS } from '@shared/page-context'
import { usePublishPageContext } from '../lib/page-context'

export interface TxFilter {
  accountId?: number
  categoryId?: number | 'none'
  month?: string
  search?: string
}

export function CategorySelect({ value, categories, onChange, className, allowNone = true, label, id, disabled }: { value: number | null; categories: Category[]; onChange: (id: number | null) => void; className?: string; allowNone?: boolean; label: string; id?: string; disabled?: boolean }) {
  const { t } = useTranslation()
  const groups: Category['kind'][] = ['expense', 'income', 'transfer']
  return (
    <Select id={id} aria-label={label} className={className} disabled={disabled} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowNone && <option value="">{t('transactions.uncategorized')}</option>}
      {groups.map((g) => (
        <optgroup key={g} label={t(`categories.kind.${g}`)}>
          {categories.filter((c) => c.kind === g && (!c.archived || c.id === value)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </Select>
  )
}

/**
 * The title of a row: opens the edit dialog. The eyes that reveal a hidden number are next to the button, not inside it
 * (a button can't hold a button), so holding one never opens the dialog.
 */
function TxTitle({ tx, onOpen }: { tx: Transaction; onOpen: () => void }) {
  const { t } = useTranslation()
  const title = useRevealable(tx.counterpartyName || tx.description)
  const description = useRevealable(tx.description, tx.counterpartyName || tx.description)
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button type="button" className="min-w-0 truncate text-left" onClick={onOpen}>
        {tx.transferAccount && <span className="mr-2 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted" title={t('transfers.pairedHint')}>⇄ {tx.transferAccount}</span>}
        {tx.splitCount > 0 && <span className="mr-2 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{t('splits.badge', { count: tx.splitCount })}</span>}
        <span className="font-medium">{title.text}</span>
        {tx.counterpartyName && <span className="ml-2 text-[13px] text-muted">{description.text}</span>}
      </button>
      {title.eye}
      {tx.counterpartyName && description.eye}
    </div>
  )
}

export function Transactions({ go, initial, openNew }: { go: (p: Page, filter?: Record<string, unknown>) => void; initial?: TxFilter; openNew?: number }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { money, fmt, updatePrefs } = useSettings()
  const [filter, setFilter] = useState<TxFilter>(initial ?? {})
  const [searchText, setSearchText] = useState(initial?.search ?? '')
  const [limit, setLimit] = useState(100)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [asking, setAsking] = useState<'search' | 'rename' | null>(null)
  const [editing, setEditing] = useState<Transaction | 'new' | null>(null)
  // A new transaction starts on this account: the one just added, or the one a link asked for.
  const [newAccountId, setNewAccountId] = useState<number | undefined>(openNew)
  const [addingAccount, setAddingAccount] = useState(false)
  // Whether the transaction being typed in is the first one ever: followed until the form opens, then kept.
  const firstEver = useRef<boolean | null>(null)
  const [suggest, setSuggest] = useState<{ pattern: string; categoryId: number; categoryName: string } | null>(null)
  const [transfersOpen, setTransfersOpen] = useState(false)
  const suggestName = useMasked(suggest?.pattern ?? '')
  const accounts = useOp('accounts.list')
  const categories = useOp('categories.list')
  const page = useOp('transactions.list', { ...filter, limit, offset: 0 })
  const cats = categories.data ?? []

  useEffect(() => {
    const h = setTimeout(() => setFilter((f) => ({ ...f, search: searchText || undefined })), 250)
    return () => clearTimeout(h)
  }, [searchText])
  useEffect(() => setSelected(new Set()), [filter])
  useEffect(() => {
    if (accounts.data && (editing !== 'new' || firstEver.current === null)) firstEver.current = isFirstTransaction(accounts.data)
  }, [accounts.data, editing])
  useEffect(() => {
    if (openNew !== undefined) startNew(openNew)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const months = useMemo(() => Array.from({ length: 24 }, (_, i) => addMonths(monthOf(), -i)), [])
  const items = page.data?.items ?? []
  usePublishPageContext({
    page: 'transactions',
    filters: Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string | number>,
    selectedIds: [...selected],
    openId: editing && editing !== 'new' ? editing.id : null,
    rows: items.slice(0, MAX_CONTEXT_ROWS).map((i) => ({ id: i.id, date: i.bookingDate, amountCents: i.amountCents, currency: i.currency, payee: i.counterpartyName, description: i.description, category: i.categoryName, account: i.accountName }))
  })
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id))

  // Exactly two selected, money out of one account and into another (the same amount, or any amount
  // in another currency): one transfer.
  const chosen = items.filter((i) => selected.has(i.id))
  const [ca, cb] = chosen
  const pairable =
    chosen.length === 2 && ca!.accountId !== cb!.accountId && !chosen.some((c) => c.transferAccount) && Math.sign(ca!.amountCents) === -Math.sign(cb!.amountCents) && (ca!.currency !== cb!.currency || ca!.amountCents === -cb!.amountCents)
  const pairSelected = (): void => {
    const [a, b] = chosen
    if (!a || !b) return
    const out = a.amountCents < 0 ? a : b
    const inn = out === a ? b : a
    void call('transfers.pair', { pairs: [{ outId: out.id, inId: inn.id }] }).then(() => { setSelected(new Set()); void page.reload() }, (e) => toast(errText(e), 'error'))
  }
  const settingsOp = useOp('settings.get')
  const saved = settingsOp.data?.savedSearches ?? []
  const activeFilter = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined && v !== ''))
  const current = saved.find((x) => JSON.stringify(x.filter) === JSON.stringify(activeFilter))

  const startNew = (accountId?: number): void => {
    setNewAccountId(accountId)
    setEditing('new')
  }
  const categorize = async (ids: number[], categoryId: number | null, tx?: Transaction): Promise<void> => {
    try {
      await call('transactions.categorize', { ids, categoryId })
      void page.reload()
      const cat = cats.find((c) => c.id === categoryId)
      if (tx?.counterpartyName && cat) setSuggest({ pattern: tx.counterpartyName, categoryId: cat.id, categoryName: cat.name })
    } catch (e) {
      toast(errText(e), 'error')
    }
  }

  return (
    <>
      <PageHeader
        title={t('transactions.title')}
        subtitle={t('transactions.subtitle')}
        action={
          <div className="flex gap-2">
            {(accounts.data ?? []).length > 1 && <Button icon={<ArrowLeftRight size={14} />} onClick={() => setTransfersOpen(true)}>{t('transfers.button')}</Button>}
            <Button icon={<Plus size={14} />} disabled={!accounts.data} onClick={() => (accounts.data?.some((a) => !a.archived) ? startNew() : setAddingAccount(true))}>{t('transactions.add')}</Button>
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <MaskedInput placeholder={t('transactions.search')} className="pl-9" value={searchText} onChange={setSearchText} label={t('transactions.search')} />
        </div>
        <Select className="w-48!" aria-label={t('transactions.account')} value={filter.accountId ?? ''} onChange={(e) => setFilter({ ...filter, accountId: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">{t('transactions.allAccounts')}</option>
          {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select className="w-48!" aria-label={t('transactions.category')} value={filter.categoryId ?? ''} onChange={(e) => setFilter({ ...filter, categoryId: e.target.value === 'none' ? 'none' : e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">{t('transactions.allCategories')}</option>
          <option value="none">{t('transactions.uncategorized')}</option>
          {cats.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select className="w-48!" aria-label={t('transactions.month')} value={filter.month ?? ''} onChange={(e) => setFilter({ ...filter, month: e.target.value || undefined })}>
          <option value="">{t('transactions.allDates')}</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1), fmt)}</option>)}
        </Select>
        <span className="ml-auto flex items-center gap-1">
          {saved.length > 0 && (
            <Select
              className="w-44!"
              aria-label={t('searches.label')}
              value={current?.name ?? ''}
              onChange={(e) => {
                const f = saved.find((x) => x.name === e.target.value)?.filter
                if (!f) return
                setFilter(f)
                setSearchText(f.search ?? '')
              }}
            >
              <option value="">{t('searches.label')}</option>
              {saved.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
            </Select>
          )}
          {(page.data?.total ?? 0) > 0 && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('export.csv')}
              title={t('export.csvHint')}
              icon={<Download size={14} />}
              onClick={() => void exportTransactions(t, activeFilter, `Kasboek ${current?.name ?? localToday()}`).then((r) => r.file && toast(t('export.saved', { count: r.rows })), (e) => toast(errText(e), 'error'))}
            />
          )}
          {current ? (
            <Button size="sm" variant="ghost" aria-label={t('searches.delete')} title={t('searches.delete')} icon={<Trash2 size={14} />} onClick={() => void call('searches.delete', { name: current.name }).then(() => settingsOp.reload())} />
          ) : (
            Object.keys(activeFilter).length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Bookmark size={14} />}
                onClick={() => setAsking('search')}
              >
                {t('searches.save')}
              </Button>
            )
          )}
        </span>
      </div>

      {page.data && page.data.total > 0 && (
        <p className="num mb-3 text-[13px] text-muted">
          {t('transactions.count', { count: page.data.total })} · {t('transactions.in')} <span className="font-medium text-text">{money(page.data.inCents)}</span> · {t('transactions.out')}{' '}
          <span className="font-medium text-text">{money(page.data.outCents)}</span>
        </p>
      )}

      {suggest && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-border bg-accent-soft px-4 py-2.5 text-[13px]">
          <Wand2 size={15} className="text-accent" />
          <span className="flex-1">{t('transactions.ruleSuggest', { name: suggestName, category: suggest.categoryName })}</span>
          <Button size="sm" variant="ghost" onClick={() => setSuggest(null)}>{t('auth.notNow')}</Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              void call('rules.create', { field: 'counterparty', pattern: suggest.pattern, categoryId: suggest.categoryId, applyToExisting: true }).then(
                (r) => {
                  toast(t('transactions.ruleCreated', { count: r.applied }))
                  setSuggest(null)
                  void page.reload()
                },
                (e) => toast(errText(e), 'error')
              )
            }
          >
            {t('transactions.ruleCreate')}
          </Button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-[13px]">
          <span className="font-medium">{t('transactions.selected', { count: selected.size })}</span>
          <span className="ml-4 text-muted">{t('transactions.setCategory')}</span>
          <CategorySelect label={t('transactions.setCategory')} className="h-8 w-48" value={null} categories={cats} onChange={(id) => void categorize([...selected], id).then(() => setSelected(new Set()))} />
          <Button
            size="sm"
            variant="ghost"
            icon={<PenLine size={14} />}
            onClick={() => setAsking('rename')}
          >
            {t('transactions.rename')}
          </Button>
          {pairable && (
            <Button size="sm" variant="ghost" icon={<ArrowLeftRight size={14} />} onClick={() => pairSelected()}>
              {t('transfers.pairSelected')}
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            className="ml-auto"
            icon={<Trash2 size={14} />}
            onClick={() => {
              if (!window.confirm(t('transactions.deleteConfirm', { count: selected.size }))) return
              void call('transactions.delete', { ids: [...selected] }).then(() => {
                setSelected(new Set())
                void page.reload()
              })
            }}
          >
            {t('transactions.delete')}
          </Button>
        </div>
      )}

      {asking === 'search' && (
        <PromptModal
          title={t('searches.save')}
          label={t('searches.namePrompt')}
          submitLabel={t('searches.save')}
          onSubmit={(name) => void call('searches.save', { name, filter: activeFilter }).then(() => settingsOp.reload(), (e) => toast(errText(e), 'error'))}
          onClose={() => setAsking(null)}
        />
      )}
      {asking === 'rename' && (
        <PromptModal
          title={t('transactions.rename')}
          label={t('transactions.renamePrompt', { count: selected.size })}
          submitLabel={t('transactions.rename')}
          onSubmit={(name) => void call('transactions.rename', { ids: [...selected], counterpartyName: name }).then(() => { setSelected(new Set()); void page.reload() }, (e) => toast(errText(e), 'error'))}
          onClose={() => setAsking(null)}
        />
      )}

      <Card>
        {page.data && items.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight size={20} />}
            title={Object.values(filter).some(Boolean) ? t('transactions.noMatch') : t('transactions.emptyTitle')}
            body={Object.values(filter).some(Boolean) ? undefined : t('transactions.emptyBody')}
            action={!Object.values(filter).some(Boolean) && <Button variant="primary" onClick={() => go('import')}>{t('transactions.goImport')}</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted">
                <th className="w-10 py-3 pl-5">
                  <input type="checkbox" aria-label={t('transactions.selectAll')} className="accent-[var(--accent)]" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))} />
                </th>
                <th className="w-28 px-3 py-3 font-medium">{t('transactions.date')}</th>
                <th className="px-3 py-3 font-medium">{t('transactions.description')}</th>
                <th className="w-40 px-3 py-3 font-medium">{t('transactions.category')}</th>
                <th className="w-32 py-3 pr-5 pl-3 text-right font-medium">{t('transactions.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((tx) => (
                <tr key={tx.id} className={cx('border-b border-border last:border-b-0 hover:bg-surface-2/60', selected.has(tx.id) && 'bg-accent-soft/50')}>
                  <td className="py-2.5 pl-5">
                    <input
                      type="checkbox"
                      aria-label={t('transactions.select')}
                      className="accent-[var(--accent)]"
                      checked={selected.has(tx.id)}
                      onChange={() => {
                        const n = new Set(selected)
                        if (n.has(tx.id)) n.delete(tx.id)
                        else n.add(tx.id)
                        setSelected(n)
                      }}
                    />
                  </td>
                  <td className="num px-3 py-2.5 text-[13px] whitespace-nowrap text-muted">{formatDate(tx.bookingDate, fmt)}</td>
                  <td className="max-w-0 px-3 py-2.5">
                    <TxTitle tx={tx} onOpen={() => setEditing(tx)} />
                  </td>
                  <td className="px-3 py-1.5">
                    {tx.splitCount > 0 ? (
                      <button type="button" className="h-8 w-full truncate rounded-md border border-border px-2 text-left text-[13px] text-muted hover:text-text" onClick={() => setEditing(tx)}>
                        {t('splits.badge', { count: tx.splitCount })}
                      </button>
                    ) : (
                      <CategorySelect label={t('transactions.category')} className={cx('h-8 text-[13px]', tx.categoryId === null && 'text-muted')} value={tx.categoryId} categories={cats} onChange={(id) => void categorize([tx.id], id, tx)} />
                    )}
                  </td>
                  <td className={cx('num py-2.5 pr-5 pl-3 text-right font-medium whitespace-nowrap', tx.amountCents > 0 && 'text-accent')}>
                    {tx.amountCents > 0 ? '+' : ''}
                    {money(tx.amountCents, tx.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
      {page.data && page.data.total > items.length && (
        <div className="mt-4 flex justify-center">
          <Button onClick={() => setLimit((l) => l + 100)}>{t('transactions.more')}</Button>
        </div>
      )}

      <TransfersModal open={transfersOpen} onClose={() => setTransfersOpen(false)} onPaired={() => void page.reload()} />
      <AccountModal
        account={addingAccount ? 'new' : null}
        intro={t('accounts.firstHint')}
        onClose={() => setAddingAccount(false)}
        onSaved={(a) => {
          setAddingAccount(false)
          void accounts.reload().then(() => startNew(a.id))
        }}
      />
      <TxModal
        tx={editing}
        categories={cats}
        accounts={(accounts.data ?? []).map((a) => ({ id: a.id, name: a.name, archived: a.archived }))}
        accountId={newAccountId}
        onClose={() => setEditing(null)}
        onCreated={(date) => {
          if (!firstEver.current) return
          void updatePrefs({ firstTipDone: false }).catch(() => undefined)
          toast(t('overview.start.doneTitle'), 'success', { label: t('overview.start.doneAction'), onClick: () => go('overview', { month: date.slice(0, 7) }) })
        }}
        onSaved={() => {
          setEditing(null)
          void page.reload()
        }}
      />
    </>
  )
}

/** A transfer between currencies: its exchange cost (booked as a fee), and a way to change it. */
function ExchangeCost({ txId, onSaved }: { txId: number; onSaved: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { money, fmt } = useSettings()
  const [info, setInfo] = useState<{ cross: boolean; currency: string | null; costCents: number | null } | null>(null)
  const [edit, setEdit] = useState<string | null>(null)
  useEffect(() => void call('transfers.cost', { id: txId }).then(setInfo, () => setInfo(null)), [txId])
  if (!info?.cross || !info.currency) return null
  const cents = edit === null ? null : parseAmount(edit, 'auto', fmt.formats.decimal)
  const save = (): void => {
    if (cents === null || cents < 0) return
    void call('transfers.setCost', { id: txId, costCents: cents }).then(
      () => {
        toast(t('transfers.costSaved'))
        setEdit(null)
        onSaved()
      },
      (e) => toast(errText(e), 'error')
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted">{info.costCents ? t('transfers.costBooked', { amount: money(info.costCents, info.currency) }) : t('transfers.noCostBooked')}</span>
      {edit === null ? (
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => setEdit(info.costCents ? centsToInput(info.costCents, fmt.formats) : '')}>{t('transfers.changeCost')}</button>
      ) : (
        <>
          <Input className="num h-7! w-28!" inputMode="decimal" autoFocus value={edit} aria-label={t('transfers.changeCost')} onChange={(e) => setEdit(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }} placeholder={info.currency} />
          <Button size="sm" variant="primary" disabled={cents === null || cents < 0} onClick={save}>{t('settings.save')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>{t('settings.cancel')}</Button>
        </>
      )}
    </div>
  )
}

function TxModal({ tx, categories, accounts, accountId, onClose, onSaved, onCreated }: { tx: Transaction | 'new' | null; categories: Category[]; accounts: { id: number; name: string; archived: boolean }[]; accountId?: number; onClose: () => void; onSaved: () => void; onCreated: (bookingDate: string) => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const isNew = tx === 'new'
  const { fmt } = useSettings()
  const base = tx && tx !== 'new' ? tx : null
  // Archived accounts are no longer offered, except the one this transaction is already in.
  const choices = accounts.filter((a) => !a.archived || a.id === base?.accountId)
  const [form, setForm] = useState({ accountId: 0, bookingDate: '', amount: '', description: '', counterpartyName: '', categoryId: null as number | null, notes: '' })
  // The form as it was opened, so Escape only asks to discard when something was changed.
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState<typeof form | null>(null)
  const dirty = opened !== null && JSON.stringify(form) !== JSON.stringify(opened)
  useEffect(() => {
    setError(null)
    if (!tx) return
    const initial = {
      accountId: base?.accountId ?? accountId ?? choices[0]?.id ?? 0,
      bookingDate: base?.bookingDate ?? localToday(),
      amount: base ? centsToInput(base.amountCents, fmt.formats) : '',
      description: base?.description ?? '',
      counterpartyName: base?.counterpartyName ?? '',
      categoryId: base?.categoryId ?? null,
      notes: base?.notes ?? ''
    }
    setForm(initial)
    setOpened(initial)
  }, [tx]) // eslint-disable-line react-hooks/exhaustive-deps
  const example = centsToInput(-1250, fmt.formats)
  const cents = parseAmount(form.amount, 'auto', fmt.formats.decimal)
  const valid = form.accountId > 0 && cents !== null && cents !== 0 && form.description.trim() && /^\d{4}-\d{2}-\d{2}$/.test(form.bookingDate)
  const save = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    const common = { bookingDate: form.bookingDate, amountCents: cents!, description: form.description, counterpartyName: form.counterpartyName || null, categoryId: form.categoryId, notes: form.notes || null }
    const p = isNew ? call('transactions.create', { accountId: form.accountId, ...common }) : call('transactions.update', { id: base!.id, ...common })
    p.then(() => {
      if (isNew) onCreated(form.bookingDate)
      onSaved()
    }, (e) => setError(errText(e))).finally(() => setBusy(false))
  }
  return (
    <Modal open={!!tx} title={isNew ? t('transactions.add') : t('transactions.edit')} onClose={onClose} dirty={dirty}>
      <form className="grid grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); if (valid) save() }}>
        {isNew && (
          <div className="col-span-2">
            <Field label={t('transactions.account')}>
              {(id) => <Select id={id} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: Number(e.target.value) })}>{choices.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}
            </Field>
          </div>
        )}
        <Field label={t('transactions.date')}>{(id) => <DateInput id={id} value={form.bookingDate} onChange={(bookingDate) => setForm({ ...form, bookingDate })} />}</Field>
        <Field label={t('transactions.amount')} hint={t('transactions.amountHint', { example })}>{(id) => <Input id={id} className="num" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={example} />}</Field>
        <div className="col-span-2"><Field label={t('transactions.counterparty')}>{(id) => <MaskedInput id={id} value={form.counterpartyName} onChange={(counterpartyName) => setForm({ ...form, counterpartyName })} />}</Field></div>
        <div className="col-span-2"><Field label={t('transactions.description')}>{(id) => <MaskedInput id={id} value={form.description} onChange={(description) => setForm({ ...form, description })} />}</Field></div>
        <div className="col-span-2">
          <Field label={t('transactions.category')} hint={cents !== null && cents > 0 && categories.find((c) => c.id === form.categoryId)?.kind === 'expense' ? t('transactions.refundHint') : undefined}>
            {(id) => <CategorySelect id={id} label={t('transactions.category')} value={form.categoryId} categories={categories} onChange={(c) => setForm({ ...form, categoryId: c })} />}
          </Field>
        </div>
        <div className="col-span-2"><Field label={t('transactions.notes')}>{(id) => <MaskedInput id={id} value={form.notes} onChange={(notes) => setForm({ ...form, notes })} />}</Field></div>
        {base?.communication && <p className="selectable col-span-2 text-xs text-muted">{t('transactions.communication')}: <Masked text={base.communication} /></p>}
        {base?.counterpartyIban && <p className="selectable num col-span-2 -mt-3 text-xs text-muted">IBAN: <Iban value={base.counterpartyIban} name={base.counterpartyName || base.description} /></p>}
        {base && <div className="col-span-2"><SplitEditor tx={base} categories={categories} onSaved={onSaved} /></div>}
        {base?.transferAccount && (
          <div className="col-span-2 flex flex-col gap-1.5">
            <p className="flex items-center gap-2 text-xs text-muted">
              ⇄ {t('transfers.pairedWith', { account: base.transferAccount })}
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => void call('transfers.unpair', { id: base.id }).then(onSaved, (e) => toast(errText(e), 'error'))}>{t('transfers.unpair')}</button>
            </p>
            <ExchangeCost txId={base.id} onSaved={onSaved} />
          </div>
        )}
        {error && <div className="col-span-2"><FormError>{error}</FormError></div>}
        <div className="col-span-2 flex justify-between gap-2">
          {base ? (
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => { if (window.confirm(t('transactions.deleteConfirm', { count: 1 }))) void call('transactions.delete', { ids: [base.id] }).then(onSaved, (e) => setError(errText(e))) }}>
              {t('transactions.delete')}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button onClick={onClose}>{t('settings.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={!valid || busy}>{t('settings.save')}</Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

/** Transfers between own accounts that aren't paired yet; the sure ones are ticked. */
function TransfersModal({ open, onClose, onPaired }: { open: boolean; onClose: () => void; onPaired: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { money, fmt } = useSettings()
  const [list, setList] = useState<TransferPair[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const key = (p: TransferPair): string => `${p.outId}-${p.inId}`
  useEffect(() => {
    if (!open) return
    setList(null)
    void call('transfers.find').then((l) => {
      setList(l)
      setPicked(new Set(l.filter((p) => p.confidence === 'iban').map(key)))
    })
  }, [open])
  const pair = (): void => {
    const pairs = (list ?? []).filter((p) => picked.has(key(p))).map((p) => ({ outId: p.outId, inId: p.inId, ...(p.costCents !== null ? { costCents: p.costCents } : {}) }))
    void call('transfers.pair', { pairs }).then(
      (r) => {
        toast(t('transfers.paired', { count: r.paired }))
        onPaired()
        onClose()
      },
      (e) => toast(errText(e), 'error')
    )
  }
  return (
    <Modal open={open} title={t('transfers.title')} onClose={onClose}>
      <p className="mb-3 text-[13px] text-muted">{t('transfers.hint')}</p>
      {list === null ? (
        <p className="text-[13px] text-muted">…</p>
      ) : list.length === 0 ? (
        <p className="text-[13px] text-muted">{t('transfers.none')}</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {list.map((p) => (
            <li key={key(p)}>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  checked={picked.has(key(p))}
                  onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(key(p)); else n.delete(key(p)); return n })}
                />
                <span className="num w-24 text-muted">{formatDate(p.date, fmt)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.fromAccount} → {p.toAccount}</span>
                  <span className="block text-xs text-muted">
                    {t(p.confidence === 'iban' ? 'transfers.sure' : p.inCurrency !== p.currency ? 'transfers.maybeFx' : 'transfers.maybe')}
                    {p.inCurrency !== p.currency && (p.costCents ? ` · ${t('transfers.cost', { amount: money(p.costCents, p.currency) })}` : ` · ${t('transfers.noCost')}`)}
                  </span>
                </span>
                <span className="num text-right font-medium">
                  {money(p.amountCents, p.currency)}
                  {p.inCurrency !== p.currency && <span className="block text-xs font-normal text-muted">→ {money(p.inAmountCents, p.inCurrency)}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>{t('settings.cancel')}</Button>
        <Button variant="primary" disabled={!picked.size} onClick={pair}>{t('transfers.pair', { count: picked.size })}</Button>
      </div>
    </Modal>
  )
}

/** Split one transaction over categories; the parts add up to its amount. */
function SplitEditor({ tx, categories, onSaved }: { tx: Transaction; categories: Category[]; onSaved: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { money, fmt } = useSettings()
  const [parts, setParts] = useState<{ categoryId: number | null; amount: string }[] | null>(null)
  useEffect(() => {
    setParts(null)
    if (tx.splitCount > 0)
      void call('transactions.splits', { id: tx.id }).then((l) => setParts(l.map((p) => ({ categoryId: p.categoryId, amount: centsToInput(p.amountCents, fmt.formats) }))))
  }, [tx.id, tx.splitCount]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!parts)
    return (
      <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setParts([{ categoryId: tx.categoryId, amount: centsToInput(tx.amountCents, fmt.formats) }, { categoryId: null, amount: '' }])}>
        {t('splits.start')}
      </button>
    )
  const cents = parts.map((p) => parseAmount(p.amount, 'auto', fmt.formats.decimal))
  const sum = cents.reduce<number>((a, c) => a + (c ?? 0), 0)
  const left = tx.amountCents - sum
  const valid = parts.length >= 2 && cents.every((c) => c !== null && c !== 0) && left === 0
  const save = (list: { categoryId: number | null; amountCents: number }[]): void =>
    void call('transactions.split', { id: tx.id, parts: list }).then(onSaved, (e) => toast(errText(e), 'error'))
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 text-[13px] font-medium">{t('splits.title')}</p>
      {parts.map((p, i) => (
        <div key={i} className="mb-2 flex items-center gap-2">
          <CategorySelect label={t('transactions.category')} className="h-8 flex-1 text-[13px]" value={p.categoryId} categories={categories} onChange={(c) => setParts(parts.map((x, j) => (j === i ? { ...x, categoryId: c } : x)))} />
          <Input aria-label={t('transactions.amount')} className="num h-8! w-28!" value={p.amount} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          <button type="button" aria-label={t('transactions.delete')} className="rounded p-1 text-muted hover:text-negative" onClick={() => setParts(parts.filter((_, j) => j !== i))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => setParts([...parts, { categoryId: null, amount: left ? centsToInput(left, fmt.formats) : '' }])}>{t('splits.add')}</button>
        {cents.every((c) => c !== null) && (
          <span className={cx('num ml-auto', left === 0 ? 'text-muted' : 'text-warning')}>{left === 0 ? t('splits.matches') : t('splits.left', { amount: money(left, tx.currency) })}</span>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {tx.splitCount > 0 && <Button size="sm" variant="ghost" onClick={() => save([])}>{t('splits.remove')}</Button>}
        <Button size="sm" variant="primary" disabled={!valid} onClick={() => save(parts.map((p, i) => ({ categoryId: p.categoryId, amountCents: cents[i]! })))}>{t('splits.save')}</Button>
      </div>
    </div>
  )
}
