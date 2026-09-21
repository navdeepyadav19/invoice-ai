/** Units of measure on a line item. Kept short so the PDF column stays readable. */
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
