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

import { VERIFICATION_TTL_HOURS } from '@/lib/email-verification'

/**
 * "Verify your email" — sent right after signup and from the in-app banner.
 *
 * Same constraints as the invoice email: inline styles, one button, no images.
 * The link is also printed as text because some corporate mail filters strip or
 * rewrite buttons, and a user who can't click has to be able to copy.
 */
export function VerifyEmail({ name, verifyUrl }: { name?: string | null; verifyUrl: string }) {
  return (
    <Html>
      <Head />
      <Preview>Confirm your email address for Invoice AI</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Invoice AI</Text>

          <Heading style={heading}>Verify your email</Heading>

          <Text style={paragraph}>
            {name ? `Hi ${name}, thanks` : 'Thanks'} for signing up. You can already use your account
            — confirming your address just makes sure invoices, receipts and password resets reach
            you.
          </Text>

          <Section style={{ margin: '28px 0' }}>
            <Button style={button} href={verifyUrl}>
              Verify email address
            </Button>
          </Section>

          <Text style={smallMuted}>
            Or paste this link into your browser:
            <br />
            <span style={{ wordBreak: 'break-all' }}>{verifyUrl}</span>
          </Text>

          <Hr style={rule} />

          <Text style={smallMuted}>
            The link expires in {VERIFICATION_TTL_HOURS} hours. If you didn&rsquo;t create an
            account, you can ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
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
