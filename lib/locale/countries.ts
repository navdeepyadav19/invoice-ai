/**
 * Country, currency, and tax-preset catalog.
 *
 * Tax rates here are invoicing defaults, not a compliance engine. Users can
 * always type a custom percentage on a line.
 */

export type TaxPreset = {
  label: string
  rate: number
}

export type Country = {
  code: string
  name: string
  currency: string
  locale: string
}

const NONE: TaxPreset[] = [{ label: 'No tax', rate: 0 }]

function vat(standard: number, reduced?: number): TaxPreset[] {
  const rates: TaxPreset[] = [{ label: 'Zero rated', rate: 0 }]
  if (reduced != null && reduced > 0) rates.push({ label: 'Reduced', rate: reduced })
  rates.push({ label: 'VAT', rate: standard })
  return rates
}

/** Standard / reduced presets. Unlisted countries get "No tax". */
const TAX_PRESETS: Record<string, TaxPreset[]> = {
  AT: vat(20, 10),
  AU: vat(10),
  BE: vat(21, 6),
  BG: vat(20, 9),
  CA: [
    { label: 'No tax', rate: 0 },
    { label: 'GST 5%', rate: 5 },
    { label: 'HST 13%', rate: 13 },
  ],
  CH: vat(8.1, 2.6),
  CY: vat(19, 9),
  CZ: vat(21, 12),
  DE: vat(19, 7),
  DK: vat(25),
  EE: vat(22, 9),
  ES: vat(21, 10),
  FI: vat(25.5, 14),
  FR: vat(20, 10),
  GB: vat(20, 5),
  GR: vat(24, 13),
  HR: vat(25, 13),
  HU: vat(27, 5),
  IE: vat(23, 13.5),
  IN: [
    { label: 'Exempt', rate: 0 },
    { label: 'GST 5%', rate: 5 },
    { label: 'GST 12%', rate: 12 },
    { label: 'GST 18%', rate: 18 },
    { label: 'GST 28%', rate: 28 },
  ],
  IT: vat(22, 10),
  LT: vat(21, 9),
  LU: vat(17, 8),
  LV: vat(21, 12),
  MT: vat(18, 5),
  MX: vat(16),
  MY: vat(8),
  NL: vat(21, 9),
  NZ: vat(15),
  PL: vat(23, 8),
  PT: vat(23, 6),
  RO: vat(19, 9),
  SE: vat(25, 12),
  SG: vat(9),
  SI: vat(22, 9.5),
  SK: vat(23, 10),
  ZA: vat(15),
  AE: vat(5),
  SA: vat(15),
  ID: vat(12),
  PH: vat(12),
  KR: vat(10),
  JP: vat(10),
  TR: vat(20, 10),
  IL: vat(18),
  NO: vat(25, 15),
  US: [{ label: 'No tax', rate: 0 }, { label: 'Sales tax', rate: 7.25 }],
  BR: vat(17),
  NG: vat(7.5),
  KE: vat(16),
  EG: vat(14),
  TH: vat(7),
  VN: vat(10),
  AR: vat(21, 10.5),
  CL: vat(19),
  CO: vat(19),
  PE: vat(18),
}

/**
 * Compact ISO 3166-1 rows: code, name, currency, locale.
 * Arithmetic uses 2 decimals throughout; display uses Intl per locale.
 */
const ROWS: [string, string, string, string][] = [
  ['AD', 'Andorra', 'EUR', 'ca-AD'],
  ['AE', 'United Arab Emirates', 'AED', 'ar-AE'],
  ['AF', 'Afghanistan', 'AFN', 'fa-AF'],
  ['AG', 'Antigua and Barbuda', 'XCD', 'en-AG'],
  ['AI', 'Anguilla', 'XCD', 'en-AI'],
  ['AL', 'Albania', 'ALL', 'sq-AL'],
  ['AM', 'Armenia', 'AMD', 'hy-AM'],
  ['AO', 'Angola', 'AOA', 'pt-AO'],
  ['AR', 'Argentina', 'ARS', 'es-AR'],
  ['AS', 'American Samoa', 'USD', 'en-AS'],
  ['AT', 'Austria', 'EUR', 'de-AT'],
  ['AU', 'Australia', 'AUD', 'en-AU'],
  ['AW', 'Aruba', 'AWG', 'nl-AW'],
  ['AZ', 'Azerbaijan', 'AZN', 'az-AZ'],
  ['BA', 'Bosnia and Herzegovina', 'BAM', 'bs-BA'],
  ['BB', 'Barbados', 'BBD', 'en-BB'],
  ['BD', 'Bangladesh', 'BDT', 'bn-BD'],
  ['BE', 'Belgium', 'EUR', 'nl-BE'],
  ['BF', 'Burkina Faso', 'XOF', 'fr-BF'],
  ['BG', 'Bulgaria', 'BGN', 'bg-BG'],
  ['BH', 'Bahrain', 'BHD', 'ar-BH'],
  ['BI', 'Burundi', 'BIF', 'fr-BI'],
  ['BJ', 'Benin', 'XOF', 'fr-BJ'],
  ['BM', 'Bermuda', 'BMD', 'en-BM'],
  ['BN', 'Brunei', 'BND', 'ms-BN'],
  ['BO', 'Bolivia', 'BOB', 'es-BO'],
  ['BR', 'Brazil', 'BRL', 'pt-BR'],
  ['BS', 'Bahamas', 'BSD', 'en-BS'],
  ['BT', 'Bhutan', 'BTN', 'dz-BT'],
  ['BW', 'Botswana', 'BWP', 'en-BW'],
  ['BY', 'Belarus', 'BYN', 'be-BY'],
  ['BZ', 'Belize', 'BZD', 'en-BZ'],
  ['CA', 'Canada', 'CAD', 'en-CA'],
  ['CD', 'Congo (DRC)', 'CDF', 'fr-CD'],
  ['CF', 'Central African Republic', 'XAF', 'fr-CF'],
  ['CG', 'Congo', 'XAF', 'fr-CG'],
  ['CH', 'Switzerland', 'CHF', 'de-CH'],
  ['CI', "Côte d'Ivoire", 'XOF', 'fr-CI'],
  ['CK', 'Cook Islands', 'NZD', 'en-CK'],
  ['CL', 'Chile', 'CLP', 'es-CL'],
  ['CM', 'Cameroon', 'XAF', 'fr-CM'],
  ['CN', 'China', 'CNY', 'zh-CN'],
  ['CO', 'Colombia', 'COP', 'es-CO'],
  ['CR', 'Costa Rica', 'CRC', 'es-CR'],
  ['CU', 'Cuba', 'CUP', 'es-CU'],
  ['CV', 'Cabo Verde', 'CVE', 'pt-CV'],
  ['CW', 'Curaçao', 'ANG', 'nl-CW'],
  ['CY', 'Cyprus', 'EUR', 'el-CY'],
  ['CZ', 'Czechia', 'CZK', 'cs-CZ'],
  ['DE', 'Germany', 'EUR', 'de-DE'],
  ['DJ', 'Djibouti', 'DJF', 'fr-DJ'],
  ['DK', 'Denmark', 'DKK', 'da-DK'],
  ['DM', 'Dominica', 'XCD', 'en-DM'],
  ['DO', 'Dominican Republic', 'DOP', 'es-DO'],
  ['DZ', 'Algeria', 'DZD', 'ar-DZ'],
  ['EC', 'Ecuador', 'USD', 'es-EC'],
  ['EE', 'Estonia', 'EUR', 'et-EE'],
  ['EG', 'Egypt', 'EGP', 'ar-EG'],
  ['ER', 'Eritrea', 'ERN', 'ti-ER'],
  ['ES', 'Spain', 'EUR', 'es-ES'],
  ['ET', 'Ethiopia', 'ETB', 'am-ET'],
  ['FI', 'Finland', 'EUR', 'fi-FI'],
  ['FJ', 'Fiji', 'FJD', 'en-FJ'],
  ['FK', 'Falkland Islands', 'FKP', 'en-FK'],
  ['FM', 'Micronesia', 'USD', 'en-FM'],
  ['FO', 'Faroe Islands', 'DKK', 'fo-FO'],
  ['FR', 'France', 'EUR', 'fr-FR'],
  ['GA', 'Gabon', 'XAF', 'fr-GA'],
  ['GB', 'United Kingdom', 'GBP', 'en-GB'],
  ['GD', 'Grenada', 'XCD', 'en-GD'],
  ['GE', 'Georgia', 'GEL', 'ka-GE'],
  ['GF', 'French Guiana', 'EUR', 'fr-GF'],
  ['GG', 'Guernsey', 'GBP', 'en-GG'],
  ['GH', 'Ghana', 'GHS', 'en-GH'],
  ['GI', 'Gibraltar', 'GIP', 'en-GI'],
  ['GL', 'Greenland', 'DKK', 'kl-GL'],
  ['GM', 'Gambia', 'GMD', 'en-GM'],
  ['GN', 'Guinea', 'GNF', 'fr-GN'],
  ['GP', 'Guadeloupe', 'EUR', 'fr-GP'],
  ['GQ', 'Equatorial Guinea', 'XAF', 'es-GQ'],
  ['GR', 'Greece', 'EUR', 'el-GR'],
  ['GT', 'Guatemala', 'GTQ', 'es-GT'],
  ['GU', 'Guam', 'USD', 'en-GU'],
  ['GW', 'Guinea-Bissau', 'XOF', 'pt-GW'],
  ['GY', 'Guyana', 'GYD', 'en-GY'],
  ['HK', 'Hong Kong', 'HKD', 'zh-HK'],
  ['HN', 'Honduras', 'HNL', 'es-HN'],
  ['HR', 'Croatia', 'EUR', 'hr-HR'],
  ['HT', 'Haiti', 'HTG', 'fr-HT'],
  ['HU', 'Hungary', 'HUF', 'hu-HU'],
  ['ID', 'Indonesia', 'IDR', 'id-ID'],
  ['IE', 'Ireland', 'EUR', 'en-IE'],
  ['IL', 'Israel', 'ILS', 'he-IL'],
  ['IM', 'Isle of Man', 'GBP', 'en-IM'],
  ['IN', 'India', 'INR', 'en-IN'],
  ['IQ', 'Iraq', 'IQD', 'ar-IQ'],
  ['IR', 'Iran', 'IRR', 'fa-IR'],
  ['IS', 'Iceland', 'ISK', 'is-IS'],
  ['IT', 'Italy', 'EUR', 'it-IT'],
  ['JE', 'Jersey', 'GBP', 'en-JE'],
  ['JM', 'Jamaica', 'JMD', 'en-JM'],
  ['JO', 'Jordan', 'JOD', 'ar-JO'],
  ['JP', 'Japan', 'JPY', 'ja-JP'],
  ['KE', 'Kenya', 'KES', 'en-KE'],
  ['KG', 'Kyrgyzstan', 'KGS', 'ky-KG'],
  ['KH', 'Cambodia', 'KHR', 'km-KH'],
  ['KI', 'Kiribati', 'AUD', 'en-KI'],
  ['KM', 'Comoros', 'KMF', 'ar-KM'],
  ['KN', 'Saint Kitts and Nevis', 'XCD', 'en-KN'],
  ['KR', 'South Korea', 'KRW', 'ko-KR'],
  ['KW', 'Kuwait', 'KWD', 'ar-KW'],
  ['KY', 'Cayman Islands', 'KYD', 'en-KY'],
  ['KZ', 'Kazakhstan', 'KZT', 'kk-KZ'],
  ['LA', 'Laos', 'LAK', 'lo-LA'],
  ['LB', 'Lebanon', 'LBP', 'ar-LB'],
  ['LC', 'Saint Lucia', 'XCD', 'en-LC'],
  ['LI', 'Liechtenstein', 'CHF', 'de-LI'],
  ['LK', 'Sri Lanka', 'LKR', 'si-LK'],
  ['LR', 'Liberia', 'LRD', 'en-LR'],
  ['LS', 'Lesotho', 'LSL', 'en-LS'],
  ['LT', 'Lithuania', 'EUR', 'lt-LT'],
  ['LU', 'Luxembourg', 'EUR', 'fr-LU'],
  ['LV', 'Latvia', 'EUR', 'lv-LV'],
  ['LY', 'Libya', 'LYD', 'ar-LY'],
  ['MA', 'Morocco', 'MAD', 'ar-MA'],
  ['MC', 'Monaco', 'EUR', 'fr-MC'],
  ['MD', 'Moldova', 'MDL', 'ro-MD'],
  ['ME', 'Montenegro', 'EUR', 'sr-ME'],
  ['MG', 'Madagascar', 'MGA', 'fr-MG'],
  ['MH', 'Marshall Islands', 'USD', 'en-MH'],
  ['MK', 'North Macedonia', 'MKD', 'mk-MK'],
  ['ML', 'Mali', 'XOF', 'fr-ML'],
  ['MM', 'Myanmar', 'MMK', 'my-MM'],
  ['MN', 'Mongolia', 'MNT', 'mn-MN'],
  ['MO', 'Macao', 'MOP', 'zh-MO'],
  ['MP', 'Northern Mariana Islands', 'USD', 'en-MP'],
  ['MQ', 'Martinique', 'EUR', 'fr-MQ'],
  ['MR', 'Mauritania', 'MRU', 'ar-MR'],
  ['MS', 'Montserrat', 'XCD', 'en-MS'],
  ['MT', 'Malta', 'EUR', 'mt-MT'],
  ['MU', 'Mauritius', 'MUR', 'en-MU'],
  ['MV', 'Maldives', 'MVR', 'dv-MV'],
  ['MW', 'Malawi', 'MWK', 'en-MW'],
  ['MX', 'Mexico', 'MXN', 'es-MX'],
  ['MY', 'Malaysia', 'MYR', 'ms-MY'],
  ['MZ', 'Mozambique', 'MZN', 'pt-MZ'],
  ['NA', 'Namibia', 'NAD', 'en-NA'],
  ['NC', 'New Caledonia', 'XPF', 'fr-NC'],
  ['NE', 'Niger', 'XOF', 'fr-NE'],
  ['NG', 'Nigeria', 'NGN', 'en-NG'],
  ['NI', 'Nicaragua', 'NIO', 'es-NI'],
  ['NL', 'Netherlands', 'EUR', 'nl-NL'],
  ['NO', 'Norway', 'NOK', 'nb-NO'],
  ['NP', 'Nepal', 'NPR', 'ne-NP'],
  ['NR', 'Nauru', 'AUD', 'en-NR'],
  ['NU', 'Niue', 'NZD', 'en-NU'],
  ['NZ', 'New Zealand', 'NZD', 'en-NZ'],
  ['OM', 'Oman', 'OMR', 'ar-OM'],
  ['PA', 'Panama', 'PAB', 'es-PA'],
  ['PE', 'Peru', 'PEN', 'es-PE'],
  ['PF', 'French Polynesia', 'XPF', 'fr-PF'],
  ['PG', 'Papua New Guinea', 'PGK', 'en-PG'],
  ['PH', 'Philippines', 'PHP', 'en-PH'],
  ['PK', 'Pakistan', 'PKR', 'ur-PK'],
  ['PL', 'Poland', 'PLN', 'pl-PL'],
  ['PM', 'Saint Pierre and Miquelon', 'EUR', 'fr-PM'],
  ['PR', 'Puerto Rico', 'USD', 'es-PR'],
  ['PS', 'Palestine', 'ILS', 'ar-PS'],
  ['PT', 'Portugal', 'EUR', 'pt-PT'],
  ['PW', 'Palau', 'USD', 'en-PW'],
  ['PY', 'Paraguay', 'PYG', 'es-PY'],
  ['QA', 'Qatar', 'QAR', 'ar-QA'],
  ['RE', 'Réunion', 'EUR', 'fr-RE'],
  ['RO', 'Romania', 'RON', 'ro-RO'],
  ['RS', 'Serbia', 'RSD', 'sr-RS'],
  ['RU', 'Russia', 'RUB', 'ru-RU'],
  ['RW', 'Rwanda', 'RWF', 'rw-RW'],
  ['SA', 'Saudi Arabia', 'SAR', 'ar-SA'],
  ['SB', 'Solomon Islands', 'SBD', 'en-SB'],
  ['SC', 'Seychelles', 'SCR', 'en-SC'],
  ['SD', 'Sudan', 'SDG', 'ar-SD'],
  ['SE', 'Sweden', 'SEK', 'sv-SE'],
  ['SG', 'Singapore', 'SGD', 'en-SG'],
  ['SI', 'Slovenia', 'EUR', 'sl-SI'],
  ['SK', 'Slovakia', 'EUR', 'sk-SK'],
  ['SL', 'Sierra Leone', 'SLE', 'en-SL'],
  ['SM', 'San Marino', 'EUR', 'it-SM'],
  ['SN', 'Senegal', 'XOF', 'fr-SN'],
  ['SO', 'Somalia', 'SOS', 'so-SO'],
  ['SR', 'Suriname', 'SRD', 'nl-SR'],
  ['SS', 'South Sudan', 'SSP', 'en-SS'],
  ['ST', 'São Tomé and Príncipe', 'STN', 'pt-ST'],
  ['SV', 'El Salvador', 'USD', 'es-SV'],
  ['SX', 'Sint Maarten', 'ANG', 'en-SX'],
  ['SY', 'Syria', 'SYP', 'ar-SY'],
  ['SZ', 'Eswatini', 'SZL', 'en-SZ'],
  ['TC', 'Turks and Caicos Islands', 'USD', 'en-TC'],
  ['TD', 'Chad', 'XAF', 'fr-TD'],
  ['TG', 'Togo', 'XOF', 'fr-TG'],
  ['TH', 'Thailand', 'THB', 'th-TH'],
  ['TJ', 'Tajikistan', 'TJS', 'tg-TJ'],
  ['TL', 'Timor-Leste', 'USD', 'pt-TL'],
  ['TM', 'Turkmenistan', 'TMT', 'tk-TM'],
  ['TN', 'Tunisia', 'TND', 'ar-TN'],
  ['TO', 'Tonga', 'TOP', 'to-TO'],
  ['TR', 'Türkiye', 'TRY', 'tr-TR'],
  ['TT', 'Trinidad and Tobago', 'TTD', 'en-TT'],
  ['TV', 'Tuvalu', 'AUD', 'en-TV'],
  ['TW', 'Taiwan', 'TWD', 'zh-TW'],
  ['TZ', 'Tanzania', 'TZS', 'sw-TZ'],
  ['UA', 'Ukraine', 'UAH', 'uk-UA'],
  ['UG', 'Uganda', 'UGX', 'en-UG'],
  ['US', 'United States', 'USD', 'en-US'],
  ['UY', 'Uruguay', 'UYU', 'es-UY'],
  ['UZ', 'Uzbekistan', 'UZS', 'uz-UZ'],
  ['VA', 'Vatican City', 'EUR', 'it-VA'],
  ['VC', 'Saint Vincent and the Grenadines', 'XCD', 'en-VC'],
  ['VE', 'Venezuela', 'VES', 'es-VE'],
  ['VG', 'British Virgin Islands', 'USD', 'en-VG'],
  ['VI', 'U.S. Virgin Islands', 'USD', 'en-VI'],
  ['VN', 'Vietnam', 'VND', 'vi-VN'],
  ['VU', 'Vanuatu', 'VUV', 'en-VU'],
  ['WF', 'Wallis and Futuna', 'XPF', 'fr-WF'],
  ['WS', 'Samoa', 'WST', 'en-WS'],
  ['XK', 'Kosovo', 'EUR', 'sq-XK'],
  ['YE', 'Yemen', 'YER', 'ar-YE'],
  ['YT', 'Mayotte', 'EUR', 'fr-YT'],
  ['ZA', 'South Africa', 'ZAR', 'en-ZA'],
  ['ZM', 'Zambia', 'ZMW', 'en-ZM'],
  ['ZW', 'Zimbabwe', 'ZWG', 'en-ZW'],
]

export const FALLBACK_COUNTRY_CODE = 'US'

export const COUNTRIES: Country[] = ROWS.map(([code, name, currency, locale]) => ({
  code,
  name,
  currency,
  locale,
}))

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]))

export const CURRENCIES = [...new Set(COUNTRIES.map((c) => c.currency))].sort()

export function isCountryCode(code: string): boolean {
  return BY_CODE.has(code.toUpperCase())
}

export function countryByCode(code: string | null | undefined): Country {
  if (!code) return BY_CODE.get(FALLBACK_COUNTRY_CODE)!
  return BY_CODE.get(code.toUpperCase()) ?? BY_CODE.get(FALLBACK_COUNTRY_CODE)!
}

export function countryName(code: string | null | undefined): string {
  if (!code) return ''
  return BY_CODE.get(code.toUpperCase())?.name ?? code
}

export function localeForCountry(code: string | null | undefined): string {
  return countryByCode(code).locale
}

export function localeForCurrency(currency: string, countryCode?: string | null): string {
  if (countryCode) {
    const country = BY_CODE.get(countryCode.toUpperCase())
    if (country && country.currency === currency) return country.locale
  }
  const match = COUNTRIES.find((c) => c.currency === currency)
  return match?.locale ?? 'en-US'
}

export function taxPresetsForCountry(code: string | null | undefined): TaxPreset[] {
  if (!code) return NONE
  return TAX_PRESETS[code.toUpperCase()] ?? NONE
}

export function defaultTaxRate(code: string | null | undefined): number {
  const presets = taxPresetsForCountry(code)
  const charged = [...presets].reverse().find((p) => p.rate > 0)
  return charged?.rate ?? 0
}

export function defaultsForCountry(code: string | null | undefined) {
  const country = countryByCode(code)
  return {
    country,
    currency: country.currency,
    locale: country.locale,
    taxRates: taxPresetsForCountry(country.code),
    defaultTaxRate: defaultTaxRate(country.code),
  }
}
