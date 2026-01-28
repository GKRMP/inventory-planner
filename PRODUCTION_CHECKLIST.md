# Production Deployment Checklist

Use this checklist when deploying your Inventory Planner app to production using Render.com and GitHub Desktop.

## Pre-Deployment

### 1. Code Preparation
- [ ] All features tested locally
- [ ] No console errors in browser
- [ ] All API endpoints working
- [ ] Database migrations tested

### 2. Environment Setup
- [ ] GitHub account created
- [ ] GitHub Desktop installed
- [ ] Render.com account created
- [ ] PostgreSQL database will be created on Render
- [ ] SSL/HTTPS automatically provided by Render

### 3. Shopify Partners Setup
- [ ] Partners account created
- [ ] Production app created in Partners Dashboard
- [ ] App name configured
- [ ] App URL set to production domain
- [ ] Redirect URLs configured
- [ ] Client ID (API key) saved
- [ ] Client Secret saved

## Deployment

### 4. Push to GitHub
- [ ] Open GitHub Desktop
- [ ] Add repository to GitHub Desktop
- [ ] Verify `.gitignore` includes sensitive files (node_modules, .env, .shopify, *.db)
- [ ] Create new repository on GitHub (public or private)
- [ ] Commit code with message: "Initial production deployment"
- [ ] Push to GitHub

### 5. Create Render Services
- [ ] Sign in to Render.com
- [ ] Create new PostgreSQL database
  - [ ] Name: `inventory-planner-db`
  - [ ] Choose region
  - [ ] Select plan (Free tier available)
  - [ ] Copy Internal Database URL
- [ ] Create new Web Service
  - [ ] Connect to GitHub repository
  - [ ] Name: `inventory-planner`
  - [ ] Runtime: Node
  - [ ] Build Command: `npm install && npx prisma generate && npx prisma migrate deploy && npm run build`
  - [ ] Start Command: `npm run start`
  - [ ] Choose instance type

### 6. Environment Variables on Render
Set these in Render web service Environment tab:

- [ ] `SHOPIFY_API_KEY` = Your Client ID from Partners Dashboard
- [ ] `SHOPIFY_API_SECRET` = Your Client Secret from Partners Dashboard
- [ ] `SCOPES` = `write_products,read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects`
- [ ] `DATABASE_URL` = Internal Database URL from Render PostgreSQL
- [ ] `NODE_ENV` = `production`
- [ ] `HOST` = Your Render app URL (e.g., `inventory-planner.onrender.com`)

### 7. Database Setup
- [ ] Update `prisma/schema.prisma` to use PostgreSQL provider
- [ ] Commit and push change via GitHub Desktop
- [ ] Wait for Render auto-deploy
- [ ] Verify migrations ran (check Build Command includes prisma migrate deploy)

### 8. Configuration Files
- [ ] Update `shopify.app.inventory-planner-422p.toml`:
  - [ ] `client_id` matches production Client ID
  - [ ] `application_url` = `https://inventory-planner.onrender.com`
  - [ ] `redirect_urls` = `https://inventory-planner.onrender.com/api/auth`
- [ ] Update Partners Dashboard with Render URLs
- [ ] Commit and push changes via GitHub Desktop
- [ ] Remove or secure any debug/test endpoints

### 9. Deploy Application
- [ ] Render automatically deploys on GitHub push
- [ ] Monitor deployment in Render dashboard
- [ ] Verify build succeeds (check Logs tab)
- [ ] Verify app starts without errors
- [ ] Test app URL in browser (should show error until installed)

## Post-Deployment

### 10. Install App on Production Store
- [ ] Go to Partners Dashboard
- [ ] Select your app
- [ ] Click "Select store"
- [ ] Choose your production Shopify store
- [ ] Click "Install app"
- [ ] Approve all permission scopes
- [ ] Verify app loads in Shopify admin

### 11. Initial Configuration
- [ ] Navigate to Suppliers page
- [ ] Click "Setup Supplier Definition"
- [ ] Wait for success message
- [ ] Verify "Add Supplier" button appears

### 12. Import Suppliers
- [ ] Prepare suppliers JSON file (see SUPPLIER_IMPORT.md)
- [ ] Navigate to `/scripts/import-suppliers.html`
- [ ] Paste JSON data
- [ ] Click "Import Suppliers"
- [ ] Verify all suppliers imported successfully
- [ ] Check Suppliers page to confirm

### 13. Configure Products
For each product variant:
- [ ] Navigate to Products page
- [ ] Click "Edit Supplier" on variant
- [ ] Select supplier
- [ ] Set Lead Time (days)
- [ ] Set Threshold (minimum stock level)
- [ ] Set Daily Demand (average units sold per day)
- [ ] Optionally add last order info
- [ ] Click Save

### 14. Verification
- [ ] Dashboard shows risk overview with correct data
- [ ] Report page displays all variants with metrics
- [ ] Risk calculations are correct:
  - [ ] Out of Stock (inventory below threshold)
  - [ ] Critical (< 7 days to stockout)
  - [ ] Warning (7-14 days to stockout)
  - [ ] Attention (15-30 days to stockout)
  - [ ] Low Risk (> 30 days to stockout)
- [ ] Sorting works on Report page
- [ ] Search works on all pages
- [ ] Navigation between pages works
- [ ] Can create new suppliers
- [ ] Can edit existing suppliers
- [ ] Can delete suppliers
- [ ] Can update variant supplier info

## Post-Launch

### 15. Monitoring
- [ ] Check error logs in Render dashboard (Logs tab)
- [ ] Monitor API usage in Partners Dashboard
- [ ] Check app performance regularly
- [ ] Set up email alerts in Render for deployment failures

### 16. Documentation
- [ ] Document how to add new suppliers
- [ ] Document how to configure products
- [ ] Document how to read the report
- [ ] Train team on using the app

### 17. Maintenance Plan
- [ ] Schedule regular backups (Shopify backs up metaobjects)
- [ ] Plan for app updates
- [ ] Monitor Shopify API version updates
- [ ] Keep dependencies updated

### 18. Cleanup (Optional)
After successful import:
- [ ] Remove import endpoint if not needed:
  - Delete `app/routes/api.bulk-import-suppliers.js`
  - Delete `scripts/import-suppliers.html`
  - Delete `scripts/import-suppliers.js`
- [ ] Remove unused code/comments
- [ ] Remove console.log statements
- [ ] Commit and push cleanup changes via GitHub Desktop

## Security Verification

### 19. Security Checklist
- [ ] API secrets not committed to git
- [ ] Environment variables secured
- [ ] HTTPS enforced on all routes
- [ ] Session storage configured properly
- [ ] No sensitive data in client-side code
- [ ] Database uses strong credentials
- [ ] Proper error handling (don't expose internals)

## Performance Optimization

### 20. Optional Performance Improvements
- [ ] Enable caching where appropriate
- [ ] Optimize large GraphQL queries
- [ ] Add loading states for slow operations
- [ ] Consider pagination for large datasets (> 250 variants)
- [ ] Monitor and optimize database queries

## Rollback Plan

### 21. If Something Goes Wrong
Have a rollback plan ready:
1. **Database issues:**
   - Restore from backup
   - Rollback migrations

2. **App errors:**
   - Revert to previous Git commit in GitHub Desktop
   - Push to trigger Render redeploy
   - Check Render logs for errors
   - Fix and redeploy

3. **Data issues:**
   - Suppliers are stored as Shopify metaobjects (backed up by Shopify)
   - Can delete and re-import if needed
   - Variant associations are in variant metafields (also backed up)

## Support Contacts

### 22. Important Links
- [ ] Shopify Partners Dashboard URL saved
- [ ] Render.com dashboard URL saved (https://dashboard.render.com)
- [ ] GitHub repository URL saved
- [ ] Render PostgreSQL dashboard URL saved
- [ ] App admin URL saved
- [ ] Shopify API docs: https://shopify.dev/docs/api

## Success Criteria

Your deployment is successful when:
- ✅ App loads without errors in Shopify admin
- ✅ All suppliers imported correctly
- ✅ Products configured with supplier data
- ✅ Dashboard shows accurate risk metrics
- ✅ Report page displays all variants
- ✅ Team can use the app without issues
- ✅ No console errors or warnings

## Timeline Estimate

- **Pre-Deployment Setup:** 1-2 hours
- **Deployment & Configuration:** 1-2 hours
- **Supplier Import:** 30 minutes
- **Product Configuration:** Varies by number of products
  - ~2 minutes per variant
  - 100 variants = ~3-4 hours
- **Verification & Testing:** 1 hour
- **Total:** ~5-10 hours (depending on product count)

## Tips for Success

1. **Do a dry run:**
   - Test deployment process on a development store first
   - Import a few test suppliers before bulk import
   - Configure a few test products to verify calculations

2. **Import incrementally:**
   - Import suppliers in batches (e.g., 50 at a time)
   - Verify each batch before continuing
   - Easier to troubleshoot if issues arise

3. **Configure high-priority products first:**
   - Start with your most important/high-volume products
   - Get value from the app quickly
   - Configure remaining products over time

4. **Get team input:**
   - Involve warehouse/inventory team in threshold settings
   - Verify daily demand calculations with sales team
   - Confirm lead times with purchasing team

---

**Ready to deploy?** Start with step 1 and check off each item as you go!
