import { AlertTriangle, CheckCircle2, Columns3, Sparkles, Square } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ImportCommitResult, ImportPreview, ImportRow } from '@shared/types'
import { Badge, Button, Card, Modal, PageHeader, Switch, cx } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { parseAmount } from '@shared/amount'
import { shownText } from '@shared/hide-numbers'
import { reconciliationBanner } from '@shared/pdf-import'
import { dateExample, datePlaceholder, parseTypedDate } from '@shared/format'
import { call, useOp } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { Masked, useHideNumbers } from '../../lib/hide-numbers'
import { useAssistantEnabled, useSettings } from '../../lib/settings'
import { errText } from '../auth/parts'
import { CategorySelect } from '../Transactions'
import { PromptModal } from '../../components/PromptModal'
import { useAssistant } from '../../components/AssistantPanel'
import { CheckConsentModal, PdfConsentModal } from './ConsentModals'
import { CheckSummaryCard } from './CheckSummaryCard'
import { MappingModal } from './MappingModal'

type Filter = 'all' | ImportRow['status']
export type AssistKind = 'check' | 'pdf'

const clock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const STATUS_TONE: Record<ImportRow['status'], 'accent' | 'warning' | 'negative' | 'neutral'> = { ready: 'accent', duplicate: 'warning', possible_duplicate: 'warning', problem: 'negative', skipped: 'neutral' }

export function PreviewView({
  preview,
  onChange,
  onCancel,
  onCommitted,
  onAssist,
  onAssistPdf,
  onSetup,
  assisting,
  assistKind
}: {
  preview: ImportPreview
  onChange: (p: ImportPreview) => void
  onCancel: () => void
  onCommitted: (r: ImportCommitResult) => void
  /** Starts the check; `needConsent` is called when the person has not agreed yet (then call again with `consent`). */
  onAssist?: (p: ImportPreview, consent: boolean, needConsent: () => void) => void
  onAssistPdf?: (p: ImportPreview) => void
  onSetup: () => void
  assisting: number | null
  assistKind: AssistKind
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const { money, fmt } = useSettings()
  const hideNumbers = useHideNumbers()
  const assistant = useAssistant()
  const assistantEnabled = useAssistantEnabled()
  const categories = useOp('categories.list')
  // Seconds since the check started, so a slow answer visibly isn't stuck.
  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number; parts: number } | null>(null)
  useEffect(
    () =>
      window.kasboek.onEvent((e) => {
        if (e.type === 'import.checkProgress' && e.sessionId === preview.sessionId) setProgress({ done: e.groupsDone, total: e.groupsTotal, parts: e.partsTotal })
      }),
    [preview.sessionId]
  )
  useEffect(() => {
    if (assisting === null) return
    const tick = (): void => setElapsed(Math.floor((Date.now() - assisting) / 1000))
    tick()
    // A check picked up again after switching tabs: its progress so far.
    void call('import.assistStatus', { sessionId: preview.sessionId }).then((st) => st?.running && setProgress({ done: st.groupsDone, total: st.groupsTotal, parts: st.partsTotal }))
    const id = setInterval(tick, 1000)
    return () => {
      clearInterval(id)
      setProgress(null)
    }
  }, [assisting, preview.sessionId])
  const [filter, setFilter] = useState<Filter>(preview.stats.problems ? 'problem' : preview.stats.possibleDuplicates ? 'possible_duplicate' : 'all')
  const [limit, setLimit] = useState(300)
  const pdf = preview.pdf
  // A PDF without a table of transactions has no columns to choose from.
  const noTable = pdf?.tableFound === false
  const [mappingOpen, setMappingOpen] = useState(!preview.mapping && !noTable)
  const [consentOpen, setConsentOpen] = useState(false)
  const [checkConsentOpen, setCheckConsentOpen] = useState(false)
  // While an assistant works the rows are its to change: edits made now would be lost or fight with its answer.
  const locked = assisting !== null
  // The row whose unreadable date or amount is being typed in.
  const [fixing, setFixing] = useState<{ index: number; field: 'date' | 'amount' } | null>(null)
  const [saveProfile, setSaveProfile] = useState(true)
  const [busy, setBusy] = useState(false)
  const s = preview.stats
  const rows = preview.rows.filter((r) => filter === 'all' || r.status === filter)
  // Every row of the file is already in Kasboek: there is nothing to import.
  const allKnown = !!preview.mapping && s.total > 0 && s.ready === 0 && s.duplicates + s.possibleDuplicates + s.skipped === s.total && s.duplicates > 0
  // Rows or categories changed by hand: leaving the review then asks first.
  const [edited, setEdited] = useState(false)
  const [askCancel, setAskCancel] = useState(false)
  const cancel = (): void => (edited ? setAskCancel(true) : onCancel())
  const update = (changes: Parameters<typeof call<'import.updateRows'>>[1]['changes']): void =>
    void call('import.updateRows', { sessionId: preview.sessionId, changes }).then(
      (p) => {
        setEdited(true)
        onChange(p)
      },
      (e) => toast(errText(e), 'error')
    )

  const xml = preview.xml
  // Only a PDF can have its signs wrong; an XML statement states them, so it is a plain mismatch.
  const shown = reconciliationBanner((pdf ?? xml)?.reconciliation ?? null)
  const banner = !pdf && shown.kind === 'maybeFlip' ? ({ kind: 'mismatch', differenceCents: shown.differenceCents } as const) : shown
  const running = pdf?.reconciliation?.runningMismatches ?? 0
  const notes = [
    ...preview.notes,
    ...(pdf?.notes ?? []).map((n) => {
      switch (n.code) {
        case 'other_account':
          return t('import.pdf.note.other_account', { iban: n.iban })
        case 'dates_without_year':
          return t('import.pdf.note.dates_without_year')
        case 'pages_without_text':
          return t('import.pdf.note.pages_without_text', { count: n.count })
        case 'no_table':
          return t('import.pdf.note.no_table', { pages: n.pages, lines: n.lines })
      }
    }),
    ...(xml?.notes ?? []).map((n) => {
      switch (n.code) {
        case 'other_account':
          return t('import.xml.note.other_account', { iban: n.iban })
        case 'accounts_left_out':
          return t('import.xml.note.accounts_left_out', { count: n.count })
        case 'not_booked':
          return t('import.xml.note.not_booked', { count: n.count })
      }
    })
  ]
  // "Flip signs" in the column editor, in one step.
  const flipSigns = (): void => {
    if (preview.mapping) void call('import.remap', { sessionId: preview.sessionId, mapping: { ...preview.mapping, invertSign: !preview.mapping.invertSign } }).then(onChange, (e) => toast(errText(e), 'error'))
  }

  // "Read with the assistant" for a PDF the local reader couldn't read or whose totals don't add up.
  const aiRunning = assisting !== null && assistKind === 'pdf'
  const aiRead: ReactNode = !assistantEnabled ? null : aiRunning ? (
    <>
      <span className="text-xs text-muted">
        {progress && progress.parts > 1 ? t('import.pdf.ai.readingPages', { done: progress.done, total: progress.total }) : t('import.pdf.ai.reading')} <span className="num">{clock(elapsed)}</span>
      </span>
      <Button size="sm" icon={<Square size={12} />} onClick={() => void call('import.assistCancel', { sessionId: preview.sessionId })}>{t('import.stopCheck')}</Button>
    </>
  ) : assisting !== null ? null : onAssistPdf ? (
    <Button size="sm" variant="primary" icon={<Sparkles size={14} />} title={t(assistant?.company === null ? 'import.pdf.ai.hintLocal' : 'import.pdf.ai.hintRemote')} onClick={() => setConsentOpen(true)}>
      {t('import.pdf.ai.button')}
    </Button>
  ) : (
    <span className="text-xs text-muted">
      {t('import.pdf.ai.off')} <button type="button" className="font-medium text-accent hover:underline" onClick={onSetup}>{t('assistant.setupButton')}</button>
    </span>
  )

  const chip = (f: Filter, label: string, n: number, tone?: string): ReactNode => (
    <button type="button" onClick={() => setFilter(f)} className={cx('rounded-full border px-3 py-1 text-[13px] font-medium transition-colors', filter === f ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-surface text-muted hover:text-text', tone)}>
      {label} <span className="num">{n}</span>
    </button>
  )

  return (
    <>
      <PageHeader
        title={t('import.reviewTitle')}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="selectable font-medium text-text">{preview.fileName}</span> → {preview.accountName}
            {preview.layout && <Badge tone="accent">{t('import.layoutRecognised')}</Badge>}
            {pdf && <Badge>PDF</Badge>}
            {xml && <Badge>XML</Badge>}
            {assistantEnabled && pdf?.readBy === 'assistant' && <Badge tone="accent">{t('import.pdf.readBy', { ai: assistant?.providerName ?? 'Claude' })}</Badge>}
            {!noTable && (assistantEnabled || preview.mappingSource !== 'assistant') && <Badge>{t(`import.source.${preview.mappingSource}`)}</Badge>}
          </span>
        }
        action={
          <div className="flex gap-2">
            <Button variant={allKnown ? 'primary' : undefined} onClick={cancel}>{allKnown ? t('import.discard') : t('settings.cancel')}</Button>
            {!allKnown && <Button variant="primary" disabled={!s.ready || busy} onClick={() => { setBusy(true); void call('import.commit', { sessionId: preview.sessionId, saveProfile }).then((r) => { toast(t('import.done', { count: r.imported })); onCommitted(r) }, (e) => toast(errText(e), 'error')).finally(() => setBusy(false)) }}>
              {t('import.commit', { count: s.ready })}
            </Button>}
          </div>
        }
      />

      {allKnown && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-border bg-accent-soft px-4 py-3 text-[13px]">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent" />
          <span className="flex-1">
            <span className="font-medium">{t('import.allKnown', { from: s.fileFrom ? formatDate(s.fileFrom, fmt) : '—', to: s.fileTo ? formatDate(s.fileTo, fmt) : '—' })}</span>
            {onAssist && <span className="block text-muted">{t('import.allKnownHint', { name: assistant?.providerName ?? 'Claude' })}</span>}
          </span>
        </div>
      )}
      {!noTable && <Card className="mb-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          {!allKnown && (
            <>
              <span className="num">{t('import.period')}: <span className="font-medium">{s.from ? `${formatDate(s.from, fmt)} – ${formatDate(s.to!, fmt)}` : '—'}</span></span>
              <span className="num">{t('transactions.in')} <span className="font-medium">{money(s.inCents, preview.currency)}</span></span>
              <span className="num">{t('transactions.out')} <span className="font-medium">{money(s.outCents, preview.currency)}</span></span>
            </>
          )}
          <span className="ml-auto flex items-center gap-2">
            {onAssist ? (
              assisting !== null ? (
                assistKind === 'pdf' ? null : (
                <>
                  <span className="text-xs text-muted" title={t('import.checkSlowHint')}>
                    {progress && progress.parts > 1 ? t('import.checkingGroups', { done: progress.done, total: progress.total }) : t('import.checking')} <span className="num">{clock(elapsed)}</span>
                  </span>
                  <Button size="sm" icon={<Square size={12} />} onClick={() => void call('import.assistCancel', { sessionId: preview.sessionId })}>{t('import.stopCheck')}</Button>
                </>
                )
              ) : (
                <Button size="sm" variant="primary" icon={<Sparkles size={14} />} title={t(assistant?.company === null ? 'import.checkPrivacyLocal' : 'import.checkPrivacy')} onClick={() => onAssist(preview, false, () => setCheckConsentOpen(true))}>
                  {allKnown ? t('import.categoriseExisting', { name: assistant?.providerName ?? 'Claude' }) : t('import.checkWithClaude')}
                </Button>
              )
            ) : (
              assistantEnabled && <span className="text-xs text-muted">{t('import.claudeOff')}</span>
            )}
            <Button size="sm" icon={<Columns3 size={14} />} disabled={locked} onClick={() => setMappingOpen(true)}>{t('import.columns')}</Button>
          </span>
        </div>
        {(banner.kind !== 'none' || running > 0) && (
          <div className="mt-3 space-y-1 border-t border-border pt-3 text-[13px]">
            {banner.kind === 'ok' && <p className="flex items-center gap-2 text-accent"><CheckCircle2 size={14} className="shrink-0" />{t('import.pdf.balanceOk')}</p>}
            {(banner.kind === 'mismatch' || banner.kind === 'maybeFlip') && (
              <p className="flex items-center gap-2 text-warning"><AlertTriangle size={14} className="shrink-0" />{t('import.pdf.balanceMismatch', { amount: money(banner.differenceCents, preview.currency) })}</p>
            )}
            {running > 0 && <p className="flex items-center gap-2 text-warning"><AlertTriangle size={14} className="shrink-0" />{t('import.pdf.runningMismatch', { count: running })}</p>}
            {pdf && (banner.kind === 'mismatch' || banner.kind === 'maybeFlip') && <div className="flex items-center gap-2">{aiRead}</div>}
            {pdf && banner.kind === 'maybeFlip' && preview.mapping && (
              <p className="flex items-center gap-2 text-muted">{t('import.pdf.flipHint')} <Button size="sm" disabled={locked} onClick={flipSigns}>{t('import.pdf.flip')}</Button></p>
            )}
          </div>
        )}
        {assistantEnabled && locked && <p className="mt-3 border-t border-border pt-3 text-xs text-muted">{t('import.lockedWhileAssisting', { ai: assistant?.providerName ?? 'Claude' })}</p>}
        {notes.length > 0 && (
          <ul className="mt-3 list-disc space-y-0.5 border-t border-border pt-3 pl-5 text-[13px] text-muted">
            {notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}
      </Card>}

      {assistantEnabled && preview.check && <CheckSummaryCard preview={preview} onChange={onChange} />}

      {noTable ? (
        <Card className="px-5 py-6 text-[13px] text-muted">
          <p><AlertTriangle size={15} className="mr-2 inline text-warning" />{t('import.pdf.noTable')}{!assistantEnabled && <> {t('import.pdf.askBank')}</>}</p>
          {notes.length > 0 && <ul className="mt-3 list-disc space-y-0.5 pl-5">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant={onAssistPdf ? undefined : 'primary'} onClick={cancel} disabled={aiRunning}>{t('import.pdf.chooseAnother')}</Button>
            {aiRead}
          </div>
        </Card>
      ) : !preview.mapping ? (
        <Card className="px-5 py-6 text-[13px] text-muted"><AlertTriangle size={15} className="mr-2 inline text-warning" />{t('import.noMapping')}</Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {chip('all', t('import.all'), s.total)}
            {chip('ready', t('import.status.ready'), s.ready)}
            {chip('duplicate', t('import.status.duplicate'), s.duplicates)}
            {s.possibleDuplicates > 0 && chip('possible_duplicate', t('import.status.possible_duplicate'), s.possibleDuplicates)}
            {chip('problem', t('import.status.problem'), s.problems)}
            {chip('skipped', t('import.status.skipped'), s.skipped)}
            <label className="ml-auto flex items-center gap-2 text-[13px] text-muted">
              <Switch label={t('import.remember')} checked={saveProfile} onChange={setSaveProfile} /> {t('import.remember')}
            </label>
          </div>
          <Card>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-muted">
                  <th className="w-10 py-3 pl-5" />
                  <th className="w-24 px-2 py-3 font-medium">{t('transactions.date')}</th>
                  <th className="px-2 py-3 font-medium">{t('transactions.description')}</th>
                  <th className="w-36 px-2 py-3 font-medium">{t('transactions.category')}</th>
                  <th className="w-28 px-2 py-3 text-right font-medium">{t('transactions.amount')}</th>
                  <th className="w-28 py-3 pr-5 pl-2 font-medium">{t('import.statusCol')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r) => (
                  <tr key={r.index} className={cx('border-b border-border last:border-b-0', r.status !== 'ready' && 'text-muted')}>
                    <td className="py-2 pl-5">
                      <input
                        type="checkbox"
                        aria-label={t('import.includeRow')}
                        className="accent-[var(--accent)]"
                        disabled={r.status === 'problem' || locked}
                        checked={r.status === 'ready'}
                        onChange={(e) => update([{ index: r.index, decided: e.target.checked ? 'include' : 'skip' }])}
                      />
                    </td>
                    <td className="num px-2 py-2 text-[13px] whitespace-nowrap">
                      {r.bookingDate ? formatDate(r.bookingDate, fmt) : (
                        <button type="button" className="font-medium text-negative underline decoration-dotted" disabled={locked} onClick={() => setFixing({ index: r.index, field: 'date' })}>{t('import.badDate')}</button>
                      )}
                    </td>
                    <td className="max-w-0 px-2 py-2">
                      <p className="truncate"><span className="font-medium text-text"><Masked text={r.counterpartyName || r.description} /></span>{r.counterpartyName && <span className="ml-2 text-[13px] text-muted"><Masked text={r.description} /></span>}</p>
                      {(r.note || r.communication) && <p className="truncate text-xs text-muted"><Masked text={r.note ? `✦ ${r.note}` : (r.communication ?? '')} /></p>}
                      {r.match && r.status === 'possible_duplicate' && (
                        <p className="truncate text-xs text-muted">{t('import.matches', { date: formatDate(r.match.bookingDate, fmt), text: shownText(r.match.counterpartyName || r.match.description || '', hideNumbers) })}</p>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <CategorySelect label={t('transactions.category')} className="h-8 min-w-48 text-[13px]" disabled={locked} value={r.categoryId} categories={categories.data ?? []} onChange={(id) => update([{ index: r.index, categoryId: id }])} />
                    </td>
                    <td className={cx('num px-2 py-2 text-right font-medium whitespace-nowrap', r.status === 'ready' && (r.amountCents ?? 0) > 0 && 'text-accent', r.status === 'ready' && (r.amountCents ?? 0) <= 0 && 'text-text')}>
                      {r.amountCents === null ? (
                        <button type="button" className="text-negative underline decoration-dotted" disabled={locked} onClick={() => setFixing({ index: r.index, field: 'amount' })}>{t('import.badAmount')}</button>
                      ) : money(r.amountCents, preview.currency)}
                    </td>
                    <td className="py-2 pr-5 pl-2" title={r.issues.map((i) => t(`import.issue.${i}`)).join(' · ')}>
                      <Badge tone={STATUS_TONE[r.status]}>{t(`import.status.${r.status}`)}</Badge>
                      {r.issues.length > 0 && <p className="mt-0.5 text-[11px] leading-tight">{r.issues.map((i) => t(`import.issue.${i}`)).join(', ')}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Card>
          {rows.length > limit && <div className="mt-4 flex justify-center"><Button onClick={() => setLimit((l) => l + 500)}>{t('transactions.more')}</Button></div>}
        </>
      )}
      {fixing?.field === 'date' && (
        <PromptModal
          title={t('import.fixDateTitle')}
          label={t('import.fixDate', { format: datePlaceholder(fmt.formats) })}
          submitLabel={t('settings.save')}
          validate={(text) => (parseTypedDate(text, fmt.formats, fmt.language) ? null : t('dateInput.invalid', { format: datePlaceholder(fmt.formats), example: dateExample(fmt.formats, fmt.language) }))}
          onSubmit={(text) => update([{ index: fixing.index, bookingDate: parseTypedDate(text, fmt.formats, fmt.language)! }])}
          onClose={() => setFixing(null)}
        />
      )}
      {fixing?.field === 'amount' && (
        <PromptModal
          title={t('import.fixAmountTitle')}
          label={t('import.fixAmount')}
          submitLabel={t('settings.save')}
          validate={(text) => (parseAmount(text, 'auto', fmt.formats.decimal) ? null : t('budgets.invalid'))}
          onSubmit={(text) => update([{ index: fixing.index, amountCents: parseAmount(text, 'auto', fmt.formats.decimal)! }])}
          onClose={() => setFixing(null)}
        />
      )}
      {assistantEnabled && <CheckConsentModal open={checkConsentOpen} preview={preview} onClose={() => setCheckConsentOpen(false)} onSend={() => { setCheckConsentOpen(false); onAssist?.(preview, true, () => undefined) }} />}
      {assistantEnabled && <PdfConsentModal open={consentOpen} preview={preview} onClose={() => setConsentOpen(false)} onSend={() => { setConsentOpen(false); onAssistPdf?.(preview) }} />}
      <Modal open={askCancel} title={t('modal.discard')} onClose={() => setAskCancel(false)}>
        <div className="flex flex-col gap-4">
          <p className="text-[13px]">{t('modal.discardAsk')}</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAskCancel(false)}>{t('modal.keepEditing')}</Button>
            <Button variant="danger" onClick={onCancel}>{t('modal.discard')}</Button>
          </div>
        </div>
      </Modal>
      {!noTable && <MappingModal key={JSON.stringify(preview.mapping)} open={mappingOpen} preview={preview} onClose={() => setMappingOpen(false)} onApplied={(p) => { onChange(p); setMappingOpen(false) }} />}
    </>
  )
}
