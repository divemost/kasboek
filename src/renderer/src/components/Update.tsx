import { ArrowDownToLine, ExternalLink, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { UpdateStatus } from '@shared/types'
import { call } from '../lib/api'
import { errText } from '../pages/auth/parts'
import { Rich } from './AssistantPanel'
import { useToast } from './Toast'
import { Button, Modal } from './ui'

export function useUpdate(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void call('update.status').then(setStatus)
    return window.kasboek.onEvent((e) => e.type === 'update.changed' && setStatus(e.status))
  }, [])
  return status
}

/** From the first heading ("What's new") up to the download table, which doesn't help inside the app. */
const whatsNew = (notes: string): string => {
  const start = notes.search(/^## /m)
  return (start > 0 ? notes.slice(start) : notes).split(/\n## (Download|First start|Good to know)/)[0]!.trim()
}

const mb = (bytes: number | null): string => (bytes ? `${Math.max(1, Math.round(bytes / 1_000_000))} MB` : '')

/** Top-bar button, only while a newer release is waiting, and the update window it opens. */
export function UpdateButton() {
  const { t } = useTranslation()
  const status = useUpdate()
  const [open, setOpen] = useState(false)
  const shown = status && status.latest && ['available', 'downloading', 'ready', 'preparing', 'installing', 'opened', 'error'].includes(status.state) && (status.state !== 'error' || status.kind)
  if (!shown) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-drag mr-2 inline-flex h-7 items-center gap-1.5 rounded-full bg-accent px-3 text-[12.5px] font-medium text-accent-fg transition-colors hover:bg-accent-hover"
      >
        <ArrowDownToLine size={14} />
        {status.state === 'downloading' ? t('update.downloadingShort', { percent: Math.round(status.progress * 100) }) : t('update.button', { version: status.latest })}
      </button>
      <UpdateModal status={status} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function UpdateModal({ status, open, onClose }: { status: UpdateStatus; open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const act = (p: Promise<unknown>): void => void p.catch((e) => toast(errText(e), 'error'))
  // Between the click and the update starting (a backup, then the helper) a second click must do nothing.
  const [starting, setStarting] = useState(false)
  const install = (): void => {
    setStarting(true)
    void call('update.install')
      .catch((e) => toast(errText(e), 'error'))
      .finally(() => setStarting(false))
  }
  const percent = Math.round(status.progress * 100)
  const busy = status.state === 'preparing' || status.state === 'installing'
  const restart = status.kind === 'msi' || status.kind === 'appimage'
  return (
    <Modal open={open} title={t('update.title', { version: status.latest })} onClose={onClose} dismissible={!busy}>
      <div className="flex flex-col gap-4 text-[13px]">
        <p className="text-muted">{t('update.current', { version: status.current })}</p>
        {status.notes && <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-surface-2/40 px-4 py-3"><Rich text={whatsNew(status.notes)} /></div>}

        {status.state === 'downloading' && (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-muted">{t('update.downloading', { percent, size: mb(status.sizeBytes) })}</p>
            {status.downloadNote && <p role="status" className="mt-1 text-xs text-warning">{t(`update.${status.downloadNote}`)}</p>}
          </div>
        )}
        {status.state === 'ready' && <p className="text-muted">{restart ? t('update.readyRestart') : t(`update.ready.${status.kind}`)}</p>}
        {(status.state === 'ready' || status.state === 'preparing') && status.kind === 'msi' && <p className="text-muted">{t('update.bridgesNote')}</p>}
        {status.state === 'preparing' && <p className="flex items-center gap-2 font-medium"><RefreshCw size={14} className="animate-spin text-accent" />{t('update.preparing')}</p>}
        {status.state === 'installing' && <p className="flex items-center gap-2 font-medium"><RefreshCw size={14} className="animate-spin text-accent" />{t('update.installing')}</p>}
        {status.state === 'opened' && <p className="font-medium">{t(`update.opened.${status.kind}`)}</p>}
        {status.error && <p className="text-negative">{status.error}</p>}
        {!status.kind && <p className="text-warning">{t('update.noFile')}</p>}
        <p className="text-xs text-muted">{t('update.safety')}</p>

        <div className="flex items-center justify-between gap-2">
          <button type="button" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline" onClick={() => act(call('update.openPage'))}>
            <ExternalLink size={13} /> {t('update.releasePage')}
          </button>
          <div className="flex gap-2">
            {status.state === 'downloading' && <Button onClick={() => act(call('update.cancel'))}>{t('update.cancel')}</Button>}
            {!busy && <Button onClick={onClose}>{t('update.later')}</Button>}
            {status.kind && (status.state === 'available' || status.state === 'error') && (
              <Button variant="primary" icon={status.state === 'error' ? <RefreshCw size={14} /> : <ArrowDownToLine size={14} />} onClick={() => act(call('update.download'))}>
                {status.state === 'error' ? t('update.retry') : status.sizeBytes ? t('update.downloadSize', { size: mb(status.sizeBytes) }) : t('update.download')}
              </Button>
            )}
            {(status.state === 'ready' || status.state === 'preparing') && (
              <Button variant="primary" disabled={starting || status.state === 'preparing'} onClick={install}>
                {restart ? t('update.installRestart') : t('update.openInstaller')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
