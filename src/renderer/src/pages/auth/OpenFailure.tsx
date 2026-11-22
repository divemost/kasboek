import { FileLock2, FolderOpen, ClipboardCopy } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { openFailureKind } from '@shared/open-failure'
import { Button } from '../../components/ui'
import { AuthCard } from './AuthLayout'

/**
 * "Kasboek can't open its data": says what is wrong in plain words and offers ways out that lose nothing.
 * Erasing is the last option, behind "More options". The technical text sits under "Details".
 */
export function OpenFailureView({
  error,
  more,
  onToggleMore,
  onRetry,
  onImport,
  onShowFolder,
  onCopy,
  erase
}: {
  error: { code: string; message: string }
  more: boolean
  onToggleMore: () => void
  onRetry: () => void
  onImport: () => void
  onShowFolder: () => void
  onCopy: () => void
  /** The erase confirmation, shown under "More options". */
  erase: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <AuthCard title={t('auth.cantOpen')} body={t(`auth.open.${openFailureKind(error.code)}`)}>
      <details className="mb-4 text-xs text-muted">
        <summary className="cursor-pointer">{t('auth.open.details')}</summary>
        <p className="selectable mt-1 break-words">
          {error.code}: {error.message}
        </p>
      </details>
      <Button variant="primary" className="mb-2 w-full" icon={<FileLock2 size={14} />} onClick={onImport}>
        {t('auth.open.import')}
      </Button>
      <p className="mb-3 text-xs text-muted">{t('auth.open.importHint')}</p>
      <Button className="mb-2 w-full" onClick={onRetry}>
        {t('auth.tryAgain')}
      </Button>
      <div className="mb-2 flex gap-2">
        <Button className="flex-1" icon={<FolderOpen size={14} />} onClick={onShowFolder}>
          {t('auth.open.showFolder')}
        </Button>
        <Button className="flex-1" icon={<ClipboardCopy size={14} />} onClick={onCopy}>
          {t('auth.open.copyInfo')}
        </Button>
      </div>
      <button type="button" aria-expanded={more} className="mt-2 text-[13px] text-muted hover:text-text" onClick={onToggleMore}>
        {t('auth.open.moreOptions')}
      </button>
      {more && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-[13px] text-muted">{t('auth.open.eraseExplain')}</p>
          {erase}
        </div>
      )}
    </AuthCard>
  )
}
