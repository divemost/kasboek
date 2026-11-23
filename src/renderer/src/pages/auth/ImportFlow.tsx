import { FileLock2, FolderSync, Server } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthStatus, ImportReset, PickedTransfer } from '@shared/types'
import { Button, Field, FormError, Input, PasswordInput } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { WebDavModal } from '../../components/WebDav'
import { ApiError, call } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { usePrefsFmt } from '../../lib/settings'
import { CodeInput, errText, PasswordFields, passwordsOk } from './parts'

/** Pick a .kasboek file and open it with the login details it was made with. */
export function ImportFlow({
  onDone,
  onCancel,
  onNotice,
  replacing,
  preset
}: {
  onDone: (s: AuthStatus) => void
  onCancel: () => void
  /** Called when the reset notice appears: the data is replaced by then, so only "Continue" may close the dialog. */
  onNotice?: (shown: boolean) => void
  replacing?: boolean
  preset?: PickedTransfer
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const fmt = usePrefsFmt()
  const [picked, setPicked] = useState<PickedTransfer | null>(preset ?? null)
  const [useRecovery, setUseRecovery] = useState(preset ? !preset.hasPassword : false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [recoveryKey, setRecoveryKey] = useState('')
  const [newPw, setNewPw] = useState({ a: '', b: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dav, setDav] = useState(false)
  // Set after an import that left some settings out: shown until the user continues.
  const [done, setDone] = useState<{ status: AuthStatus; reset: ImportReset[] } | null>(null)
  // A chosen sync folder leaves a downloaded copy behind until it is imported or dropped. However the dialog goes away
  // (Cancel, X, Escape, the parent closing it), what was picked and not imported is dropped when this unmounts.
  const pickedToken = useRef<string | null>(null)
  pickedToken.current = picked?.token ?? null
  const imported = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // Not at once: React's development check unmounts and mounts again, which must not drop what was picked.
      queueMicrotask(() => {
        if (!mounted.current && pickedToken.current && !imported.current) void call('sync.cancelJoin', { token: pickedToken.current }).catch(() => undefined)
      })
    }
  }, [])
  const cancel = onCancel

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
          {t('transfer.resetNotice', { items: done.reset.map((r) => t(`transfer.reset.${r}`)).join(', ') })}
        </p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => onDone(done.status)}>
            {t('auth.continue')}
          </Button>
        </div>
      </div>
    )
  }

  if (!picked) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-muted">{t('transfer.importIntro')}</p>
        {replacing && <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">{t('transfer.replaceWarning')}</p>}
        <WebDavModal
          open={dav}
          title={t('sync.join')}
          submit={t('webdav.joinSubmit')}
          onClose={() => setDav(false)}
          onSubmit={(webdav) =>
            call('sync.pickJoin', { webdav }).then((p) => {
              setPicked(p)
              setUseRecovery(!p.hasPassword)
            })
          }
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onCancel}>{t('settings.cancel')}</Button>
          <Button icon={<Server size={14} />} title={t('sync.joinHint')} onClick={() => setDav(true)}>
            {t('webdav.join')}
          </Button>
          <Button
            icon={<FolderSync size={14} />}
            title={t('sync.joinHint')}
            onClick={() =>
              void call('sync.pickJoin').then(
                (p) => {
                  setPicked(p)
                  setUseRecovery(!p.hasPassword)
                },
                (e) => (e instanceof ApiError && e.code === 'sync.cancelled' ? undefined : toast(errText(e), 'error'))
              )
            }
          >
            {t('sync.joinFolder')}
          </Button>
          <Button
            variant="primary"
            icon={<FileLock2 size={14} />}
            onClick={() =>
              void call('transfer.pick').then(
                (p) => {
                  if (!p) return
                  setPicked(p)
                  setUseRecovery(!p.hasPassword)
                },
                (e) => toast(errText(e), 'error')
              )
            }
          >
            {t('transfer.chooseFile')}
          </Button>
        </div>
      </div>
    )
  }

  const needsCode = picked.twoFactor && !useRecovery
  const ready =
    (useRecovery ? recoveryKey.replace(/[^A-Za-z2-7]/g, '').length >= 32 : password.length > 0 && (!needsCode || code.length === 6)) &&
    (!picked.needsNewPassword || passwordsOk(newPw))

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        void call('transfer.import', {
          token: picked.token,
          ...(useRecovery ? { recoveryKey } : { password, ...(needsCode ? { code } : {}) }),
          ...(picked.needsNewPassword ? { newPassword: newPw.a } : {})
        })
          .then(({ status, reset }) => {
            // Imported: nothing is left to drop.
            imported.current = true
            toast(t('transfer.imported'))
            if (reset.length) {
              onNotice?.(true)
              setDone({ status, reset })
            }
            else onDone(status)
          })
          .catch((err) => setError(errText(err)))
          .finally(() => setBusy(false))
      }}
    >
      <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-[13px]">
        <p className="selectable font-medium break-all">{picked.fileName}</p>
        <p className="text-muted">
          {t(picked.kind === 'export' ? 'transfer.kindExport' : 'transfer.kindBackup')} · {formatDateTime(picked.createdAt, fmt)}
        </p>
      </div>
      {useRecovery ? (
        <Field label={t('auth.recoveryKey')}>
          {(id) => <Input id={id} autoFocus value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" className="num font-mono" />}
        </Field>
      ) : (
        <>
          <Field label={t('auth.password')}>{(id) => <PasswordInput id={id} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          {needsCode && <Field label={t('auth.code')}>{(id) => <CodeInput id={id} value={code} onChange={setCode} />}</Field>}
        </>
      )}
      {picked.hasPassword && (
        <button type="button" className="self-start text-[13px] font-medium text-accent hover:underline" onClick={() => setUseRecovery((v) => !v)}>
          {useRecovery ? t('auth.usePasswordInstead') : t('auth.useRecoveryInstead')}
        </button>
      )}
      {picked.needsNewPassword && (
        <div className="border-t border-border pt-4">
          <p className="mb-3 text-[13px] text-muted">{t('transfer.needsNewPassword')}</p>
          <PasswordFields value={newPw} onChange={setNewPw} />
        </div>
      )}
      {replacing && <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">{t('transfer.replaceWarning')}</p>}
      {error && <FormError>{error}</FormError>}
      <div className="flex justify-end gap-2">
        <Button onClick={cancel}>{t('settings.cancel')}</Button>
        <Button type="submit" variant="primary" busy={busy} disabled={!ready}>
          {busy ? t('auth.working') : t('transfer.importConfirm')}
        </Button>
      </div>
    </form>
  )
}
