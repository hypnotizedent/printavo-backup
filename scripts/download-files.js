#!/usr/bin/env node
/**
 * Printavo File Download Script
 * 
 * Downloads artwork files from Filestack CDN after extraction.
 * Run this AFTER extract-all-data.js completes.
 * 
 * Features:
 * - Parses extracted JSON to find all file URLs
 * - Downloads with rate limiting
 * - Skips existing files
 * - Creates URL mapping CSV for database updates
 * - Progress tracking and resume capability
 * 
 * Usage:
 *   node scripts/download-files.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// =============================================================================
// CONFIGURATION
// =============================================================================

let CONFIG;
try {
  CONFIG = require('../config.js');
} catch (e) {
  CONFIG = {};
}

CONFIG.DATA_DIR = CONFIG.DATA_DIR || './data';
CONFIG.DOWNLOAD_DELAY = CONFIG.DOWNLOAD_DELAY || 100; // ms between downloads
CONFIG.MAX_RETRIES = CONFIG.MAX_RETRIES || 3;

const DATA_DIR = path.resolve(__dirname, '..', CONFIG.DATA_DIR);
const INVOICES_DIR = path.join(DATA_DIR, 'invoices');
const QUOTES_DIR = path.join(DATA_DIR, 'quotes');
const FILES_DIR = path.join(DATA_DIR, 'files');
const MAPPING_FILE = path.join(DATA_DIR, 'url-mapping.csv');
const PROGRESS_FILE = path.join(DATA_DIR, 'download-progress.json');

// File type directories
const BUCKETS = {
  'production-files': path.join(FILES_DIR, 'production-files'),
  'line-item-mockups': path.join(FILES_DIR, 'line-item-mockups'),
  'imprint-mockups': path.join(FILES_DIR, 'imprint-mockups')
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function logError(message) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${message}`);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (e) {}
  return { downloaded: [], failed: [], startedAt: new Date().toISOString() };
}

function saveProgress(progress) {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

/**
 * Extract file handle from Filestack URL
 * Examples:
 *   https://cdn.filepicker.io/abc123 -> abc123
 *   https://cdn.filepicker.io/abc123?cache=true+.png -> abc123
 *   https://www.filepicker.io/api/file/abc123 -> abc123
 */
function extractFileHandle(url) {
  const patterns = [
    /cdn\.filepicker\.io\/([^?/]+)/,
    /www\.filepicker\.io\/api\/file\/([^?/]+)/,
    /filestack\.com\/([^?/]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  
  return null;
}

/**
 * Extract file extension from URL or default
 */
function extractExtension(url, mimeType) {
  // Try URL parameter first
  const paramMatch = url.match(/\+\.(\w+)/);
  if (paramMatch) return `.${paramMatch[1]}`;
  
  // Try mime type
  const mimeMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'application/pdf': '.pdf',
    'application/illustrator': '.ai',
    'application/postscript': '.eps',
    'application/x-illustrator': '.ai'
  };
  
  if (mimeType && mimeMap[mimeType]) {
    return mimeMap[mimeType];
  }
  
  return '.bin'; // Unknown
}

/**
 * Download a single file
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, destPath)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(true);
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {}); // Clean up partial file
        reject(err);
      });
    });
    
    request.on('error', reject);
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// =============================================================================
// URL EXTRACTION
// =============================================================================

/**
 * Extract all file URLs from extracted order data
 */
function extractAllUrls() {
  const urls = {
    'production-files': [],
    'line-item-mockups': [],
    'imprint-mockups': []
  };
  
  const processOrder = (orderData, visualId) => {
    // Production files
    orderData.productionFiles?.nodes?.forEach(file => {
      if (file.fileUrl) {
        urls['production-files'].push({
          url: file.fileUrl,
          visualId,
          originalName: file.name,
          mimeType: file.mimeType,
          printavoId: file.id
        });
      }
    });
    
    // Line items and imprints
    orderData.lineItemGroups?.nodes?.forEach(group => {
      // Line item mockups
      group.lineItems?.nodes?.forEach(item => {
        item.mockups?.nodes?.forEach(mockup => {
          if (mockup.fullImageUrl) {
            urls['line-item-mockups'].push({
              url: mockup.fullImageUrl,
              visualId,
              originalName: `mockup-${mockup.id}`,
              mimeType: mockup.mimeType,
              printavoId: mockup.id
            });
          }
        });
      });
      
      // Imprint mockups
      group.imprints?.nodes?.forEach(imprint => {
        imprint.mockups?.nodes?.forEach(mockup => {
          if (mockup.fullImageUrl) {
            urls['imprint-mockups'].push({
              url: mockup.fullImageUrl,
              visualId,
              originalName: `mockup-${mockup.id}`,
              mimeType: mockup.mimeType,
              printavoId: mockup.id
            });
          }
        });
      });
    });
  };
  
  // Process invoices
  if (fs.existsSync(INVOICES_DIR)) {
    for (const file of fs.readdirSync(INVOICES_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(INVOICES_DIR, file)));
        processOrder(data, data.visualId);
      } catch (e) {
        logError(`Failed to parse ${file}: ${e.message}`);
      }
    }
  }
  
  // Process quotes
  if (fs.existsSync(QUOTES_DIR)) {
    for (const file of fs.readdirSync(QUOTES_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(QUOTES_DIR, file)));
        processOrder(data, data.visualId);
      } catch (e) {
        logError(`Failed to parse ${file}: ${e.message}`);
      }
    }
  }
  
  return urls;
}

// =============================================================================
// MAIN DOWNLOAD LOGIC
// =============================================================================

async function downloadAllFiles() {
  log('╔════════════════════════════════════════════════════════════╗');
  log('║            PRINTAVO FILE DOWNLOAD                          ║');
  log('╚════════════════════════════════════════════════════════════╝');
  
  // Ensure directories exist
  Object.values(BUCKETS).forEach(ensureDir);
  
  // Extract URLs from JSON files
  log('\nExtracting file URLs from extracted data...');
  const allUrls = extractAllUrls();
  
  const totalCount = Object.values(allUrls).reduce((sum, arr) => sum + arr.length, 0);
  log(`\nFound ${totalCount} total files:`);
  Object.entries(allUrls).forEach(([bucket, urls]) => {
    log(`  ${bucket}: ${urls.length}`);
  });
  
  // Load progress
  const progress = loadProgress();
  const downloadedSet = new Set(progress.downloaded);
  
  // Initialize CSV mapping file
  if (!fs.existsSync(MAPPING_FILE)) {
    fs.writeFileSync(MAPPING_FILE, 'old_url,bucket,new_path,visual_id,original_name\n');
  }
  const mappingStream = fs.createWriteStream(MAPPING_FILE, { flags: 'a' });
  
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  
  // Download each bucket
  for (const [bucket, urls] of Object.entries(allUrls)) {
    log(`\n--- Downloading ${bucket} (${urls.length} files) ---`);
    
    for (const fileInfo of urls) {
      const { url, visualId, originalName, mimeType } = fileInfo;
      
      // Skip if already downloaded
      if (downloadedSet.has(url)) {
        skipped++;
        continue;
      }
      
      const handle = extractFileHandle(url);
      if (!handle) {
        logError(`Cannot extract handle from: ${url}`);
        failed++;
        continue;
      }
      
      const ext = extractExtension(url, mimeType);
      const filename = `${handle}${ext}`;
      const destPath = path.join(BUCKETS[bucket], filename);
      
      // Skip if file exists on disk
      if (fs.existsSync(destPath)) {
        downloadedSet.add(url);
        skipped++;
        continue;
      }
      
      // Download with retries
      let success = false;
      for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
          await downloadFile(url, destPath);
          success = true;
          break;
        } catch (err) {
          if (attempt < CONFIG.MAX_RETRIES) {
            await delay(1000 * attempt);
          } else {
            logError(`Failed ${url}: ${err.message}`);
          }
        }
      }
      
      if (success) {
        downloaded++;
        downloadedSet.add(url);
        progress.downloaded.push(url);
        
        // Write to mapping CSV
        const csvLine = `"${url}","${bucket}","${filename}","${visualId}","${originalName}"\n`;
        mappingStream.write(csvLine);
        
        if (downloaded % 100 === 0) {
          log(`Downloaded ${downloaded} files (${skipped} skipped, ${failed} failed)`);
          saveProgress(progress);
        }
      } else {
        failed++;
        progress.failed.push({ url, bucket, visualId });
      }
      
      await delay(CONFIG.DOWNLOAD_DELAY);
    }
  }
  
  mappingStream.end();
  saveProgress(progress);
  
  log('\n╔════════════════════════════════════════════════════════════╗');
  log('║                  DOWNLOAD COMPLETE                          ║');
  log('╠════════════════════════════════════════════════════════════╣');
  log(`║  Downloaded: ${downloaded}`.padEnd(61) + '║');
  log(`║  Skipped: ${skipped}`.padEnd(61) + '║');
  log(`║  Failed: ${failed}`.padEnd(61) + '║');
  log('╚════════════════════════════════════════════════════════════╝');
  log(`\nMapping file: ${MAPPING_FILE}`);
  log(`Files saved to: ${FILES_DIR}`);
}

// =============================================================================
// ENTRY POINT
// =============================================================================

downloadAllFiles().catch(err => {
  logError(`Fatal error: ${err.message}`);
  process.exit(1);
});
