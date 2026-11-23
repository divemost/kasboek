import { Download, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateInput } from '../../components/DateInput'
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Switch } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { call, useOp } from '../../lib/api'
import { formatDate, formatDateTime, formatNumber } from '../../lib/format'
import { useSettings } from '../../lib/settings'
import { CurrencySelect } from '../../components/CurrencySelect'
import { errText } from '../auth/parts'
import { localToday } from '@shared/month'
import { Row } from './Row'

export function CurrenciesSection() {
  const { t } = useTranslation()
  const toast = useToast()
  const { settings, update, fmt } = useSettings()
  const status = useOp('fx.status')
  const manual = useOp('fx.rates', {})
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const today = localToday()
  const [rate, setRate] = useState({ currency: 'USD', date: today, perEur: '' })
  const reload = (): void => {
    void status.reload()
    void manual.reload()
  }
  useEffect(() => window.kasboek.onEvent((e) => e.type === 'data.changed' && reload()), []) // eslint-disable-line react-hooks/exhaustive-deps
  const download = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await call('fx.updateEcb', {})
      toast(t('fx.downloaded', { count: r.added }))
      reload()
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const saveRate = async (): Promise<void> => {
    const perEur = Number(rate.perEur.replace(',', '.'))
    try {
      await call('fx.setRate', { currency: rate.currency, date: rate.date, perEur })
      toast(t('fx.rateSaved'))
      setAdding(false)
      reload()
    } catch (e) {
      toast(errText(e), 'error')
    }
  }
  const s = status.data
  const rateText = (cur: string, perEur: number): string => `1 EUR = ${formatNumber(perEur, fmt, perEur >= 100 ? 2 : 4)} ${cur}`
  return (
    <Card>
      <CardHeader title={t('fx.title')} description={t('fx.hint')} />
      <Row label={t('fx.main')} hint={t('fx.mainHint')}>
        <CurrencySelect className="w-64!" value={settings.currency} onChange={(e) => void update({ currency: e.target.value }).then(reload)} aria-label={t('fx.main')} />
      </Row>
      {s?.currencies.map((c) => (
        <Row
          key={c.currency}
          label={c.currency}
          hint={
            c.latest
              ? `${rateText(c.currency, c.latest.perEur)} · ${formatDate(c.latest.date, fmt)} · ${t(c.latest.source === 'ecb' ? 'fx.sourceEcb' : 'fx.sourceManual')}${c.coversOldest ? '' : ' · ' + t('fx.olderThanRates')}`
              : t('fx.noRate')
          }
        >
          {c.latest ? <Badge tone="accent">{t('fx.converted')}</Badge> : <Badge tone="warning">{t('fx.notConverted')}</Badge>}
        </Row>
      ))}
      <Row label={t('fx.ecb')} hint={s?.lastEcbUpdateAt ? t('fx.ecbLast', { date: formatDateTime(s.lastEcbUpdateAt, fmt) }) : t('fx.ecbHint')}>
        <Button size="sm" icon={<Download size={14} />} disabled={busy} onClick={() => void download()}>{busy ? t('fx.downloading') : t('fx.download')}</Button>
      </Row>
      <Row label={t('fx.auto')} hint={t('fx.autoHint')}>
        <Switch checked={settings.fxAutoUpdate} onChange={(v) => void update({ fxAutoUpdate: v })} label={t('fx.auto')} />
      </Row>
      <Row label={t('fx.manual')} hint={t('fx.manualHint')}>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => { setRate({ currency: s?.currencies[0]?.currency ?? 'USD', date: today, perEur: '' }); setAdding(true) }}>{t('fx.addRate')}</Button>
      </Row>
      {(manual.data ?? []).map((r) => (
        <Row key={`${r.currency}-${r.date}`} label={<span className="num text-[13px]">{rateText(r.currency, r.perEur)}</span>} hint={formatDate(r.date, fmt)}>
          <Button size="sm" variant="ghost" onClick={() => void call('fx.deleteRate', { currency: r.currency, date: r.date }).then(reload)}>{t('fx.remove')}</Button>
        </Row>
      ))}
      <Modal open={adding} title={t('fx.addRate')} onClose={() => setAdding(false)}>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void saveRate() }}>
          <Field label={t('fx.currency')}>{(id) => <CurrencySelect id={id} value={rate.currency} onChange={(e) => setRate({ ...rate, currency: e.target.value })} />}</Field>
          <Field label={t('fx.date')} hint={t('fx.dateHint')}>{(id) => <DateInput id={id} value={rate.date} onChange={(date) => setRate({ ...rate, date })} required />}</Field>
          <Field label={t('fx.perEur', { currency: rate.currency })}>{(id) => <Input id={id} inputMode="decimal" value={rate.perEur} onChange={(e) => setRate({ ...rate, perEur: e.target.value })} placeholder={formatNumber(1.08, fmt, 4)} className="num" required />}</Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAdding(false)}>{t('settings.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={!(Number(rate.perEur.replace(',', '.')) > 0) || rate.currency === 'EUR' || !rate.date}>{t('settings.save')}</Button>
          </div>
        </form>
      </Modal>
    </Card>
  )
}
