import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader, cx } from '../components/ui'
import { AssistantSwitchSection, ClaudeSection, ConnectedAppsSection, PermissionsSection } from './SettingsClaude'
import { useAssistantEnabled } from '../lib/settings'
import { MemorySection } from './SettingsMemory'
import { SETTINGS_TABS, onSettingsTab, openSettingsTab, settingsTab, type SettingsTab } from '../lib/settings-tab'
import { AboutSection } from './settings-sections/AboutSection'
import { AppearanceSection } from './settings-sections/AppearanceSection'
import { BackupSection } from './settings-sections/BackupSection'
import { CurrenciesSection } from './settings-sections/CurrenciesSection'
import { FormatsSection } from './settings-sections/FormatsSection'
import { InsightsSection } from './settings-sections/InsightsSection'
import { SecuritySection } from './settings-sections/SecuritySection'
import { SyncSection } from './settings-sections/SyncSection'
import { TransferSection } from './settings-sections/TransferSection'

export function SettingsPage() {
  const { t } = useTranslation()
  const assistantEnabled = useAssistantEnabled()
  const [tab, setTabState] = useState<SettingsTab>(settingsTab())
  const setTab = (next: SettingsTab): void => openSettingsTab(next)
  useEffect(() => onSettingsTab(setTabState), [])
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <div className="mb-6 overflow-x-auto border-b border-border">
      <div role="tablist" aria-label={t('settings.title')} className="flex w-max min-w-full gap-1">
        {SETTINGS_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap font-medium transition-colors',
              tab === id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-text'
            )}
          >
            {t(`settings.tab.${id}`)}
          </button>
        ))}
      </div>
      </div>
      <div role="tabpanel" className="flex flex-col gap-6">
        {tab === 'general' && (
          <>
            <AppearanceSection />
            <FormatsSection />
            <CurrenciesSection />
            <InsightsSection />
          </>
        )}
        {tab === 'about' && <AboutSection />}
        {tab === 'security' && <SecuritySection />}
        {tab === 'data' && (
          <>
            <BackupSection />
            <SyncSection />
            <TransferSection />
          </>
        )}
        {tab === 'assistant' && (
          <>
            <AssistantSwitchSection />
            {assistantEnabled && (
              <>
                <ClaudeSection />
                <PermissionsSection />
                <MemorySection />
              </>
            )}
            <ConnectedAppsSection />
          </>
        )}
      </div>
    </>
  )
}
