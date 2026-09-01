# Fonts

**Noto Sans** (Regular 400, SemiBold 600, Bold 700), from Google Fonts, licensed
under the [SIL Open Font License 1.1](https://openfontlicense.org/).

## Why these files are committed

The PDF renderer needs real font files on disk. Two things make Noto Sans the
right choice and this directory the right home:

**It has the rupee glyph.** react-pdf's built-in Helvetica does not contain
U+20B9 (₹), so every rupee sign on a generated invoice would render blank — a
silent failure you only notice by looking at the PDF. Verified present in all
three weights (glyph id 1577).

**They live outside `public/`.** Files in `public/` are served as static assets
but are not guaranteed to be traced into a serverless function bundle, so a PDF
route reading from there works locally and 500s in production. `next.config.ts`
uses `outputFileTracingIncludes` to pull this directory into the PDF routes
explicitly.

## Re-downloading

```bash
curl -sL -A "Mozilla/4.0" "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700" \
  | grep -oE "https://[^)]*\.ttf"
```

Then save the three URLs as `NotoSans-Regular.ttf`, `NotoSans-SemiBold.ttf` and
`NotoSans-Bold.ttf` in that order (400, 600, 700).
