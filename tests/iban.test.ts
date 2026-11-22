import { describe, expect, it } from 'vitest'
import { cutText, findIbans, maskAccount, maskContacts, maskIban, maskNumbers, maskPrivate, validIban } from '@shared/iban'

describe('IBAN helpers', () => {
  it('checks the checksum', () => {
    expect(validIban('BE68539007547034')).toBe(true)
    expect(validIban('BE68539007547035')).toBe(false)
  })

  it('finds valid IBANs, written in groups or stuck to other text, each once', () => {
    expect(findIbans('Naar BE68 5390 0754 7034 voor huur')).toEqual(['BE68539007547034'])
    expect(findIbans('MANDAAT 864551BE68539007547034XYZ')).toEqual(['BE68539007547034'])
    expect(findIbans('BE68 5390 0754 7034 en NL91 ABNA 0417 1643 00, BE68539007547034')).toEqual(['BE68539007547034', 'NL91ABNA0417164300'])
    expect(findIbans('REF AB12CDEFGHIJKLMNOP')).toEqual([])
    expect(findIbans('geen rekening')).toEqual([])
  })

  it('masks IBANs and long digit runs', () => {
    expect(maskNumbers('Afschrift BE68 5390 0754 7034.pdf')).toBe('Afschrift BE…7034.pdf')
    expect(maskNumbers('statement_5390075470341.pdf')).toBe('statement_…0341.pdf')
    expect(maskNumbers('card 4111 1111 1111 1111 paid')).toBe('card …1111 paid')
    expect(maskNumbers('afschrift 2026-11.pdf')).toBe('afschrift 2026-11.pdf')
    expect(maskNumbers(maskIban('BE68539007547034'))).toBe('BE…7034')
  })

  it('keeps ordinary dates side by side, and still masks numbers that are not dates', () => {
    expect(maskNumbers('01-10-2026 02-10-2026')).toBe('01-10-2026 02-10-2026')
    expect(maskNumbers('van 2026-10-01 2026-10-02 tot')).toBe('van 2026-10-01 2026-10-02 tot')
    expect(maskNumbers('01-10-2026 02-10-2026 03-10-2026')).toBe('01-10-2026 02-10-2026 03-10-2026')
    expect(maskNumbers('card 4111-1111-1111-1111')).toBe('card …1111')
    expect(maskNumbers('ref 01-10-2026 02-10-2026 98765')).toBe('ref 01-10-2026 02-10-2026 98765')
    expect(maskNumbers('ref 01-10-2026 02-10-2026 98765 4321 1111')).toBe('ref 01-10-2026 02-10-2026 …1111')
    expect(maskNumbers('mandaat 20261001000123456789')).toBe('mandaat …6789')
  })

  it('masks a 16-digit number written as two date-like groups, since no real day or month fits', () => {
    expect(maskNumbers('card 4111-11-11 1111-11-11')).toBe('card …1111')
    expect(maskNumbers('card 9999-99-99 9999-99-99')).toBe('card …9999')
    expect(maskNumbers('card 41-11-1111 11-11-1111')).toBe('card …1111')
    expect(maskNumbers('ref 2026-13-01 2026-10-02')).toBe('ref …1002')
    expect(maskNumbers('ref 2026-10-32 2026-10-02')).toBe('ref …1002')
    expect(maskNumbers('ref 00-10-2026 02-10-2026')).toBe('ref …2026')
  })

  it('finds an IBAN stuck to letters or digits before it, and one in lower case', () => {
    expect(findIbans('REFNL91ABNA0417164300')).toEqual(['NL91ABNA0417164300'])
    expect(findIbans('MANDATEBE68539007547034')).toEqual(['BE68539007547034'])
    expect(findIbans('REF12NL91ABNA0417164300 end')).toEqual(['NL91ABNA0417164300'])
    expect(findIbans('naar nl91 abna 0417 1643 00 voor')).toEqual(['NL91ABNA0417164300'])
    expect(findIbans('betaling be68539007547034')).toEqual(['BE68539007547034'])
    expect(findIbans('BE68539007547034NL91ABNA0417164300')).toEqual(['BE68539007547034', 'NL91ABNA0417164300'])
  })

  it('masks glued IBANs everywhere the masking is used', () => {
    expect(maskIban('REFNL91ABNA0417164300 ok')).toBe('REFNL…4300 ok')
    expect(maskNumbers('REFNL91ABNA0417164300')).toBe('REFNL…4300')
    expect(maskNumbers('Mandate 864551BE68539007547034XYZ')).toBe('Mandate 864551BE…7034XYZ')
    expect(maskIban('nl91abna0417164300')).toBe('NL…4300')
    expect(maskIban('BE68539007547034NL91ABNA0417164300')).toBe('BE…7034NL…4300')
  })

  it('leaves ordinary words, references and wrong checksums alone', () => {
    for (const text of ['REFNL91ABNA0417164301', 'BE68539007547035', 'REFERENCE2026110512345', 'INVOICE12ABCDEFGHIJK', 'PAYMENT AB12CDEFGHIJKLMNOP', 'Albert Heijn Brussel 03/11', 'REFERENTIENUMMER']) {
      expect(findIbans(text)).toEqual([])
      expect(maskIban(text)).toBe(text)
    }
    expect(maskNumbers('afschrift 2026-11.pdf')).toBe('afschrift 2026-11.pdf')
  })

  // The example IBANs of the registry, one per country in the table of lengths. A wrong length for a country fails here.
  const EXAMPLES = [
    'AD1200012030200359100100', 'AE070331234567890123456', 'AL47212110090000000235698741', 'AT611904300234573201', 'AZ21NABZ00000000137010001944', 'BA391290079401028494',
    'BE68539007547034', 'BG80BNBG96611020345678', 'BH67BMAG00001299123456', 'BR1800360305000010009795493C1', 'BY13NBRB3600900000002Z00AB00', 'CH9300762011623852957',
    'CR05015202001026284066', 'CY17002001280000001200527600', 'CZ6508000000192000145399', 'DE89370400440532013000', 'DK5000400440116243', 'DO28BAGR00000001212453611324',
    'EE382200221020145685', 'EG380019000500000000263180002', 'ES9121000418450200051332', 'FI2112345600000785', 'FO6264600001631634', 'FR1420041010050500013M02606',
    'GB29NWBK60161331926819', 'GE29NB0000000101904917', 'GI75NWBK000000007099453', 'GL8964710001000206', 'GR1601101250000000012300695', 'GT82TRAJ01020000001210029690',
    'HR1210010051863000160', 'HU42117730161111101800000000', 'IE29AIBK93115212345678', 'IL620108000000099999999', 'IS140159260076545510730339', 'IT60X0542811101000000123456',
    'JO94CBJO0010000000000131000302', 'KW81CBKU0000000000001234560101', 'KZ86125KZT5004100100', 'LB62099900000001001901229114', 'LI21088100002324013AA', 'LT121000011101001000',
    'LU280019400644750000', 'LV80BANK0000435195001', 'MC5811222000010123456789030', 'MD24AG000225100013104168', 'ME25505000012345678951', 'MK07250120000058984',
    'MR1300020001010000123456753', 'MT84MALT011000012345MTLCAST001S', 'MU17BOMM0101101030300200000MUR', 'NL91ABNA0417164300', 'NO9386011117947', 'PK36SCBL0000001123456702',
    'PL61109010140000071219812874', 'PS92PALS000000000400123456702', 'PT50000201231234567890154', 'QA58DOHB00001234567890ABCDEFG', 'RO49AAAA1B31007593840000', 'RS35260005601001611379',
    'SA0380000000608010167519', 'SC18SSCB11010000000000001497USD', 'SE4550000000058398257466', 'SI56263300012039086', 'SK3112000000198742637541', 'SM86U0322509800000000270100',
    'ST68000100010051845310112', 'SV62CENR00000000000000700025', 'TL380080012345678910157', 'TN5910006035183598478831', 'TR330006100519786457841326', 'UA213223130000026007233566001',
    'VA59001123000012345678', 'VG96VPVG0000012345678901', 'XK051212012345678906'
  ]
  const grouped = (iban: string): string => iban.replace(/(.{4})(?=.)/g, '$1 ')

  it.each(EXAMPLES)('finds and masks the example IBAN %s, written plain, in groups and glued to text', (iban) => {
    expect(validIban(iban)).toBe(true)
    const last4 = iban.slice(-4)
    const mask = `${iban.slice(0, 2)}…${last4}`
    expect(findIbans(`naar ${iban} voor huur`)).toEqual([iban])
    expect(maskIban(`naar ${iban} voor huur`)).toBe(`naar ${mask} voor huur`)
    expect(findIbans(`naar ${grouped(iban)} voor huur`)).toEqual([iban])
    expect(maskIban(`naar ${grouped(iban)}.`)).toBe(`naar ${mask}.`)
    expect(findIbans(`REF${iban}`)).toEqual([iban])
    expect(maskNumbers(`REF${iban}`)).toBe(`REF${mask}`)
  })
})

// All numbers here are invented or the published examples of the IBAN standard.
describe('maskPrivate: numbers first, then contacts', () => {
  it('keeps spaced IBANs whole, also with groups that start with 00 (the phone rule must not eat them)', () => {
    expect(maskPrivate('naar DE89 3704 0044 0532 0130 00 voor huur')).toBe('naar DE…3000 voor huur')
    expect(maskPrivate('BE38 0014 7710 5230')).toBe('BE…5230')
    expect(maskPrivate('NL91 ABNA 0417 1643 00')).toBe('NL…4300')
    expect(maskPrivate('GB29 NWBK 6016 1331 9268 19 ok')).toBe('GB…6819 ok')
    expect(maskContacts(maskNumbers('DE89 3704 0044 0532 0130 00'))).toBe('DE…3000')
  })

  it('finds an IBAN with dots, hyphens, slashes, double spaces, tabs, non-breaking spaces, line breaks and zero-width characters', () => {
    for (const text of ['NL91-ABNA-0417-1643-00', 'NL91.ABNA.0417.1643.00', 'NL91/ABNA/0417/1643/00', 'NL91  ABNA  0417  1643  00', 'NL91\tABNA\t0417\t1643\t00', 'NL91\u00a0ABNA\u00a00417\u00a01643\u00a000', 'NL91 ABNA\n0417 1643\r\n00', 'NL91\u200bABNA0417164300', 'NL91\u2013ABNA\u20130417\u20131643\u201300', 'ＮＬ９１ＡＢＮＡ０４１７１６４３００'])
      expect(maskPrivate(`to ${text} thanks`), JSON.stringify(text)).toBe('to NL…4300 thanks')
    expect(maskPrivate('BE68.5390.0754.7034')).toBe('BE…7034')
  })

  it('masks card numbers written with dots, slashes, hyphens, full-width digits or line breaks', () => {
    for (const text of ['4111.1111.1111.1111', '4111/1111/1111/1111', '4111-1111-1111-1111', '４１１１ １１１１ １１１１ １１１１', '4111 1111\n1111 1111']) expect(maskPrivate(`card ${text} paid`), JSON.stringify(text)).toBe('card …1111 paid')
  })

  it('keeps dates and amounts next to numbers', () => {
    expect(maskPrivate('Ref 01-10-2026 02-10-2026 1250')).toBe('Ref 01-10-2026 02-10-2026 1250')
    expect(maskPrivate('Betaling 03-10-2026 1234567 Delhaize')).toBe('Betaling 03-10-2026 1234567 Delhaize')
    expect(maskPrivate('on 03/10/2026 and 03.10.2026 and 2026/10/03')).toBe('on 03/10/2026 and 03.10.2026 and 2026/10/03')
    expect(maskPrivate('total 1.234.567,89 and +1.234.567 and 1,234,567.89')).toBe('total 1.234.567,89 and +1.234.567 and 1,234,567.89')
    expect(maskPrivate('card 4111 1111 1111 1111 on 01-10-2026')).toBe('card …1111 on 01-10-2026')
    expect(maskPrivate('mandaat 20261001000123456789')).toBe('mandaat …6789')
  })

  it('hides international phone numbers (+ or 00) and e-mail addresses, also on odd white space', () => {
    expect(maskPrivate('call +32 475 12 34 56 now')).toBe('call …phone… now')
    expect(maskPrivate('call 0044\u00a07946\u00a00958 now')).toBe('call …phone… now')
    expect(maskPrivate('mail ilse.vermeulen@example.test bye')).toBe('mail …@… bye')
    expect(maskPrivate('ＩＬＳＥ＠example.test x')).toBe('…@… x')
  })

  it('returns the text as it came when nothing is hidden', () => {
    for (const text of ['Bakery Roos  12\n', 'tab\tseparated', 'ﬁnal 5 a@b', '1 2 3'])  expect(maskPrivate(text)).toBe(text)
  })

  it('does not change a masked text again', () => {
    for (const text of ['NL…4300', '…1111', '…@… …phone…', 'to BE…7034 and …1111 and …@…']) expect(maskPrivate(text)).toBe(text)
  })

  it('cuts first, so that a number at the cut is hidden whole', () => {
    const text = `${'a '.repeat(995)}NL91 ABNA 0417 1643 00 tail`
    const out = maskPrivate(text, 1995)
    expect(out).not.toMatch(/ABNA|0417|1643/)
    expect(out.endsWith('…')).toBe(true)
    expect(maskPrivate('short', 100)).toBe('short')
  })
})

describe('maskAccount shows at most the country and the last four', () => {
  it.each([
    ['NL91ABNA0417164300', 'NL…4300'],
    ['NL91 ABNA 0417 1643 00', 'NL…4300'],
    ['123-4567890-12', '…9012'],
    ['12345678', '…5678'],
    ['AB123456789', 'AB…6789'],
    ['XX1234567890123', 'XX…0123'],
    ['1234', '…'],
    ['AB12', '…'],
    ['', '…'],
    ['NL…4300', 'NL…4300']
  ])('%s -> %s', (value, shown) => {
    expect(maskAccount(value)).toBe(shown)
  })

  it('never returns a value of nine characters or fewer whole', () => {
    for (const v of ['12345', '123456', '1234567', '12345678', '123456789', 'AB1234567']) expect(maskAccount(v)).not.toContain(v.slice(0, 5))
  })
})

describe('masking a huge text is fast', () => {
  const huge = (unit: string): string => unit.repeat(Math.ceil(200_000 / unit.length)).slice(0, 200_000)
  it.each([
    ['no spaces', 'x'],
    ['many @', '@'],
    ['@ between letters', 'a@'],
    ['many digits', '1'],
    ['digits with spaces', '1 '],
    ['dotted letters', 'x.'],
    ['IBAN-like starts', 'ab12']
  ])('a text of 200,000 characters (%s), cut to 2,000 first', (_name, unit) => {
    const started = performance.now()
    maskPrivate(huge(unit), 2000)
    expect(performance.now() - started).toBeLessThan(process.env.CI ? 5000 : 1000)
  })

  it('finds e-mail addresses without scanning a long text over and over', () => {
    const started = performance.now()
    expect(maskContacts(`${'x'.repeat(200_000)} ilse@example.test`)).toBe(`${'x'.repeat(200_000)} …@…`)
    expect(maskContacts('@'.repeat(200_000))).toBe('@'.repeat(200_000))
    expect(performance.now() - started).toBeLessThan(process.env.CI ? 5000 : 1000)
  })
})

describe('cutText', () => {
  it('cuts a text, but never through a number: that number is left out whole', () => {
    expect(cutText('short', 60)).toBe('short')
    expect(cutText(`${'a'.repeat(50)} NL91ABNA0417164300 more`, 60)).toBe(`${'a'.repeat(50)} `)
    expect(cutText(`${'a'.repeat(50)} 4111 1111 1111 1111 more`, 60)).toBe(`${'a'.repeat(50)} `)
    expect(cutText(`${'a'.repeat(70)} NL91ABNA0417164300`, 60)).toBe('a'.repeat(60))
  })
})
