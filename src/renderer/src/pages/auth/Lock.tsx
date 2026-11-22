import { Lock as LockIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Field, Input, PasswordInput } from '../../components/ui'
import { call } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import { usePrefsFmt } from '../../lib/settings'
import { useToast } from '../../components/Toast'
import { AuthCard, AuthLayout } from './AuthLayout'
import { ImportFlow } from './ImportFlow'
import { OpenFailureView } from './OpenFailure'
import { CodeInput, DeviceIcon, errText, useDeviceName } from './parts'

type View = 'unlock' | 'recovery' | 'erase' | 'import'

export function Lock() {
  const fmt = usePrefsFmt()
  const { t } = useTranslation()
  const toast = useToast()
  const { status, set } = useAuth()
  const deviceName = useDeviceName(status.device)
  const [view, setView] = useState<View>('unlock')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(false)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [erase, setErase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = (p: Promise<Parameters<typeof set>[0]>): void => {
    setBusy(true)
    setError(null)
    p.then(set)
      .catch((e) => {
        setError(errText(e))
        setPassword('')
        setCode('')
      })
      .finally(() => setBusy(false))
  }

  if (status.error) {
    if (view === 'import') {
      return (
        <AuthLayout>
          <AuthCard title={t('auth.open.importTitle')} body={t('auth.open.importBody')}>
            <ImportFlow onCancel={() => setView('unlock')} onDone={set} />
          </AuthCard>
        </AuthLayout>
      )
    }
    return (
      <AuthLayout>
        <OpenFailureView
          error={status.error}
          more={more}
          onToggleMore={() => setMore((m) => !m)}
          onRetry={() => window.location.reload()}
          onImport={() => setView('import')}
          onShowFolder={() => void call('auth.showDataFolder').then((r) => r.ok || toast(t('auth.open.folderFailed'), 'error'), (e) => toast(errText(e), 'error'))}
          onCopy={() =>
            void call('auth.diagnostics')
              .then(({ text }) => navigator.clipboard.writeText(text))
              .then(
                () => toast(t('auth.open.copied')),
                () => toast(t('auth.copyFailed'), 'error')
              )
          }
          erase={<EraseForm value={erase} onChange={setErase} onConfirm={() => run(call('auth.erase', { confirm: 'ERASE' }))} busy={busy} />}
        />
      </AuthLayout>
    )
  }

  const device = status.mode === 'device'
  // A remembered computer skips the code; the real check happens in the main process.
  const needCode = status.twoFactor && !status.rememberedUntil
  return (
    <AuthLayout>
      {view === 'unlock' && (
        <AuthCard title={t('auth.unlockTitle')} body={device ? t('auth.unlockDeviceBody', { name: deviceName }) : undefined}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              const second = needCode ? { code, remember } : {}
              run(call('auth.unlock', device ? second : { password, ...second }))
            }}
          >
            {!device && (
              <Field label={t('auth.password')}>
                {(id) => <PasswordInput id={id} autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
              </Field>
            )}
            {needCode && (
              <>
                <Field label={t('auth.code')}>{(id) => <CodeInput id={id} value={code} onChange={setCode} autoFocus={device} />}</Field>
                <label className="-mt-2 flex items-center gap-2 text-[13px] text-muted">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  {t('auth.rememberComputer')}
                </label>
              </>
            )}
            {status.twoFactor && status.rememberedUntil && <p className="text-xs text-muted">{t('auth.rememberedNote', { date: formatDate(status.rememberedUntil, fmt) })}</p>}
            {error && <p className="text-[13px] text-negative" role="alert">{error}</p>}
            {status.throttleSeconds > 0 && !error && <p className="text-[13px] text-warning">{t('auth.throttled', { s: status.throttleSeconds })}</p>}
            <Button
              type="submit"
              variant="primary"
              icon={device ? <DeviceIcon kind={status.device} /> : <LockIcon size={14} />}
              disabled={busy || (!device && !password) || (needCode && code.length !== 6)}
            >
              {busy ? t('auth.working') : device ? t('auth.unlockWith', { name: deviceName }) : t('auth.unlock')}
            </Button>
          </form>
          <div className="mt-5 flex justify-between text-[13px]">
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => setView('recovery')}>
              {t('auth.forgot')}
            </button>
            <button type="button" className="text-muted hover:text-negative" onClick={() => setView('erase')}>
              {t('auth.eraseLink')}
            </button>
          </div>
        </AuthCard>
      )}

      {view === 'recovery' && (
        <AuthCard title={t('auth.recoveryUnlockTitle')} body={t('auth.recoveryUnlockBody')}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(call('auth.unlockRecovery', { recoveryKey }))
            }}
          >
            <Field label={t('auth.recoveryKey')}>
              {(id) => <Input id={id} autoFocus value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" className="num font-mono" />}
            </Field>
            {error && <p className="text-[13px] text-negative">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setView('unlock')}>{t('auth.back')}</Button>
              <Button type="submit" variant="primary" disabled={busy || recoveryKey.length < 32}>
                {t('auth.unlock')}
              </Button>
            </div>
          </form>
        </AuthCard>
      )}

      {view === 'erase' && (
        <AuthCard title={t('auth.eraseTitle')} body={t('auth.eraseBody')}>
          <EraseForm value={erase} onChange={setErase} onConfirm={() => run(call('auth.erase', { confirm: 'ERASE' }))} busy={busy} />
          <Button className="mt-2 w-full" onClick={() => setView('unlock')}>
            {t('auth.back')}
          </Button>
        </AuthCard>
      )}
    </AuthLayout>
  )
}

function EraseForm({ value, onChange, onConfirm, busy }: { value: string; onChange: (v: string) => void; onConfirm: () => void; busy: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="mt-4 flex flex-col gap-3">
      <Field label={t('auth.eraseType')}>{(id) => <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={t('auth.eraseWord')} />}</Field>
      <Button variant="danger" disabled={value.trim().toUpperCase() !== t('auth.eraseWord').toUpperCase() || busy} onClick={onConfirm}>
        {t('auth.eraseConfirm')}
      </Button>
    </div>
  )
}
