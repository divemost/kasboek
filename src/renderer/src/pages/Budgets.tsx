import { ArrowDown, ArrowUp, Copy, ListChecks, Tags, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { parseAmount } from '@shared/amount'
import { centsToInput } from '@shared/format'
import { monthOf } from '@shared/month'
import { MAX_CONTEXT_ROWS } from '@shared/page-context'
import type { BudgetRow, RuleField, RuleMatch, RulePreview } from '@shared/types'
import { Meter } from '../components/charts'
import { PromptModal } from '../components/PromptModal'
import { Badge, Button, Card, Field, Input, Modal, MonthNav, PageHeader, Select, cx } from '../components/ui'
import { useToast } from '../components/Toast'
import { call, useOp } from '../lib/api'
import { Iban, Masked, useMasked } from '../lib/hide-numbers'
import { usePublishPageContext } from '../lib/page-context'
import { monthLabel } from '../lib/format'
import { useSettings } from '../lib/settings'
import { errText } from './auth/parts'
import { CategorySelect } from './Transactions'

const toDate = (m: string): Date => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1)

/** How long the category a tip pointed to stays highlighted. */
const HIGHLIGHT_MS = 2500

export function Budgets({ initial }: { initial?: { month?: string; categoryId?: number | 'none' } }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { fmt, money } = useSettings()
  const [month, setMonth] = useState(initial?.month ?? monthOf())
  const [rows, setRows] = useState<BudgetRow[] | null>(null)
  const [modal, setModal] = useState<null | 'categories' | 'rules'>(null)
  const load = (): void => void call('budgets.list', { month }).then(setRows)
  useEffect(load, [month])

  // The category a tip pointed to is scrolled into view once the rows are there, and marked for a moment.
  const [marked, setMarked] = useState<number | null>(typeof initial?.categoryId === 'number' ? initial.categoryId : null)
  const markedRow = useRef<HTMLTableRowElement | null>(null)
  const found = rows?.some((r) => r.categoryId === marked) ?? false
  useEffect(() => {
    if (marked === null || !found) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    markedRow.current?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
    const timer = setTimeout(() => setMarked(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [marked, found])

  usePublishPageContext({
    page: 'budgets',
    filters: { month },
    selectedIds: [],
    openId: null,
    rows: (rows ?? []).slice(0, MAX_CONTEXT_ROWS).map((r) => ({ categoryId: r.categoryId, category: r.name, budgetCents: r.budgetCents, spentCents: r.spentCents }))
  })
  const budgeted = (rows ?? []).filter((r) => r.budgetCents !== null)
  const totalBudget = budgeted.reduce((s, r) => s + (r.budgetCents ?? 0), 0)
  const totalSpent = (rows ?? []).reduce((s, r) => s + r.spentCents, 0)

  return (
    <>
      <PageHeader
        title={t('budgets.title')}
        action={
          <div className="flex items-center gap-2">
            <Button icon={<Tags size={14} />} onClick={() => setModal('categories')}>{t('budgets.categories')}</Button>
            <Button icon={<ListChecks size={14} />} onClick={() => setModal('rules')}>{t('budgets.rules')}</Button>
            <MonthNav month={month} label={monthLabel(toDate(month), fmt)} onChange={setMonth} />
          </div>
        }
      />
      {rows && budgeted.length === 0 && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-[13px]">
          <span className="text-muted">{t('budgets.emptyHint')}</span>
          <Button size="sm" icon={<Copy size={14} />} onClick={() => void call('budgets.copyPrevious', { month }).then((r) => { toast(t('budgets.copied', { count: r.copied })); load() })}>
            {t('budgets.copyPrevious')}
          </Button>
        </div>
      )}
      <Card>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[12px] text-muted">
              <th className="px-5 py-3 font-medium">{t('budgets.category')}</th>
              <th className="w-40 px-3 py-3 text-right font-medium">{t('budgets.budget')}</th>
              <th className="w-32 px-3 py-3 text-right font-medium">{t('budgets.spent')}</th>
              <th className="w-64 px-5 py-3 font-medium">{t('budgets.remaining')}</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <BudgetLine key={`${month}-${r.categoryId}`} row={r} month={month} money={money} onSaved={setRows} marked={r.categoryId === marked} rowRef={markedRow} />
            ))}
          </tbody>
          {rows && (
            <tfoot>
              <tr className="border-t border-border-strong font-semibold">
                <td className="px-5 py-3">{t('budgets.total')}</td>
                <td className="num px-3 py-3 text-right">{budgeted.length ? money(totalBudget) : '—'}</td>
                <td className="num px-3 py-3 text-right">{money(totalSpent)}</td>
                <td className="px-5 py-3" />
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </Card>
      <p className="mt-3 text-xs text-muted">{t('budgets.hint')}</p>
      <CategoriesModal open={modal === 'categories'} onClose={() => { setModal(null); load() }} />
      <RulesModal open={modal === 'rules'} onClose={() => setModal(null)} />
    </>
  )
}

function BudgetLine({ row, month, money, onSaved, marked, rowRef }: { row: BudgetRow; month: string; money: (c: number) => string; onSaved: (r: BudgetRow[]) => void; marked: boolean; rowRef: RefObject<HTMLTableRowElement | null> }) {
  const { t } = useTranslation()
  const toast = useToast()
  const { fmt } = useSettings()
  const initial = row.budgetCents === null ? '' : centsToInput(row.budgetCents, fmt.formats)
  const [text, setText] = useState(initial)
  const save = (): void => {
    if (text === initial) return
    const cents = text.trim() === '' ? null : parseAmount(text, 'auto', fmt.formats.decimal)
    if (cents !== null && (cents < 0 || Number.isNaN(cents))) return toast(t('budgets.invalid'), 'error')
    if (text.trim() !== '' && cents === null) return toast(t('budgets.invalid'), 'error')
    call('budgets.set', { categoryId: row.categoryId, month, amountCents: cents }).then(onSaved, (e) => toast(errText(e), 'error'))
  }
  const left = row.budgetCents === null ? null : row.budgetCents - row.spentCents
  return (
    <tr ref={marked ? rowRef : undefined} className={cx('border-b border-border transition-colors last:border-b-0', marked && 'bg-accent-soft')}>
      <td className="px-5 py-2.5 font-medium">{row.name}</td>
      <td className="px-3 py-1.5">
        <Input
          aria-label={t('budgets.budgetFor', { name: row.name })}
          className="num h-8 text-right"
          placeholder={t('budgets.notSet')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </td>
      <td className="num px-3 py-2.5 text-right">{money(row.spentCents)}</td>
      <td className="px-5 py-2.5">
        <div className="flex items-center gap-3">
          <Meter value={row.spentCents} max={row.budgetCents} />
          <span className={cx('num w-28 shrink-0 text-right text-[13px]', left !== null && left < 0 ? 'font-medium text-negative' : 'text-muted')}>
            {left === null ? '' : left < 0 ? t('budgets.over', { amount: money(-left) }) : t('budgets.left', { amount: money(left) })}
          </span>
        </div>
      </td>
    </tr>
  )
}

function CategoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const cats = useOp('categories.list')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'expense' | 'income' | 'transfer'>('expense')
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null)
  const act = (p: Promise<unknown>): void => void p.then(() => cats.reload(), (e) => toast(errText(e), 'error'))
  // While a name is typed the list gives way to that dialog, so Escape only closes one of them.
  return (
    <>
    <Modal open={open && !renaming} title={t('budgets.categories')} onClose={onClose}>
      <div className="flex max-h-80 flex-col overflow-y-auto">
        {(cats.data ?? []).map((c) => (
          <div key={c.id} className="flex items-center gap-2 border-b border-border py-2 text-[13px] last:border-b-0">
            <span className={cx('flex-1', c.archived && 'text-muted line-through')}>{c.name}</span>
            <Badge>{t(`categories.kind.${c.kind}`)}</Badge>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(c)}>{t('budgets.renameShort')}</Button>
            <Button size="sm" variant="ghost" onClick={() => act(call('categories.update', { id: c.id, archived: !c.archived }))}>{c.archived ? t('budgets.restore') : t('budgets.archive')}</Button>
          </div>
        ))}
      </div>
      <form className="mt-4 flex gap-2 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); act(call('categories.create', { name, kind }).then(() => setName(''))) }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('budgets.newCategory')} aria-label={t('budgets.newCategory')} />
        <Select className="w-36" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={t('budgets.kind')}>
          {(['expense', 'income', 'transfer'] as const).map((k) => <option key={k} value={k}>{t(`categories.kind.${k}`)}</option>)}
        </Select>
        <Button type="submit" variant="primary" disabled={!name.trim()}>{t('budgets.add')}</Button>
      </form>
    </Modal>
    {renaming && (
      <PromptModal
        title={t('budgets.renameShort')}
        label={t('budgets.rename')}
        initialValue={renaming.name}
        submitLabel={t('budgets.renameShort')}
        onSubmit={(name) => name !== renaming.name && act(call('categories.update', { id: renaming.id, name }))}
        onClose={() => setRenaming(null)}
      />
    )}
    </>
  )
}

function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const rules = useOp('rules.list')
  const cats = useOp('categories.list')
  const [pattern, setPattern] = useState('')
  const [field, setField] = useState<RuleField>('counterparty')
  const [match, setMatch] = useState<RuleMatch>('contains')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [reach, setReach] = useState<RulePreview | null>(null)
  const examples = useMasked(reach?.examples.join(' · ') ?? '')
  const category = categoryId ?? cats.data?.[0]?.id ?? null
  // What the rule would do, shown while typing.
  useEffect(() => {
    if (pattern.trim().length < 2) return setReach(null)
    const timer = setTimeout(() => void call('rules.preview', { field, pattern, match, categoryId: category }).then(setReach, () => setReach(null)), 250)
    return () => clearTimeout(timer)
  }, [pattern, field, match, category])
  const list = rules.data ?? []
  const move = (i: number, by: -1 | 1): void => {
    const ids = list.map((r) => r.id)
    const j = i + by
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    void call('rules.reorder', { ids }).then(() => rules.reload(), (err) => toast(errText(err), 'error'))
  }
  return (
    <Modal open={open} title={t('budgets.rules')} onClose={onClose}>
      <p className="mb-3 text-[13px] text-muted">{t('budgets.rulesHint')}</p>
      <div className="flex max-h-72 flex-col overflow-y-auto">
        {list.length === 0 && <p className="py-2 text-[13px] text-muted">{t('budgets.noRules')}</p>}
        {list.map((r, i) => (
          <div key={r.id} className="flex items-center gap-1 border-b border-border py-1.5 text-[13px] last:border-b-0">
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted">{t(`budgets.field.${r.field}`)} {r.field === 'iban' ? t('budgets.match.is') : t(`budgets.match.${r.match}`)}</span> “{r.field === 'iban' ? <Iban value={r.pattern} /> : <Masked text={r.pattern} />}” → <span className="font-medium">{r.categoryName}</span>
            </span>
            <button type="button" aria-label={t('budgets.moveUp')} disabled={i === 0} className="rounded p-1 text-muted hover:text-text disabled:opacity-30" onClick={() => move(i, -1)}>
              <ArrowUp size={14} />
            </button>
            <button type="button" aria-label={t('budgets.moveDown')} disabled={i === list.length - 1} className="rounded p-1 text-muted hover:text-text disabled:opacity-30" onClick={() => move(i, 1)}>
              <ArrowDown size={14} />
            </button>
            <button type="button" aria-label={t('transactions.delete')} className="rounded p-1 text-muted hover:text-negative" onClick={() => void call('rules.delete', { id: r.id }).then(() => rules.reload())}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      {list.length > 1 && <p className="mt-1 text-xs text-muted">{t('budgets.rulesOrder')}</p>}
      <form
        className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!category) return
          void call('rules.create', { field, pattern, match, categoryId: category, applyToExisting: true }).then(
            (r) => { toast(t('transactions.ruleCreated', { count: r.applied })); setPattern(''); void rules.reload() },
            (err) => toast(errText(err), 'error')
          )
        }}
      >
        <Field label={t('budgets.whenText')}>{(id) => <Input id={id} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={field === 'iban' ? 'BE68 5390 0754 7034' : 'Delhaize'} />}</Field>
        <Field label={t('budgets.appearsIn')}>
          {(id) => <Select id={id} value={field} onChange={(e) => setField(e.target.value as RuleField)}>{(['counterparty', 'description', 'any', 'iban'] as const).map((f) => <option key={f} value={f}>{t(`budgets.field.${f}`)}</option>)}</Select>}
        </Field>
        {field === 'iban' ? (
          <p className="self-end pb-2 text-xs text-muted">{t('budgets.ibanHint')}</p>
        ) : (
          <Field label={t('budgets.howMatch')}>
            {(id) => <Select id={id} value={match} onChange={(e) => setMatch(e.target.value as RuleMatch)}>{(['contains', 'word', 'starts'] as const).map((m) => <option key={m} value={m}>{t(`budgets.matchOption.${m}`)}</option>)}</Select>}
          </Field>
        )}
        <Field label={t('budgets.putIn')}>{() => <CategorySelect label={t('budgets.putIn')} allowNone={false} value={category} categories={cats.data ?? []} onChange={setCategoryId} />}</Field>
        {reach && (
          <p className="col-span-2 text-xs text-muted">
            {t('budgets.reach', { count: reach.matches, uncategorised: reach.uncategorised })}
            {reach.otherCategory > 0 && ` ${t('budgets.reachOther', { count: reach.otherCategory })}`}
            {reach.wholeWord && ` ${t('budgets.reachWord')}`}
            {reach.examples.length > 0 && <span className="block truncate">{examples}</span>}
          </p>
        )}
        <div className="col-span-2 flex justify-end"><Button type="submit" variant="primary" disabled={pattern.trim().length < 2 || !category}>{t('budgets.addRule')}</Button></div>
      </form>
    </Modal>
  )
}
