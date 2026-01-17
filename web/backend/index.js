import express from "express";
import { shopify } from "./shopify.js";
import suppliers from "./routes/suppliers.js";   // ⭐ ADD THIS

const app = express();

app.use(express.json());
app.use(shopify.validateAuthenticatedSession());

// ⭐ REGISTER YOUR ROUTE
app.use("/api/suppliers", suppliers);

// …existing Shopify routes…
app.use(shopify.cspHeaders());
app.use(shopify.servePublic());
app.use(shopify.serveReactApp());

export default app;