import { Copy, KeyRound, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ASSISTANT_MODELS, type AssistantModel, type Effort } from '@shared/types'
import { REASONING_LEVELS, claudeEfforts, type ReasoningLevel } from '@shared/reasoning'
import { BULK_LIMIT, PERMISSION_KINDS, PERMISSION_MODES, presetRules, type PermissionMode, type PermissionRule, type PermissionSettings } from '@shared/permissions'
import { PROVIDER_IDS, PROVIDERS, isCustomId, presetFor, type ProviderId } from '@shared/ai-providers'
import { customProviders, providerGap, resolveProvider } from '@shared/ai-provider-store'
import { useAssistant } from '../components/AssistantPanel'
import { DesktopRunningWarning, SeenLine, useClaudeClients, useDesktopOverwritten, useDesktopRunning } from '../components/ClaudeApps'
import { ModelPicker } from '../components/ModelPicker'
import { Badge, Button, Card, CardHeader, Field, FormError, Input, Modal, PasswordInput, Select, Switch } from '../components/ui'
import { useToast } from '../components/Toast'
import { call, useOp } from '../lib/api'
import { useSettings } from '../lib/settings'
import { errText } from './auth/parts'
import { Row } from './settings-sections/Row'

/** A model list that was loaded for a provider is shown again, without asking, when the person comes back to it within this time. */
const MODELS_KEPT_MS = 60_000

const isAssistantModel = (m: string): m is AssistantModel => (ASSISTANT_MODELS as readonly string[]).includes(m)

export function ClaudeSection() {
  const { t } = useTranslation()
  const toast = useToast()
  const status = useAssistant()
  const settings = useOp('settings.get')
  const [keyOpen, setKeyOpen] = useState(false)
  const [key, setKey] = useState('')
  const [keyError, setKeyError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsStatus, setModelsStatus] = useState<{ count: number } | { error: string } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const closeKey = (): void => {
    setKeyOpen(false)
    setKeyError(null)
  }
  // Changed elsewhere (e.g. "Stop Claude connection" in the tray menu).
  useEffect(() => window.kasboek.onEvent((e) => e.type === 'settings.changed' && void settings.reload()), [settings.reload]) // eslint-disable-line react-hooks/exhaustive-deps
  const s = settings.data
  const preset = s ? presetFor(s.aiProvider, s.aiProviders[s.aiProvider]?.name) : PROVIDERS.anthropic
  const native = preset.id === 'anthropic'
  const custom = isCustomId(preset.id)
  // What this provider still lacks (the key is known to the panel's status, which updates as soon as anything is saved).
  const gap = s && !native ? providerGap(resolveProvider(s), status?.provider === preset.id && status.keyHint ? status.keyHint : null) : null
  const configure = (patch: Parameters<typeof call<'assistant.configure'>>[1]): void => void call('assistant.configure', patch).then(() => settings.reload(), (e) => toast(errText(e), 'error'))
  const modelSelect = (value: AssistantModel, onChange: (m: AssistantModel) => void, label: string) => (
    <Select className="w-52" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as AssistantModel)}>
      {ASSISTANT_MODELS.map((m) => <option key={m} value={m}>{t(`claude.model.${m}`)}</option>)}
    </Select>
  )
  // The levels this model has: "off" only where the model can stop thinking.
  const effortSelect = (model: AssistantModel, value: Effort, onChange: (e: Effort) => void, label: string) => (
    <Select className="w-40" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Effort)}>
      {claudeEfforts(model).map((x) => <option key={x} value={x}>{t(`claude.effort.${x}`)}</option>)}
    </Select>
  )
  const reasoningSelect = (value: ReasoningLevel, onChange: (r: ReasoningLevel) => void, label: string) => (
    <Select className="w-40" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as ReasoningLevel)}>
      {REASONING_LEVELS.map((x) => <option key={x} value={x}>{t(`assistant.reasoning.${x}`)}</option>)}
    </Select>
  )
  // The list belongs to a provider (and its address): a list that arrives after switching is not shown.
  const modelsKey = `${preset.id}|${s?.aiBaseUrl ?? ''}`
  const modelsKeyRef = useRef(modelsKey)
  modelsKeyRef.current = modelsKey
  const modelRequest = useRef(0)
  const keptModels = useRef(new Map<string, { list: string[]; at: number }>())
  useEffect(() => {
    modelRequest.current++
    setLoadingModels(false)
    const kept = keptModels.current.get(modelsKey)
    const fresh = kept && Date.now() - kept.at < MODELS_KEPT_MS
    setModels(fresh ? kept.list : [])
    setModelsStatus(fresh ? { count: kept.list.length } : null)
  }, [modelsKey])
  // Reload always asks the provider.
  const loadModels = (): void => {
    const asked = ++modelRequest.current
    const key = modelsKeyRef.current
    setLoadingModels(true)
    void call('assistant.models', {})
      .then((list) => {
        if (asked !== modelRequest.current) return
        keptModels.current.set(key, { list, at: Date.now() })
        setModels(list)
        setModelsStatus({ count: list.length })
      })
      .catch((e) => asked === modelRequest.current && setModelsStatus({ error: errText(e) }))
      .finally(() => asked === modelRequest.current && setLoadingModels(false))
  }
  const warn = (g: 'key' | 'url' | 'model') => gap === g && <p className="mt-1 text-warning">{t(`ai.gap.${g}`, { name: preset.name })}</p>
  // The state of the model list, in the words of this provider.
  const modelsLine = (noList: boolean) =>
    modelsStatus && 'error' in modelsStatus ? <span className="text-warning">{modelsStatus.error}</span>
      : noList ? t('ai.noModelList')
      : modelsStatus ? t('ai.modelsLoaded', { count: modelsStatus.count })
      : models.length ? null
      : t('ai.reloadHint')
  // Claude's models are known without asking; the others' list is loaded from the provider.
  const modelInput = (value: string, field: 'aiChatModel' | 'aiCsvModel' | 'aiPdfModel', label: string, placeholder?: string, emptyLabel?: string) => (
    <ModelPicker key={`${preset.id}-${field}`} value={value} loaded={native ? ASSISTANT_MODELS : models} suggested={preset.suggestedModels} label={label} placeholder={placeholder} emptyLabel={emptyLabel} loading={loadingModels} status={native ? undefined : modelsLine(models.length === 0 && preset.suggestedModels.length === 0 && !(modelsStatus && 'error' in modelsStatus))} onChange={(v) => configure({ [field]: v })} onReload={loadModels} />
  )
  // Reading PDF statements has a model of its own: the one chosen, else the default of the provider.
  const pdfModel = s ? resolveProvider(s).pdfModel : ''
  const pdfRow = s && (
    <Row label={t('ai.pdfTitle')} hint={<>{t('ai.pdfDesc')}{!pdfModel && warn('model')}</>}>
      {modelInput(s.aiPdfModel, 'aiPdfModel', t('ai.pdfTitle'), undefined, t('ai.defaultModel', { model: pdfModel ? (isAssistantModel(pdfModel) ? t(`claude.model.${pdfModel}`) : pdfModel) : '' }))}
    </Row>
  )

  return (
    <Card>
      <CardHeader title={t('ai.title')} description={t('ai.hint')} />
      {s && (
        <Row label={t('ai.provider')} hint={preset.company ? t('ai.providerCloud', { company: preset.company }) : t('ai.providerLocal')}>
          <Select
            className="w-64!"
            aria-label={t('ai.provider')}
            value={s.aiProvider}
            onChange={(e) => {
              if (e.target.value === ADD_PROVIDER) return setAddOpen(true)
              configure({ aiProvider: e.target.value as ProviderId })
            }}
          >
            {PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDERS[id].name}{PROVIDERS[id].company ? '' : ` · ${t('ai.local')}`}</option>)}
            {customProviders(s).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value={ADD_PROVIDER}>{t('ai.addProvider')}</option>
          </Select>
        </Row>
      )}
      {s && custom && (
        <Row label={t('ai.providerName')} hint={t('ai.providerNameHint')}>
          <TextSetting key={`${preset.id}-name`} className="w-64!" label={t('ai.providerName')} value={s.aiProviders[preset.id]?.name ?? preset.name} onSave={(name) => name && void call('assistant.renameProvider', { id: preset.id, name }).then(() => settings.reload(), (e) => toast(errText(e), 'error'))} />
          <Button size="sm" variant="ghost" aria-label={t('ai.removeProvider')} icon={<Trash2 size={14} />} onClick={() => setRemoveOpen(true)} />
        </Row>
      )}
      {s && preset.editableUrl && (
        <Row label={t('ai.baseUrl')} hint={<>{custom ? t('ai.baseUrlCustomHint') : t('ai.baseUrlLocalHint', { url: preset.baseUrl })}{warn('url')}</>}>
          <TextSetting key={`${preset.id}-url`} className="w-72!" label={t('ai.baseUrl')} value={s.aiBaseUrl ?? ''} placeholder={preset.baseUrl || 'https://…/v1'} onSave={(v) => configure({ aiBaseUrl: v || null })} />
        </Row>
      )}
      {(preset.needsKey || custom) && (
        <Row label={t('claude.apiKey')} hint={<>{native ? t('claude.apiKeyHint') : preset.needsKey ? t('ai.keyHint', { name: preset.name }) : t('ai.keyOptional')}{!native && warn('key')}</>}>
          <Badge tone={status?.keyHint ? 'accent' : 'neutral'}>{status?.keyHint ? t('claude.keySet', { hint: status.keyHint }) : t('claude.keyNotSet')}</Badge>
          <Button size="sm" icon={<KeyRound size={14} />} onClick={() => setKeyOpen(true)}>{status?.keyHint ? t('claude.replaceKey') : t('claude.addKey')}</Button>
          {status?.keyHint && <Button size="sm" variant="ghost" aria-label={t('claude.removeKey')} icon={<Trash2 size={14} />} onClick={() => void call('assistant.clearKey')} />}
        </Row>
      )}
      {s && native && (
        <>
          <Row label={t('claude.chat')} hint={t('claude.chatHint')}>
            {modelSelect(s.chatModel, (chatModel) => configure({ chatModel }), t('claude.chat'))}
          </Row>
          <Row label={<Sub>{t('claude.effortLabel')}</Sub>}>
            {effortSelect(s.chatModel, s.chatEffort, (chatEffort) => configure({ chatEffort }), t('claude.effortLabel'))}
          </Row>
          <Row label={t('claude.csv')} hint={t('claude.csvHint')}>
            {modelSelect(s.csvModel, (csvModel) => configure({ csvModel }), t('claude.csv'))}
          </Row>
          <Row label={<Sub>{t('claude.effortLabel')}</Sub>}>
            {effortSelect(s.csvModel, s.csvEffort, (csvEffort) => configure({ csvEffort }), t('claude.effortLabel'))}
          </Row>
          {pdfRow}
          <div className="border-b border-border px-5 py-4 text-xs text-muted">{t('claude.privacy')}</div>
        </>
      )}
      {s && !native && (
        <>
          <Row label={t('ai.chatTitle')} hint={<>{t('ai.chatDesc')}{warn('model')}</>}>
            {modelInput(s.aiChatModel, 'aiChatModel', t('ai.chatTitle'), preset.suggestedModels[0])}
          </Row>
          <Row label={<Sub>{t('assistant.reasoningLabel')}</Sub>} hint={t('assistant.reasoningHint')}>
            {reasoningSelect(s.aiReasoning, (aiReasoning) => configure({ aiReasoning }), t('assistant.reasoningLabel'))}
          </Row>
          <Row label={t('ai.fileTitle')} hint={t('ai.fileDesc')}>
            {modelInput(s.aiCsvModel, 'aiCsvModel', t('ai.fileTitle'), undefined, t('ai.sameAsChat', { model: s.aiChatModel || preset.suggestedModels[0] || '' }))}
          </Row>
          <Row label={<Sub>{t('assistant.reasoningLabel')}</Sub>} hint={t('assistant.reasoningHint')}>
            {reasoningSelect(s.aiCsvReasoning, (aiCsvReasoning) => configure({ aiCsvReasoning }), t('assistant.reasoningLabel'))}
          </Row>
          {pdfRow}
          <div className="border-b border-border px-5 py-4 text-xs text-muted">{t('ai.note')}</div>
        </>
      )}
      {s && (
        <Row label={t('assistant.pageContext')} hint={t('assistant.pageContextHint')}>
          <Switch label={t('assistant.pageContext')} checked={s.pageContextEnabled} onChange={(pageContextEnabled) => configure({ pageContextEnabled })} />
        </Row>
      )}

      <AddProviderModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false)
          void settings.reload()
        }}
      />
      <Modal open={removeOpen} title={t('ai.removeTitle', { name: preset.name })} onClose={() => setRemoveOpen(false)}>
        <p className="text-[13px] text-muted">{t('ai.removeConfirm')}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setRemoveOpen(false)}>{t('settings.cancel')}</Button>
          <Button
            variant="danger"
            onClick={() => {
              setRemoveOpen(false)
              void call('assistant.removeProvider', { id: preset.id }).then(() => settings.reload(), (e) => toast(errText(e), 'error'))
            }}
          >
            {t('ai.removeButton')}
          </Button>
        </div>
      </Modal>
      <Modal open={keyOpen} title={t('ai.addKeyFor', { name: preset.name })} onClose={closeKey}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            setBusy(true)
            setKeyError(null)
            void call('assistant.setKey', { apiKey: key, provider: preset.id })
              .then(() => {
                toast(t('claude.keySaved'))
                setKey('')
                closeKey()
              })
              .catch((err) => setKeyError(errText(err)))
              .finally(() => setBusy(false))
          }}
        >
          <p className="text-[13px] text-muted">{native ? t('claude.keyHelp') : t('ai.keyHelp', { name: preset.name })}</p>
          <Field label={t('claude.apiKey')}>{(id) => <PasswordInput id={id} autoFocus value={key} onChange={(e) => setKey(e.target.value)} placeholder={preset.keyPlaceholder ?? ''} />}</Field>
          {keyError && <FormError>{keyError}</FormError>}
          <div className="flex justify-between gap-2">
            {preset.keyUrl ? <a className="self-center text-[13px] font-medium text-accent hover:underline" href={preset.keyUrl} target="_blank" rel="noreferrer">{t('ai.getKey', { name: preset.name })}</a> : <span />}
            <div className="flex gap-2">
              <Button onClick={closeKey}>{t('settings.cancel')}</Button>
              <Button type="submit" variant="primary" busy={busy} disabled={!key.trim()}>{busy ? t('claude.checking') : t('settings.save')}</Button>
            </div>
          </div>
        </form>
      </Modal>
    </Card>
  )
}

/** The switch for the whole assistant, at the top of the tab. Off: nothing else of the assistant is shown or can run (see assistantEnabled). */
export function AssistantSwitchSection() {
  const { t } = useTranslation()
  const toast = useToast()
  const { settings, update } = useSettings()
  return (
    <Card>
      <Row label={t('assistant.enabled')} hint={t('assistant.enabledHint')}>
        <Switch label={t('assistant.enabled')} checked={settings.assistantEnabled} onChange={(assistantEnabled) => void update({ assistantEnabled }).catch((e) => toast(errText(e), 'error'))} />
      </Row>
    </Card>
  )
}

/** Claude Desktop and Claude Code connected over MCP: a separate integration with its own switch, which stays as it is when the assistant is off. */
export function ConnectedAppsSection() {
  const { t } = useTranslation()
  const toast = useToast()
  const settings = useOp('settings.get')
  useEffect(() => window.kasboek.onEvent((e) => e.type === 'settings.changed' && void settings.reload()), [settings.reload]) // eslint-disable-line react-hooks/exhaustive-deps
  const s = settings.data
  if (!s) return null
  return (
    <Card>
      <CardHeader title={t('mcp.sectionTitle')} description={t('mcp.separateNote')} />
      <McpRows enabled={s.mcpEnabled} onChange={(mcpEnabled) => void call('assistant.configure', { mcpEnabled }).then(() => settings.reload(), (e) => toast(errText(e), 'error'))} />
    </Card>
  )
}

const ADD_PROVIDER = '__add__'

/** The label of a setting that belongs to the row above it (the reasoning of a model), set in a little. */
const Sub = ({ children }: { children: ReactNode }) => <span className="pl-4 font-normal text-muted">{children}</span>

/** A new OpenAI-compatible provider: name, address, key (optional for a local server) and models. */
function AddProviderModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [form, setForm] = useState({ name: '', baseUrl: '', apiKey: '', chatModel: '', csvModel: '' })
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<typeof form>): void => setForm((f) => ({ ...f, ...patch }))
  useEffect(() => {
    if (open) setForm({ name: '', baseUrl: '', apiKey: '', chatModel: '', csvModel: '' })
  }, [open])
  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await call('assistant.addProvider', { name: form.name, baseUrl: form.baseUrl, chatModel: form.chatModel, csvModel: form.csvModel })
      onAdded()
      // The provider exists now; a key that fails its check can be fixed in the settings that follow.
      if (form.apiKey.trim()) await call('assistant.setKey', { apiKey: form.apiKey.trim(), provider: next.aiProvider })
    } catch (err) {
      toast(errText(err), 'error')
    } finally {
      setBusy(false)
    }
  }
  const ready = form.name.trim() && form.baseUrl.trim() && form.chatModel.trim()
  return (
    <Modal open={open} title={t('ai.addProviderTitle')} onClose={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <p className="text-[13px] text-muted">{t('ai.addProviderHint')}</p>
        <Field label={t('ai.providerName')}>{(id) => <Input id={id} autoFocus value={form.name} maxLength={60} placeholder={t('ai.providerNamePlaceholder')} onChange={(e) => set({ name: e.target.value })} />}</Field>
        <Field label={t('ai.baseUrl')} hint={t('ai.baseUrlCustomHint')}>{(id) => <Input id={id} value={form.baseUrl} spellCheck={false} placeholder="https://…/v1" onChange={(e) => set({ baseUrl: e.target.value })} />}</Field>
        <Field label={t('claude.apiKey')} hint={t('ai.keyLocalOptional')}>{(id) => <PasswordInput id={id} value={form.apiKey} autoComplete="off" onChange={(e) => set({ apiKey: e.target.value })} />}</Field>
        <Field label={t('claude.chat')} hint={t('ai.chatModelHint')}>{(id) => <Input id={id} value={form.chatModel} spellCheck={false} onChange={(e) => set({ chatModel: e.target.value })} />}</Field>
        <Field label={t('claude.csv')} hint={t('ai.csvModelHint')}>{(id) => <Input id={id} value={form.csvModel} spellCheck={false} onChange={(e) => set({ csvModel: e.target.value })} />}</Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('settings.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!ready || busy}>{busy ? t('claude.checking') : t('ai.addProviderButton')}</Button>
        </div>
      </form>
    </Modal>
  )
}

/** A text field that saves when it loses focus or on Enter. */
function TextSetting({ value, onSave, label, className, placeholder }: { value: string; onSave: (v: string) => void; label: string; className?: string; placeholder?: string }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const save = (): void => {
    if (text.trim() !== value) onSave(text.trim())
  }
  return (
    <Input
      className={className}
      aria-label={label}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), save())}
    />
  )
}

function McpRows({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const status = useOp('mcp.setupStatus')
  const [confirm, setConfirm] = useState<null | 'desktopAdd' | 'desktopRemove'>(null)
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const st = status.data
  const seen = useClaudeClients()
  const desktopOpen = useDesktopRunning(confirm === 'desktopAdd')
  const overwritten = useDesktopOverwritten(st?.desktop?.state, status.reload)
  const entryJson = st ? JSON.stringify({ mcpServers: { kasboek: st.entry } }, null, 2) : ''
  const quote = (p: string): string => (/\s/.test(p) ? `"${p}"` : p)
  const command = st ? `claude mcp add --scope user kasboek -- ${[st.entry.command, ...st.entry.args].map(quote).join(' ')}` : ''
  const copy = (v: string): void => void navigator.clipboard.writeText(v).then(() => toast(t('mcp.copied')), () => toast(t('auth.copyFailed'), 'error'))
  const act = (p: Promise<unknown>, done: string): void => {
    setBusy(true)
    p.then(() => toast(done), (e) => toast(errText(e), 'error')).finally(() => {
      setBusy(false)
      setConfirm(null)
      void status.reload()
    })
  }
  const desktopTone = st?.desktop?.state === 'current' ? 'accent' : st?.desktop?.state === 'outdated' ? 'warning' : 'neutral'
  return (
    <>
      <Row label={t('mcp.title')} hint={t('mcp.hint')}>
        <Switch label={t('mcp.title')} checked={enabled} onChange={onChange} />
      </Row>
      {enabled && st && (
        <>
          {!st.helperFound && <p className="px-5 pt-3 text-xs text-warning">{t('mcp.helperMissing')}</p>}
          {st.bridgeError && <p className="px-5 pt-3 text-xs text-warning">{t('mcp.bridgeError', { error: st.bridgeError })}</p>}
          {overwritten && <div className="px-5 pt-3"><DesktopRunningWarning text={t('mcp.overwritten')} /></div>}
          <Row
            label={t('mcp.desktopLabel')}
            hint={st.desktop ? <span className="flex flex-col gap-0.5"><span className="selectable break-all">{st.desktop.configPath}</span>{(st.desktop.state !== 'absent' || !!seen?.desktop) && <SeenLine at={seen?.desktop ?? seen?.other} />}</span> : t('mcp.desktopUnavailable')}
          >
            {st.desktop && (
              <>
                <Badge tone={desktopTone}>{t(`mcp.state.${st.desktop.state}`)}</Badge>
                {st.desktop.state !== 'current' && <Button size="sm" variant="primary" disabled={busy} onClick={() => setConfirm('desktopAdd')}>{st.desktop.state === 'outdated' ? t('mcp.update') : t('mcp.addDesktop')}</Button>}
                {st.desktop.state !== 'absent' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm('desktopRemove')}>{t('mcp.remove')}</Button>}
              </>
            )}
          </Row>
          <Row
            label={t('mcp.codeLabel')}
            hint={st.code ? <span className="flex flex-col gap-0.5"><span className="selectable break-all">{st.code.path}</span>{(st.code.state !== 'absent' || !!seen?.code) && <SeenLine at={seen?.code} />}</span> : t('mcp.codeNotFound')}
          >
            {st.code && (
              <>
                <Badge tone={st.code.state === 'current' ? 'accent' : st.code.state === 'outdated' ? 'warning' : 'neutral'}>{t(`mcp.state.${st.code.state}`)}</Badge>
                {/* Like Claude Desktop: "Update" only when the entry points at another helper or data folder. */}
                {st.code.state !== 'current' && <Button size="sm" variant="primary" disabled={busy} onClick={() => act(call('mcp.codeAdd'), t('mcp.codeAdded'))}>{st.code.state === 'outdated' ? t('mcp.update') : t('mcp.addCode')}</Button>}
                {st.code.state !== 'absent' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(call('mcp.codeRemove'), t('mcp.removedCode'))}>{t('mcp.remove')}</Button>}
              </>
            )}
          </Row>
          <div className="px-5 py-3 text-[13px]">
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => setManual((v) => !v)}>{manual ? t('mcp.hideManual') : t('mcp.manual')}</button>
            {manual && (
              <div className="mt-3 flex flex-col gap-3">
                <div>
                  <div className="mb-1 flex items-center justify-between"><span className="font-medium">{t('mcp.desktop')}</span><Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => copy(entryJson)}>{t('auth.copy')}</Button></div>
                  <pre className="selectable overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px]">{entryJson}</pre>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between"><span className="font-medium">{t('mcp.code')}</span><Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => copy(command)}>{t('auth.copy')}</Button></div>
                  <pre className="selectable overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px]">{command}</pre>
                </div>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">{t('mcp.note')}</p>
          </div>
          <Modal open={!!confirm} title={confirm === 'desktopRemove' ? t('mcp.removeTitle') : t('mcp.addTitle')} onClose={() => setConfirm(null)}>
            <div className="flex flex-col gap-3 text-[13px]">
              <p className="text-muted">{confirm === 'desktopRemove' ? t('mcp.removeBody') : t('mcp.addBody')}</p>
              <p className="selectable rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12px] break-all">{st.desktop?.configPath}</p>
              {confirm === 'desktopAdd' && <pre className="selectable overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px]">{JSON.stringify({ kasboek: st.entry }, null, 2)}</pre>}
              {desktopOpen && <DesktopRunningWarning />}
              <p className="text-xs text-muted">{t('mcp.backupNote')}</p>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setConfirm(null)}>{t('settings.cancel')}</Button>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => act(call(confirm === 'desktopRemove' ? 'mcp.desktopRemove' : 'mcp.desktopAdd'), confirm === 'desktopRemove' ? t('mcp.removedDesktop') : t('mcp.addedDesktop'))}
                >
                  {confirm === 'desktopRemove' ? t('mcp.remove') : desktopOpen ? t('mcp.addAnyway') : t('mcp.confirmAdd')}
                </Button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </>
  )
}

/** What the assistant may change without asking: a mode, or a choice per kind of change. */
export function PermissionsSection() {
  const { t } = useTranslation()
  const toast = useToast()
  const settings = useOp('settings.get')
  const p = settings.data?.permissions
  if (!p) return null
  const save = (next: PermissionSettings): void => void call('assistant.configure', { permissions: next }).then(() => settings.reload(), (e) => toast(errText(e), 'error'))
  const rules = p.mode === 'custom' ? { ...presetRules('ask'), ...p.rules } : presetRules(p.mode)
  return (
    <Card>
      <CardHeader title={t('permissions.title')} description={t('permissions.hint')} />
      <Row label={t('permissions.mode')} hint={t(`permissions.modeHint.${p.mode}`, { limit: BULK_LIMIT })}>
        <Select
          className="w-64!"
          aria-label={t('permissions.mode')}
          value={p.mode}
          // Switching to "custom" starts from what the current mode allows.
          onChange={(e) => {
            const mode = e.target.value as PermissionMode
            save({ ...p, mode, rules: mode === 'custom' ? rules : p.rules })
          }}
        >
          {PERMISSION_MODES.map((m) => <option key={m} value={m}>{t(`permissions.modes.${m}`)}</option>)}
        </Select>
      </Row>
      {p.mode === 'trust' && <div className="border-b border-border px-5 py-4 text-xs text-muted">{t('permissions.trustNote')}</div>}
      {PERMISSION_KINDS.map((k) => (
        <Row key={k.id} label={t(`permissions.kind.${k.id}`)} hint={t(`permissions.kindHint.${k.id}`)}>
          <Select
            className="w-48!"
            aria-label={t(`permissions.kind.${k.id}`)}
            value={rules[k.id]}
            disabled={p.mode !== 'custom'}
            onChange={(e) => save({ ...p, mode: 'custom', rules: { ...rules, [k.id]: e.target.value as PermissionRule } })}
          >
            <option value="ask">{t('permissions.ask')}</option>
            <option value="allow">{t('permissions.allow')}</option>
          </Select>
        </Row>
      ))}
      <Row label={t('permissions.mcp')} hint={t('permissions.mcpHint')}>
        <Switch label={t('permissions.mcp')} checked={p.mcpAlwaysAsk} onChange={(v) => save({ ...p, mcpAlwaysAsk: v })} />
      </Row>
    </Card>
  )
}
