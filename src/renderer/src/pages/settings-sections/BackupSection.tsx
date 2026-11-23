import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type PickedTransfer } from '@shared/types'
import { Badge, Button, Card, CardHeader, Modal, Switch } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { call, useOp } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDateTime } from '../../lib/format'
import { useSettings } from '../../lib/settings'
import { ImportFlow } from '../auth/ImportFlow'
import { errText } from '../auth/parts'
import { Row } from './Row'

export function BackupSection() {
  const { t } = useTranslation()
  const toast = useToast()
  const { fmt } = useSettings()
  const { set } = useAuth()
  const status = useOp('backup.status')
  const list = useOp('backup.list')
  const [showAll, setShowAll] = useState(false)
  const [restoring, setRestoring] = useState<PickedTransfer | null>(null)
  const [restoreNotice, setRestoreNotice] = useState(false)
  const s = status.data
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      void status.reload()
      void list.reload()
    }
  }
  useEffect(() => window.kasboek.onEvent((e) => { if (e.type === 'backup.completed') { void list.reload(); void status.reload() } }), []) // eslint-disable-line react-hooks/exhaustive-deps
  const backups = list.data ?? []
  const shown = showAll ? backups : backups.slice(0, 6)
  const kb = (n: number): string => `${Math.max(1, Math.round(n / 1024))} KB`
  return (
    <Card>
      <CardHeader title={t('settings.backups')} description={t('settings.backupsHint')} />
      <Row label={t('settings.auto')} hint={t('settings.autoHint')}>
        <Switch
          label={t('settings.auto')}
          checked={!!s?.autoEnabled}
          onChange={(enabled) =>
            void run(async () => {
              if (enabled && !s?.folder && !(await call('backup.chooseFolder')).folder) return
              await call('backup.configureAuto', { enabled })
            })
          }
        />
      </Row>
      <Row label={t('settings.folder')} hint={<span className="selectable break-all">{s?.folder ?? t('settings.noFolder')}</span>}>
        {s?.folder && <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={() => void run(() => call('backup.revealFolder'))}>{t('settings.openFolder')}</Button>}
        <Button size="sm" onClick={() => void run(() => call('backup.chooseFolder'))}>{t('settings.chooseFolder')}</Button>
      </Row>
      <Row label={t('settings.whenBackup')} hint={t('settings.whenBackupHint')}>
        <Button size="sm" disabled={!s?.folder} onClick={() => void run(async () => toast(t('settings.backupSaved', { file: (await call('backup.runNow')).file })))}>
          {t('settings.backupNow')}
        </Button>
      </Row>
      {backups.length > 0 && (
        <div className="border-t border-border">
          {shown.map((b) => (
            <div key={b.name} className="flex items-center gap-3 border-b border-border px-5 py-2.5 text-[13px] last:border-b-0">
              <span className="num flex-1">{formatDateTime(b.createdAt, fmt)}</span>
              <Badge tone={b.tier === 'recent' ? 'accent' : 'neutral'}>{t(`settings.tier.${b.tier}`)}</Badge>
              <span className="num w-16 text-right text-muted">{kb(b.size)}</span>
              <Button size="sm" variant="ghost" onClick={() => void run(async () => setRestoring(await call('backup.pick', { name: b.name })))}>{t('settings.restoreThis')}</Button>
            </div>
          ))}
          {backups.length > 6 && (
            <button type="button" className="w-full px-5 py-2.5 text-left text-[13px] font-medium text-accent hover:underline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? t('settings.showFewer') : t('settings.showAllBackups', { count: backups.length })}
            </button>
          )}
        </div>
      )}
      <Modal open={!!restoring} title={t('settings.restoreTitle')} onClose={() => setRestoring(null)} dismissible={!restoreNotice}>
        {restoring && <ImportFlow replacing preset={restoring} onNotice={setRestoreNotice} onCancel={() => setRestoring(null)} onDone={(st) => { setRestoring(null); set(st); window.location.reload() }} />}
      </Modal>
    </Card>
  )
}
