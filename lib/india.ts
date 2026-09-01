/**
 * GST state codes. The first two digits of a GSTIN encode the state of
 * registration, and comparing supplier state to place of supply is what decides
 * CGST+SGST vs IGST — so this list is load-bearing, not cosmetic.
 *
 * Code 25 (Daman & Diu) was merged into 26 in 2020 and is intentionally absent.
 * 96/97 exist so exports and unclassified territories have a valid selection.
 */
export const GST_STATES = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '96', name: 'Foreign Country (exports)' },
  { code: '97', name: 'Other Territory' },
] as const

export type GstStateCode = (typeof GST_STATES)[number]['code']

const STATE_NAME_BY_CODE = new Map(GST_STATES.map((s) => [s.code, s.name]))

export function stateName(code: string | null | undefined): string {
  if (!code) return ''
  return STATE_NAME_BY_CODE.get(code as GstStateCode) ?? ''
}

export function isValidStateCode(code: string): boolean {
  return STATE_NAME_BY_CODE.has(code as GstStateCode)
}

/** The GST slabs a user can pick per line item. */
export const GST_RATES = [0, 0.1, 0.25, 3, 5, 12, 18, 28] as const

/** Units of measure, matching the GST UQC (unit quantity code) vocabulary. */
export const UNITS = [
  'NOS',
  'PCS',
  'KGS',
  'GMS',
  'LTR',
  'MTR',
  'SQF',
  'SQM',
  'HRS',
  'DAY',
  'MON',
  'BOX',
  'SET',
  'OTH',
] as const

export type Unit = (typeof UNITS)[number]

/**
 * Indian financial year label for a date: April 1 to March 31.
 * A date of 2026-08-16 belongs to FY 26-27 and renders as "26-27".
 */
export function financialYearLabel(date: Date): string {
  const year = date.getFullYear()
  const startYear = date.getMonth() >= 3 ? year : year - 1
  const short = (y: number) => String(y % 100).padStart(2, '0')
  return `${short(startYear)}-${short(startYear + 1)}`
}
