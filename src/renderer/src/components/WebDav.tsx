import { Server } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errText } from '../pages/auth/parts'
import { Button, Field, FormError, Input, Modal, PasswordInput } from './ui'

export interface WebDavInput {
  url: string
  user: string
  password: string
}

/**
 * A WebDAV server to sync through (Nextcloud, ownCloud, Synology, a NAS, …). `onSubmit` starts,
 * joins or attaches; its error is shown here and the window stays open to correct the details.
 */
export function WebDavModal({ open, title, submit, onClose, onSubmit }: { open: boolean; title: string; submit: string; onClose: () => void; onSubmit: (w: WebDavInput) => Promise<unknown> }) {
  const { t } = useTranslation()
  const [w, setW] = useState<WebDavInput>({ url: '', user: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = (): void => {
    setError(null)
    setW((x) => ({ ...x, password: '' }))
    onClose()
  }
  return (
    <Modal open={open} title={title} onClose={close} dismissible={!busy}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          void onSubmit(w)
            .then(() => close())
            .catch((err) => setError(errText(err)))
            .finally(() => setBusy(false))
        }}
      >
        <p className="text-[13px] text-muted">{t('webdav.intro')}</p>
        <Field label={t('webdav.url')} hint={t('webdav.urlHint')}>
          {(id) => <Input id={id} value={w.url} onChange={(e) => setW({ ...w, url: e.target.value })} placeholder="https://cloud.example.com/remote.php/dav/files/me/" autoFocus spellCheck={false} />}
        </Field>
        <Field label={t('webdav.user')}>{(id) => <Input id={id} value={w.user} onChange={(e) => setW({ ...w, user: e.target.value })} autoComplete="username" spellCheck={false} />}</Field>
        <Field label={t('webdav.password')} hint={t('webdav.passwordHint')}>
          {(id) => <PasswordInput id={id} value={w.password} onChange={(e) => setW({ ...w, password: e.target.value })} autoComplete="current-password" />}
        </Field>
        {error && <FormError>{error}</FormError>}
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" onClick={close} disabled={busy}>{t('settings.cancel')}</Button>
          <Button type="submit" variant="primary" icon={<Server size={14} />} busy={busy} disabled={!w.url.trim()}>{busy ? t('webdav.connecting') : submit}</Button>
        </div>
      </form>
    </Modal>
  )
}
