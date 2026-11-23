import { Check, Copy, Fingerprint, KeyRound, ScanFace } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DeviceAuthKind } from '@shared/types'
import { MIN_PASSWORD_LENGTH, checkPassword } from '@shared/password'
import { Button, Field, FormError, Input, PasswordInput, cx } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { ApiError, call } from '../../lib/api'
import { errorMessage } from '../../lib/error-message'
import { recoveryKeyConfirmed, totpStepView } from '@shared/setup-rules'

/** Errors from the main process come in English; the ones with a translation here are shown in the chosen language. */
export const errText = (e: unknown): string => (e instanceof ApiError ? errorMessage(e) : String(e))

export function DeviceIcon({ kind, size = 16 }: { kind: DeviceAuthKind; size?: number }) {
  return kind === 'touch-id' ? <Fingerprint size={size} /> : kind === 'windows-hello' ? <ScanFace size={size} /> : <KeyRound size={size} />
}

export function useDeviceName(kind: DeviceAuthKind): string {
  const { t } = useTranslation()
  return kind === 'touch-id' ? t('auth.touchId') : t('auth.windowsHello')
}

const STRENGTH_TONE = ['bg-negative', 'bg-negative', 'bg-warning', 'bg-warning', 'bg-accent']

/** New-password fields with a live strength meter and the rules ticked off as they're met. */
export function PasswordFields({ value, onChange, autoFocus }: { value: { a: string; b: string }; onChange: (v: { a: string; b: string }) => void; autoFocus?: boolean }) {
  const { t } = useTranslation()
  const check = checkPassword(value.a)
  const mismatch = value.b.length > 0 && value.a !== value.b
  const rules: { ok: boolean; label: string }[] = [
    { ok: [...value.a].length >= MIN_PASSWORD_LENGTH, label: t('auth.ruleLength', { n: MIN_PASSWORD_LENGTH }) },
    { ok: check.classes >= 3, label: t('auth.ruleVariety') },
    { ok: value.a.length > 0 && !check.issues.includes('common') && !check.issues.includes('appName'), label: t('auth.ruleCommon') },
    { ok: value.a.length > 0 && !check.issues.includes('pattern'), label: t('auth.rulePattern') }
  ]
  return (
    <div className="flex flex-col gap-4">
      <Field label={t('auth.newPassword')}>
        {(id) => <PasswordInput id={id} autoFocus={autoFocus} autoComplete="new-password" value={value.a} onChange={(e) => onChange({ ...value, a: e.target.value })} />}
      </Field>
      <div>
        <div className="flex gap-1" role="meter" aria-label={t('auth.strength')} aria-valuemin={0} aria-valuemax={4} aria-valuenow={check.strength}>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={cx('h-1.5 flex-1 rounded-full', value.a && check.strength >= i ? STRENGTH_TONE[check.strength] : 'bg-surface-2')} />
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{value.a ? t(`auth.strength${check.strength}`) : t('auth.strengthHint')}</p>
        <ul className="mt-2 space-y-0.5 text-xs">
          {rules.map((r) => (
            <li key={r.label} className={cx('flex items-center gap-1.5', r.ok ? 'text-accent' : 'text-muted')}>
              {r.ok ? <Check size={12} strokeWidth={3} /> : <span className="inline-block h-3 w-3 rounded-full border border-border-strong" />}
              {r.label}
            </li>
          ))}
        </ul>
      </div>
      <Field label={t('auth.repeatPassword')}>
        {(id) => <PasswordInput id={id} autoComplete="new-password" value={value.b} onChange={(e) => onChange({ ...value, b: e.target.value })} />}
      </Field>
      {mismatch && <p className="text-[13px] text-negative">{t('auth.passwordMismatch')}</p>}
    </div>
  )
}

export const passwordsOk = (v: { a: string; b: string }): boolean => checkPassword(v.a).ok && v.a === v.b

export function CodeInput({ value, onChange, autoFocus, id }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; id?: string }) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      maxLength={6}
      placeholder="123456"
      className="num text-center text-lg tracking-[0.4em]"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
    />
  )
}

/** Shows the recovery key once and makes sure it was written down. */
export function RecoveryKeyPanel({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [saved, setSaved] = useState(false)
  const [check, setCheck] = useState('')
  return (
    <div className="flex flex-col gap-4">
      {/* Hidden while confirming, so the last group is read from where it was stored, not from here. */}
      <div
        aria-hidden={saved}
        className={cx(
          'num rounded-lg border border-border bg-surface-2 px-4 py-4 text-center font-mono text-[17px] leading-relaxed font-semibold tracking-wider transition-[filter]',
          saved ? 'pointer-events-none blur-md select-none' : 'selectable'
        )}
      >
        {recoveryKey.split('-').slice(0, 4).join('-')}
        <br />
        {recoveryKey.split('-').slice(4).join('-')}
      </div>
      <Button
        icon={<Copy size={14} />}
        disabled={saved}
        onClick={() =>
          void navigator.clipboard.writeText(recoveryKey).then(
            () => toast(t('auth.copied')),
            () => toast(t('auth.copyFailed'), 'error')
          )
        }
      >
        {t('auth.copy')}
      </Button>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">
        <li>{t('auth.recoveryTip1')}</li>
        <li>{t('auth.recoveryTip2')}</li>
        <li>{t('auth.recoveryTip3')}</li>
      </ul>
      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t('auth.recoverySaved')}
      </label>
      {saved && (
        <Field label={t('auth.recoveryConfirm', { n: 8 })} hint={t('auth.recoveryHidden')}>
          {(id) => <Input id={id} value={check} onChange={(e) => setCheck(e.target.value.toUpperCase())} maxLength={4} className="num font-mono tracking-widest" />}
        </Field>
      )}
      <Button variant="primary" disabled={!recoveryKeyConfirmed(recoveryKey, saved, check)} onClick={onDone}>
        {t('auth.continue')}
      </Button>
    </div>
  )
}

/** Scan a QR code, enter the first code, done. */
export function TotpSetup({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [data, setData] = useState<{ secret: string; qrSvg: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void call('auth.totpBegin').then(setData, (e) => setFailure(errText(e)))
  }, [])
  const view = totpStepView(data ? 'ready' : failure !== null ? 'failed' : 'loading')
  if (view.error) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
          {failure}
        </p>
        {onCancel && (
          <div className="flex justify-end">
            <Button onClick={onCancel}>{t('auth.notNow')}</Button>
          </div>
        )}
      </div>
    )
  }
  if (!data) return null
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        void call('auth.totpEnable', { code })
          .then(() => {
            toast(t('auth.totpEnabled'))
            onDone()
          })
          .catch((err) => setError(errText(err)))
          .finally(() => setBusy(false))
      }}
    >
      <ol className="list-decimal space-y-1 pl-5 text-[13px] text-muted">
        <li>{t('auth.totpStep1')}</li>
        <li>{t('auth.totpStep2')}</li>
      </ol>
      <div className="flex items-center gap-4">
        <img alt={t('auth.qrAlt')} className="h-40 w-40 rounded-lg border border-border bg-white p-1" src={`data:image/svg+xml;utf8,${encodeURIComponent(data.qrSvg)}`} />
        <div className="min-w-0 text-[13px]">
          <p className="text-muted">{t('auth.totpManual')}</p>
          <p className="selectable num mt-1 font-mono text-[13px] font-semibold break-all">{data.secret}</p>
        </div>
      </div>
      <Field label={t('auth.totpStep3')}>{(id) => <CodeInput id={id} value={code} onChange={setCode} autoFocus />}</Field>
      {error && <FormError>{error}</FormError>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button onClick={onCancel}>{t('auth.notNow')}</Button>}
        <Button type="submit" variant="primary" icon={<Check size={14} />} busy={busy} disabled={code.length !== 6}>
          {t('auth.totpTurnOn')}
        </Button>
      </div>
    </form>
  )
}
