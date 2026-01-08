#!/bin/bash
# run-extract.sh - Auto-restart wrapper for extract.js
# 
# This script provides an ultimate safety net by automatically restarting
# the extraction script if it exits for any reason (crash, error, etc.)
#
# Usage:
#   ./run-extract.sh                    # Run in foreground
#   nohup ./run-extract.sh >> extract.log 2>&1 &   # Run in background
#
# Environment variables:
#   PRINTAVO_EMAIL - Your Printavo account email
#   PRINTAVO_TOKEN - Your Printavo API token

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/restarts.log"
RESTART_DELAY=30

# Function to log messages with timestamp
log_message() {
    echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] $1" >> "$LOG_FILE"
    echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] $1"
}

# Check if required environment variables are set
if [ -z "$PRINTAVO_EMAIL" ] || [ -z "$PRINTAVO_TOKEN" ]; then
    log_message "ERROR: PRINTAVO_EMAIL and PRINTAVO_TOKEN environment variables are required."
    log_message "Set them before running this script:"
    log_message "  export PRINTAVO_EMAIL='your-email@example.com'"
    log_message "  export PRINTAVO_TOKEN='your-api-token'"
    exit 1
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    log_message "ERROR: Node.js is not installed or not in PATH"
    exit 1
fi

# Check Node.js version (requires 18+)
NODE_VERSION_FULL=$(node -v)
NODE_VERSION_MAJOR=$(echo "$NODE_VERSION_FULL" | sed 's/^v//' | cut -d'.' -f1 | sed 's/[^0-9].*//')
if [ -z "$NODE_VERSION_MAJOR" ] || [ "$NODE_VERSION_MAJOR" -lt 18 ]; then
    log_message "ERROR: Node.js 18+ is required (current: ${NODE_VERSION_FULL})"
    exit 1
fi

# Check if extract.js exists (look in parent dir since we're in scripts/)
EXTRACT_SCRIPT="${SCRIPT_DIR}/../scripts/extract-all-data.js"
if [ ! -f "$EXTRACT_SCRIPT" ]; then
    EXTRACT_SCRIPT="${SCRIPT_DIR}/extract-all-data.js"
fi
if [ ! -f "$EXTRACT_SCRIPT" ]; then
    log_message "ERROR: extract-all-data.js not found"
    exit 1
fi

log_message "=========================================="
log_message "Printavo Extraction Wrapper Started"
log_message "=========================================="
log_message "Script directory: ${SCRIPT_DIR}"
log_message "Extract script: ${EXTRACT_SCRIPT}"
log_message "Restart delay: ${RESTART_DELAY} seconds"
log_message "Node.js version: $(node -v)"

# Main loop - keeps restarting until successful completion
while true; do
    log_message "Starting extraction..."
    
    # Run the extraction script
    set +e
    PRINTAVO_EMAIL="${PRINTAVO_EMAIL}" PRINTAVO_TOKEN="${PRINTAVO_TOKEN}" node "${EXTRACT_SCRIPT}"
    EXIT_CODE=$?
    set -e
    
    log_message "Extraction exited with code ${EXIT_CODE}"
    
    # Check if completed successfully (exit code 0)
    if [ $EXIT_CODE -eq 0 ]; then
        log_message "=========================================="
        log_message "Extraction completed successfully!"
        log_message "=========================================="
        break
    fi
    
    # If there was an error, wait and restart
    log_message "Extraction failed or encountered errors."
    log_message "Restarting in ${RESTART_DELAY} seconds..."
    log_message "------------------------------------------"
    
    sleep $RESTART_DELAY
done

log_message "Wrapper script finished."
exit 0