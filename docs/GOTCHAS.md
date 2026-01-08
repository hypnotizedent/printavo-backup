# Printavo Extraction Gotchas

Lessons learned from extracting 12,900+ orders.

## API Limits

### Query Complexity (25,000 max)

**Problem:** Large orders with many line items exceed complexity limit.

```
Query has complexity of 70386, which exceeds max complexity of 25000
```

**Solution:** Split into 3 queries per order:
1. Header + status + contact + addresses (~5k)
2. Line items + imprints + mockups (~15k)
3. Production files + financials (~5k)

### Rate Limiting (10 req/5 sec)

**Problem:** Too many requests too fast = temporary ban.

**Solution:** 650ms delay between requests. For burst operations, use exponential backoff.

### Pagination (cursor-based)

**Problem:** Can't request "all" records at once.

**Solution:** 
```javascript
let cursor = null;
while (hasMore) {
  const data = await query({ after: cursor });
  cursor = data.pageInfo.endCursor;
  hasMore = data.pageInfo.hasNextPage;
}
```

## Data Structure Surprises

### Imprints vs Line Item Mockups

**Problem:** Two different types of mockups in different locations.

- **Line Item Mockups:** `lineItems[].mockups[]` - Garment visualization
- **Imprint Mockups:** `imprints[].mockups[]` - Print close-up

**Easy to miss imprint mockups!**

### Size Keys Vary

**Problem:** Sizes aren't standardized strings.

Printavo returns:
```javascript
{ size: "size_2xl", count: 5 }  // Note: size_2xl, not size_2_xl
```

### Quotes vs Invoices

**Problem:** They're stored separately but have identical structure.

**Solution:** Query both `invoices()` and `quotes()` endpoints.

## File URL Issues

### Filestack CDN Patterns

URLs come in multiple formats:
```
https://cdn.filepicker.io/abc123
https://cdn.filepicker.io/abc123?cache=true+.png
https://www.filepicker.io/api/file/abc123?cache=true+.png
```

All resolve to the same file.

### Missing Extensions

Filenames often lack extensions. Extract from:
1. URL query param: `?cache=true+.png` → `.png`
2. MIME type in API response
3. Content-Type header when downloading

### URL Expiration

**Critical:** Filestack URLs may stop working after account closure. Download immediately.

## Resume & Recovery

### Process Crashes

**Problem:** Multi-hour extraction interrupted.

**Solution:** Save progress after each order:
```javascript
if (processed % 10 === 0) {
  saveProgress(progress);
}
```

### Skip Existing

**Solution:** Check before processing:
```javascript
if (fs.existsSync(`invoices/${visualId}.json`)) {
  skipped++;
  continue;
}
```

### Error Logging

**Solution:** Track failures separately:
```javascript
saveError({
  type: 'invoice',
  visualId,
  error: error.message
});
```

## Performance Tips

### Start with Newest

Sort by `visualId` descending. Most recent orders are most important if extraction is interrupted.

### Parallel Queries (Careful!)

You can parallelize the 3 split queries per order, but add delays:
```javascript
const [header, lineItems, files] = await Promise.all([
  query1(),
  delay(650).then(() => query2()),
  delay(1300).then(() => query3())
]);
```

### caffeinate (macOS)

Prevent laptop sleep during long extraction:
```bash
caffeinate -i node extract-all-data.js
```

### nohup for Background

Run extraction that survives terminal close:
```bash
nohup node extract-all-data.js >> extraction.log 2>&1 &
```

## Verification

### Count Extracted

```bash
ls data/invoices/*.json | wc -l
ls data/quotes/*.json | wc -l
```

### Check for Errors

```bash
cat data/errors.json | jq '.errors | length'
```

### Verify File Counts

```bash
cat data/summary.json | jq .
```

### Sample Spot Check

```bash
# Pick random order and verify data looks complete
cat data/invoices/12345.json | jq '.lineItemGroups.nodes | length'
```
