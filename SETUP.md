# Inventory Planning App - Setup Guide

## Overview
This Shopify app helps you manage inventory planning by tracking suppliers, calculating reorder points, and predicting stockouts.

## Features Implemented

### 1. **Inventory Report** (`/app`)
- Main dashboard showing all products at risk of running out of stock
- Displays top 50 most urgent items
- Columns:
  - Risk level (color-coded badges)
  - SKU and product name
  - On hand quantity
  - Daily demand
  - Threshold (minimum stock level)
  - Supplier name
  - Lead time
  - Annualized demand
  - Days until stockout
  - Out of stock date
  - Reorder point
  - Suggested order size

**Filtering:**
- Search by SKU or product name
- Filter by risk level (Critical, Warning, Attention, Low)

### 2. **Products** (`/app/products`)
- Manage supplier associations for each product variant
- Assign suppliers and configure:
  - Lead time (days)
  - Threshold (minimum stock)
  - Daily demand (average sold per day)
  - Last order date
  - Last order cost per unit
  - Last order quantity
  - Notes

### 3. **Suppliers** (`/app/additional`)
- Create, edit, and delete suppliers
- Full supplier information:
  - Supplier ID (auto-generated)
  - Supplier name
  - Contact names (primary and secondary)
  - Addresses
  - Phone numbers (primary and secondary)
  - Emails (primary and secondary)
  - Website
  - Notes

## Required Setup in Shopify Admin

### Step 1: Create Supplier Metaobject Definition

1. Go to Shopify Admin → Settings → Custom Data → Metaobjects
2. Click "Add definition"
3. Name: `Supplier`
4. Type: `supplier`
5. Add these fields:

| Field Name | Key | Type |
|------------|-----|------|
| Supplier ID | `supplier_id` | Single line text |
| Supplier Name | `supplier_name` | Single line text |
| Contact Name | `contact_name` | Single line text |
| Contact Name 2 | `contact_name_2` | Single line text |
| Address | `address` | Single line text |
| Address 2 | `address_2` | Single line text |
| City | `city` | Single line text |
| State | `state` | Single line text |
| Zip | `zip` | Single line text |
| Country | `country` | Single line text |
| Phone 1 | `phone_1` | Single line text |
| Phone 2 | `phone_2` | Single line text |
| Email 1 | `email_1` | Single line text |
| Email 2 | `email_2` | Single line text |
| Website | `website` | URL |
| Notes | `notes` | Multi-line text |

6. Save the definition

### Step 2: Create Variant Metafield Definition

The app automatically creates this metafield when you save supplier data for a variant, but you can also create it manually:

1. Go to Shopify Admin → Settings → Custom Data → Variants
2. Click "Add definition"
3. Configure:
   - **Name:** Supplier Data
   - **Namespace:** `inventory`
   - **Key:** `supplier_data`
   - **Type:** JSON
   - **Description:** Stores supplier and inventory planning data for variants

## Data Structure

### Variant Metafield Structure
```json
{
  "supplier_id": "SUP-1737145200000",
  "lead_time": 14,
  "last_order_date": "2026-01-15",
  "last_order_cpu": 25.50,
  "last_order_quantity": 100,
  "threshold": 50,
  "daily_demand": 5.2,
  "notes": "Preferred supplier for this item"
}
```

## How to Use

### Initial Setup

1. **Create Suppliers:**
   - Navigate to "Suppliers" in the app
   - Click "Add Supplier"
   - Fill in supplier details (ID is auto-generated)
   - Save

2. **Assign Suppliers to Products:**
   - Navigate to "Products"
   - Find the product/variant you want to configure
   - Click "Edit Supplier"
   - Select a supplier from the dropdown
   - Enter inventory planning data:
     - Lead time (how many days to receive stock)
     - Threshold (minimum quantity to maintain)
     - Daily demand (average units sold per day)
     - Last order information (optional)
   - Save

3. **Monitor Inventory:**
   - Go to "Inventory Report"
   - Review products at risk
   - Use filters to focus on critical items
   - Take action based on suggested order sizes

### Calculations Explained

- **Days Until Stockout:** `(On Hand - Threshold) / Daily Demand`
- **Reorder Point:** `Threshold + (Daily Demand × Lead Time)`
- **Suggested Order Size:** `(Daily Demand × Lead Time × 2) - On Hand`
- **Annualized Demand:** `Daily Demand × 365`

### Risk Levels

- **OUT OF STOCK** (Red): Already below threshold
- **CRITICAL** (Red): ≤ 7 days until stockout
- **WARNING** (Yellow): 8-14 days until stockout
- **ATTENTION** (Blue): 15-30 days until stockout
- **LOW** (Green): > 30 days until stockout

## Navigation

The app has a sidebar with three main sections:
- **Inventory Report:** Main dashboard
- **Products:** Manage product-supplier associations
- **Suppliers:** Manage supplier information

## Troubleshooting

### Products not showing in Inventory Report
- Make sure you've assigned a supplier to the variant in the Products page
- Ensure daily demand and threshold values are set

### Supplier not appearing in dropdown
- Verify the supplier was created successfully in the Suppliers page
- Check that the supplier has a valid Supplier ID

### Calculations seem incorrect
- Verify daily demand is accurate (this should be based on historical data)
- Check that threshold is set appropriately
- Ensure lead time reflects actual supplier delivery time

## Future Enhancements

Potential features to add:
- Bulk import/export of supplier data
- Historical sales data integration for automatic daily demand calculation
- Multiple suppliers per variant
- Purchase order generation
- Email alerts for critical stock levels
- Dashboard with summary statistics
