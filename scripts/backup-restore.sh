#!/bin/bash

# ============================================================================
# Printavo Backup Restoration & Verification Script
# ============================================================================
#
# This script helps verify backup integrity, restore specific invoices,
# and locate artwork files from the Printavo backup.
#
# Usage:
#   ./scripts/backup-restore.sh <command> [options]
#
# Commands:
#   verify              - Verify backup integrity
#   search <invoice>    - Search for specific invoice
#   artwork <invoice>   - Find artwork for invoice
#   restore-all         - Restore complete backup
#   import-db           - Import JSON to SQLite database
#   help                - Show this help message
#
# ============================================================================

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Directories
OUTPUT_DIR="./output"
AUDIT_DIR="./audit-output"
ARTWORK_DIR="./artwork"
SCRIPTS_DIR="./scripts"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_header() {
    echo -e "\n${BOLD}========================================${NC}"
    echo -e "${BOLD}$1${NC}"
    echo -e "${BOLD}========================================${NC}\n"
}

# Check if jq is installed
check_jq() {
    if ! command -v jq &> /dev/null; then
        log_error "jq is not installed. Please install it first:"
        echo "  Ubuntu/Debian: sudo apt-get install jq"
        echo "  macOS: brew install jq"
        exit 1
    fi
}

# Verify backup integrity
verify_backup() {
    log_header "Verifying Backup Integrity"
    
    local errors=0
    local warnings=0
    
    # Check if output directory exists
    if [ ! -d "$OUTPUT_DIR" ]; then
        log_error "Output directory not found: $OUTPUT_DIR"
        return 1
    fi
    
    log_info "Checking JSON files..."
    
    # List of expected files
    local files=(
        "account.json"
        "user.json"
        "contacts.json"
        "customers.json"
        "invoices.json"
        "quotes.json"
        "products.json"
        "statuses.json"
        "tasks.json"
        "threads.json"
        "transactions.json"
    )
    
    for file in "${files[@]}"; do
        local filepath="$OUTPUT_DIR/$file"
        
        if [ ! -f "$filepath" ]; then
            log_error "Missing file: $file"
            ((errors++))
            continue
        fi
        
        # Verify JSON is valid
        if ! jq empty "$filepath" 2>/dev/null; then
            log_error "Invalid JSON: $file"
            ((errors++))
            continue
        fi
        
        # Check file size
        local size=$(stat -f%z "$filepath" 2>/dev/null || stat -c%s "$filepath" 2>/dev/null || echo 0)
        if [ "$size" -lt 10 ]; then
            log_warning "Suspiciously small file: $file ($size bytes)"
            ((warnings++))
        else
            log_success "✓ $file ($(numfmt --to=iec-i --suffix=B $size 2>/dev/null || echo "${size} bytes"))"
        fi
    done
    
    # Check for duplicate IDs
    log_info "Checking for duplicate IDs..."
    
    for file in invoices.json quotes.json customers.json contacts.json; do
        local filepath="$OUTPUT_DIR/$file"
        if [ -f "$filepath" ]; then
            local total=$(jq 'length' "$filepath")
            local unique=$(jq '[.[] | .id] | unique | length' "$filepath" 2>/dev/null || echo 0)
            
            if [ "$total" != "$unique" ]; then
                log_error "Duplicate IDs found in $file (Total: $total, Unique: $unique)"
                ((errors++))
            else
                log_success "✓ No duplicates in $file ($total records)"
            fi
        fi
    done
    
    # Check artwork files
    log_info "Checking artwork files..."
    
    if [ -f "$OUTPUT_DIR/01-production-files.json" ]; then
        local artwork_count=$(jq 'length' "$OUTPUT_DIR/01-production-files.json")
        log_success "✓ $artwork_count artwork file records"
        
        # Check for null URLs
        local null_urls=$(jq '[.[] | select(.fileUrl == null or .fileUrl == "")] | length' "$OUTPUT_DIR/01-production-files.json")
        if [ "$null_urls" -gt 0 ]; then
            log_warning "$null_urls artwork files have null/empty URLs"
            ((warnings++))
        fi
    else
        log_warning "Artwork metadata file not found"
        ((warnings++))
    fi
    
    # Summary
    echo ""
    log_header "Verification Summary"
    
    if [ $errors -eq 0 ] && [ $warnings -eq 0 ]; then
        log_success "✅ Backup is perfect! No issues found."
        return 0
    elif [ $errors -eq 0 ]; then
        log_warning "⚠️  Backup is good with $warnings warning(s)."
        return 0
    else
        log_error "❌ Backup has $errors error(s) and $warnings warning(s)."
        return 1
    fi
}

# Search for a specific invoice
search_invoice() {
    local invoice_id="$1"
    
    if [ -z "$invoice_id" ]; then
        log_error "Please provide an invoice ID"
        echo "Usage: $0 search <invoice-id>"
        return 1
    fi
    
    check_jq
    
    log_header "Searching for Invoice: $invoice_id"
    
    # Search in invoices
    log_info "Searching invoices.json..."
    local invoice=$(jq ".[] | select(.visualId==\"$invoice_id\")" "$OUTPUT_DIR/invoices.json" 2>/dev/null)
    
    if [ -n "$invoice" ]; then
        log_success "Found in invoices!"
        echo "$invoice" | jq '{
            visualId: .visualId,
            total: .total,
            customerName: .contact.customer.companyName,
            invoiceDate: .invoiceAt,
            status: .status.name,
            lineItemCount: (.lineItemGroups.nodes | length),
            productionFileCount: (.productionFiles.nodes | length)
        }'
        return 0
    fi
    
    # Search in quotes
    log_info "Searching quotes.json..."
    local quote=$(jq ".[] | select(.visualId==\"$invoice_id\")" "$OUTPUT_DIR/quotes.json" 2>/dev/null)
    
    if [ -n "$quote" ]; then
        log_success "Found in quotes!"
        echo "$quote" | jq '{
            visualId: .visualId,
            total: .total,
            customerName: .contact.customer.companyName,
            quoteDate: .createdAt,
            status: .status.name,
            lineItemCount: (.lineItemGroups.nodes | length)
        }'
        return 0
    fi
    
    log_error "Invoice/Quote not found: $invoice_id"
    return 1
}

# Find artwork for invoice
find_artwork() {
    local invoice_id="$1"
    
    if [ -z "$invoice_id" ]; then
        log_error "Please provide an invoice ID"
        echo "Usage: $0 artwork <invoice-id>"
        return 1
    fi
    
    check_jq
    
    log_header "Finding Artwork for: $invoice_id"
    
    if [ ! -f "$OUTPUT_DIR/01-production-files.json" ]; then
        log_error "Production files metadata not found"
        log_info "Run ./extract-artwork-clean.sh first"
        return 1
    fi
    
    local files=$(jq ".[] | select(.visualId==\"$invoice_id\")" "$OUTPUT_DIR/01-production-files.json" 2>/dev/null)
    
    if [ -z "$files" ]; then
        log_warning "No artwork files found for invoice: $invoice_id"
        return 1
    fi
    
    local count=$(echo "$files" | jq -s 'length')
    log_success "Found $count artwork file(s)!"
    echo ""
    
    echo "$files" | jq -r '"File: \(.fileName)\nURL: \(.fileUrl)\nType: \(.mimeType)\n"'
    
    # Offer to download
    echo ""
    read -p "Download these files? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        mkdir -p "$ARTWORK_DIR/$invoice_id"
        echo "$files" | jq -r '.fileUrl' | while read url; do
            log_info "Downloading: $url"
            wget -q "$url" -P "$ARTWORK_DIR/$invoice_id/" || log_error "Download failed"
        done
        log_success "Files downloaded to: $ARTWORK_DIR/$invoice_id/"
    fi
}

# Restore all data
restore_all() {
    log_header "Restoring All Data"
    
    log_warning "This will download all artwork files and prepare data for use."
    read -p "Continue? (y/n): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Restore cancelled"
        return 0
    fi
    
    # Create directories
    log_info "Creating directories..."
    mkdir -p "$ARTWORK_DIR"
    
    # Download all artwork
    if [ -f "$OUTPUT_DIR/02-production-urls.txt" ]; then
        log_info "Downloading all artwork files..."
        log_warning "This may take a while..."
        
        wget -i "$OUTPUT_DIR/02-production-urls.txt" -P "$ARTWORK_DIR/" --progress=bar:force
        
        log_success "All artwork downloaded!"
    else
        log_warning "Production URLs file not found"
    fi
    
    # Verify JSON files
    verify_backup
    
    log_success "Restore complete!"
}

# Import to SQLite database
import_database() {
    log_header "Importing to SQLite Database"
    
    check_jq
    
    if ! command -v sqlite3 &> /dev/null