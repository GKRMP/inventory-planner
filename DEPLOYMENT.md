# Deployment Guide - Inventory Planner App

This guide covers deploying your Inventory Planner app to a production Shopify store using Render.com and GitHub Desktop.

## Prerequisites

- Shopify Partners account
- Production Shopify store with admin access
- GitHub account (for version control)
- Render.com account (for hosting)
- GitHub Desktop installed

## Step 1: Create Production App in Partners Dashboard

1. Go to [Shopify Partners](https://partners.shopify.com)
2. Navigate to "Apps" → "Create app"
3. Select "Create app manually"
4. Fill in:
   - **App name**: "Inventory Planner" (or your preferred name)
   - **App URL**: Your production domain (e.g., `https://inventory-planner.yourdomain.com`)
   - **Allowed redirection URL(s)**:
     - `https://inventory-planner.yourdomain.com/api/auth`
     - `https://inventory-planner.yourdomain.com/api/auth/callback`

5. After creation, note down:
   - **Client ID** (API key)
   - **Client Secret** (API secret key)

## Step 2: Push Code to GitHub using GitHub Desktop

1. Open GitHub Desktop
2. If this is a new repository:
   - Click "File" → "Add Local Repository"
   - Browse to `C:\Users\Gordon\rmp-app-clean\inventory-planner`
   - Click "Add Repository"
   - If prompted that it's not a Git repository, click "Create a repository"

3. Create a new repository on GitHub:
   - Click "Publish repository" in GitHub Desktop
   - Choose a name (e.g., "inventory-planner")
   - Choose whether to make it public or private
   - Click "Publish repository"

4. Verify `.gitignore` includes sensitive files:
   ```
   node_modules/
   .env
   .shopify/
   prisma/*.db
   prisma/*.db-journal
   ```

5. Commit your code:
   - In GitHub Desktop, review changed files
   - Enter commit message: "Initial production deployment"
   - Click "Commit to main"
   - Click "Push origin" to push to GitHub

## Step 3: Deploy to Render.com

1. Go to [Render.com](https://render.com) and sign in
2. Click "New +" → "Web Service"
3. Connect your GitHub repository:
   - Authorize Render to access your GitHub account
   - Select the `inventory-planner` repository
4. Configure the web service:
   - **Name**: `inventory-planner` (or your preferred name)
   - **Region**: Choose closest to your location
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npx prisma generate && npm run build`
   - **Start Command**: `npm run start`
   - **Instance Type**: Choose your preferred plan (Free tier available)

5. Add PostgreSQL database:
   - In Render dashboard, click "New +" → "PostgreSQL"
   - **Name**: `inventory-planner-db`
   - **Region**: Same as web service
   - **Plan**: Choose your preferred plan (Free tier available)
   - Click "Create Database"
   - Copy the "Internal Database URL" (looks like `postgresql://...`)

6. Set environment variables for web service:
   - In your web service settings, go to "Environment"
   - Add the following variables:
     - `SHOPIFY_API_KEY` = Your Client ID from Partners Dashboard
     - `SHOPIFY_API_SECRET` = Your Client Secret from Partners Dashboard
     - `SCOPES` = `write_products,read_metaobject_definitions,write_metaobject_definitions,read_metaobjects,write_metaobjects`
     - `DATABASE_URL` = The Internal Database URL from your PostgreSQL database
     - `NODE_ENV` = `production`
     - `HOST` = Your Render app URL (e.g., `inventory-planner.onrender.com`)

7. Deploy:
   - Click "Save Changes"
   - Render will automatically deploy your app
   - Wait for deployment to complete (may take 5-10 minutes)
   - Note your app URL (e.g., `https://inventory-planner.onrender.com`)

## Step 4: Update App Configuration Locally

1. Update `shopify.app.inventory-planner-422p.toml`:
   ```toml
   client_id = "your_production_client_id"
   application_url = "https://inventory-planner.onrender.com"

   [auth]
   redirect_urls = [ "https://inventory-planner.onrender.com/api/auth" ]
   ```

2. Update your Partners Dashboard with the Render URL:
   - Go to Partners Dashboard → Your App
   - Update "App URL" to `https://inventory-planner.onrender.com`
   - Update "Allowed redirection URL(s)" to:
     - `https://inventory-planner.onrender.com/api/auth`
     - `https://inventory-planner.onrender.com/api/auth/callback`

3. Commit and push changes using GitHub Desktop:
   - Open GitHub Desktop
   - Review changed files
   - Enter commit message: "Update production URLs"
   - Click "Commit to main"
   - Click "Push origin"
   - Render will automatically redeploy

## Step 5: Set Up Database

Your app uses Prisma with SQLite by default. For production with Render.com, you need PostgreSQL:

1. Update `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

2. Commit and push this change:
   - In GitHub Desktop, commit with message: "Switch to PostgreSQL"
   - Push to GitHub
   - Render will automatically redeploy

3. Run migrations on Render:
   - In Render dashboard, go to your web service
   - Click "Shell" tab
   - Run: `npx prisma migrate deploy`
   - Or add to your Build Command: `npm install && npx prisma generate && npx prisma migrate deploy && npm run build`

## Step 6: Install App on Production Store

1. In Partners Dashboard, select your app
2. Click "Select store" → Choose your production store
3. Click "Install app"
4. Approve the permission scopes:
   - `write_products`
   - `read_metaobject_definitions`
   - `write_metaobject_definitions`
   - `read_metaobjects`
   - `write_metaobjects`

## Step 7: Initial Setup

After installing the app:

1. Navigate to the app in your Shopify admin
2. Go to **Suppliers** page
3. Click **"Setup Supplier Definition"** button
4. Wait for success message
5. Import your existing suppliers (see SUPPLIER_IMPORT.md)

## Step 8: Configure Variants

1. Go to **Products** page
2. For each product variant, click **"Edit Supplier"**
3. Fill in:
   - Supplier
   - Lead Time (days)
   - Threshold (minimum stock)
   - Daily Demand (average units sold per day)
   - Last order information (optional)

## Step 9: Verify Functionality

1. Check **Dashboard** - should show risk overview
2. Check **Report** - should show all variants with calculated metrics
3. Test creating a new supplier
4. Test updating product supplier information

## Troubleshooting

### Issue: "Supplier definition already exists"
- This is expected if you've run setup before
- The app will automatically update missing fields
- Click OK and proceed with adding suppliers

### Issue: Authentication errors
- Verify `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` match Partners Dashboard
- Check that redirect URLs match exactly (including https://)
- Ensure scopes in environment match required permissions

### Issue: Database connection errors
- Verify `DATABASE_URL` is set correctly
- Run `npx prisma migrate deploy`
- Check database service is running

### Issue: "Field definition does not exist"
- Go to Suppliers page
- Click "Setup Supplier Definition"
- This creates all required metaobject fields

## Maintenance

### Updating the App

1. Make code changes locally
2. Test with `npm run dev`
3. Commit and push changes using GitHub Desktop:
   - Open GitHub Desktop
   - Review changed files
   - Enter a descriptive commit message
   - Click "Commit to main"
   - Click "Push origin"
4. Render automatically deploys on push to main branch
5. Monitor deployment in Render dashboard
6. Run migrations if schema changed (in Render Shell): `npx prisma migrate deploy`

### Monitoring

Monitor your app's performance:
- Check error logs in Render dashboard (Logs tab)
- Monitor API usage in Shopify Partners Dashboard
- Review app analytics in Shopify admin
- Set up alerts in Render for deployment failures or errors

### Backup

Regularly backup:
- Supplier data (Shopify metaobjects - backed up by Shopify)
- Product supplier associations (variant metafields - backed up by Shopify)
- App sessions (your database)

## Security Checklist

- [ ] Environment variables are set securely
- [ ] API secrets are never committed to git
- [ ] Database uses strong password
- [ ] HTTPS is enforced on production domain
- [ ] App requires re-authentication periodically
- [ ] Session storage is properly configured

## Support

If you encounter issues:
1. Check console logs in browser DevTools
2. Check server logs in hosting dashboard
3. Verify all environment variables are set
4. Review Shopify API documentation: https://shopify.dev/docs/api
