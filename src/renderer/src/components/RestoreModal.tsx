import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/auth'
import { ImportFlow } from '../pages/auth/ImportFlow'
import { Modal } from './ui'

/** Opens a .kasboek backup or export and replaces what is here with it; Kasboek then reloads. */
export function RestoreModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { set } = useAuth()
  const [notice, setNotice] = useState(false)
  return (
    <Modal open={open} title={t('transfer.import')} onClose={onClose} dismissible={!notice}>
      {open && <ImportFlow replacing onNotice={setNotice} onCancel={onClose} onDone={(s) => { onClose(); set(s); window.location.reload() }} />}
    </Modal>
  )
}
