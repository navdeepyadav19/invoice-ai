import path from 'node:path'

import { Document, Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

import { formatInvoiceDate, formatPartyAddress, type InvoiceView } from '@/lib/invoice-view'
import { formatPaise, formatPaisePlain } from '@/lib/money'
import { countryName, localeForCountry } from '@/lib/locale/countries'

/**
 * The PDF rendition of an invoice.
 *
 * react-pdf has its own primitives, so this is a deliberate second
 * implementation of components/invoice/invoice-document.tsx rather than a shared
 * one. Both read the same InvoiceView, which is what keeps them saying the same
 * thing — the numbers are computed once, upstream, and neither template does any
 * arithmetic of its own.
 */

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts')

let fontsRegistered = false

function registerFonts() {
  if (fontsRegistered) return

  Font.register({
    family: 'Noto Sans',
    fonts: [
      { src: path.join(FONT_DIR, 'NotoSans-Regular.ttf'), fontWeight: 400 },
      { src: path.join(FONT_DIR, 'NotoSans-SemiBold.ttf'), fontWeight: 600 },
      { src: path.join(FONT_DIR, 'NotoSans-Bold.ttf'), fontWeight: 700 },
    ],
  })

  // react-pdf hyphenates by default, which turns "Consulting" into "Con-sulting"
  // in a narrow description column. An invoice should wrap, not hyphenate.
  Font.registerHyphenationCallback((word) => [word])

  fontsRegistered = true
}

const INK = '#1f2033'
const MUTED = '#6b6c80'
const RULE = '#e2e2ea'

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Noto Sans',
    fontSize: 9,
    color: INK,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    lineHeight: 1.45,
  },
  row: { flexDirection: 'row' },
  spread: { flexDirection: 'row', justifyContent: 'space-between' },

  docType: { fontSize: 7, letterSpacing: 1.4, color: MUTED, textTransform: 'uppercase' },
  supplierName: { fontSize: 13, fontWeight: 600, marginTop: 4 },
  invoiceNumber: { fontSize: 12, fontWeight: 600 },
  muted: { color: MUTED },
  small: { fontSize: 8 },
  label: { fontSize: 7, letterSpacing: 1.2, color: MUTED, textTransform: 'uppercase' },

  hr: { borderBottomWidth: 1, borderBottomColor: RULE, marginVertical: 14 },

  parties: { flexDirection: 'row', justifyContent: 'space-between', gap: 24 },
  party: { width: '48%' },

  thead: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    paddingBottom: 5,
    marginBottom: 2,
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
    paddingVertical: 6,
  },
  cDesc: { width: '46%', paddingRight: 8 },
  cQty: { width: '13%', textAlign: 'right', paddingRight: 8 },
  cRate: { width: '15%', textAlign: 'right', paddingRight: 8 },
  cGst: { width: '10%', textAlign: 'right', paddingRight: 8 },
  cAmt: { width: '16%', textAlign: 'right' },

  totals: { width: 200, marginLeft: 'auto', marginTop: 14 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 },
  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: RULE,
    marginTop: 6,
    paddingTop: 6,
  },
  grand: { fontSize: 12, fontWeight: 700 },

  footerBlock: { marginTop: 22 },
  declaration: {
    marginTop: 16,
    fontSize: 7.5,
    color: MUTED,
    borderTopWidth: 1,
    borderTopColor: RULE,
    paddingTop: 8,
  },
  pageNumber: {
    position: 'absolute',
    bottom: 26,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 7.5,
    color: MUTED,
  },
})

export function InvoicePdf({ view }: { view: InvoiceView }) {
  registerFonts()

  const { business, client, computed } = view
  const locale = localeForCountry(business.country_code)

  return (
    <Document
      title={`Invoice ${view.number ?? 'draft'}`}
      author={business.name}
      subject={`Invoice for ${client.name}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.spread}>
          <View style={{ width: '58%' }}>
            <Text style={styles.docType}>Invoice</Text>
            <Text style={styles.supplierName}>{business.trade_name || business.name}</Text>
            {business.trade_name ? (
              <Text style={[styles.small, styles.muted]}>{business.name}</Text>
            ) : null}

            {formatPartyAddress(business).map((line) => (
              <Text key={line} style={[styles.small, styles.muted]}>
                {line}
              </Text>
            ))}
            {business.tax_id ? <Text style={styles.small}>Tax ID {business.tax_id}</Text> : null}
            {business.email ? (
              <Text style={[styles.small, styles.muted]}>{business.email}</Text>
            ) : null}
            {business.phone ? (
              <Text style={[styles.small, styles.muted]}>{business.phone}</Text>
            ) : null}
          </View>

          <View style={{ width: '38%', alignItems: 'flex-end' }}>
            <Text style={styles.invoiceNumber}>{view.number ?? 'Draft'}</Text>
            <View style={{ marginTop: 6, alignItems: 'flex-end' }}>
              <Text style={styles.small}>
                <Text style={styles.muted}>Issued </Text>
                {formatInvoiceDate(view.issueDate)}
              </Text>
              {view.dueDate ? (
                <Text style={styles.small}>
                  <Text style={styles.muted}>Due </Text>
                  {formatInvoiceDate(view.dueDate)}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.hr} />

        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.label}>Bill to</Text>
            <Text style={{ fontWeight: 600, marginTop: 3 }}>{client.name}</Text>
            {formatPartyAddress(client).map((line) => (
              <Text key={line} style={[styles.small, styles.muted]}>
                {line}
              </Text>
            ))}
            {client.tax_id ? <Text style={styles.small}>Tax ID {client.tax_id}</Text> : null}
          </View>

          <View style={[styles.party, { alignItems: 'flex-end' }]}>
            <Text style={styles.label}>Billed from</Text>
            <Text style={{ fontWeight: 600, marginTop: 3 }}>
              {countryName(business.country_code)}
            </Text>
            <Text style={[styles.small, styles.muted]}>Currency {view.currency}</Text>
          </View>
        </View>

        <View style={{ marginTop: 18 }}>
          <View style={styles.thead} fixed>
            <Text style={[styles.cDesc, styles.label]}>Description</Text>
            <Text style={[styles.cQty, styles.label]}>Qty</Text>
            <Text style={[styles.cRate, styles.label]}>Rate</Text>
            <Text style={[styles.cGst, styles.label]}>Tax</Text>
            <Text style={[styles.cAmt, styles.label]}>Amount</Text>
          </View>

          {computed.lines.map((line, index) => (
            <View key={index} style={styles.tr} wrap={false}>
              <View style={styles.cDesc}>
                <Text>{line.description}</Text>
                {line.discountPercent > 0 ? (
                  <Text style={[styles.small, styles.muted]}>−{line.discountPercent}%</Text>
                ) : null}
              </View>
              <Text style={styles.cQty}>
                {line.quantity} {line.unit}
              </Text>
              <Text style={styles.cRate}>{formatPaisePlain(Math.round(line.rate * 100), locale)}</Text>
              <Text style={styles.cGst}>{line.taxRate}%</Text>
              <Text style={styles.cAmt}>{formatPaisePlain(line.taxableMinor, locale)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <TotalRow label="Subtotal" value={formatPaisePlain(computed.subtotalMinor, locale)} />
          {computed.discountTotalMinor > 0 ? (
            <TotalRow label="Discount" value={`−${formatPaisePlain(computed.discountTotalMinor, locale)}`} />
          ) : null}
          <TotalRow label="Taxable value" value={formatPaisePlain(computed.taxableTotalMinor, locale)} />
          {computed.taxTotalMinor > 0 ? (
            <TotalRow label="Tax" value={formatPaisePlain(computed.taxTotalMinor, locale)} />
          ) : null}

          <View style={styles.grandRow}>
            <Text style={{ fontWeight: 600 }}>Total</Text>
            <Text style={styles.grand}>{formatPaise(computed.totalMinor, view.currency, locale)}</Text>
          </View>

          <Text style={[styles.small, styles.muted, { marginTop: 4 }]}>
            {computed.amountInWords}
          </Text>
        </View>

        <View style={styles.footerBlock}>
          {view.notes ? (
            <View style={{ marginBottom: 8 }}>
              <Text style={{ fontWeight: 600 }}>Notes</Text>
              <Text style={[styles.small, styles.muted]}>{view.notes}</Text>
            </View>
          ) : null}

          {view.terms ? (
            <View style={{ marginBottom: 8 }}>
              <Text style={{ fontWeight: 600 }}>Terms</Text>
              <Text style={[styles.small, styles.muted]}>{view.terms}</Text>
            </View>
          ) : null}

          <PaymentBlock view={view} />
        </View>

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `${pageNumber} of ${totalPages}` : ''
          }
          fixed
        />
      </Page>
    </Document>
  )
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.totalRow}>
      <Text style={styles.muted}>{label}</Text>
      <Text>{value}</Text>
    </View>
  )
}

function PaymentBlock({ view }: { view: InvoiceView }) {
  const payment = view.business.payment
  if (!payment) return null
  if (!payment.bank_name && !payment.account_number) return null

  return (
    <View>
      <Text style={{ fontWeight: 600 }}>Payment details</Text>
      {payment.account_name ? (
        <Text style={[styles.small, styles.muted]}>{payment.account_name}</Text>
      ) : null}
      {payment.bank_name ? (
        <Text style={[styles.small, styles.muted]}>{payment.bank_name}</Text>
      ) : null}
      {payment.account_number ? (
        <Text style={[styles.small, styles.muted]}>A/C {payment.account_number}</Text>
      ) : null}
      {payment.routing_number ? (
        <Text style={[styles.small, styles.muted]}>Routing {payment.routing_number}</Text>
      ) : null}
    </View>
  )
}
