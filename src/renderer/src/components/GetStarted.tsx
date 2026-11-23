import { ArchiveRestore, FileUp, Lock, PenLine } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { startPrivacyKey } from '@shared/get-started'
import type { AccountWithBalance } from '@shared/types'
import type { Page } from '../App'
import { call } from '../lib/api'
import { useAssistant } from './AssistantPanel'
import { useAssistantEnabled, useSettings } from '../lib/settings'
import { errText } from '../pages/auth/parts'
import { CurrencySelect } from './CurrencySelect'
import { Mark } from './Mark'
import { RestoreModal } from './RestoreModal'
import { Button, Card, Field, FormError, Input } from './ui'

/** Moves focus to the assistant's input, also when the panel has to open first (it may load after a moment). Gives up after about 3 seconds. */
function focusAssistant(until = Date.now() + 3000): void {
  const input = document.querySelector<HTMLTextAreaElement>('[data-assistant-input]')
  if (input) input.focus()
  else if (Date.now() < until) setTimeout(() => focusAssistant(until), 50)
}

function SecondaryCard({ icon, title, body, onClick }: { icon: ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 text-left transition-colors hover:bg-surface-2">
      <span className="mt-0.5 text-muted">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{body}</span>
      </span>
    </button>
  )
}

/** The Overview of a Kasboek without any transaction: one clear first step (import), with the other ways in underneath. */
export function GetStarted({ go, accounts }: { go: (p: Page, filter?: Record<string, unknown>) => void; accounts: AccountWithBalance[] }) {
  const { t } = useTranslation()
  const { settings } = useSettings()
  const assistantEnabled = useAssistantEnabled()
  const assistant = useAssistant()
  const titleId = useId()
  const title = useRef<HTMLHeadingElement>(null)
  const accountForm = useRef<HTMLFormElement>(null)
  const importButton = useRef<HTMLButtonElement>(null)
  const [restoring, setRestoring] = useState(false)
  // The account added on this screen: the import card then says so, and "Add by hand" can use it before the list has reloaded.
  const [added, setAdded] = useState<{ id: number; name: string } | null>(null)
  // What the person came for when the account step opened: "Add by hand" continues to a new transaction afterwards.
  const [intent, setIntent] = useState<'import' | 'hand'>('import')
  const [form, setForm] = useState({ name: '', bank: '', currency: settings.currency })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = accounts.filter((a) => !a.archived)
  const account = active[0] ?? added
  useEffect(() => title.current?.focus(), [])
  useEffect(() => {
    if (added && intent === 'import') importButton.current?.focus()
  }, [added]) // eslint-disable-line react-hooks/exhaustive-deps

  const addAccount = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const a = await call('accounts.create', { name: form.name, bank: form.bank, currency: form.currency })
      if (intent === 'hand') go('transactions', { openNew: a.id })
      else setAdded({ id: a.id, name: a.name })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const byHand = (): void => {
    if (account) go('transactions', { openNew: account.id })
    else {
      setIntent('hand')
      accountForm.current?.querySelector('input')?.focus()
    }
  }

  const chooseFile = t('overview.start.importAction')
  return (
    <div className="@container">
      <section aria-labelledby={titleId} className="fade-in mx-auto max-w-xl pt-[12vh]">
        <div className="flex flex-col items-start @[34rem]:items-center">
          <Mark size={28} className="text-text" />
          {/* An empty ledger: three faint lines under the mark. */}
          <div aria-hidden="true" className="mt-3 flex flex-col gap-1.5">
            {[0, 1, 2].map((i) => <div key={i} className="w-[120px] border-t border-border" />)}
          </div>
        </div>
        <h1 id={titleId} ref={title} tabIndex={-1} className="mt-5 text-left font-serif text-2xl font-semibold @[34rem]:font-medium tracking-[-0.01em] outline-none @[34rem]:text-center @[34rem]:text-[30px]">{t('overview.start.title')}</h1>
        <p className="mt-2 text-left text-sm text-muted @[34rem]:text-center">{t('overview.start.subtitle')}</p>

        <div className="mt-8">
          {account ? (
            <div key="import" className="fade-in">
              {added && (
                <p id={`${titleId}-added`} className="mb-2 text-xs text-muted" aria-live="polite">
                  {t('overview.start.importStep')} · ✓ {t('overview.start.accountAdded', { name: added.name })}
                </p>
              )}
              <button
                ref={importButton}
                type="button"
                aria-describedby={added ? `${titleId}-added` : undefined}
                onClick={() => go('import')}
                className="flex w-full items-center gap-4 rounded-xl border border-accent bg-accent-soft px-5 py-5 text-left transition-colors hover:border-accent-hover"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><FileUp size={18} strokeWidth={1.75} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{t('overview.start.importTitle')}</span>
                  <span className="mt-0.5 block text-[13px] text-muted">{t('overview.start.importBody')}</span>
                  <span className="mt-2 block text-[13px] font-semibold text-accent-hover @[34rem]:hidden">{chooseFile}</span>
                </span>
                <span className="hidden shrink-0 text-[13px] font-semibold text-accent-hover @[34rem]:inline">{chooseFile}</span>
              </button>
            </div>
          ) : (
            <Card key="account" className="fade-in px-5 py-5">
              <form ref={accountForm} onSubmit={(e) => { e.preventDefault(); if (form.name.trim() && !busy) void addAccount() }}>
                <h2 className="text-[15px] font-semibold">{t('overview.start.accountStep')}</h2>
                {intent === 'hand' && <p id={`${titleId}-need`} className="mt-1 text-[13px] text-muted">{t('overview.start.needAccount')}</p>}
                <div className="mt-4 flex flex-col gap-3">
                  <Field label={t('overview.start.accountName')}>{(id) => <Input id={id} value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-describedby={intent === 'hand' ? `${titleId}-need` : undefined} aria-invalid={error ? true : undefined} required />}</Field>
                  <div className="grid gap-3 @[34rem]:grid-cols-2">
                    <Field label={t('overview.start.accountBank')}>{(id) => <Input id={id} value={form.bank} maxLength={60} onChange={(e) => setForm({ ...form, bank: e.target.value })} />}</Field>
                    <Field label={t('settings.accountCurrency')}>{(id) => <CurrencySelect id={id} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />}</Field>
                  </div>
                  {error && <FormError>{error}</FormError>}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <button type="button" className="text-xs text-accent hover:underline" onClick={() => go('accounts')}>{t('overview.start.moreDetails', { place: t('nav.accounts') })}</button>
                  <Button type="submit" variant="primary" busy={busy || !form.name.trim()}>{t('overview.start.addAccount')}</Button>
                </div>
              </form>
            </Card>
          )}
        </div>

        <div className="mt-3 grid gap-3 @[34rem]:grid-cols-2">
          <SecondaryCard icon={<PenLine size={16} />} title={t('overview.start.manualTitle')} body={t('overview.start.manualBody')} onClick={byHand} />
          <SecondaryCard icon={<ArchiveRestore size={16} />} title={t('overview.start.restoreTitle')} body={t('overview.start.restoreBody')} onClick={() => setRestoring(true)} />
        </div>

        <p className="mt-6 flex items-center gap-2 text-xs text-muted @[34rem]:justify-center">
          <Lock size={13} aria-hidden="true" className="shrink-0" />
          {t(startPrivacyKey(assistantEnabled, assistant), { ai: assistant?.providerName ?? '', aiCompany: assistant?.company ?? '' })}
        </p>
        {assistantEnabled && (
          <p className="mt-2 text-xs @[34rem]:text-center">
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => {
                window.dispatchEvent(new Event('kasboek:open-assistant'))
                focusAssistant()
              }}
            >
              {t('overview.start.askAssistant')}
            </button>
          </p>
        )}
      </section>
      <RestoreModal open={restoring} onClose={() => setRestoring(false)} />
    </div>
  )
}
