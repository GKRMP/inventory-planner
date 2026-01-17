export function computeRiskRecord(sp, variant, supplier, inventoryLevels) {
  const Q = variant ? inventoryLevels[variant.inventory_item_id] || 0 : 0;
  const D = variant ? Number(variant.daily_demand) : 0;
  const T = sp.threshold ? Number(sp.threshold) : 0;
  const L = sp.lead_time_days ? Number(sp.lead_time_days) : 0;

  const annualized_demand = D * 365;

  let days_until_stockout = Infinity;
  if (D > 0) {
    if (Q <= T) days_until_stockout = 0;
    else days_until_stockout = (Q - T) / D;
  }

  const today = new Date();
  const out_of_stock_date = new Date(today.getTime() + days_until_stockout * 86400000);

  const reorder_date = new Date(out_of_stock_date.getTime() - L * 86400000);

  const safety_days = 7;
  const target_stock = D * (L + safety_days);
  const suggested_order_size = Math.max(0, target_stock + T - Q);

  let risk_color = "green";
  if (days_until_stockout <= 7) risk_color = "red";
  else if (days_until_stockout <= 21) risk_color = "orange";
  else if (days_until_stockout <= 45) risk_color = "yellow";

  return {
    sku: variant?.sku,
    product_title: variant?.product_title,
    supplier_name: supplier?.supplier_name,
    on_hand: Q,
    daily_demand: D,
    threshold: T,
    lead_time_days: L,
    annualized_demand,
    days_until_stockout,
    out_of_stock_date,
    reorder_date,
    suggested_order_size,
    risk_color
  };
}