#!/usr/bin/env node
/**
 * Printavo Preflight Check
 * 
 * Tests API access and shows account statistics before full extraction.
 * Run this first to verify your credentials work.
 * 
 * Usage:
 *   node scripts/verify-preflight.js
 */

let CONFIG;
try {
  CONFIG = require('../config.js');
} catch (e) {
  console.error('ERROR: config.js not found. Copy config.example.js to config.js and add your credentials.');
  process.exit(1);
}

if (!CONFIG.PRINTAVO_EMAIL || !CONFIG.PRINTAVO_TOKEN || 
    CONFIG.PRINTAVO_EMAIL === 'your-email@example.com') {
  console.error('ERROR: Please configure your Printavo credentials in config.js');
  process.exit(1);
}

CONFIG.PRINTAVO_API = CONFIG.PRINTAVO_API || 'https://www.printavo.com/api/v2';

async function graphqlRequest(query) {
  const response = await fetch(CONFIG.PRINTAVO_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'email': CONFIG.PRINTAVO_EMAIL,
      'token': CONFIG.PRINTAVO_TOKEN
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(`GraphQL: ${result.errors.map(e => e.message).join(', ')}`);
  }

  return result.data;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║            PRINTAVO PREFLIGHT CHECK                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`API Endpoint: ${CONFIG.PRINTAVO_API}`);
  console.log(`Email: ${CONFIG.PRINTAVO_EMAIL}`);
  console.log('');
  
  try {
    console.log('Testing API access...');
    
    const data = await graphqlRequest(`
      query {
        invoices(first: 1) { totalNodes }
        quotes(first: 1) { totalNodes }
      }
    `);
    
    console.log('');
    console.log('✓ API access successful!');
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                  ACCOUNT STATISTICS                        ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Total Invoices: ${data.invoices.totalNodes}`.padEnd(61) + '║');
    console.log(`║  Total Quotes: ${data.quotes.totalNodes}`.padEnd(61) + '║');
    console.log(`║  Total Orders: ${data.invoices.totalNodes + data.quotes.totalNodes}`.padEnd(61) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Ready to extract! Run:');
    console.log('  node scripts/extract-all-data.js');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('✗ API access FAILED');
    console.error('');
    console.error(`Error: ${error.message}`);
    console.error('');
    console.error('Please check:');
    console.error('  1. Your email is correct');
    console.error('  2. Your API token is correct (from My Account → API)');
    console.error('  3. Your Printavo account is still active');
    console.error('');
    process.exit(1);
  }
}

main();
