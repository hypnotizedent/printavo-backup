# Printavo Backup

> Tools and documentation for extracting your data from Printavo before migration or account closure.

## Why This Exists

When we migrated away from Printavo, we discovered that:

1. **Artwork files are stored on Filestack CDN** - URLs may expire after account closure
2. **No bulk export exists** - Printavo's CSV exports miss critical data (mockups, imprints, file URLs)
3. **API access could end any time** - Once your account is closed, the data is gone

This repository contains the scripts and documentation we used to extract **100% of our data** before our Printavo account was terminated.

## What You Can Extract

| Data Type | Method | Notes |
|-----------|--------|-------|
| Orders (Invoices) | GraphQL API | All fields, line items, imprints |
| Quotes | GraphQL API | Same structure as orders |
| Customers | GraphQL API | Via order contacts |
| Line Items | GraphQL API | Including all size breakdowns |
| Imprints | GraphQL API | Decoration details |
| Production Files | GraphQL API + Download | Print-ready files (AI, PDF, etc.) |
| Line Item Mockups | GraphQL API + Download | Garment visualizations |
| Imprint Mockups | GraphQL API + Download | Print close-ups |
| Fees & Expenses | GraphQL API | Financial data |
| Payments | GraphQL API | Transaction history |
| Tasks | GraphQL API | Production tasks |

## Quick Start

### 1. Get Your API Credentials

In Printavo, go to **My Account → API** to find your:
- Email
- API Token

### 2. Configure the Script

```bash
cp config.example.js config.js
# Edit config.js with your credentials
```

### 3. Run Extraction

```bash
# Install dependencies (none required - uses native fetch)
node scripts/extract-all-data.js
```

### 4. Download Artwork Files

After extraction completes, download the actual files from Filestack:

```bash
node scripts/download-files.js
```

## Output Structure

```
data/
├── invoices/
│   ├── 12345.json    # One file per invoice (by visual ID)
│   └── ...
├── quotes/
│   ├── 6789.json     # One file per quote
│   └── ...
├── files/
│   ├── production-files/
│   ├── line-item-mockups/
│   └── imprint-mockups/
├── progress.json      # Resume capability
├── errors.json        # Failed extractions
└── summary.json       # Final statistics
```

## Key Gotchas

### Query Complexity Limit

Printavo limits GraphQL queries to **25,000 complexity points**. Large orders with many line items will fail.

**Solution:** We split each order into 3 smaller queries:
1. Header (contact, addresses, status)
2. Line items + imprints + mockups
3. Production files + financials

### Rate Limiting

Printavo allows **10 requests per 5 seconds**.

**Solution:** Use 650ms delay between requests.

### Artwork URL Expiration

Files are hosted on Filestack CDN (`cdn.filepicker.io`). These URLs may stop working after account closure.

**Solution:** Download all files immediately after extraction.

### Resume Capability

Extraction can take hours for large accounts. The script saves progress and can resume if interrupted.

## Data Model

See [docs/DATA_MODEL.md](docs/DATA_MODEL.md) for complete Printavo data structure documentation.

## File Recovery

See [docs/FILE_RECOVERY.md](docs/FILE_RECOVERY.md) for detailed artwork download instructions.

## Scripts

| Script | Purpose |
|--------|--------|
| `extract-all-data.js` | Main extraction - pulls all orders via GraphQL |
| `download-files.js` | Downloads artwork from Filestack CDN |
| `verify-preflight.js` | Tests API access before full extraction |

## Contributing

Pull requests welcome! If you've discovered additional Printavo data that should be extracted, please contribute.

## License

MIT - Use freely, attribution appreciated.

## Disclaimer

This tool is not affiliated with Printavo. Use at your own risk. Always verify your extracted data before relying on it.
