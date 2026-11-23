import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Card, CardHeader, Field, Modal, PasswordInput, Select } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { call } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import { useSettings } from '../../lib/settings'
import { CodeInput, DeviceIcon, errText, PasswordFields, passwordsOk, RecoveryKeyPanel, TotpSetup, useDeviceName } from '../auth/parts'
import { Row } from './Row'

type SecurityModal = null | 'password' | 'passwordless' | 'totp-on' | 'totp-off' | 'recovery'

export function SecuritySection() {
  const { fmt } = useSettings()
  const { t } = useTranslation()
  const toast = useToast()
  const { status, set } = useAuth()
  const { prefs, updatePrefs } = useSettings()
  const deviceName = useDeviceName(status.device)
  const [modal, setModal] = useState<SecurityModal>(null)
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState({ a: '', b: '' })
  const [code, setCode] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const device = status.mode === 'device'
  const close = (): void => {
    setModal(null)
    setCurrent('')
    setPw({ a: '', b: '' })
    setCode('')
    setNewKey(null)
  }
  const run = (p: Promise<unknown>, done: string): void => {
    setBusy(true)
    p.then(() => {
      toast(done)
      void call('auth.status').then(set)
      if (modal !== 'recovery') close()
    })
      .catch((e) => toast(errText(e), 'error'))
      .finally(() => setBusy(false))
  }
  const currentField = !device && (
    <Field label={t('auth.currentPassword')}>{(id) => <PasswordInput id={id} autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
  )

  return (
    <Card>
      <CardHeader title={t('settings.security')} description={t('settings.securityHint')} />
      <Row label={t('settings.signIn')} hint={device ? t('settings.signInDevice', { name: deviceName }) : t('settings.signInPassword')}>
        <Badge tone="accent">
          {device ? <DeviceIcon kind={status.device} size={12} /> : <ShieldCheck size={12} />}
          {device ? deviceName : t('auth.password')}
        </Badge>
        {device ? (
          <Button size="sm" onClick={() => setModal('password')}>{t('settings.usePassword')}</Button>
        ) : (
          <>
            <Button size="sm" onClick={() => setModal('password')}>{t('settings.changePassword')}</Button>
            {status.device && status.keyProtection === 'os' && <Button size="sm" onClick={() => setModal('passwordless')}>{t('settings.goPasswordless', { name: deviceName })}</Button>}
          </>
        )}
      </Row>
      <Row
        label={t('settings.twoFactor')}
        hint={status.rememberedUntil ? t('settings.rememberedHint', { date: formatDate(status.rememberedUntil, fmt) }) : t('settings.twoFactorHint')}
      >
        {status.rememberedUntil && (
          <Button size="sm" variant="ghost" onClick={() => void call('auth.forgetComputer').then((s2) => { set(s2); toast(t('settings.forgotten')) }, (e) => toast(errText(e), 'error'))}>
            {t('settings.forgetComputer')}
          </Button>
        )}
        <Badge tone={status.twoFactor ? 'accent' : 'neutral'}>{status.twoFactor ? t('settings.on') : t('settings.off')}</Badge>
        <Button size="sm" onClick={() => setModal(status.twoFactor ? 'totp-off' : 'totp-on')}>
          {status.twoFactor ? t('settings.turnOff') : t('settings.turnOn')}
        </Button>
      </Row>
      <Row label={t('auth.recoveryKey')} hint={t('settings.recoveryHint')}>
        <Button size="sm" onClick={() => setModal('recovery')}>{t('settings.newRecoveryKey')}</Button>
      </Row>
      <Row label={t('settings.autoLock')} hint={t('settings.autoLockHint')}>
        <Select className="w-44" aria-label={t('settings.autoLock')} value={prefs.autoLockMinutes} onChange={(e) => void updatePrefs({ autoLockMinutes: Number(e.target.value) })}>
          {[1, 5, 10, 15, 30, 60, 0].map((m) => (
            <option key={m} value={m}>
              {m === 0 ? t('settings.never') : t('settings.minutes', { count: m })}
            </option>
          ))}
        </Select>
      </Row>
      <Row label={t('settings.encryption')} hint={t('settings.encryptionHint')}>
        <Badge tone="accent"><ShieldCheck size={12} />{t('settings.encryptionValue')}</Badge>
      </Row>
      <Row label={t('settings.keyStorage')} hint={status.keyProtection === 'weak' ? t('settings.keyStorageWeakHint') : t('settings.keyStorageOsHint')}>
        <Badge tone={status.keyProtection === 'weak' ? 'warning' : 'accent'}>
          {status.keyProtection === 'weak' ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
          {status.keyProtection === 'weak' ? t('settings.keyStorageWeak') : t('settings.keyStorageOs')}
        </Badge>
      </Row>
      <Modal open={modal === 'password'} title={device ? t('settings.usePassword') : t('settings.changePassword')} onClose={close}>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(call('auth.changePassword', { current: device ? undefined : current, next: pw.a }), t('auth.passwordChanged')) }}>
          {currentField}
          {device && <p className="text-[13px] text-muted">{t('settings.confirmWithDevice', { name: deviceName })}</p>}
          <PasswordFields value={pw} onChange={setPw} autoFocus={device} />
          <p className="text-xs text-muted">{t('settings.oldExportsNote')}</p>
          <div className="flex justify-end gap-2">
            <Button onClick={close}>{t('settings.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={!passwordsOk(pw) || busy || (!device && !current)}>{t('settings.save')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={modal === 'passwordless'} title={t('settings.goPasswordless', { name: deviceName })} onClose={close}>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(call('auth.usePasswordless', { current }), t('settings.passwordlessOn')) }}>
          <p className="text-[13px] text-muted">{t('settings.passwordlessExplain', { name: deviceName })}</p>
          {currentField}
          <div className="flex justify-end gap-2">
            <Button onClick={close}>{t('settings.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={!current || busy}>{t('auth.continue')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={modal === 'totp-on'} title={t('auth.totpTitle')} onClose={close}>
        {modal === 'totp-on' && <TotpSetup onCancel={close} onDone={() => { void call('auth.status').then(set); close() }} />}
      </Modal>

      <Modal open={modal === 'totp-off'} title={t('settings.twoFactorOff')} onClose={close}>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(call('auth.totpDisable', { code }), t('settings.twoFactorDisabled')) }}>
          <p className="text-[13px] text-muted">{t('settings.twoFactorOffBody')}</p>
          <Field label={t('auth.code')}>{(id) => <CodeInput id={id} value={code} onChange={setCode} autoFocus />}</Field>
          <div className="flex justify-end gap-2">
            <Button onClick={close}>{t('settings.cancel')}</Button>
            <Button type="submit" variant="danger" disabled={code.length !== 6 || busy}>{t('settings.turnOff')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={modal === 'recovery'} title={t('settings.newRecoveryKey')} onClose={close} dismissible={!newKey}>
        {newKey ? (
          <RecoveryKeyPanel recoveryKey={newKey} onDone={close} />
        ) : (
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setBusy(true); void call('auth.newRecoveryKey', { current: device ? undefined : current }).then((r) => setNewKey(r.recoveryKey)).catch((err) => toast(errText(err), 'error')).finally(() => setBusy(false)) }}>
            <p className="text-[13px] text-muted">{t('settings.newRecoveryBody')}</p>
            {currentField}
            <div className="flex justify-end gap-2">
              <Button onClick={close}>{t('settings.cancel')}</Button>
              <Button type="submit" variant="primary" disabled={busy || (!device && !current)}>{t('auth.continue')}</Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  )
}
