const fs = require('fs');
const path = require('path');

// Configuration
const OUTPUT_DIR = './output';
const AUDIT_OUTPUT_DIR = './audit-output';

// Analysis thresholds
const MIN_EXPECTED_RECORD_SIZE = 100; // bytes
const LARGE_RECORD_MULTIPLIER = 3; // records > 3x average size
const SMALL_RECORD_MULTIPLIER = 0.3; // records < 0.3x average size

// Color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Logging utilities
function log(message, color = null) {
  const timestamp = new Date().toISOString();
  const colorCode = color ? COLORS[color] || '' : '';
  const resetCode = color ? COLORS.reset : '';
  console.log(`${colorCode}[${timestamp}] ${message}${resetCode}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(80));
  console.log(COLORS.bright + COLORS.cyan + title.toUpperCase() + COLORS.reset);
  console.log('='.repeat(80));
}

function logSubSection(title) {
  console.log('\n' + COLORS.blue + title + COLORS.reset);
  console.log('-'.repeat(80));
}

function logSuccess(message) {
  log('✓ ' + message, 'green');
}

function logWarning(message) {
  log('⚠ ' + message, 'yellow');
}

function logError(message) {
  log('✗ ' + message, 'red');
}

function logInfo(message) {
  log('ℹ ' + message, 'blue');
}

// ============================================================================
// Data Loading Functions
// ============================================================================

function loadJSONFile(filename) {
  const filepath = path.join(OUTPUT_DIR, filename);
  try {
    if (!fs.existsSync(filepath)) {
      logWarning(`File not found: ${filename}`);
      return null;
    }
    const data = fs.readFileSync(filepath, 'utf8');
    const parsed = JSON.parse(data);
    logSuccess(`Loaded ${filename}`);
    return parsed;
  } catch (err) {
    logError(`Failed to load ${filename}: ${err.message}`);
    return null;
  }
}

function loadAllData() {
  logSection('Loading Data Files');
  
  const data = {
    account: loadJSONFile('account.json'),
    user: loadJSONFile('user.json'),
    contacts: loadJSONFile('contacts.json') || [],
    customers: loadJSONFile('customers.json') || [],
    inquiries: loadJSONFile('inquiries.json') || [],
    invoices: loadJSONFile('invoices.json') || [],
    quotes: loadJSONFile('quotes.json') || [],
    orders: loadJSONFile('orders.json') || [],
    products: loadJSONFile('products.json') || [],
    statuses: loadJSONFile('statuses.json') || [],
    tasks: loadJSONFile('tasks.json') || [],
    threads: loadJSONFile('threads.json') || [],
    transactions: loadJSONFile('transactions.json') || [],
    paymentRequests: loadJSONFile('payment_requests.json') || [],
    merchStores: loadJSONFile('merch_stores.json') || [],
    merchOrders: loadJSONFile('merch_orders.json') || []
  };
  
  logInfo(`Total files loaded: ${Object.keys(data).filter(k => data[k] !== null).length}/16`);
  
  return data;
}

// ============================================================================
// Audit Analysis Functions
// ============================================================================

// 1. Data Completeness Analysis
function analyzeDataCompleteness(data) {
  logSubSection('1. Data Completeness Analysis');
  
  const issues = [];
  const stats = {};
  
  // Count records
  stats.invoices = data.invoices.length;
  stats.quotes = data.quotes.length;
  stats.orders = data.orders.length;
  stats.transactions = data.transactions.length;
  stats.contacts = data.contacts.length;
  stats.customers = data.customers.length;
  stats.tasks = data.tasks.length;
  stats.products = data.products.length;
  
  logInfo(`Invoices: ${stats.invoices}`);
  logInfo(`Quotes: ${stats.quotes}`);
  logInfo(`Orders (union): ${stats.orders}`);
  logInfo(`Transactions: ${stats.transactions}`);
  
  // Reconcile orders vs transactions
  const expectedOrders = stats.invoices + stats.quotes;
  if (stats.orders !== expectedOrders) {
    const issue = {
      type: 'order_count_mismatch',
      severity: 'high',
      message: `Orders union count (${stats.orders}) doesn't match invoices (${stats.invoices}) + quotes (${stats.quotes}) = ${expectedOrders}`,
      difference: Math.abs(stats.orders - expectedOrders)
    };
    issues.push(issue);
    logWarning(issue.message);
  }
  
  // Analyze transaction to order ratio
  if (stats.transactions > stats.orders) {
    const ratio = (stats.transactions / stats.orders).toFixed(2);
    const issue = {
      type: 'transaction_order_ratio',
      severity: 'medium',
      message: `${stats.transactions} transactions for ${stats.orders} orders (ratio: ${ratio}:1)`,
      ratio: parseFloat(ratio),
      explanation: 'Multiple transactions per order (payments, refunds) or orphaned transactions'
    };
    issues.push(issue);
    logInfo(issue.message);
  }
  
  // Check for missing/null fields in critical records
  const nullFieldChecks = {
    invoices: ['id', 'visualId', 'total', 'status', 'contact'],
    quotes: ['id', 'visualId', 'total', 'status', 'contact'],
    transactions: ['id', 'amount', 'transactionDate'],
    contacts: ['id', 'customer'],
    customers: ['id', 'primaryContact']
  };
  
  for (const [dataType, fields] of Object.entries(nullFieldChecks)) {
    if (!data[dataType]) continue;
    
    for (const field of fields) {
      const recordsWithNull = data[dataType].filter(record => {
        const value = record[field];
        return value === null || value === undefined || value === '';
      });
      
      if (recordsWithNull.length > 0) {
        const issue = {
          type: 'null_critical_field',
          severity: 'high',
          dataType,
          field,
          count: recordsWithNull.length,
          percentage: ((recordsWithNull.length / data[dataType].length) * 100).toFixed(2),
          message: `${recordsWithNull.length} ${dataType} records missing ${field} (${((recordsWithNull.length / data[dataType].length) * 100).toFixed(2)}%)`,
          sampleIds: recordsWithNull.slice(0, 5).map(r => r.id)
        };
        issues.push(issue);
        logWarning(issue.message);
      }
    }
  }
  
  // Check for orphaned transactions (transactions without orders)
  const transactionsWithOrders = data.transactions.filter(t => t.transactedFor);
  const orphanedTransactions = data.transactions.length - transactionsWithOrders.length;
  
  if (orphanedTransactions > 0) {
    const issue = {
      type: 'orphaned_transactions',
      severity: 'high',
      count: orphanedTransactions,
      percentage: ((orphanedTransactions / data.transactions.length) * 100).toFixed(2),
      message: `${orphanedTransactions} transactions without associated orders (${((orphanedTransactions / data.transactions.length) * 100).toFixed(2)}%)`,
      sampleIds: data.transactions.filter(t => !t.transactedFor).slice(0, 10).map(t => t.id)
    };
    issues.push(issue);
    logWarning(issue.message);
  }
  
  // Check for contacts without customers
  const contactsWithCustomers = data.contacts.filter(c => c.customer);
  const orphanedContacts = data.contacts.length - contactsWithCustomers.length;
  
  if (orphanedContacts > 0) {
    const issue = {
      type: 'orphaned_contacts',
      severity: 'medium',
      count: orphanedContacts,
      percentage: ((orphanedContacts / data.contacts.length) * 100).toFixed(2),
      message: `${orphanedContacts} contacts without associated customers (${((orphanedContacts / data.contacts.length) * 100).toFixed(2)}%)`,
      sampleIds: data.contacts.filter(c => !c.customer).slice(0, 10).map(c => c.id)
    };
    issues.push(issue);
    logWarning(issue.message);
  }
  
  return { stats, issues };
}

// 2. Duplicates & Data Integrity Analysis
function analyzeDuplicates(data) {
  logSubSection('2. Duplicates & Data Integrity Analysis');
  
  const issues = [];
  
  // Helper function to find duplicates by field
  function findDuplicatesByField(records, fieldName, recordType) {
    const valueMap = {};
    const duplicates = [];
    
    records.forEach(record => {
      const value = record[fieldName];
      if (!value) return;
      
      if (valueMap[value]) {
        valueMap[value].push(record.id);
      } else {
        valueMap[value] = [record.id];
      }
    });
    
    Object.entries(valueMap).forEach(([value, ids]) => {
      if (ids.length > 1) {
        duplicates.push({ value, ids, count: ids.length });
      }
    });
    
    if (duplicates.length > 0) {
      const totalDupes = duplicates.reduce((sum, d) => sum + d.count, 0);
      const issue = {
        type: 'duplicate_ids',
        severity: 'high',
        recordType,
        field: fieldName,
        duplicateCount: duplicates.length,
        totalAffected: totalDupes,
        message: `Found ${duplicates.length} duplicate ${fieldName} values in ${recordType} (${totalDupes} total records affected)`,
        samples: duplicates.slice(0, 5)
      };
      issues.push(issue);
      logWarning(issue.message);
    } else {
      logSuccess(`No duplicate ${fieldName} in ${recordType}`);
    }
    
    return duplicates;
  }
  
  // Check for duplicate IDs
  findDuplicatesByField(data.invoices, 'id', 'invoices');
  findDuplicatesByField(data.invoices, 'visualId', 'invoices');
  findDuplicatesByField(data.quotes, 'id', 'quotes');
  findDuplicatesByField(data.quotes, 'visualId', 'quotes');
  findDuplicatesByField(data.transactions, 'id', 'transactions');
  findDuplicatesByField(data.contacts, 'id', 'contacts');
  findDuplicatesByField(data.customers, 'id', 'customers');
  
  // Check for duplicate line items
  let totalLineItems = 0;
  let duplicateLineItemIds = [];
  const lineItemIdMap = {};
  
  [...data.invoices, ...data.quotes].forEach(order => {
    if (!order.lineItemGroups) return;
    order.lineItemGroups.forEach(group => {
      if (!group.lineItems) return;
      group.lineItems.forEach(item => {
        totalLineItems++;
        if (lineItemIdMap[item.id]) {
          lineItemIdMap[item.id].push(order.id);
          duplicateLineItemIds.push(item.id);
        } else {
          lineItemIdMap[item.id] = [order.id];
        }
      });
    });
  });
  
  const uniqueDuplicateLineItems = [...new Set(duplicateLineItemIds)];
  if (uniqueDuplicateLineItems.length > 0) {
    const issue = {
      type: 'duplicate_line_items',
      severity: 'medium',
      totalLineItems,
      duplicateCount: uniqueDuplicateLineItems.length,
      message: `Found ${uniqueDuplicateLineItems.length} duplicate line item IDs across orders`,
      samples: uniqueDuplicateLineItems.slice(0, 5).map(id => ({
        lineItemId: id,
        foundInOrders: lineItemIdMap[id]
      }))
    };
    issues.push(issue);
    logWarning(issue.message);
  } else {
    logSuccess(`No duplicate line item IDs (${totalLineItems} total line items checked)`);
  }
  
  // Check for identical data with different IDs (potential duplicates)
  function findIdenticalRecords(records, fields, recordType) {
    const signatures = {};
    const identicalRecords = [];
    
    records.forEach(record => {
      const signature = fields.map(f => JSON.stringify(record[f])).join('|');
      if (signatures[signature]) {
        signatures[signature].push(record.id);
      } else {
        signatures[signature] = [record.id];
      }
    });
    
    Object.entries(signatures).forEach(([signature, ids]) => {
      if (ids.length > 1) {
        identicalRecords.push({ signature, ids, count: ids.length });
      }
    });
    
    if (identicalRecords.length > 0) {
      const issue = {
        type: 'identical_records',
        severity: 'medium',
        recordType,
        count: identicalRecords.length,
        message: `Found ${identicalRecords.length} sets of ${recordType} with identical data but different IDs`,
        samples: identicalRecords.slice(0, 3).map(r => ({ ids: r.ids, count: r.count }))
      };
      issues.push(issue);
      logWarning(issue.message);
    }
    
    return identicalRecords;
  }
  
  // Check for identical transactions
  findIdenticalRecords(data.transactions, ['amount', 'transactionDate', 'description'], 'transactions');
  
  // Check for identical contacts
  findIdenticalRecords(data.contacts, ['firstName', 'lastName', 'email', 'phone'], 'contacts');
  
  return { issues };
}

// 3. Artwork/Production Files Analysis
function analyzeArtworkFiles(data) {
  logSubSection('3. Artwork/Production Files Analysis');
  
  const issues = [];
  const stats = {
    totalFiles: 0,
    uniqueUrls: new Set(),
    nullUrls: 0,
    emptyUrls: 0,
    ordersWithFiles: 0,
    ordersWithLineItemsButNoFiles: 0,
    filesByMimeType: {},
    urlsByOrder: {}
  };
  
  // Analyze invoices and quotes
  [...data.invoices, ...data.quotes].forEach(order => {
    const hasLineItems = order.lineItemGroups && 
                         order.lineItemGroups.some(g => g.lineItems && g.lineItems.length > 0);
    
    if (order.productionFiles && order.productionFiles.length > 0) {
      stats.ordersWithFiles++;
      stats.urlsByOrder[order.id] = [];
      
      order.productionFiles.forEach(file => {
        stats.totalFiles++;
        
        // Check for null/empty URLs
        if (file.fileUrl === null || file.fileUrl === undefined) {
          stats.nullUrls++;
        } else if (file.fileUrl === '') {
          stats.emptyUrls++;
        } else {
          stats.uniqueUrls.add(file.fileUrl);
          stats.urlsByOrder[order.id].push(file.fileUrl);
        }
        
        // Track MIME types
        const mimeType = file.mimeType || 'unknown';
        stats.filesByMimeType[mimeType] = (stats.filesByMimeType[mimeType] || 0) + 1;
      });
    } else if (hasLineItems) {
      stats.ordersWithLineItemsButNoFiles++;
    }
  });
  
  logInfo(`Total production files: ${stats.totalFiles}`);
  logInfo(`Unique URLs: ${stats.uniqueUrls.size}`);
  logInfo(`Orders with files: ${stats.ordersWithFiles}`);
  logInfo(`Orders with line items but no files: ${stats.ordersWithLineItemsButNoFiles}`);
  
  // Issue: Null or empty file URLs
  if (stats.nullUrls > 0) {
    const issue = {
      type: 'null_file_urls',
      severity: 'high',
      count: stats.nullUrls,
      percentage: ((stats.nullUrls / stats.totalFiles) * 100).toFixed(2),
      message: `${stats.nullUrls} production files have null fileUrl (${((stats.nullUrls / stats.totalFiles) * 100).toFixed(2)}%)`
    };
    issues.push(issue);
    logError(issue.message);
  }
  
  if (stats.emptyUrls > 0) {
    const issue = {
      type: 'empty_file_urls',
      severity: 'high',
      count: stats.emptyUrls,
      percentage: ((stats.emptyUrls / stats.totalFiles) * 100).toFixed(2),
      message: `${stats.emptyUrls} production files have empty fileUrl (${((stats.emptyUrls / stats.totalFiles) * 100).toFixed(2)}%)`
    };
    issues.push(issue);
    logError(issue.message);
  }
  
  // Issue: Orders with line items but no production files
  if (stats.ordersWithLineItemsButNoFiles > 0) {
    const totalOrdersWithLineItems = stats.ordersWithFiles + stats.ordersWithLineItemsButNoFiles;
    const issue = {
      type: 'missing_production_files',
      severity: 'medium',
      count: stats.ordersWithLineItemsButNoFiles,
      percentage: ((stats.ordersWithLineItemsButNoFiles / totalOrdersWithLineItems) * 100).toFixed(2),
      message: `${stats.ordersWithLineItemsButNoFiles} orders have line items but no production files (${((stats.ordersWithLineItemsButNoFiles / totalOrdersWithLineItems) * 100).toFixed(2)}%)`
    };
    issues.push(issue);
    logWarning(issue.message);
  }
  
  // Issue: Duplicate URLs
  const duplicateUrls = [];
  Object.entries(stats.urlsByOrder).forEach(([orderId, urls]) => {
    const urlCounts = {};
    urls.forEach(url => {
      urlCounts[url] = (urlCounts[url] || 0) + 1;
    });
    Object.entries(urlCounts).forEach(([url, count]) => {
      if (count > 1) {
        duplicateUrls.push({ orderId, url, count });
      }
    });
  });
  
  if (duplicateUrls.length > 0) {
    const issue = {
      type: 'duplicate_file_urls',
      severity: 'low',
      count: duplicateUrls.length,
      message: `${duplicateUrls.length} instances of duplicate file URLs within same order`,
      samples: duplicateUrls.slice(0, 5)
    };
    issues.push(issue);
    logWarning(issue.message);
  }
  
  // Calculate actual vs expected file count
  const discrepancy = stats.totalFiles - stats.uniqueUrls.size;
  if (discrepancy !== 0) {
    const issue = {
      type: 'file_count_discrepancy',
      severity: 'medium',
      totalFiles: stats.totalFiles,
      uniqueUrls: stats.uniqueUrls.size,
      difference: discrepancy,
      message: `Total files (${stats.totalFiles}) vs unique URLs (${stats.uniqueUrls.size}): difference of ${discrepancy}`
    };
    issues.push(issue);
    logInfo(issue.message);
  }
  
  return { stats, issues };
}

// 4. Data Relationships Validation
function validateRelationships(data) {
  logSubSection('4. Data Relationships Validation');
  
  const issues = [];
  
  // Build lookup maps
  const orderIds = new Set([...data.invoices, ...data.quotes].map(o => o.id));
  const productIds = new Set(data.products.map(p => p.id));
  const customerIds = new Set(data.customers.map(c => c.id));
  const contactIds = new Set(data.contacts.map(c => c.id));
  
  // 1. Verify transactions have corresponding orders
  let transactionsWithInvalidOrders = 0;
  const invalidTransactionSamples = [];
  
  data.transactions.forEach(transaction => {
    if (transaction.transactedFor) {
      const orderId = transaction.transactedFor.id;
      if (!orderIds.has(orderId)) {
        transactionsWithInvalidOrders++;
        if (invalidTransactionSamples.length < 10) {
          invalidTransactionSamples.push({
            transactionId: transaction.id,
            orderId: orderId
          });
        }
      }
    }
  });
  
  if (transactionsWithInvalidOrders > 0) {
    const issue = {
      type: 'invalid_transaction_orders',
      severity: 'high',
      count: transactionsWithInvalidOrders,
      message: `${transactionsWithInvalidOrders} transactions reference non-existent orders`,
      samples: invalidTransactionSamples
    };
    issues.push(issue);
    logError(issue.message);
  } else {
    logSuccess('All transactions reference valid orders');
  }
  
  // 2. Check line items reference valid products (where product is specified)
  let lineItemsWithProducts = 0;
  let lineItemsWithInvalidProducts = 0;
  const invalidProductSamples = [];
  
  [...data.invoices, ...data.quotes].forEach(order => {
    if (!order.lineItemGroups) return;
    order.lineItemGroups.forEach(group => {
      if (!group.lineItems) return;
      group.lineItems.forEach(item => {
        if (item.product) {
          lineItemsWithProducts++;
          if (!productIds.has(item.product.id)) {
            lineItemsWithInvalidProducts++;
            if (invalidProductSamples.length < 10) {
              invalidProductSamples.push({
                orderId: order.id,
                lineItemId: item.id,
                productId: item.product.id
              });
            }
          }
        }
      });
    });
  });
  
  if (lineItemsWithInvalidProducts > 0) {
    const issue = {
      type: 'invalid_product_references',
      severity: 'medium',
      totalWithProducts: lineItemsWithProducts,
      invalidCount: lineItemsWithInvalidProducts,
      percentage: ((lineItemsWithInvalidProducts / lineItemsWithProducts) * 100).toFixed(2),
      message: `${lineItemsWithInvalidProducts} line items reference non-existent products (${((lineItemsWithInvalidProducts / lineItemsWithProducts) * 100).toFixed(2)}%)`,
      samples: invalidProductSamples
    };
    issues.push(issue);
    logWarning(issue.message);
  } else {
    logSuccess(`All ${lineItemsWithProducts} line items with products reference valid products`);
  }
  
  // 3. Verify contacts are linked to customers
  const contactsWithInvalidCustomers = data.contacts.filter(c => {
    return c.customer && !customerIds.has(c.customer.id);
  });
  
  if (contactsWithInvalidCustomers.length > 0) {
    const issue = {
      type: 'invalid_customer_references',
      severity: 'high',
      count: contactsWithInvalidCustomers.length,
      message: `${contactsWithInvalidCustomers.length} contacts reference non-existent customers`,
      samples: contactsWithInvalidCustomers.slice(0, 10).map(c => ({
        contactId: c.id,
        customerId: c.customer.id
      }))
    };
    issues.push(issue);
    logError(issue.message);
  } else {
    logSuccess('All contacts with customers reference valid customers');
  }
  
  // 4. Verify tasks are linked to valid entities
  let tasksWithInvalidEntities = 0;
  const tasksSamples = [];
  
  data.tasks.forEach(task => {
    if (!task.taskable) {
      tasksWithInvalidEntities++;
      if (tasksSamples.length < 10) {
        tasksSamples.push({ taskId: task.id, name: task.name });
      }
    }
  });
  
  if (tasksWithInvalidEntities > 0) {
    const issue = {
      type: 'tasks_without_entities',
      severity: 'low',
      count: tasksWithInvalidEntities,
      percentage: ((tasksWithInvalidEntities / data.tasks.length) * 100).toFixed(2),
      message: `${tasksWithInvalidEntities} tasks are not linked to any entity (${((tasksWithInvalidEntities / data.tasks.length) * 100).toFixed(2)}%)`,
      samples: tasksSamples
    };
    issues.push(issue);
    logWarning(issue.message);
  }
  
  return { issues };
}

// 5. Size & Volume Analysis
function analyzeSizeAndVolume(data) {
  logSubSection('5. Size & Volume Analysis');
  
  const issues = [];
  const stats = {
    dataFiles: {},
    totalRecords: 0,
    recordSizes: {},
    largeRecords: [],
    smallRecords: []
  };
  
  // Analyze JSON file sizes
  const files = [
    'account.json', 'user.json', 'contacts.json', 'customers.json',
    'inquiries.json', 'invoices.json', 'quotes.json', 'orders.json',
    'products.json', 'statuses.json', 'tasks.json', 'threads.json',
    'transactions.json', 'payment_requests.json', 'merch_stores.json',
    'merch_orders.json'
  ];
  
  let totalBytes = 0;
  files.forEach(filename => {
    const filepath = path.join(OUTPUT_DIR, filename);
    if (fs.existsSync(filepath)) {
      const fileStats = fs.statSync(filepath);
      stats.dataFiles[filename] = {
        size: fileStats.size,
        sizeKB: (fileStats.size / 1024).toFixed(2),
        sizeMB: (fileStats.size / 1024 / 1024).toFixed(2)
      };
      totalBytes += fileStats.size;
    }
  });
  
  stats.totalSize = {
    bytes: totalBytes,
    KB: (totalBytes / 1024).toFixed(2),
    MB: (totalBytes / 1024 / 1024).toFixed(2)
  };
  
  logInfo(`Total data size: ${stats.totalSize.MB} MB`);
  
  // Find largest files
  const filesBySize = Object.entries(stats.dataFiles)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 5);
  
  logInfo('Largest files:');
  filesBySize.forEach(([name, info]) => {
    logInfo(`  - ${name}: ${info.sizeMB} MB`);
  });
  
  // Analyze record sizes
  function analyzeRecordSizes(records, typeName) {
    if (!records || records.length === 0) return;
    
    const sizes = records.map(r => {
      const json = JSON.stringify(r);
      return { id: r.id, size: json.length };
    });
    
    sizes.sort((a, b) => b.size - a.size);
    
    const avgSize = sizes.reduce((sum, s) => sum + s.size, 0) / sizes.length;
    const maxSize = sizes[0].size;
    const minSize = sizes[sizes.length - 1].size;
    
    stats.recordSizes[typeName] = {
      count: sizes.length,
      avgSize: avgSize.toFixed(0),
      maxSize,
      minSize,
      largest: sizes.slice(0, 3).map(s => ({ id: s.id, size: s.size })),
      smallest: sizes.slice(-3).map(s => ({ id: s.id, size: s.size }))
    };
    
    // Flag anomalies (records >3x or <0.3x average)
    const largeThreshold = avgSize * LARGE_RECORD_MULTIPLIER;
    const smallThreshold = avgSize * SMALL_RECORD_MULTIPLIER;
    
    const anomalouslyLarge = sizes.filter(s => s.size > largeThreshold);
    const anomalouslySmall = sizes.filter(s => s.size < smallThreshold);
    
    if (anomalouslyLarge.length > 0) {
      stats.largeRecords.push({
        type: typeName,
        count: anomalouslyLarge.length,
        samples: anomalouslyLarge.slice(0, 5)
      });
    }
    
    if (anomalouslySmall.length > 0) {
      stats.smallRecords.push({
        type: typeName,
        count: anomalouslySmall.length,
        samples: anomalouslySmall.slice(0, 5)
      });
    }
  }
  
  analyzeRecordSizes(data.invoices, 'invoices');
  analyzeRecordSizes(data.quotes, 'quotes');
  analyzeRecordSizes(data.customers, 'customers');
  analyzeRecordSizes(data.transactions, 'transactions');
  
  // Report anomalies
  if (stats.largeRecords.length > 0) {
    stats.largeRecords.forEach(anomaly => {
      const issue = {
        type: 'anomalously_large_records',
        severity: 'low',
        recordType: anomaly.type,
        count: anomaly.count,
        message: `${anomaly.count} ${anomaly.type} records are anomalously large (>3x average)`,
        samples: anomaly.samples
      };
      issues.push(issue);
      logInfo(issue.message);
    });
  }
  
  if (stats.smallRecords.length > 0) {
    stats.smallRecords.forEach(anomaly => {
      const issue = {
        type: 'anomalously_small_records',
        severity: 'low',
        recordType: anomaly.type,
        count: anomaly.count,
        message: `${anomaly.count} ${anomaly.type} records are anomalously small (<0.3x average)`,
        samples: anomaly.samples
      };
      issues.push(issue);
      logInfo(issue.message);
    });
  }
  
  // Mapping for filename to data key conversions
  const filenameToDataKey = {
    'payment_requests.json': 'paymentRequests',
    'merch_stores.json': 'merchStores',
    'merch_orders.json': 'merchOrders'
  };
  
  // Check for potential data truncation by comparing file sizes to record counts
  Object.entries(stats.dataFiles).forEach(([filename, fileInfo]) => {
    let dataKey = filename.replace('.json', '');
    if (filenameToDataKey[filename]) {
      dataKey = filenameToDataKey[filename];
    }
    
    const records = data[dataKey];
    if (Array.isArray(records) && records.length > 0) {
      const avgRecordSize = fileInfo.size / records.length;
      
      if (avgRecordSize < MIN_EXPECTED_RECORD_SIZE) {
        const issue = {
          type: 'potential_truncation',
          severity: 'medium',
          file: filename,
          recordCount: records.length,
          fileSize: fileInfo.size,
          avgRecordSize: avgRecordSize.toFixed(0),
          message: `${filename} has suspiciously small average record size (${avgRecordSize.toFixed(0)} bytes) - possible truncation`
        };
        issues.push(issue);
        logWarning(issue.message);
      }
    }
  });
  
  return { stats, issues };
}

// ============================================================================
// Report Generation Functions
// ============================================================================

function generateAuditReport(analyses) {
  logSection('Generating Audit Reports');
  
  const timestamp = new Date().toISOString();
  
  const allIssues = [
    ...analyses.completeness.issues,
    ...analyses.duplicates.issues,
    ...analyses.artwork.issues,
    ...analyses.relationships.issues,
    ...analyses.sizeVolume.issues
  ];
  
  const severityCounts = {
    high: allIssues.filter(i => i.severity === 'high').length,
    medium: allIssues.filter(i => i.severity === 'medium').length,
    low: allIssues.filter(i => i.severity === 'low').length
  };
  
  const auditReport = {
    metadata: {
      generatedAt: timestamp,
      auditVersion: '1.0.0',
      description: 'Comprehensive data audit and validation report for Printavo data extraction'
    },
    summary: {
      totalIssuesFound: allIssues.length,
      severityBreakdown: severityCounts,
      dataCompleteness: {
        invoices: analyses.completeness.stats.invoices,
        quotes: analyses.completeness.stats.quotes,
        orders: analyses.completeness.stats.orders,
        transactions: analyses.completeness.stats.transactions,
        contacts: analyses.completeness.stats.contacts,
        customers: analyses.completeness.stats.customers
      },
      artworkFiles: {
        totalFiles: analyses.artwork.stats.totalFiles,
        uniqueUrls: analyses.artwork.stats.uniqueUrls.size,
        ordersWithFiles: analyses.artwork.stats.ordersWithFiles,
        ordersWithLineItemsButNoFiles: analyses.artwork.stats.ordersWithLineItemsButNoFiles
      },
      dataSize: {
        totalMB: analyses.sizeVolume.stats.totalSize.MB,
        totalBytes: analyses.sizeVolume.stats.totalSize.bytes
      }
    },
    analyses: {
      dataCompleteness: {
        stats: analyses.completeness.stats,
        issues: analyses.completeness.issues
      },
      duplicates: {
        issues: analyses.duplicates.issues
      },
      artworkFiles: {
        stats: {
          ...analyses.artwork.stats,
          uniqueUrls: analyses.artwork.stats.uniqueUrls.size
        },
        issues: analyses.artwork.issues
      },
      relationships: {
        issues: analyses.relationships.issues
      },
      sizeAndVolume: {
        stats: analyses.sizeVolume.stats,
        issues: analyses.sizeVolume.issues
      }
    },
    recommendations: generateRecommendations(allIssues)
  };
  
  return auditReport;
}

function generateRecommendations(issues) {
  const recommendations = [];
  
  const issuesByType = {};
  issues.forEach(issue => {
    if (!issuesByType[issue.type]) {
      issuesByType[issue.type] = [];
    }
    issuesByType[issue.type].push(issue);
  });
  
  if (issuesByType.orphaned_transactions) {
    recommendations.push({
      priority: 'high',
      category: 'data_integrity',
      issue: 'Orphaned transactions',
      recommendation: 'Investigate transactions without orders. These may be payment requests, refunds, or system artifacts.',
      action: 'Review transactions without transactedFor field and verify if they should be linked to orders or payment requests.'
    });
  }
  
  if (issuesByType.null_file_urls || issuesByType.empty_file_urls) {
    recommendations.push({
      priority: 'high',
      category: 'data_loss_prevention',
      issue: 'Missing production file URLs',
      recommendation: 'Some production files have null or empty URLs. These files cannot be downloaded and represent potential data loss.',
      action: 'Before canceling Printavo, manually verify and download all production files.'
    });
  }
  
  if (issuesByType.missing_production_files) {
    recommendations.push({
      priority: 'medium',
      category: 'data_completeness',
      issue: 'Orders with line items but no production files',
      recommendation: 'Some orders have products but no associated artwork files.',
      action: 'Review orders without production files and manually download any missing artwork before canceling service.'
    });
  }
  
  if (issuesByType.duplicate_ids) {
    recommendations.push({
      priority: 'high',
      category: 'data_integrity',
      issue: 'Duplicate IDs detected',
      recommendation: 'Duplicate IDs indicate potential data corruption or API extraction issues.',
      action: 'Re-run extraction for affected data types. If duplicates persist, contact Printavo support before canceling.'
    });
  }
  
  if (issuesByType.null_critical_field) {
    recommendations.push({
      priority: 'high',
      category: 'data_completeness',
      issue: 'Missing critical fields',
      recommendation: 'Some records are missing critical fields like ID, visualId, or relationships.',
      action: 'Verify these records in Printavo UI. If they exist there, re-run extraction with updated queries.'
    });
  }
  
  recommendations.push({
    priority: 'high',
    category: 'backup_strategy',
    issue: 'Data preservation',
    recommendation: 'Before canceling Printavo, create multiple backups of all extracted data.',
    action: '1. Run extract.js to get all data\n2. Run extract-artwork-clean.sh to organize files\n3. Download all production files\n4. Create backup on external drive and cloud storage\n5. Verify all backups are complete and accessible'
  });
  
  recommendations.push({
    priority: 'medium',
    category: 'data_migration',
    issue: 'Future data access',
    recommendation: 'Consider creating a local database or spreadsheet from the extracted JSON files for ongoing access.',
    action: 'Import CSV files into Excel or database for filtering, searching, and reporting on historical data.'
  });
  
  return recommendations;
}

function generateTextReport(auditReport) {
  const lines = [];
  
  lines.push('╔' + '═'.repeat(78) + '╗');
  lines.push('║' + ' '.repeat(20) + 'PRINTAVO DATA AUDIT REPORT' + ' '.repeat(32) + '║');
  lines.push('╚' + '═'.repeat(78) + '╝');
  lines.push('');
  lines.push(`Generated: ${auditReport.metadata.generatedAt}`);
  lines.push(`Version: ${auditReport.metadata.auditVersion}`);
  lines.push('');
  
  lines.push('═'.repeat(80));
  lines.push('EXECUTIVE SUMMARY');
  lines.push('═'.repeat(80));
  lines.push('');
  lines.push(`Total Issues Found: ${auditReport.summary.totalIssuesFound}`);
  lines.push(`  - High Severity: ${auditReport.summary.severityBreakdown.high}`);
  lines.push(`  - Medium Severity: ${auditReport.summary.severityBreakdown.medium}`);
  lines.push(`  - Low Severity: ${auditReport.summary.severityBreakdown.low}`);
  lines.push('');
  
  lines.push('─'.repeat(80));
  lines.push('DATA COMPLETENESS');
  lines.push('─'.repeat(80));
  lines.push(`Invoices: ${auditReport.summary.dataCompleteness.invoices}`);
  lines.push(`Quotes: ${auditReport.summary.dataCompleteness.quotes}`);
  lines.push(`Orders (union): ${auditReport.summary.dataCompleteness.orders}`);
  lines.push(`Transactions: ${auditReport.summary.dataCompleteness.transactions}`);
  lines.push(`Contacts: ${auditReport.summary.dataCompleteness.contacts}`);
  lines.push(`Customers: ${auditReport.summary.dataCompleteness.customers}`);
  lines.push('');
  
  lines.push('─'.repeat(80));
  lines.push('ARTWORK & PRODUCTION FILES');
  lines.push('─'.repeat(80));
  lines.push(`Total Production Files: ${auditReport.summary.artworkFiles.totalFiles}`);
  lines.push(`Unique URLs: ${auditReport.summary.artworkFiles.uniqueUrls}`);
  lines.push(`Orders with Files: ${auditReport.summary.artworkFiles.ordersWithFiles}`);
  lines.push(`Orders with Line Items but No Files: ${auditReport.summary.artworkFiles.ordersWithLineItemsButNoFiles}`);
  lines.push('');
  
  lines.push('─'.repeat(80));
  lines.push('DATA SIZE & VOLUME');
  lines.push('─'.repeat(80));
  lines.push(`Total Data Size: ${auditReport.summary.dataSize.totalMB} MB`);
  lines.push('');
  
  lines.push('═'.repeat(80));
  lines.push('DETAILED ISSUES');
  lines.push('═'.repeat(80));
  lines.push('');
  
  const allIssues = [
    ...auditReport.analyses.dataCompleteness.issues,
    ...auditReport.analyses.duplicates.issues,
    ...auditReport.analyses.artworkFiles.issues,
    ...auditReport.analyses.relationships.issues,
    ...auditReport.analyses.sizeAndVolume.issues
  ];
  
  ['high', 'medium', 'low'].forEach(severity => {
    const severityIssues = allIssues.filter(i => i.severity === severity);
    if (severityIssues.length > 0) {
      lines.push('─'.repeat(80));
      lines.push(`${severity.toUpperCase()} SEVERITY ISSUES (${severityIssues.length})`);
      lines.push('─'.repeat(80));
      severityIssues.forEach((issue, idx) => {
        lines.push(`${idx + 1}. [${issue.type}] ${issue.message}`);
        if (issue.samples && issue.samples.length > 0) {
          lines.push(`   Samples: ${JSON.stringify(issue.samples.slice(0, 2))}`);
        }
        lines.push('');
      });
    }
  });
  
  lines.push('═'.repeat(80));
  lines.push('RECOMMENDATIONS');
  lines.push('═'.repeat(80));
  lines.push('');
  
  auditReport.recommendations.forEach((rec, idx) => {
    lines.push(`${idx + 1}. [${rec.priority.toUpperCase()}] ${rec.category}`);
    lines.push(`   Issue: ${rec.issue}`);
    lines.push(`   Recommendation: ${rec.recommendation}`);
    lines.push(`   Action: ${rec.action}`);
    lines.push('');
  });
  
  lines.push('═'.repeat(80));
  lines.push('END OF REPORT');
  lines.push('═'.repeat(80));
  
  return lines.join('\n');
}

function generateDiscrepanciesReport(analyses) {
  const allIssues = [
    ...analyses.completeness.issues,
    ...analyses.duplicates.issues,
    ...analyses.artwork.issues,
    ...analyses.relationships.issues,
    ...analyses.sizeVolume.issues
  ];
  
  return {
    generatedAt: new Date().toISOString(),
    totalDiscrepancies: allIssues.length,
    bySeverity: {
      high: allIssues.filter(i => i.severity === 'high'),
      medium: allIssues.filter(i => i.severity === 'medium'),
      low: allIssues.filter(i => i.severity === 'low')
    },
    byType: allIssues.reduce((acc, issue) => {
      if (!acc[issue.type]) {
        acc[issue.type] = [];
      }
      acc[issue.type].push(issue);
      return acc;
    }, {}),
    allIssues
  };
}

function generateSourceOfTruthManifest(data, analyses) {
  return {
    generatedAt: new Date().toISOString(),
    description: 'Complete inventory of all Printavo data extracted',
    dataIntegrity: {
      validated: new Date().toISOString(),
      totalIssuesFound: analyses.completeness.issues.length + 
                        analyses.duplicates.issues.length +
                        analyses.artwork.issues.length +
                        analyses.relationships.issues.length +
                        analyses.sizeVolume.issues.length
    },
    inventory: {
      account: data.account ? 1 : 0,
      user: data.user ? 1 : 0,
      contacts: data.contacts.length,
      customers: data.customers.length,
      inquiries: data.inquiries.length,
      invoices: data.invoices.length,
      quotes: data.quotes.length,
      orders: data.orders.length,
      products: data.products.length,
      statuses: data.statuses.length,
      tasks: data.tasks.length,
      threads: data.threads.length,
      transactions: data.transactions.length,
      paymentRequests: data.paymentRequests.length,
      merchStores: data.merchStores.length,
      merchOrders: data.merchOrders.length
    },
    detailedCounts: {
      lineItems: [...data.invoices, ...data.quotes].reduce((sum, order) => {
        if (!order.lineItemGroups) return sum;
        return sum + order.lineItemGroups.reduce((s, g) => {
          return s + (g.lineItems ? g.lineItems.length : 0);
        }, 0);
      }, 0),
      imprints: [...data.invoices, ...data.quotes].reduce((sum, order) => {
        if (!order.lineItemGroups) return sum;
        return sum + order.lineItemGroups.reduce((s, g) => {
          return s + (g.imprints ? g.imprints.length : 0);
        }, 0);
      }, 0),
      productionFiles: analyses.artwork.stats.totalFiles,
      uniqueProductionFileUrls: analyses.artwork.stats.uniqueUrls.size,
      expenses: [...data.invoices, ...data.quotes].reduce((sum, order) => {
        return sum + (order.expenses ? order.expenses.length : 0);
      }, 0)
    },
    fileManifest: {
      location: './output',
      files: analyses.sizeVolume.stats.dataFiles,
      totalSize: analyses.sizeVolume.stats.totalSize
    },
    recommendations: [
      'Verify all production files are downloaded',
      'Create backup copies of all JSON files on external storage',
      'Import CSV files into spreadsheet or database for ongoing access',
      'Document any custom integrations or workflows that depend on Printavo data',
      'Test restoration process before canceling Printavo subscription'
    ]
  };
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.clear();
  
  logSection('Printavo Data Audit & Validation Script');
  log('This script performs comprehensive analysis of extracted Printavo data', 'cyan');
  log('to identify completeness issues, duplicates, and potential data loss.', 'cyan');
  
  if (!fs.existsSync(AUDIT_OUTPUT_DIR)) {
    fs.mkdirSync(AUDIT_OUTPUT_DIR, { recursive: true });
    logSuccess(`Created audit output directory: ${AUDIT_OUTPUT_DIR}`);
  }
  
  const data = loadAllData();
  
  const hasData = Object.values(data).some(d => d !== null && (Array.isArray(d) ? d.length > 0 : true));
  if (!hasData) {
    logError('No data files found in output directory!');
    logInfo('Please run extract.js first to download data from Printavo.');
    process.exit(1);
  }
  
  logSection('Running Audit Analyses');
  
  const analyses = {
    completeness: analyzeDataCompleteness(data),
    duplicates: analyzeDuplicates(data),
    artwork: analyzeArtworkFiles(data),
    relationships: validateRelationships(data),
    sizeVolume: analyzeSizeAndVolume(data)
  };
  
  logSection('Generating Reports');
  
  const auditReport = generateAuditReport(analyses);
  const textReport = generateTextReport(auditReport);
  const discrepancies = generateDiscrepanciesReport(analyses);
  const manifest = generateSourceOfTruthManifest(data, analyses);
  
  const auditReportPath = path.join(AUDIT_OUTPUT_DIR, 'audit-report.json');
  const textReportPath = path.join(AUDIT_OUTPUT_DIR, 'audit-report.txt');
  const discrepanciesPath = path.join(AUDIT_OUTPUT_DIR, 'data-discrepancies.json');
  const manifestPath = path.join(AUDIT_OUTPUT_DIR, 'source-of-truth-manifest.json');
  
  fs.writeFileSync(auditReportPath, JSON.stringify(auditReport, null, 2));
  logSuccess(`Saved: ${auditReportPath}`);
  
  fs.writeFileSync(textReportPath, textReport);
  logSuccess(`Saved: ${textReportPath}`);
  
  fs.writeFileSync(discrepanciesPath, JSON.stringify(discrepancies, null, 2));
  logSuccess(`Saved: ${discrepanciesPath}`);
  
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  logSuccess(`Saved: ${manifestPath}`);
  
  logSection('Audit Complete');
  
  console.log('');
  console.log(COLORS.bright + 'SUMMARY:' + COLORS.reset);
  console.log('─'.repeat(80));
  console.log(`Total Issues Found: ${COLORS.yellow}${auditReport.summary.totalIssuesFound}${COLORS.reset}`);
  console.log(`  - High Severity: ${COLORS.red}${auditReport.summary.severityBreakdown.high}${COLORS.reset}`);
  console.log(`  - Medium Severity: ${COLORS.yellow}${auditReport.summary.severityBreakdown.medium}${COLORS.reset}`);
  console.log(`  - Low Severity: ${COLORS.blue}${auditReport.summary.severityBreakdown.low}${COLORS.reset}`);
  console.log('');
  console.log(`Production Files: ${COLORS.cyan}${analyses.artwork.stats.totalFiles}${COLORS.reset}`);
  console.log(`Unique URLs: ${COLORS.cyan}${analyses.artwork.stats.uniqueUrls.size}${COLORS.reset}`);
  console.log(`Total Data Size: ${COLORS.cyan}${analyses.sizeVolume.stats.totalSize.MB} MB${COLORS.reset}`);
  console.log('');
  console.log('Reports generated in: ' + COLORS.green + AUDIT_OUTPUT_DIR + COLORS.reset);
  console.log('  - audit-report.json (detailed JSON report)');
  console.log('  - audit-report.txt (human-readable summary)');
  console.log('  - data-discrepancies.json (all found issues)');
  console.log('  - source-of-truth-manifest.json (complete inventory)');
  console.log('');
  console.log(COLORS.bright + 'Next steps:' + COLORS.reset);
  console.log('  1. Review: cat ' + AUDIT_OUTPUT_DIR + '/audit-report.txt');
  console.log('  2. Address high-severity issues before canceling Printavo');
  console.log('  3. Download all production files using extract-artwork-clean.sh');
  console.log('  4. Create backups on external storage and cloud');
  console.log('');
}

main().catch(err => {
  logError('Fatal error: ' + err.message);
  console.error(err.stack);
  process.exit(1);
});