#!/usr/bin/env node
/**
 * Printavo Full Data Extraction Script - v2 (Split Queries)
 * 
 * Extracts ALL data from Printavo via GraphQL API:
 * - Invoices and Quotes
 * - Line items with size breakdowns
 * - Imprints with mockups
 * - Production files
 * - Fees, expenses, payments, tasks
 * 
 * Features:
 * - Resume capability (saves progress)
 * - Rate limiting (respects API limits)
 * - Split queries (avoids complexity limit)
 * - Error logging
 * 
 * Usage:
 *   node scripts/extract-all-data.js
 */

const fs = require('fs');
const path = require('path');

// =============================================================================
// CONFIGURATION
// =============================================================================

let CONFIG;
try {
  CONFIG = require('../config.js');
} catch (e) {
  console.error('ERROR: config.js not found. Copy config.example.js to config.js and add your credentials.');
  process.exit(1);
}

// Ensure required config
if (!CONFIG.PRINTAVO_EMAIL || !CONFIG.PRINTAVO_TOKEN || 
    CONFIG.PRINTAVO_EMAIL === 'your-email@example.com') {
  console.error('ERROR: Please configure your Printavo credentials in config.js');
  process.exit(1);
}

// Set defaults
CONFIG.PRINTAVO_API = CONFIG.PRINTAVO_API || 'https://www.printavo.com/api/v2';
CONFIG.RATE_LIMIT_DELAY = CONFIG.RATE_LIMIT_DELAY || 650;
CONFIG.RETRY_DELAY = CONFIG.RETRY_DELAY || 5000;
CONFIG.MAX_RETRIES = CONFIG.MAX_RETRIES || 3;
CONFIG.DATA_DIR = CONFIG.DATA_DIR || './data';

// Resolve paths
const DATA_DIR = path.resolve(__dirname, '..', CONFIG.DATA_DIR);
const INVOICES_DIR = path.join(DATA_DIR, 'invoices');
const QUOTES_DIR = path.join(DATA_DIR, 'quotes');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const ERRORS_FILE = path.join(DATA_DIR, 'errors.json');
const SUMMARY_FILE = path.join(DATA_DIR, 'summary.json');

// Ensure directories exist
[DATA_DIR, INVOICES_DIR, QUOTES_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// =============================================================================
// SPLIT QUERIES (to avoid 25k complexity limit)
// =============================================================================

const LIST_INVOICES_QUERY = `
query ListInvoices($cursor: String) {
  invoices(first: 25, after: $cursor, sortOn: VISUAL_ID, sortDescending: true) {
    nodes { id visualId }
    pageInfo { hasNextPage endCursor }
    totalNodes
  }
}`;

const LIST_QUOTES_QUERY = `
query ListQuotes($cursor: String) {
  quotes(first: 25, after: $cursor, sortOn: VISUAL_ID, sortDescending: true) {
    nodes { id visualId }
    pageInfo { hasNextPage endCursor }
    totalNodes
  }
}`;

// Query 1: Header (low complexity)
const GET_ORDER_HEADER = (type) => `
query GetHeader($id: ID!) {
  ${type}(id: $id) {
    id visualId nickname
    total subtotal totalUntaxed
    discount discountAsPercentage discountAmount
    salesTax salesTaxAmount
    amountPaid amountOutstanding paidInFull totalQuantity
    productionNote customerNote
    createdAt customerDueAt paymentDueAt invoiceAt dueAt startAt
    publicUrl publicPdf publicHash workorderUrl packingSlipUrl url
    visualPoNumber tags
    timestamps { createdAt updatedAt }
    status { id name color position type }
    contact {
      id fullName firstName lastName email phone fax
      customer { id companyName }
    }
    owner { id email name }
    billingAddress { address1 address2 city state stateIso zipCode country countryIso companyName customerName }
    shippingAddress { address1 address2 city state stateIso zipCode country countryIso companyName customerName }
    deliveryMethod { id name }
    paymentTerm { id name }
  }
}`;

// Query 2: Line Items + Imprints (medium complexity, but paginated)
const GET_ORDER_LINE_ITEMS = (type) => `
query GetLineItems($id: ID!) {
  ${type}(id: $id) {
    id
    lineItemGroups(first: 10) {
      nodes {
        id position
        imprints(first: 10) {
          nodes {
            id details
            typeOfWork { id name }
            mockups(first: 5) {
              nodes { id fullImageUrl thumbnailUrl mimeType }
            }
          }
        }
        lineItems(first: 15) {
          nodes {
            id description color itemNumber
            category { id name }
            position price items taxed markupPercentage productStatus
            product { id description itemNumber brand color }
            sizes { size count }
            mockups(first: 5) {
              nodes { id fullImageUrl thumbnailUrl mimeType }
            }
          }
        }
      }
    }
  }
}`;

// Query 3: Files + Financial (low complexity)
const GET_ORDER_FILES_FINANCIAL = (type) => `
query GetFilesFinancial($id: ID!) {
  ${type}(id: $id) {
    id
    productionFiles(first: 50) {
      nodes { id fileUrl name mimeType }
    }
    fees(first: 30) {
      nodes { id description amount quantity unitPrice unitPriceAsPercentage taxable }
    }
    expenses(first: 30) {
      nodes { id name amount transactionAt userGenerated }
    }
    tasks(first: 30) {
      nodes { id name dueAt completed completedAt }
    }
    transactions(first: 30) {
      nodes {
        ... on Payment { id amount transactionDate category processing source description }
        ... on Refund { id amount transactionDate category }
      }
    }
  }
}`;

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

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (e) {
    logError(`Failed to load progress: ${e.message}`);
  }
  return {
    phase: 'invoices',
    lastProcessedVisualId: null,
    invoicesProcessed: 0,
    quotesProcessed: 0,
    totalProductionFiles: 0,
    totalLineItemMockups: 0,
    totalImprintMockups: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString()
  };
}

function saveProgress(progress) {
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function loadErrors() {
  try {
    if (fs.existsSync(ERRORS_FILE)) {
      return JSON.parse(fs.readFileSync(ERRORS_FILE, 'utf8'));
    }
  } catch (e) {}
  return { errors: [] };
}

function saveError(errorData) {
  const errors = loadErrors();
  errors.errors.push({ ...errorData, timestamp: new Date().toISOString() });
  fs.writeFileSync(ERRORS_FILE, JSON.stringify(errors, null, 2));
}

function orderExists(type, visualId) {
  const dir = type === 'invoice' ? INVOICES_DIR : QUOTES_DIR;
  return fs.existsSync(path.join(dir, `${visualId}.json`));
}

function saveOrder(type, visualId, data) {
  const dir = type === 'invoice' ? INVOICES_DIR : QUOTES_DIR;
  fs.writeFileSync(path.join(dir, `${visualId}.json`), JSON.stringify(data, null, 2));
}

function countFiles(data) {
  let productionFiles = 0;
  let lineItemMockups = 0;
  let imprintMockups = 0;
  
  if (data.productionFiles?.nodes) {
    productionFiles = data.productionFiles.nodes.length;
  }
  
  if (data.lineItemGroups?.nodes) {
    for (const group of data.lineItemGroups.nodes) {
      if (group.lineItems?.nodes) {
        for (const item of group.lineItems.nodes) {
          if (item.mockups?.nodes) {
            lineItemMockups += item.mockups.nodes.length;
          }
        }
      }
      if (group.imprints?.nodes) {
        for (const imprint of group.imprints.nodes) {
          if (imprint.mockups?.nodes) {
            imprintMockups += imprint.mockups.nodes.length;
          }
        }
      }
    }
  }
  
  return { productionFiles, lineItemMockups, imprintMockups };
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

async function graphqlRequest(query, variables = {}, retries = CONFIG.MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(CONFIG.PRINTAVO_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'email': CONFIG.PRINTAVO_EMAIL,
          'token': CONFIG.PRINTAVO_TOKEN
        },
        body: JSON.stringify({ query, variables })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.errors && !result.data) {
        throw new Error(`GraphQL: ${result.errors.map(e => e.message).join(', ')}`);
      }

      return result.data;
    } catch (error) {
      logError(`Request failed (attempt ${attempt}/${retries}): ${error.message}`);
      
      if (attempt < retries) {
        const waitTime = CONFIG.RETRY_DELAY * attempt;
        log(`Waiting ${waitTime}ms before retry...`);
        await delay(waitTime);
      } else {
        throw error;
      }
    }
  }
}

async function fetchAllOrderIds(type) {
  log(`Fetching all ${type} IDs...`);
  
  const query = type === 'invoice' ? LIST_INVOICES_QUERY : LIST_QUOTES_QUERY;
  const dataKey = type === 'invoice' ? 'invoices' : 'quotes';
  
  const orderIds = [];
  let cursor = null;
  let hasMore = true;
  let page = 0;
  
  while (hasMore) {
    const data = await graphqlRequest(query, { cursor });
    const orders = data[dataKey];
    
    for (const order of orders.nodes) {
      orderIds.push({ id: order.id, visualId: order.visualId });
    }
    
    hasMore = orders.pageInfo.hasNextPage;
    cursor = orders.pageInfo.endCursor;
    page++;
    
    if (page % 10 === 0) {
      log(`  Fetched ${orderIds.length} ${type} IDs (page ${page})...`);
    }
    
    await delay(CONFIG.RATE_LIMIT_DELAY);
  }
  
  log(`Found ${orderIds.length} total ${type}s`);
  return orderIds;
}

async function fetchOrderData(type, printavoId) {
  // Split into 3 queries to avoid complexity limit
  const [headerData, lineItemsData, filesData] = await Promise.all([
    graphqlRequest(GET_ORDER_HEADER(type), { id: printavoId }),
    delay(CONFIG.RATE_LIMIT_DELAY).then(() => 
      graphqlRequest(GET_ORDER_LINE_ITEMS(type), { id: printavoId })
    ),
    delay(CONFIG.RATE_LIMIT_DELAY * 2).then(() => 
      graphqlRequest(GET_ORDER_FILES_FINANCIAL(type), { id: printavoId })
    )
  ]);
  
  // Merge all data
  const header = headerData[type];
  const lineItems = lineItemsData[type];
  const files = filesData[type];
  
  return {
    ...header,
    lineItemGroups: lineItems.lineItemGroups,
    productionFiles: files.productionFiles,
    fees: files.fees,
    expenses: files.expenses,
    tasks: files.tasks,
    transactions: files.transactions
  };
}

// =============================================================================
// MAIN EXTRACTION LOGIC
// =============================================================================

async function extractOrders(type, orderIds, progress) {
  const total = orderIds.length;
  let processed = 0;
  let skipped = 0;
  
  log(`\n${'='.repeat(60)}`);
  log(`EXTRACTING ${type.toUpperCase()}S (${total} total)`);
  log(`${'='.repeat(60)}\n`);
  
  for (const order of orderIds) {
    const { id: printavoId, visualId } = order;
    
    // Skip if already extracted
    if (orderExists(type, visualId)) {
      skipped++;
      if (skipped % 100 === 0) {
        log(`Skipped ${skipped} existing ${type}s...`);
      }
      continue;
    }
    
    try {
      const orderData = await fetchOrderData(type, printavoId);
      
      if (!orderData) {
        throw new Error(`No data returned for ${type} ${visualId}`);
      }
      
      const fileCounts = countFiles(orderData);
      
      const outputData = {
        extractedAt: new Date().toISOString(),
        type,
        printavoId,
        visualId,
        ...orderData
      };
      
      saveOrder(type, visualId, outputData);
      
      processed++;
      progress.lastProcessedVisualId = visualId;
      progress[`${type}sProcessed`] = (progress[`${type}sProcessed`] || 0) + 1;
      progress.totalProductionFiles += fileCounts.productionFiles;
      progress.totalLineItemMockups += fileCounts.lineItemMockups;
      progress.totalImprintMockups += fileCounts.imprintMockups;
      
      const totalFiles = fileCounts.productionFiles + fileCounts.lineItemMockups + fileCounts.imprintMockups;
      log(`✓ ${type} #${visualId} - ${totalFiles} files (${processed}/${total - skipped} new, ${skipped} skipped)`);
      
      if (processed % 10 === 0) {
        saveProgress(progress);
      }
      
      // Extra delay since we're making 3 requests per order
      await delay(CONFIG.RATE_LIMIT_DELAY);
      
    } catch (error) {
      logError(`Failed to extract ${type} #${visualId}: ${error.message}`);
      
      saveError({
        type,
        visualId,
        printavoId,
        error: error.message,
        retries: CONFIG.MAX_RETRIES
      });
      
      progress.errors++;
      saveProgress(progress);
      
      await delay(CONFIG.RATE_LIMIT_DELAY);
    }
  }
  
  log(`\nCompleted ${type}s: ${processed} extracted, ${skipped} skipped, ${progress.errors} errors`);
  return processed;
}

async function main() {
  log('╔════════════════════════════════════════════════════════════╗');
  log('║     PRINTAVO EXTRACTION v2 (Split Queries)                 ║');
  log('║     Starting extraction (newest orders first)              ║');
  log('╚════════════════════════════════════════════════════════════╝');
  
  const progress = loadProgress();
  log(`\nProgress loaded: ${progress.invoicesProcessed} invoices, ${progress.quotesProcessed} quotes already done`);
  
  log('\nVerifying Printavo API access...');
  try {
    const testData = await graphqlRequest('query { invoices(first: 1) { totalNodes } }');
    log(`✓ API access verified (${testData.invoices.totalNodes} total invoices)`);
  } catch (error) {
    logError(`API access failed: ${error.message}`);
    process.exit(1);
  }
  
  const startTime = Date.now();
  
  try {
    if (progress.phase === 'invoices' || !progress.phase) {
      log('\n--- PHASE 1: INVOICES ---');
      const invoiceIds = await fetchAllOrderIds('invoice');
      await extractOrders('invoice', invoiceIds, progress);
      progress.phase = 'quotes';
      saveProgress(progress);
    }
    
    if (progress.phase === 'quotes') {
      log('\n--- PHASE 2: QUOTES ---');
      const quoteIds = await fetchAllOrderIds('quote');
      await extractOrders('quote', quoteIds, progress);
      progress.phase = 'complete';
      saveProgress(progress);
    }
    
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    
    const summary = {
      completedAt: new Date().toISOString(),
      duration: `${duration} minutes`,
      invoicesExtracted: progress.invoicesProcessed,
      quotesExtracted: progress.quotesProcessed,
      totalOrders: progress.invoicesProcessed + progress.quotesProcessed,
      totalProductionFiles: progress.totalProductionFiles,
      totalLineItemMockups: progress.totalLineItemMockups,
      totalImprintMockups: progress.totalImprintMockups,
      totalFiles: progress.totalProductionFiles + progress.totalLineItemMockups + progress.totalImprintMockups,
      errors: progress.errors
    };
    
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
    
    log('\n╔════════════════════════════════════════════════════════════╗');
    log('║                    EXTRACTION COMPLETE                      ║');
    log('╠════════════════════════════════════════════════════════════╣');
    log(`║  Duration: ${duration} minutes`.padEnd(61) + '║');
    log(`║  Invoices: ${summary.invoicesExtracted}`.padEnd(61) + '║');
    log(`║  Quotes: ${summary.quotesExtracted}`.padEnd(61) + '║');
    log(`║  Total Files: ${summary.totalFiles}`.padEnd(61) + '║');
    log(`║  Errors: ${summary.errors}`.padEnd(61) + '║');
    log('╚════════════════════════════════════════════════════════════╝');
    
  } catch (error) {
    logError(`Fatal error: ${error.message}`);
    saveProgress(progress);
    process.exit(1);
  }
}

main().catch(err => {
  logError(`Unhandled error: ${err.message}`);
  process.exit(1);
});
