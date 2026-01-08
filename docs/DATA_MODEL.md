# Printavo Data Model

This document explains Printavo's data structure so you know what you're extracting.

## Overview

```
Order (Invoice or Quote)
├── Header (dates, totals, status)
├── Contact → Customer
├── Addresses (billing, shipping)
├── Production Files[]
├── Line Item Groups[]
│   ├── Imprints[] (decorations)
│   │   └── Mockups[] (print close-ups)
│   └── Line Items[] (products)
│       ├── Sizes[] (size breakdown)
│       └── Mockups[] (garment visualizations)
├── Fees[]
├── Expenses[]
├── Payments[]
└── Tasks[]
```

## Order Types

| Type | API Endpoint | Description |
|------|--------------|-------------|
| Invoice | `invoices()` | Confirmed orders in production |
| Quote | `quotes()` | Pending quotes awaiting approval |

Both have identical data structures.

## Key Entities

### Order Header

| Field | Type | Description |
|-------|------|-------------|
| `id` | ID | Printavo internal ID |
| `visualId` | String | Human-readable order number (e.g., "12345") |
| `nickname` | String | Order name/description |
| `total` | Float | Total including tax |
| `subtotal` | Float | Total before tax |
| `amountPaid` | Float | Payments received |
| `amountOutstanding` | Float | Balance due |
| `paidInFull` | Boolean | Payment complete? |
| `createdAt` | DateTime | Order creation date |
| `dueAt` | DateTime | Due date |
| `customerDueAt` | DateTime | Customer-facing due date |
| `productionNote` | String | Internal production notes |
| `customerNote` | String | Notes visible to customer |
| `publicUrl` | String | Customer-facing order URL |
| `publicPdf` | String | PDF invoice URL |

### Status

| Field | Type | Description |
|-------|------|-------------|
| `status.id` | ID | Status ID |
| `status.name` | String | Status name (e.g., "In Production") |
| `status.color` | String | Hex color code |
| `status.type` | Enum | QUOTE or INVOICE |

### Contact & Customer

| Field | Type | Description |
|-------|------|-------------|
| `contact.fullName` | String | Contact name |
| `contact.email` | String | Email address |
| `contact.phone` | String | Phone number |
| `contact.customer.id` | ID | Customer ID |
| `contact.customer.companyName` | String | Company name |

### Line Items

| Field | Type | Description |
|-------|------|-------------|
| `id` | ID | Line item ID |
| `description` | String | Product description |
| `color` | String | Product color |
| `itemNumber` | String | SKU/style number |
| `price` | Float | Unit price |
| `items` | Int | Total quantity |
| `sizes` | Array | Size breakdown |
| `mockups` | Array | Product mockup images |

### Size Breakdown

Printavo uses specific size keys:

```javascript
sizes: [
  { size: "size_s", count: 5 },
  { size: "size_m", count: 10 },
  { size: "size_l", count: 8 },
  { size: "size_xl", count: 3 },
  { size: "size_2xl", count: 2 }
]
```

**All possible size keys:**
- Adults: `size_xs`, `size_s`, `size_m`, `size_l`, `size_xl`, `size_2xl`, `size_3xl`, `size_4xl`, `size_5xl`
- Youth: `size_yxs`, `size_ys`, `size_ym`, `size_yl`, `size_yxl`
- Infant: `size_6m`, `size_12m`, `size_18m`, `size_24m`
- Toddler: `size_2t`, `size_3t`, `size_4t`, `size_5t`
- Other: `size_other`

### Imprints (Decorations)

| Field | Type | Description |
|-------|------|-------------|
| `id` | ID | Imprint ID |
| `details` | String | Decoration description (location, size, colors) |
| `typeOfWork.name` | String | Decoration type (Screen Print, Embroidery, etc.) |
| `mockups` | Array | Print mockup images |

### File Types

| Type | Location | Description |
|------|----------|-------------|
| Production Files | `order.productionFiles` | Print-ready files (AI, PDF, DST) |
| Line Item Mockups | `lineItem.mockups` | Product visualization |
| Imprint Mockups | `imprint.mockups` | Print close-up/proof |

### Financials

**Fees:**
```javascript
{
  id: "123",
  description: "Setup Fee",
  amount: 25.00,
  quantity: 1,
  taxable: true
}
```

**Expenses:**
```javascript
{
  id: "456",
  name: "Blank Goods",
  amount: 150.00,
  transactionAt: "2025-01-01"
}
```

**Payments:**
```javascript
{
  id: "789",
  amount: 500.00,
  transactionDate: "2025-01-05",
  category: "CREDIT_CARD"  // or CHECK, CASH, etc.
}
```

## URL Patterns

Printavo stores files on Filestack CDN:

```
# Production Files
https://cdn.filepicker.io/{filestack_id}

# Mockups (with cache parameter)
https://cdn.filepicker.io/{filestack_id}?cache=true+.{ext}
https://www.filepicker.io/api/file/{filestack_id}?cache=true+.{ext}
```

**Important:** These URLs may stop working after your Printavo account is closed. Download files immediately after extraction.

## GraphQL Complexity

Printavo limits queries to **25,000 complexity points**. Large orders with many line items can exceed this.

**Solution:** Split into multiple queries:
1. Header + contact + addresses (~5,000 points)
2. Line items + imprints + mockups (~15,000 points)
3. Files + financials (~5,000 points)

See `scripts/extract-all-data.js` for implementation.
