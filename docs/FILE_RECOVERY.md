# File Recovery Guide

How to download artwork files from Printavo/Filestack before they expire.

## Overview

Printavo stores files on Filestack's CDN (`cdn.filepicker.io`). After account closure, these URLs may stop working. This guide explains how to download everything.

## File Types to Download

| Type | API Location | Typical Count |
|------|--------------|---------------|
| Production Files | `order.productionFiles[].fileUrl` | 10-20k |
| Line Item Mockups | `order.lineItemGroups[].lineItems[].mockups[].fullImageUrl` | 20-30k |
| Imprint Mockups | `order.lineItemGroups[].imprints[].mockups[].fullImageUrl` | 5-10k |

## Step 1: Extract URLs

After running `extract-all-data.js`, parse the JSON files to get all unique URLs:

```javascript
// extract-urls.js
const fs = require('fs');
const path = require('path');

const dataDir = './data';
const urls = {
  productionFiles: new Set(),
  lineItemMockups: new Set(),
  imprintMockups: new Set()
};

// Process invoices
const invoicesDir = path.join(dataDir, 'invoices');
for (const file of fs.readdirSync(invoicesDir)) {
  const order = JSON.parse(fs.readFileSync(path.join(invoicesDir, file)));
  
  // Production files
  order.productionFiles?.nodes?.forEach(f => {
    if (f.fileUrl) urls.productionFiles.add(f.fileUrl);
  });
  
  // Line items and imprints
  order.lineItemGroups?.nodes?.forEach(group => {
    group.lineItems?.nodes?.forEach(item => {
      item.mockups?.nodes?.forEach(m => {
        if (m.fullImageUrl) urls.lineItemMockups.add(m.fullImageUrl);
      });
    });
    group.imprints?.nodes?.forEach(imprint => {
      imprint.mockups?.nodes?.forEach(m => {
        if (m.fullImageUrl) urls.imprintMockups.add(m.fullImageUrl);
      });
    });
  });
}

// Same for quotes...

console.log(`Production Files: ${urls.productionFiles.size}`);
console.log(`Line Item Mockups: ${urls.lineItemMockups.size}`);
console.log(`Imprint Mockups: ${urls.imprintMockups.size}`);

// Save to file
fs.writeFileSync('urls.json', JSON.stringify({
  productionFiles: [...urls.productionFiles],
  lineItemMockups: [...urls.lineItemMockups],
  imprintMockups: [...urls.imprintMockups]
}, null, 2));
```

## Step 2: Download Files

### Option A: Node.js Script

```javascript
// download-files.js
const fs = require('fs');
const path = require('path');

const urls = JSON.parse(fs.readFileSync('urls.json'));

async function downloadFile(url, destDir) {
  // Extract filename from URL
  const urlObj = new URL(url);
  const filename = urlObj.pathname.split('/').pop().split('?')[0];
  
  // Add extension if missing
  let ext = path.extname(filename);
  if (!ext) {
    // Try to get from URL params or default to .png
    const match = url.match(/\+\.(\w+)/);
    ext = match ? `.${match[1]}` : '.png';
  }
  
  const destPath = path.join(destDir, filename + (ext ? '' : '.png'));
  
  if (fs.existsSync(destPath)) {
    return; // Skip existing
  }
  
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(buffer));
    
    return true;
  } catch (error) {
    console.error(`Failed: ${url} - ${error.message}`);
    return false;
  }
}

async function main() {
  // Create directories
  ['production-files', 'line-item-mockups', 'imprint-mockups'].forEach(dir => {
    fs.mkdirSync(path.join('data/files', dir), { recursive: true });
  });
  
  // Download with rate limiting
  for (const url of urls.productionFiles) {
    await downloadFile(url, 'data/files/production-files');
    await new Promise(r => setTimeout(r, 100)); // 100ms delay
  }
  
  // Repeat for other types...
}

main();
```

### Option B: wget/curl (faster for large batches)

```bash
# Create URL list
cat urls.json | jq -r '.productionFiles[]' > production-urls.txt

# Download with wget
wget -i production-urls.txt \
  --directory-prefix=data/files/production-files \
  --wait=0.1 \
  --no-clobber \
  --content-disposition
```

### Option C: aria2c (fastest, parallel downloads)

```bash
# Install aria2
brew install aria2  # macOS
apt install aria2   # Ubuntu

# Download with 5 parallel connections
aria2c -i production-urls.txt \
  -d data/files/production-files \
  -j 5 \
  --continue \
  --auto-file-renaming=false
```

## Step 3: Create URL Mapping

Create a mapping file to link old URLs to downloaded files:

```csv
old_url,bucket,new_path,visual_id,original_name
"https://cdn.filepicker.io/abc123","production-files","abc123.ai","12345","logo.ai"
```

This mapping is essential for updating your database later.

## Common Issues

### 403 Forbidden

Some URLs may be expired or restricted. Log these for manual review.

### Missing Extensions

Filestack URLs often don't include file extensions. The extension is sometimes in:
- Query parameter: `?cache=true+.png`
- Response headers: `Content-Type: image/png`

### Rate Limiting

Filestack may rate-limit aggressive downloads. Use delays:
- 100-200ms between requests is usually safe
- Back off if you get 429 errors

### Large Files

Production files (AI, PDF) can be large. Ensure enough disk space:
- Budget ~50-100GB for a medium-sized print shop
- Our extraction: 37,500 files = 79GB

## Verification

After downloading, verify file integrity:

```bash
# Count files
find data/files -type f | wc -l

# Check for empty/corrupt files
find data/files -type f -size 0

# Sample verification
head -c 4 data/files/production-files/abc123.ai | xxd
# Should show PDF header (%PDF) or AI header
```

## Storage Recommendations

Once downloaded, consider:

1. **Backup immediately** - Multiple copies, offsite
2. **Upload to your own storage** - S3, MinIO, GCS
3. **Update database URLs** - Point to new storage location
4. **Verify accessibility** - Test URLs from your application
