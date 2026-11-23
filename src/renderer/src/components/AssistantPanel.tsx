import { ArrowUp, Check, ChevronRight, Eye, EyeOff, FileCheck2, RotateCcw, Sparkles, Square, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { THINKING_START_OPEN, hasThinking, showJumpToLatest, stickToBottom, thinkingLabelKey, toggleThinking } from '@shared/thinking-view'
import { REASONING_LEVELS, claudeEfforts, type ReasoningLevel } from '@shared/reasoning'
import { ASSISTANT_MODELS, type AssistantModel, type AssistantStatus, type ChatMessage, type Effort, type Settings } from '@shared/types'
import { presetFor, type ProviderId } from '@shared/ai-providers'
import type { Page } from '../App'
import { shownText } from '@shared/hide-numbers'
import { call } from '../lib/api'
import { useHideNumbers } from '../lib/hide-numbers'
import { usePageContext } from '../lib/page-context'
import { useAssistantEnabled } from '../lib/settings'
import { openSettingsTab } from '../lib/settings-tab'
import { setAiName } from '../i18n'
import { errText } from '../pages/auth/parts'
import { useToast } from './Toast'
import { Badge, Button, cx } from './ui'

/** The assistant's state, or null while it is switched off (assistantEnabled): then nothing asks the main process about it and every caller shows nothing. */
export function useAssistant(): AssistantStatus | null {
  const assistantEnabled = useAssistantEnabled()
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  useEffect(() => {
    if (!assistantEnabled) {
      setStatus(null)
      return
    }
    const apply = (s: AssistantStatus): void => {
      // Texts name the chosen assistant ("Check with Mistral") through {{ai}} and {{aiCompany}}.
      setAiName(s.providerName, s.company)
      setStatus(s)
    }
    void call('assistant.status').then(apply)
    return window.kasboek.onEvent((e) => {
      if (e.type === 'assistant.update') apply(e.status)
    })
  }, [assistantEnabled])
  return assistantEnabled ? status : null
}

/** Minimal formatting: # headings, **bold**, `code`, line breaks and "- " bullets. No HTML is ever injected. */
export function Rich({ text }: { text: string }) {
  const inline = (s: string, key: number): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`') ? <code key={`${key}-${i}`} className="rounded bg-surface-2 px-1 text-[12px]">{part.slice(1, -1)}</code> : part
    )
  const bullet = /^\s*[-•*] /
  return (
    <div className="selectable space-y-1.5">
      {text.split(/\n{2,}/).map((para, i) => {
        // Runs of bullet lines become a list; other lines stay text, headings bold.
        const blocks: { list: boolean; lines: string[] }[] = []
        for (const l of para.split('\n')) {
          const list = bullet.test(l)
          const last = blocks.at(-1)
          if (last && last.list === list) last.lines.push(l)
          else blocks.push({ list, lines: [l] })
        }
        return (
          <div key={i} className="space-y-1">
            {blocks.map((b, j) =>
              b.list ? (
                <ul key={j} className="list-disc space-y-0.5 pl-4">{b.lines.map((l, k) => <li key={k}>{inline(l.replace(bullet, ''), k)}</li>)}</ul>
              ) : (
                <p key={j}>{b.lines.flatMap((l, k) => {
                  const h = /^#{1,6} /.test(l)
                  const parts = h ? [<strong key={`h${k}`}>{l.replace(/^#{1,6} /, '')}</strong>] : inline(l, k)
                  return k ? [<br key={`br${k}`} />, ...parts] : parts
                })}</p>
              )
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The chat's model (and, for Claude, its effort), right under the message box. The same settings
 * as Settings → Assistant → Chat; the CSV check keeps its own.
 */
function ModelPicker({ provider, disabled, unsupported }: { provider: ProviderId; disabled: boolean; unsupported?: boolean }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [s, setS] = useState<Settings | null>(null)
  const [models, setModels] = useState<string[]>([])
  useEffect(() => {
    const load = (): void => void call('settings.get').then(setS, () => undefined)
    load()
    return window.kasboek.onEvent((e) => e.type === 'data.changed' && load())
  }, [])
  // Other providers: the models they offer (quietly skipped when the list can't be loaded).
  useEffect(() => {
    if (provider === 'anthropic') return
    void call('assistant.models', {}).then(setModels, () => setModels([]))
  }, [provider])
  if (!s) return null
  const configure = (patch: Parameters<typeof call<'assistant.configure'>>[1]): void =>
    void call('assistant.configure', patch).then(setS, (e) => toast(errText(e), 'error'))
  const small = 'h-7 rounded-md border-0 bg-transparent px-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50'
  if (provider === 'anthropic')
    return (
      <div className="mt-1.5 flex min-w-0 items-center gap-1">
        <select className={cx(small, 'min-w-0 flex-1 truncate')} disabled={disabled} aria-label={t('assistant.model')} value={s.chatModel} onChange={(e) => configure({ chatModel: e.target.value as AssistantModel })}>
          {ASSISTANT_MODELS.map((m) => <option key={m} value={m}>{t(`claude.model.${m}`)}</option>)}
        </select>
        <select className={cx(small, 'shrink-0')} disabled={disabled} aria-label={t('claude.effortLabel')} value={s.chatEffort} onChange={(e) => configure({ chatEffort: e.target.value as Effort })}>
          {claudeEfforts(s.chatModel).map((x) => <option key={x} value={x}>{x === 'off' ? t('claude.effort.off') : t('assistant.effortOption', { level: t(`claude.effort.${x}`) })}</option>)}
        </select>
      </div>
    )
  const options = [...new Set([s.aiChatModel, ...models, ...presetFor(provider).suggestedModels].filter(Boolean))]
  if (!options.length) return null
  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-1">
      <select className={cx(small, 'min-w-0 max-w-full truncate')} disabled={disabled} aria-label={t('assistant.model')} value={s.aiChatModel} onChange={(e) => configure({ aiChatModel: e.target.value })}>
        {options.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <select
        className={cx(small, 'shrink-0', unsupported && 'line-through')}
        disabled={disabled}
        aria-label={t('assistant.reasoningLabel')}
        title={unsupported ? t('assistant.reasoningUnsupported') : t('assistant.reasoningHint')}
        value={s.aiReasoning}
        onChange={(e) => configure({ aiReasoning: e.target.value as ReasoningLevel })}
      >
        {REASONING_LEVELS.map((x) => <option key={x} value={x}>{t('assistant.reasoningOption', { level: t(`assistant.reasoning.${x}`) })}</option>)}
      </select>
    </div>
  )
}

/**
 * The model's reasoning: collapsed until the person opens it. Open, it is a bounded box in the
 * message flow that follows the newest text (until they scroll up to read).
 */
function Thinking({ text, live }: { text: string; live: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(THINKING_START_OPEN)
  const [behind, setBehind] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const id = useId()
  const body = text.trim()
  const toBottom = (): void => {
    const el = box.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    stuck.current = true
    setBehind(false)
  }
  useEffect(() => {
    if (open && stuck.current) toBottom()
  }, [body, open])
  const onScroll = (): void => {
    const el = box.current
    if (!el) return
    stuck.current = stickToBottom(el)
    setBehind(showJumpToLatest(el))
  }
  return (
    <div className="mb-2 rounded-lg border border-border bg-surface/60">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => { stuck.current = true; setBehind(false); setOpen(toggleThinking(open)) }} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <ChevronRight size={13} className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
        <span>{t(thinkingLabelKey(live))}</span>
        {live && <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
      </button>
      {open && (
        <div className="relative">
          <div ref={box} id={id} onScroll={onScroll} className="selectable max-h-[40vh] overflow-y-auto px-3 pb-2 text-xs whitespace-pre-wrap text-muted">{body}</div>
          {behind && (
            <button type="button" onClick={toBottom} className="absolute right-2 bottom-2 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted shadow-sm hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {t('assistant.thinkingJump')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Bubble({ m }: { m: ChatMessage }) {
  const { t } = useTranslation()
  const toast = useToast()
  // The messages on screen hide account numbers like the pages do; the assistant's own text is already masked on its way here.
  const hidden = useHideNumbers()
  const masked = (text: string): string => shownText(text, hidden)
  if (m.role === 'user') return <div className="selectable ml-8 self-end rounded-2xl rounded-br-md bg-surface-2 px-3.5 py-2 text-[13px] whitespace-pre-wrap">{masked(m.text)}</div>
  // Made without asking, as the person's permissions allow.
  if (m.role === 'confirm' && m.state === 'auto')
    return (
      <p className="flex items-start gap-1.5 rounded-lg bg-surface-2/60 px-2.5 py-1.5 text-xs text-muted">
        {m.failed ? <X size={13} className="mt-0.5 shrink-0 text-negative" /> : <Check size={13} className="mt-0.5 shrink-0 text-accent" />}
        <span>
          <span className="font-medium text-text">{m.failed ? t('assistant.autoFailed') : t('assistant.autoDone')}</span> {masked(m.summary)}
        </span>
      </p>
    )
  if (m.role === 'confirm')
    return (
      <div className="rounded-xl border border-border bg-surface p-3 text-[13px]">
        <p className="mb-1 text-xs font-medium text-muted">{t('assistant.wantsTo')}</p>
        <p className="font-medium">{masked(m.summary)}</p>
        {m.state === 'pending' ? (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => void call('assistant.confirm', { id: m.id, approve: true }).catch((e) => toast(errText(e), 'error'))}>{t('assistant.approve')}</Button>
            <Button size="sm" icon={<X size={14} />} onClick={() => void call('assistant.confirm', { id: m.id, approve: false })}>{t('assistant.decline')}</Button>
          </div>
        ) : (
          <div className="mt-2"><Badge tone={m.state === 'approved' ? 'accent' : 'neutral'}>{m.state === 'approved' ? t('assistant.approved') : t('assistant.declined')}</Badge></div>
        )}
      </div>
    )
  const check = m.check
  return (
    <div className="text-[13px] leading-relaxed">
      {check && (
        <p className={cx('mb-1 flex items-center gap-1.5 text-xs text-muted', !check.done && 'animate-pulse')}>
          <FileCheck2 size={13} />
          {!check.done
            ? check.groupsTotal
              ? t('assistant.checkRunningGroups', { file: check.fileName, done: check.groupsDone, total: check.groupsTotal })
              : t('assistant.checkRunning', { file: check.fileName })
            : m.error
              ? t('assistant.checkFailed', { file: check.fileName })
              : t('assistant.checkDone', { file: check.fileName, categorised: check.categorised ?? 0, renamed: check.renamed ?? 0, rules: check.rules ?? 0, existing: check.existing ?? 0 })}
        </p>
      )}
      {hasThinking(m.thinking) && <Thinking text={m.thinking} live={!m.text && !m.error && (!check || !check.done)} />}
      {m.tools.length > 0 && (
        <p className="mb-1 text-xs text-muted">
          {[...new Set(m.tools.map((x) => t(`assistant.tool.${x.name}`, { defaultValue: x.name.replace(/_/g, ' ') })))].join(' · ')}
        </p>
      )}
      {m.text && <Rich text={masked(m.text)} />}
      {m.error && <p className="mt-1 text-negative">{masked(m.error)}</p>}
    </div>
  )
}

/** The line under the conversation while the assistant is busy, so there is always a sign of life, also while a tool runs. */
function Working({ activity }: { activity: AssistantStatus['activity'] }) {
  const { t } = useTranslation()
  if (activity?.kind === 'approval') return <p className="text-xs text-muted">{t('assistant.waitingApproval')}</p>
  const tool = activity?.kind === 'tool' ? t(`assistant.tool.${activity.tool}`, { defaultValue: activity.tool.replace(/_/g, ' ') }) : null
  return (
    <p role="status" className="animate-pulse text-xs text-muted">
      {tool ? t('assistant.thinkingTool', { tool }) : t('assistant.thinking')}
    </p>
  )
}

export function AssistantPanel({ go, overlay = false }: { go: (p: Page) => void; overlay?: boolean }) {
  const { t } = useTranslation()
  const toast = useToast()
  const status = useAssistant()
  const [text, setText] = useState('')
  const pageContext = usePageContext()
  const [pageShared, setPageShared] = useState(true)
  const [allowed, setAllowed] = useState(true)
  useEffect(() => {
    const load = (): void => void call('settings.get').then((s) => setAllowed(s.pageContextEnabled), () => undefined)
    load()
    return window.kasboek.onEvent((e) => (e.type === 'data.changed' || e.type === 'settings.changed') && load())
  }, [])
  const sharing = allowed && pageContext ? pageContext : null
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [status?.messages])
  const examples = [t('assistant.example1'), t('assistant.example2'), t('assistant.example3')]
  const sendText = (v: string): void => {
    if (!v.trim() || status?.busy) return
    setText('')
    void call('assistant.send', { text: v, ...(sharing && pageShared ? { pageContext: sharing } : {}) }).catch((e) => toast(errText(e), 'error'))
  }

  return (
    <aside className={cx('flex flex-col border-l border-border bg-bg', overlay ? 'absolute inset-y-0 right-0 z-40 w-[min(340px,100%)] shadow-xl' : 'w-[340px] shrink-0')} aria-label={t('assistant.title')}>
      <div className="flex items-center justify-between px-5 pt-3 pb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-accent" />
          <h2 className="text-sm font-semibold">{t('assistant.title')}</h2>
        </div>
        {status?.configured && status.messages.length > 0 && (
          <button type="button" title={t('assistant.newChat')} aria-label={t('assistant.newChat')} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text" onClick={() => void call('assistant.reset')}>
            <RotateCcw size={14} />
          </button>
        )}
      </div>
      {!status ? null : !status.configured ? (
        <div className="flex-1 px-5">
          <p className="text-[13px] text-muted">{t('assistant.setupBody')}</p>
          <Button className="mt-4" variant="primary" onClick={() => { openSettingsTab('assistant'); go('settings') }}>{t('assistant.setupButton')}</Button>
          <p className="mt-4 text-xs text-muted">{t(status?.company === null ? 'assistant.privacyLocal' : 'assistant.privacy')}</p>
        </div>
      ) : (
        <>
          <div ref={scroller} className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4">
            {status.messages.length === 0 ? (
              <>
                <p className="text-[13px] text-muted">{t('assistant.intro')}</p>
                <div className="flex flex-col gap-2">
                  {examples.map((e) => (
                    <button key={e} type="button" onClick={() => sendText(e)} className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-[13px] hover:border-accent">{e}</button>
                  ))}
                </div>
                <p className="text-xs text-muted">{t(status?.company === null ? 'assistant.privacyLocal' : 'assistant.privacy')}</p>
              </>
            ) : (
              status.messages.map((m) => <Bubble key={m.id} m={m} />)
            )}
            {status.busy && <Working activity={status.activity} />}
          </div>
          <form className="p-4" onSubmit={(e) => { e.preventDefault(); sendText(text) }}>
            {sharing && (
              <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
                {pageShared ? <Eye size={13} className="shrink-0" /> : <EyeOff size={13} className="shrink-0" />}
                <span className="min-w-0 flex-1 truncate">
                  {pageShared
                    ? sharing.rows.length
                      ? t('assistant.lookingRows', { page: t(`nav.${sharing.page}`), count: sharing.rows.length })
                      : t('assistant.looking', { page: t(`nav.${sharing.page}`) })
                    : t('assistant.lookingPaused')}
                </span>
                <button type="button" title={pageShared ? t('assistant.lookingOff') : t('assistant.lookingOn')} aria-label={pageShared ? t('assistant.lookingOff') : t('assistant.lookingOn')} aria-pressed={pageShared} onClick={() => setPageShared(!pageShared)} className="rounded p-1 hover:bg-surface-2 hover:text-text">
                  {pageShared ? <X size={12} /> : <Eye size={12} />}
                </button>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-input-border bg-surface px-3 py-2 focus-within:border-accent">
              <textarea
                rows={1}
                data-assistant-input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(text) } }}
                placeholder={t('assistant.placeholder')}
                aria-label={t('assistant.placeholder')}
                className="max-h-32 min-h-7 flex-1 resize-none bg-transparent py-1 text-sm outline-none"
              />
              {status.busy ? (
                <button type="button" aria-label={t('assistant.stop')} onClick={() => void call('assistant.stop')} className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-text"><Square size={12} /></button>
              ) : (
                <button type="submit" aria-label={t('assistant.send')} disabled={!text.trim()} className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg disabled:opacity-40"><ArrowUp size={15} /></button>
              )}
            </div>
            <ModelPicker provider={status.provider} disabled={status.busy} unsupported={status.reasoningUnsupported} />
          </form>
        </>
      )}
    </aside>
  )
}
