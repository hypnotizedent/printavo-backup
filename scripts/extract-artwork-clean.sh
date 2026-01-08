#!/bin/bash

# ============================================================================
# Printavo Artwork & Production Files Extraction Script
# ============================================================================
# 
# This script extracts artwork and production files data from invoices.json
# with NO SPACES in jq filter expressions to avoid syntax errors.
#
# Requirements:
#   - jq (JSON processor)
#   - invoices.json file in ./output/ directory
#
# Usage:
#   ./extract-artwork-clean.sh
#
# Outputs (numbered for organization):
#   01-production-files.json        - All production files with metadata
#   02-production-urls.txt          - List of all production file URLs
#   03-production-files.csv         - Production files mapped to invoices
#   04-line-items.json              - All line items (products) details
#   05-line-items.csv               - Line items in CSV format
#   06-imprints.json                - All imprints (decorations) details
#   07-imprints-summary.txt         - Human-readable imprint summary
#   08-inventory-master.csv         - Master inventory combining all data
#   09-extraction-summary.txt       - Statistics and summary report
#
# ============================================================================

set -e

# Configuration
INPUT_FILE="./output/invoices.json"
OUTPUT_DIR="./output"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored messages
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

# Function to check if jq is installed
check_dependencies() {
    if ! command -v jq &> /dev/null; then
        log_error "jq is not installed. Please install jq to run this script."
        log_info "Install with: sudo apt-get install jq (Ubuntu/Debian)"
        log_info "           or: brew install jq (macOS)"
        exit 1
    fi
}

# Function to check if input file exists
check_input_file() {
    if [ ! -f "$INPUT_FILE" ]; then
        log_error "Input file not found: $INPUT_FILE"
        log_info "Please ensure invoices.json exists in the output directory."
        exit 1
    fi
}

# ============================================================================
# Main extraction functions
# ============================================================================

# 1. Extract production files with metadata
extract_production_files() {
    log_info "Extracting production files with metadata..."
    jq '[.[]|select(.productionFiles)|.id as $invId|.visualId as $visId|.productionFiles[]|{invoiceId:$invId,visualId:$visId,fileId:.id,fileName:.name,fileUrl:.fileUrl,mimeType:.mimeType}]' "$INPUT_FILE" > "${OUTPUT_DIR}/01-production-files.json"
    log_success "Created: 01-production-files.json"
}

# 2. Extract production file URLs
extract_production_urls() {
    log_info "Extracting production file URLs..."
    jq -r '.[]|select(.productionFiles)|.productionFiles[]|.fileUrl' "$INPUT_FILE" > "${OUTPUT_DIR}/02-production-urls.txt"
    log_success "Created: 02-production-urls.txt"
}

# 3. Create CSV with production files mapped to invoice numbers
create_production_csv() {
    log_info "Creating production files CSV..."
    {
        echo "InvoiceID,InvoiceNumber,FileID,FileName,FileURL,MimeType"
        jq -r '.[]|select(.productionFiles)|. as $inv|.productionFiles[]|[$inv.id,$inv.visualId,.id,.name,.fileUrl,.mimeType]|@csv' "$INPUT_FILE"
    } > "${OUTPUT_DIR}/03-production-files.csv"
    log_success "Created: 03-production-files.csv"
}

# 4. Extract line items (products) with details
extract_line_items() {
    log_info "Extracting line items with details..."
    jq '[.[]|select(.lineItemGroups)|. as $inv|.lineItemGroups[]|.lineItems[]|{invoiceId:$inv.id,invoiceVisualId:$inv.visualId,lineItemId:.id,description:.description,itemNumber:.itemNumber,color:.color,quantity:.items,price:.price,sizes:.sizes}]' "$INPUT_FILE" > "${OUTPUT_DIR}/04-line-items.json"
    log_success "Created: 04-line-items.json"
}

# 5. Create line items CSV
create_line_items_csv() {
    log_info "Creating line items CSV..."
    {
        echo "InvoiceID,InvoiceNumber,LineItemID,Description,ItemNumber,Color,Quantity,Price,Sizes"
        jq -r '.[]|select(.lineItemGroups)|. as $inv|.lineItemGroups[]|.lineItems[]|[$inv.id,$inv.visualId,.id,.description,.itemNumber,.color,.items,.price,((.sizes//[])|map("\(.size):\(.count)")|join(";"))]|@csv' "$INPUT_FILE"
    } > "${OUTPUT_DIR}/05-line-items.csv"
    log_success "Created: 05-line-items.csv"
}

# 6. Extract imprints (decorations)
extract_imprints() {
    log_info "Extracting imprints..."
    jq '[.[]|select(.lineItemGroups)|. as $inv|.lineItemGroups[]|select(.imprints)|.imprints[]|{invoiceId:$inv.id,invoiceVisualId:$inv.visualId,imprintId:.id,details:.details,typeOfWork:(.typeOfWork.name//null)}]' "$INPUT_FILE" > "${OUTPUT_DIR}/06-imprints.json"
    log_success "Created: 06-imprints.json"
}

# 7. Create imprints text summary
create_imprints_summary() {
    log_info "Creating imprints summary..."
    {
        echo "=========================================="
        echo "IMPRINTS SUMMARY"
        echo "=========================================="
        echo ""
        jq -r '.[]|select(.lineItemGroups)|.visualId as $vid|.lineItemGroups[]|select(.imprints)|.imprints[]|"Invoice: "+$vid+"\n  - "+.details+" ("+(.typeOfWork.name//"N/A")+")"' "$INPUT_FILE"
        echo ""
        echo "=========================================="
    } > "${OUTPUT_DIR}/07-imprints-summary.txt"
    log_success "Created: 07-imprints-summary.txt"
}

# 8. Create master inventory CSV
create_master_inventory() {
    log_info "Creating master inventory CSV..."
    {
        echo "InvoiceID,InvoiceNumber,InvoiceTotal,LineItemID,Description,ItemNumber,Color,Quantity,Price,Size,SizeCount,Imprints"
        jq -r '.[]|select(.lineItemGroups)|. as $inv|.lineItemGroups[]|. as $grp|.lineItems[]|. as $item|if .sizes then (.sizes[]|[$inv.id,$inv.visualId,$inv.total,$item.id,$item.description,$item.itemNumber,$item.color,$item.items,$item.price,.size,.count,($grp.imprints//[]|map(.details)|join(" | "))]|@csv) else ([$inv.id,$inv.visualId,$inv.total,$item.id,$item.description,$item.itemNumber,$item.color,$item.items,$item.price,"","",($grp.imprints//[]|map(.details)|join(" | "))]|@csv) end' "$INPUT_FILE"
    } > "${OUTPUT_DIR}/08-inventory-master.csv"
    log_success "Created: 08-inventory-master.csv"
}

# 9. Generate summary report with statistics
generate_summary_report() {
    log_info "Generating summary report..."
    {
        echo "=========================================="
        echo "EXTRACTION SUMMARY REPORT"
        echo "=========================================="
        echo ""
        echo "Generated: $(date '+%Y-%m-%d %H:%M:%S')"
        echo ""
        echo "Input File: $INPUT_FILE"
        echo ""
        echo "----------------------------------------"
        echo "STATISTICS"
        echo "----------------------------------------"
        
        # Count invoices
        INVOICE_COUNT=$(jq 'length' "$INPUT_FILE")
        echo "Total Invoices: $INVOICE_COUNT"
        
        # Count production files
        PROD_FILE_COUNT=$(jq '[.[]|select(.productionFiles)|.productionFiles[]]|length' "$INPUT_FILE")
        echo "Total Production Files: $PROD_FILE_COUNT"
        
        # Count line items
        LINE_ITEM_COUNT=$(jq '[.[]|select(.lineItemGroups)|.lineItemGroups[]|.lineItems[]]|length' "$INPUT_FILE")
        echo "Total Line Items: $LINE_ITEM_COUNT"
        
        # Count imprints
        IMPRINT_COUNT=$(jq '[.[]|select(.lineItemGroups)|.lineItemGroups[]|select(.imprints)|.imprints[]]|length' "$INPUT_FILE")
        echo "Total Imprints: $IMPRINT_COUNT"
        
        # Calculate total quantity
        TOTAL_QTY=$(jq '[.[]|select(.lineItemGroups)|.lineItemGroups[]|.lineItems[]|.items]|add//0' "$INPUT_FILE")
        echo "Total Item Quantity: $TOTAL_QTY"
        
        # Calculate total value
        TOTAL_VALUE=$(jq '[.[]|.total//0]|add' "$INPUT_FILE")
        echo "Total Invoice Value: \$$TOTAL_VALUE"
        
        echo ""
        echo "----------------------------------------"
        echo "SAMPLE DATA"
        echo "----------------------------------------"
        echo ""
        echo "Sample Production Files (first 3):"
        jq -r '.[]|select(.productionFiles)|.productionFiles[0:3][]|"  - "+.name+" ("+.mimeType+")"' "$INPUT_FILE" | head -10
        
        echo ""
        echo "Sample Line Items (first 3):"
        jq -r '.[]|select(.lineItemGroups)|.lineItemGroups[]|.lineItems[0:3][]|"  - "+.description+" ("+.color+") - Qty: "+(.items|tostring)' "$INPUT_FILE" | head -10
        
        echo ""
        echo "Sample Imprints (first 3):"
        jq -r '.[]|select(.lineItemGroups)|.lineItemGroups[]|select(.imprints)|.imprints[0:3][]|"  - "+.details' "$INPUT_FILE" | head -10
        
        echo ""
        echo "----------------------------------------"
        echo "OUTPUT FILES CREATED"
        echo "----------------------------------------"
        ls -lh "${OUTPUT_DIR}"/0*.json "${OUTPUT_DIR}"/0*.csv "${OUTPUT_DIR}"/0*.txt 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
        
        echo ""
        echo "=========================================="
        echo "EXTRACTION COMPLETE"
        echo "=========================================="
    } > "${OUTPUT_DIR}/09-extraction-summary.txt"
    log_success "Created: 09-extraction-summary.txt"
}

# ============================================================================
# Main execution
# ============================================================================

main() {
    echo ""
    log_info "Starting Printavo Artwork & Production Files Extraction"
    echo ""
    
    # Check dependencies
    check_dependencies
    
    # Check input file
    check_input_file
    
    # Run all extraction steps
    extract_production_files
    extract_production_urls
    create_production_csv
    extract_line_items
    create_line_items_csv
    extract_imprints
    create_imprints_summary
    create_master_inventory
    generate_summary_report
    
    echo ""
    log_success "All extraction tasks completed successfully!"
    log_info "Output files are in: $OUTPUT_DIR"
    log_info "View summary: cat ${OUTPUT_DIR}/09-extraction-summary.txt"
    echo ""
}

# Run main function
main