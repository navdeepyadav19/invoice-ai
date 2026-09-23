
# Invoice AI: Account Setup, Guest Mode & Onboarding

> Create an account with email, use guest mode with no signup, complete the onboarding wizard, claim a guest account, and reset your password.

Invoice AI is designed to get out of your way. You can create a professional invoice before you've created an account — and when you do sign up, everything you've already made comes with you. This page covers every path into Invoice AI: signing up with email, starting as a guest, completing onboarding, upgrading a guest account, and resetting your password.

***

## Sign up with email

If you want a permanent account from the start, use the standard signup flow.

<Steps>
  <Step title="Open the signup page">
    Go to [https://invoice.horizonpay.co/signup](https://invoice.horizonpay.co/signup), or click **Create account** on the landing page.
  </Step>

  <Step title="Enter your details">
    Provide your name, email address, and a password of at least 8 characters. Then click **Create account**.
  </Step>

  <Step title="Confirm your email">
    Invoice AI sends a confirmation link to the address you entered. Click the link to verify your email and activate your account.

    <Note>
      If the confirmation email doesn't arrive within a few minutes, check your spam folder. You can request a new link from the confirmation screen.
    </Note>
  </Step>

  <Step title="Complete the onboarding wizard">
    After confirming your email, Invoice AI takes you through the two-step onboarding wizard to set up your business profile. See [Onboarding wizard](#onboarding-wizard) below for the full walkthrough.
  </Step>
</Steps>

***

## Guest mode

You don't need an account to create an invoice. Guest mode lets you start immediately — no email, no password, no setup required.

<Steps>
  <Step title="Click 'Create an invoice'">
    On the Invoice AI landing page, click the **Create an invoice** button. Invoice AI signs you in anonymously in the background and opens the invoice builder directly.
  </Step>

  <Step title="Fill in the invoice builder">
    Because you haven't set up a business profile yet, Invoice AI asks for your business details inline in the builder the first time you create an invoice. Add your business name, country, currency, and address as you go.
  </Step>

  <Step title="Finalize and share">
    Complete your invoice and finalize it to get a PDF and a shareable link — exactly the same as a signed-in user.
  </Step>
</Steps>

<Warning>
  Guest data is kept for **30 days**. After that, your invoices and business details are deleted. To keep your work permanently, [claim your guest account](#claiming-a-guest-account) before the 30-day window closes.
</Warning>

<Tip>
  Guest mode is the fastest way to raise your first invoice. There's no downside — claiming your account later takes under a minute and your invoices stay exactly where they are.
</Tip>

***

## Onboarding wizard

When you sign up with email, Invoice AI walks you through a two-step wizard before you reach the dashboard. Your progress is saved automatically, so you can close the tab and resume exactly where you left off.

### Step 1 — Business details

<Steps>
  <Step title="Confirm your country and currency">
    Invoice AI pre-selects your country based on your IP address. Change it if needed — the currency updates automatically to match your country's default. You can override the currency if you invoice in a different one.
  </Step>

  <Step title="Add your address">
    Enter your business address. This appears on every invoice you send, so use the address your clients and tax authority expect to see.

    | Field          | Required? |
    | -------------- | --------- |
    | Business name  | Yes       |
    | Country        | Yes       |
    | Currency       | Yes       |
    | Address line 1 | Yes       |
    | Address line 2 | Optional  |
    | City           | Yes       |
    | Region / State | Optional  |
    | Postal code    | Optional  |
  </Step>

  <Step title="Add an optional tax ID">
    If you're registered for tax — VAT, EIN, GST, ABN, or any other format — enter your tax ID here. Invoice AI doesn't validate the format; enter it exactly as it appears on your registration. You can leave this blank and add it later in **Settings → Business**.
  </Step>
</Steps>

### Step 2 — Payment details

This step adds your bank account information to the footer of every invoice so clients know how to pay you.

| Field          | Description                                                                |
| -------------- | -------------------------------------------------------------------------- |
| Bank name      | Your bank's name                                                           |
| Account name   | The name on the account                                                    |
| Account number | Your account number                                                        |
| Routing number | Sort code, BSB, IFSC, or routing number — whatever applies to your country |

<Tip>
  You can skip this step and add your payment details later under **Settings → Business**. Skipping doesn't block you from creating invoices; it just means the payment details section of your invoices will be blank until you fill it in.
</Tip>

***

## Claiming a guest account

If you started in guest mode and want to keep your invoices permanently, claim your account by adding an email address and password. Your existing invoices, clients, and business details stay attached to the same account — nothing is copied or migrated.

<Steps>
  <Step title="Open the claim page">
    From anywhere in the app, look for the **Save your work** prompt, or navigate directly to [https://invoice.horizonpay.co/claim](https://invoice.horizonpay.co/claim).
  </Step>

  <Step title="Enter an email address and password">
    Choose an email address and a password of at least 8 characters. Click **Claim account**.
  </Step>

  <Step title="Confirm your email">
    Invoice AI sends a confirmation link to the address you entered. Click the link to activate the account.

    After confirmation, your guest session is upgraded to a permanent account. All your invoices are already there — no import needed.

    <Note>
      Invoice AI shows you how many invoices are attached to your guest session on the claim page, so you know exactly what will be saved.
    </Note>
  </Step>
</Steps>

### If the email address is already taken

If the email you enter belongs to an existing Invoice AI account, Invoice AI starts a merge flow:

<Steps>
  <Step title="See the conflict notice">
    Invoice AI tells you that the email address already has an account and asks whether you want to merge your guest data into it.
  </Step>

  <Step title="Sign in to the existing account">
    Click **Sign in** and enter the password for the existing account. Invoice AI re-parents all your guest invoices to the account you sign in to.
  </Step>

  <Step title="Your work is transferred">
    After signing in, your guest invoices appear in the existing account's dashboard. The merge happens automatically — no manual steps required.
  </Step>
</Steps>

<Warning>
  The merge window is **30 minutes**. If you don't complete the sign-in within that window, start the claim process again to get a fresh merge token.
</Warning>

***

## Resetting your password

If you've forgotten your password, Invoice AI can email you a reset link.

<Steps>
  <Step title="Open the forgot-password page">
    Go to [https://invoice.horizonpay.co/forgot-password](https://invoice.horizonpay.co/forgot-password), or click **Forgot your password?** on the sign-in page.
  </Step>

  <Step title="Enter your email address">
    Type the email address you signed up with and click **Send reset link**.

    <Note>
      Invoice AI returns the same confirmation message whether or not the email address has an account. This prevents account enumeration — if you don't receive an email, check that you're using the correct address.
    </Note>
  </Step>

  <Step title="Click the link in the email">
    Open the reset email and click the link. It takes you to a page where you can set a new password.
  </Step>

  <Step title="Set a new password">
    Enter your new password (at least 8 characters) and confirm it. Click **Update password** — Invoice AI signs you in automatically and takes you to your dashboard.
  </Step>
</Steps>

<Tip>
  Reset links expire after a short window. If yours has expired, go back to the forgot-password page and request a new one.
</Tip>
