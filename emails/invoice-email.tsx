import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'

import { formatInvoiceDate, type InvoiceView } from '@/lib/invoice-view'
import { formatPaise } from '@/lib/money'

/**
 * The email a client receives.
 *
 * Deliberately plain: inline styles only, a single call to action, no images and
 * no web fonts. Email clients strip stylesheets, block remote images by default,
 * and Outlook will mangle anything clever — and this message has one job, which
 * is to get someone to open the invoice.
 */
export function InvoiceEmail({ view, publicUrl }: { view: InvoiceView; publicUrl: string }) {
  const supplier = view.business.trade_name || view.business.name
  const total = formatPaise(view.computed.totalPaise, view.currency)

  return (
    <Html>
      <Head />
      <Preview>{`Invoice ${view.number} from ${supplier} — ${total}`}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>{supplier}</Text>

          <Heading style={heading}>
            Invoice {view.number} — {total}
          </Heading>

          <Text style={paragraph}>
            Hi {view.client.name}, here&rsquo;s your invoice
            {view.dueDate ? `, due ${formatInvoiceDate(view.dueDate)}` : ''}. The PDF is attached,
            and you can also view it online.
          </Text>

          <Section style={{ margin: '28px 0' }}>
            <Button style={button} href={publicUrl}>
              View invoice
            </Button>
          </Section>

          <Section style={summary}>
            <Row label="Invoice" value={view.number ?? '—'} />
            <Row label="Issued" value={formatInvoiceDate(view.issueDate)} />
            {view.dueDate ? <Row label="Due" value={formatInvoiceDate(view.dueDate)} /> : null}
            <Row label="Amount due" value={total} strong />
          </Section>

          {view.terms ? <Text style={smallMuted}>{view.terms}</Text> : null}

          <Hr style={rule} />

          <Text style={smallMuted}>
            Sent by {view.business.name}
            {view.business.gstin ? ` · GSTIN ${view.business.gstin}` : ''}
            {view.business.email ? ` · ${view.business.email}` : ''}
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <table width="100%" style={{ borderCollapse: 'collapse' }}>
      <tbody>
        <tr>
          <td style={{ ...cell, color: '#6b6c80' }}>{label}</td>
          <td
            style={{
              ...cell,
              textAlign: 'right',
              fontWeight: strong ? 700 : 400,
              fontSize: strong ? '16px' : '14px',
            }}
          >
            {value}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

const body: React.CSSProperties = {
  backgroundColor: '#f7f6f3',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: '32px 0',
}

const container: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e2ea',
  borderRadius: '10px',
  margin: '0 auto',
  maxWidth: '520px',
  padding: '32px',
}

const eyebrow: React.CSSProperties = {
  color: '#6b6c80',
  fontSize: '12px',
  letterSpacing: '0.08em',
  margin: 0,
  textTransform: 'uppercase',
}

const heading: React.CSSProperties = {
  color: '#1f2033',
  fontSize: '22px',
  fontWeight: 600,
  lineHeight: 1.3,
  margin: '8px 0 0',
}

const paragraph: React.CSSProperties = {
  color: '#3c3d52',
  fontSize: '15px',
  lineHeight: 1.6,
  margin: '16px 0 0',
}

const button: React.CSSProperties = {
  backgroundColor: '#4a44b8',
  borderRadius: '8px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '15px',
  fontWeight: 600,
  padding: '12px 22px',
  textDecoration: 'none',
}

const summary: React.CSSProperties = {
  backgroundColor: '#f7f6f3',
  borderRadius: '8px',
  padding: '12px 16px',
}

const cell: React.CSSProperties = {
  fontSize: '14px',
  padding: '5px 0',
}

const rule: React.CSSProperties = {
  borderColor: '#e2e2ea',
  margin: '28px 0 16px',
}

const smallMuted: React.CSSProperties = {
  color: '#6b6c80',
  fontSize: '12px',
  lineHeight: 1.6,
  margin: '12px 0 0',
}
