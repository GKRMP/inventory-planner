/**
 * Shopify Authentication Helper for Inventory Planner
 *
 * Retrieves the access token from the Prisma database for CLI tools.
 * This allows CLI tools to authenticate with Shopify without needing
 * a separate API token in .env files.
 *
 * Usage:
 *   import { getShopifyClient } from './shopify-auth.js';
 *   const { graphql, shop } = await getShopifyClient();
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          // Don't override existing env vars
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = valueParts.join('=').trim();
          }
        }
      }
    }
  }
}

/**
 * Get the Shopify access token from Prisma database
 * @param {string} shopDomain - Optional shop domain to filter by
 * @returns {Promise<{accessToken: string, shop: string}>}
 */
export async function getAccessToken(shopDomain = null) {
  loadEnv();

  const prisma = new PrismaClient();

  try {
    // Find the most recent offline session (offline sessions have longer-lived tokens)
    // accessToken is a required field in the schema, so no need to check for null
    const whereClause = {
      isOnline: false,
    };

    if (shopDomain) {
      whereClause.shop = shopDomain;
    }

    const session = await prisma.session.findFirst({
      where: whereClause,
      orderBy: { id: 'desc' },
    });

    if (!session) {
      throw new Error(
        'No offline session found in database. Please ensure the app has been installed ' +
        'and has an active session. You may need to visit the app in Shopify Admin first.'
      );
    }

    if (!session.accessToken) {
      throw new Error('Session found but access token is missing.');
    }

    return {
      accessToken: session.accessToken,
      shop: session.shop,
    };
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Create a simple GraphQL client for Shopify Admin API
 * @param {string} shopDomain - Optional shop domain
 * @returns {Promise<{graphql: Function, shop: string, accessToken: string}>}
 */
export async function getShopifyClient(shopDomain = null) {
  const { accessToken, shop } = await getAccessToken(shopDomain);

  const apiVersion = '2025-01'; // Latest stable version

  /**
   * Execute a GraphQL query against Shopify Admin API
   * @param {string} query - GraphQL query or mutation
   * @param {object} variables - Query variables
   * @returns {Promise<object>} - Response data
   */
  async function graphql(query, variables = {}) {
    const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GraphQL request failed: ${response.status} - ${text}`);
    }

    const result = await response.json();

    if (result.errors) {
      const errorMessages = result.errors.map(e => e.message).join(', ');
      throw new Error(`GraphQL errors: ${errorMessages}`);
    }

    return result.data;
  }

  return { graphql, shop, accessToken };
}

/**
 * Mask a token for safe display
 * @param {string} token
 * @returns {string}
 */
export function maskToken(token) {
  if (!token || token.length < 10) return '****';
  return token.substring(0, 8) + '...' + token.substring(token.length - 4);
}
