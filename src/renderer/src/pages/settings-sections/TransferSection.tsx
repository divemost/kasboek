import { Download, Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RestoreModal } from '../../components/RestoreModal'
import { Button, Card, CardHeader } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { call } from '../../lib/api'
import { errText } from '../auth/parts'
import { Row } from './Row'

export function TransferSection() {
  const { t } = useTranslation()
  const toast = useToast()
  const [importing, setImporting] = useState(false)
  return (
    <Card>
      <CardHeader title={t('transfer.title')} description={t('transfer.hint')} />
      <Row label={t('transfer.export')} hint={t('transfer.exportHint')}>
        <Button
          size="sm"
          variant="primary"
          icon={<Download size={14} />}
          onClick={() => void call('transfer.export').then((r) => r.file && toast(t('transfer.exported', { file: r.file })), (e) => toast(errText(e), 'error'))}
        >
          {t('transfer.exportButton')}
        </Button>
      </Row>
      <Row label={t('transfer.import')} hint={t('transfer.importHint')}>
        <Button size="sm" icon={<Upload size={14} />} onClick={() => setImporting(true)}>{t('transfer.importButton')}</Button>
      </Row>
      <RestoreModal open={importing} onClose={() => setImporting(false)} />
    </Card>
  )
}
