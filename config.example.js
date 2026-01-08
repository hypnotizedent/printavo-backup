/**
 * Printavo Backup Configuration
 * 
 * Copy this file to config.js and fill in your credentials.
 * 
 * To find your API credentials:
 * 1. Log into Printavo
 * 2. Go to My Account → API
 * 3. Copy your email and token
 */

module.exports = {
  // Your Printavo login email
  PRINTAVO_EMAIL: 'your-email@example.com',
  
  // Your Printavo API token (from My Account → API)
  PRINTAVO_TOKEN: 'your-api-token-here',
  
  // API endpoint (don't change unless Printavo updates it)
  PRINTAVO_API: 'https://www.printavo.com/api/v2',
  
  // Rate limiting (Printavo allows 10 requests per 5 seconds)
  RATE_LIMIT_DELAY: 650,  // milliseconds between requests
  
  // Retry configuration
  RETRY_DELAY: 5000,      // milliseconds before retry
  MAX_RETRIES: 3,         // number of retries per request
  
  // Output directory (relative to script location)
  DATA_DIR: './data',
};
