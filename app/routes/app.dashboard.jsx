import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { loadCatalogForRoute } from "../services/catalog-queries.server";

export async function loader({ request }) {
  return loadCatalogForRoute(request);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function getSupplierData(variant) {
  const mf = variant.metafields.find(
    (m) => m.namespace === "inventory" && m.key === "supplier_data"
  );
  if (!mf) return [];
  try {
    const parsed = JSON.parse(mf.value);
    return Array.isArray(parsed) ? parsed : [{ ...parsed, is_primary: true }];
  } catch {
    return [];
  }
}

function getSourcingType(variant) {
  const mf = variant.metafields.find(
    (m) => m.namespace === "inventory" && m.key === "sourcing_type"
  );
  return mf?.value || null;
}

function getReproSettings(variant) {
  const mf = variant.metafields.find(
    (m) => m.namespace === "inventory" && m.key === "repro_settings"
  );
  if (!mf) return null;
  try {
    return JSON.parse(mf.value);
  } catch {
    return null;
  }
}

function riskOf(onHand, dts) {
  if (onHand <= 0)
    return { key: "out", label: "Out of stock", text: "#912018", bg: "#fee4e2", dot: "#b42318" };
  if (dts <= 7)
    return { key: "critical", label: "Critical", text: "#b42318", bg: "#fef3f2", dot: "#d92d20" };
  if (dts <= 14)
    return { key: "warning", label: "Low", text: "#b54708", bg: "#fffaeb", dot: "#f79009" };
  if (dts <= 30)
    return { key: "attention", label: "Watch", text: "#175cd3", bg: "#eff8ff", dot: "#2e90fa" };
  return { key: "healthy", label: "Healthy", text: "#067647", bg: "#ecfdf3", dot: "#17b26a" };
}

function money(n) {
  return (
    "$" +
    (Number(n) || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
function money0(n) {
  return "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
}

function enrichVariant(variant, supplierMap) {
  const sourcingType = getSourcingType(variant);
  const isNOS = sourcingType === "nos";
  const isRepro = sourcingType === "repro";

  const rawSources = getSupplierData(variant);
  // NOS stock is largely uncataloged barn stock — it must still show up
  // (for scarcity signals) even with zero supplier_data rows.
  if (rawSources.length === 0 && !isNOS) return null;

  const sources = rawSources.map((s) => {
    const sup = supplierMap[s.supplier_id] || {
      name: s.supplier_id || "Unknown",
      code: (s.supplier_id || "???").slice(0, 3).toUpperCase(),
    };
    return {
      sup: s.supplier_id,
      mpn: s.mpn || "",
      cpu: parseFloat(s.last_order_cpu) || 0,
      lead: parseInt(s.lead_time) || 7,
      lastDate: s.last_order_date || "",
      primary: !!s.is_primary,
      supplierName: sup.name,
      code: sup.code,
      dailyDemand: parseFloat(s.daily_demand) || 0,
      threshold: parseInt(s.threshold) || 0,
    };
  });

  const onHand = variant.inventoryQuantity || 0;

  // ── NOS: finite, irreplaceable stock. No reorder-point logic — just
  // scarcity signals (last-one, gone-forever). Kept out of reorder alerts by
  // using risk keys ("nos-*") that don't match the standard out/critical/etc.
  // buckets used to build attention/reorderList/counts elsewhere.
  if (isNOS) {
    const primary = sources.find((s) => s.primary) || sources[0] || null;
    const lastOne = onHand === 1;
    const goneForever = onHand <= 0;
    const risk = goneForever
      ? { key: "nos-gone", label: "Gone forever", text: "#912018", bg: "#fee4e2", dot: "#b42318" }
      : lastOne
      ? { key: "nos-last", label: "Last one", text: "#b54708", bg: "#fffaeb", dot: "#f79009" }
      : { key: "nos-available", label: "NOS in stock", text: "#175cd3", bg: "#eff8ff", dot: "#2e90fa" };
    const recommended = primary || { sup: null, cpu: 0, lead: 0, supplierName: "N/A", code: "NOS" };

    return {
      id: variant.id,
      sku: variant.sku || "N/A",
      name: variant.productTitle || "Unknown",
      onHand,
      demand: 0,
      threshold: 0,
      sources,
      primary,
      recommended,
      reason: "NOS — no reorder",
      reorderPoint: null,
      suggestedQty: null,
      savingsPerUnit: 0,
      leadDiff: 0,
      dts: null,
      risk,
      demandStr: "0.0",
      dtsLabel: "N/A",
      dtsWidth: "0%",
      recommendedName: recommended.supplierName,
      primaryName: primary?.supplierName || "N/A",
      bestCpuStr: money(recommended.cpu || 0),
      bestLeadStr: (recommended.lead || 0) + "d",
      suggestedQtyStr: "—",
      estCost: 0,
      sourcesCount: sources.length,
      sourceCodes: sources.map((s) => s.code).join(" · "),
      diff: false,
      belowReorder: false,
      sourcingType,
      isNOS: true,
      isRepro: false,
      lastOne,
      goneForever,
    };
  }

  const primary = sources.find((s) => s.primary) || sources[0];
  const demand = primary?.dailyDemand || 0;
  const threshold = primary?.threshold || 0;
  const dts = demand > 0 ? Math.floor((onHand - threshold) / demand) : 999;
  const risk = riskOf(onHand, dts);
  const urgent = risk.key === "out" || risk.key === "critical";

  const withCost = sources.filter((s) => s.cpu > 0);
  const byFast = withCost.slice().sort((a, b) => a.lead - b.lead || a.cpu - b.cpu);
  const byCheap = withCost.slice().sort((a, b) => a.cpu - b.cpu || a.lead - b.lead);

  let recommended, reason;
  if (withCost.length > 0) {
    recommended = urgent ? byFast[0] : byCheap[0];
    reason = sources.length > 1 ? (urgent ? "Fastest" : "Lowest cost") : "Only source";
  } else {
    recommended = primary;
    reason = "Only source";
  }
  recommended = recommended || primary;

  const reorderPoint = Math.round(threshold + demand * (primary?.lead || 0));
  let suggestedQty = Math.max(
    1,
    Math.ceil(demand * (recommended.lead || 7) * 2 + threshold - onHand)
  );
  const savingsPerUnit =
    primary && recommended.sup !== primary.sup ? primary.cpu - recommended.cpu : 0;
  const leadDiff =
    primary && recommended.sup !== primary.sup ? primary.lead - recommended.lead : 0;
  const dtsLabel = onHand <= 0 ? "Out" : dts < 0 ? "Overdue" : dts + "d";
  const dtsWidth =
    (onHand <= 0 || dts < 0 ? 100 : Math.max(4, Math.min(100, (dts / 45) * 100))).toFixed(0) +
    "%";

  let belowReorder = onHand <= reorderPoint;
  let estCost = suggestedQty * recommended.cpu;

  // ── Repro: they own the tooling, so a "reorder" is really a production
  // run — trigger it off the same threshold, but size it to the run/MOQ
  // instead of a lead-time buffer, and cost it off the flat run cost.
  if (isRepro) {
    const repro = getReproSettings(variant) || {};
    const runSize = parseInt(repro.run_size) || 0;
    const moq = parseInt(repro.moq) || 0;
    const runCost = parseFloat(repro.run_cost) || 0;
    const rawQty = Math.max(moq, runSize, Math.ceil(demand * 180));
    const runQty = runSize > 0 ? Math.ceil(rawQty / runSize) * runSize : rawQty;

    belowReorder = onHand <= threshold;
    suggestedQty = belowReorder ? runQty : 0;
    estCost = runCost;
    reason = "Repro run";
  }

  return {
    id: variant.id,
    sku: variant.sku || "N/A",
    name: variant.productTitle || "Unknown",
    onHand,
    demand,
    threshold,
    sources,
    primary,
    recommended,
    reason,
    reorderPoint,
    suggestedQty,
    savingsPerUnit,
    leadDiff,
    dts,
    risk,
    demandStr: demand.toFixed(1),
    dtsLabel,
    dtsWidth,
    recommendedName: recommended.supplierName,
    primaryName: primary?.supplierName || "N/A",
    bestCpuStr: money(recommended.cpu),
    bestLeadStr: recommended.lead + "d",
    suggestedQtyStr: String(suggestedQty),
    estCost,
    sourcesCount: sources.length,
    sourceCodes: sources.map((s) => s.code).join(" · "),
    diff: recommended.sup !== primary?.sup,
    belowReorder,
    sourcingType,
    isNOS: false,
    isRepro,
  };
}

// ─── style constants ─────────────────────────────────────────────────────────

const TH = {
  padding: "12px 16px",
  textAlign: "left",
  fontSize: 11,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#9a968e",
  fontWeight: 600,
  borderBottom: "1px solid #e8e6e0",
  whiteSpace: "nowrap",
};

const FONTS_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
  @keyframes rmp-spin { to { transform: rotate(360deg); } }
  @keyframes rmp-shimmer { 0% { background-position: -450px 0; } 100% { background-position: 450px 0; } }
  @keyframes rmp-slide { from { transform: translateX(30px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  .rmp-app *, .rmp-app *::before, .rmp-app *::after { box-sizing: border-box; }
  .rmp-app { font-family: 'Hanken Grotesk', system-ui, -apple-system, sans-serif; }
  .rmp-app select:focus, .rmp-app input:focus { outline: none; }
  .rmp-app ::-webkit-scrollbar { width: 11px; height: 11px; }
  .rmp-app ::-webkit-scrollbar-thumb { background: #dcdad3; border-radius: 8px; border: 3px solid #f7f6f3; }
  .rmp-app ::-webkit-scrollbar-track { background: transparent; }
  .rmp-spin { animation: rmp-spin .8s linear infinite; }
  .rmp-slide { animation: rmp-slide .26s cubic-bezier(.2,.8,.2,1); }
  .rmp-shimmer { animation: rmp-shimmer 1.4s infinite; background: linear-gradient(90deg,#eeece7 25%,#f6f5f1 37%,#eeece7 63%); background-size: 900px 100%; }
  .rmp-kpi:hover { border-color: #d8d5cd !important; }
  .rmp-row:hover td { background: #faf9f7 !important; }
  .rmp-card-row:hover { background: #faf9f7 !important; }
  .rmp-dist:hover { opacity: 0.82 !important; }
  .rmp-btn-dark:hover { background: #3a3733 !important; }
  .rmp-btn-light:hover { background: #f1efea !important; }
  .rmp-link:hover { color: #232220 !important; }
`;

const MONO = { fontFamily: "'IBM Plex Mono', monospace" };

// ─── component ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { variants, suppliers, syncPending } = useLoaderData();
  const revalidator = useRevalidator();
  const isLoading = revalidator.state === "loading";
  const refreshProducts = useCallback(() => revalidator.revalidate(), [revalidator]);
  const refreshSuppliers = refreshProducts;

  const [screen, setScreen] = useState("dashboard");
  const [search, setSearch] = useState("");
  const [reportFilter, setReportFilter] = useState("all");
  const [sortDir, setSortDir] = useState("asc");
  const [selectedId, setSelectedId] = useState(null);
  const [detailSup, setDetailSup] = useState(null);
  const [detailQty, setDetailQty] = useState(0);
  const [poOpen, setPoOpen] = useState(false);
  const [po, setPo] = useState({});
  const [prodSup, setProdSup] = useState("all");
  const [toast, setToast] = useState("");
  const toastRef = useRef(null);
  const [supFormOpen, setSupFormOpen] = useState(false);
  const [supFormMode, setSupFormMode] = useState("add");
  const [supFormData, setSupFormData] = useState({});
  const supFetcher = useFetcher();
  const supSubmitRef = useRef(false);

  // supplier map
  const supMap = useMemo(() => {
    const m = {};
    suppliers.forEach((s) => {
      const fv = (key) => s.fields.find((f) => f.key === key)?.value || "";
      const id = fv("supplier_id");
      const name = fv("supplier_name") || "Unknown";
      if (id)
        m[id] = {
          gid: s.id,
          supplierId: id,
          name,
          code: name.slice(0, 3).toUpperCase(),
          contactName: fv("contact_name"),
          contactName2: fv("contact_name_2"),
          address: fv("address"),
          address2: fv("address_2"),
          city: fv("city"),
          state: fv("state"),
          zip: fv("zip"),
          country: fv("country"),
          phone1: fv("phone_1"),
          phone2: fv("phone_2"),
          email1: fv("email_1"),
          email2: fv("email_2"),
          website: fv("website"),
          notes: fv("notes"),
          specializedMfg: fv("specialized_mfg") === "true",
        };
    });
    return m;
  }, [suppliers]);

  // enriched parts
  const enriched = useMemo(
    () => variants.map((v) => enrichVariant(v, supMap)).filter(Boolean),
    [variants, supMap]
  );

  // supplier list derived from part data + all known metaobject suppliers
  const supList = useMemo(() => {
    const ids = new Set();
    enriched.forEach((e) => e.sources.forEach((s) => s.sup && ids.add(s.sup)));
    Object.keys(supMap).forEach((id) => ids.add(id)); // include suppliers with no parts yet
    return Array.from(ids).map((id) => {
      const carries = enriched.filter((e) => e.sources.some((s) => s.sup === id));
      const avgLead =
        carries.length > 0
          ? Math.round(
              carries.reduce(
                (sum, e) => sum + (e.sources.find((s) => s.sup === id)?.lead || 0),
                0
              ) / carries.length
            )
          : 0;
      const raw = supMap[id] || null;
      return {
        id,
        name: raw?.name || id,
        code: raw?.code || id.slice(0, 3).toUpperCase(),
        gid: raw?.gid || "",
        address: raw?.address || "",
        city: raw?.city || "",
        state: raw?.state || "",
        country: raw?.country || "",
        email1: raw?.email1 || "",
        email2: raw?.email2 || "",
        specializedMfg: raw?.specializedMfg || false,
        _raw: raw,
        avgLead,
        partsCount: carries.length,
        recCount: enriched.filter((e) => e.recommended?.sup === id).length,
        sharedCount: carries.filter((e) => e.sources.length > 1).length,
        spend: carries.reduce((sum, e) => {
          const src = e.sources.find((s) => s.sup === id);
          return sum + (src?.cpu || 0) * e.suggestedQty;
        }, 0),
      };
    });
  }, [enriched, supMap]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(""), 2400);
  }, []);

  const handleEmailClick = useCallback(
    (e, email) => {
      e.preventDefault();
      e.stopPropagation();
      if (!email) return;

      const fallbackCopy = (text) => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
          document.execCommand("copy");
        } catch {
          // ignore — best-effort fallback
        }
        document.body.removeChild(ta);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(email).catch(() => fallbackCopy(email));
      } else {
        fallbackCopy(email);
      }
      showToast(`Copied ${email}`);
    },
    [showToast]
  );

  const go = useCallback((scr) => {
    setScreen(scr);
    setSelectedId(null);
    setPoOpen(false);
    setSearch("");
  }, []);

  const openAddSupplier = useCallback(() => {
    setSupFormData({ supplier_id: `SUP-${Date.now()}` });
    setSupFormMode("add");
    setSupFormOpen(true);
  }, []);

  const openEditSupplier = useCallback((raw) => {
    if (!raw) return;
    setSupFormData({
      supplier_id: raw.supplierId,
      supplier_name: raw.name,
      contact_name: raw.contactName,
      contact_name_2: raw.contactName2,
      address: raw.address,
      address_2: raw.address2,
      city: raw.city,
      state: raw.state,
      zip: raw.zip,
      country: raw.country,
      phone_1: raw.phone1,
      phone_2: raw.phone2,
      email_1: raw.email1,
      email_2: raw.email2,
      website: raw.website,
      notes: raw.notes,
      specialized_mfg: raw.specializedMfg,
      _gid: raw.gid,
    });
    setSupFormMode("edit");
    setSupFormOpen(true);
  }, []);

  useEffect(() => {
    if (!supSubmitRef.current) return;
    if (supFetcher.state !== "idle" || !supFetcher.data) return;
    supSubmitRef.current = false;

    const data = supFetcher.data;
    // App-level validation error returned by /api/suppliers
    if (data.error) {
      showToast(data.error);
      return;
    }
    // Shopify userErrors from the metaobject mutation
    const errs =
      data?.data?.metaobjectCreate?.userErrors ||
      data?.data?.metaobjectUpdate?.userErrors ||
      [];
    if (errs.length > 0) {
      showToast(errs[0].message || "Could not save supplier");
      return;
    }
    // Success — close, refresh supplier list, confirm
    setSupFormOpen(false);
    if (refreshSuppliers) refreshSuppliers();
    showToast(supFormMode === "add" ? "Supplier added" : "Supplier updated");
  }, [supFetcher.state, supFetcher.data, supFormMode, showToast, refreshSuppliers]);

  const openDetail = useCallback(
    (id) => {
      const part = enriched.find((e) => e.id === id);
      if (!part) return;
      setSelectedId(id);
      setDetailSup(part.recommended.sup);
      setDetailQty(part.suggestedQty);
      setPoOpen(false);
    },
    [enriched]
  );

  const addToPO = useCallback(
    (part, supId, qty) => {
      setPo((prev) => ({
        ...prev,
        [part.id]: { supId: supId || part.recommended.sup, qty: qty || part.suggestedQty },
      }));
      showToast(part.sku + " added to draft PO");
    },
    [showToast]
  );

  const removePO = useCallback((id) => {
    setPo((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
  }, []);

  const setPOQty = useCallback((id, qty) => {
    setPo((prev) =>
      prev[id] ? { ...prev, [id]: { ...prev[id], qty: Math.max(1, qty) } } : prev
    );
  }, []);

  const inPO = (id) => !!po[id];

  // counts
  const counts = useMemo(() => {
    const c = { all: enriched.length, out: 0, critical: 0, warning: 0, attention: 0, healthy: 0 };
    enriched.forEach((e) => {
      if (c[e.risk.key] !== undefined) c[e.risk.key]++;
    });
    return c;
  }, [enriched]);

  const atRisk = counts.out + counts.critical + counts.warning;
  const q = search.trim().toLowerCase();

  const attention = useMemo(
    () =>
      enriched
        .filter((e) => e.risk.key === "out" || e.risk.key === "critical")
        .sort((a, b) => a.dts - b.dts)
        .slice(0, 6),
    [enriched]
  );

  const sourcingOps = useMemo(
    () =>
      enriched
        .filter((e) => e.diff && (e.savingsPerUnit > 0 || e.leadDiff > 0))
        .sort((a, b) => b.savingsPerUnit * b.suggestedQty - a.savingsPerUnit * a.suggestedQty)
        .slice(0, 5),
    [enriched]
  );

  const potentialSavings = useMemo(
    () => sourcingOps.reduce((s, e) => s + Math.max(0, e.savingsPerUnit) * e.suggestedQty, 0),
    [sourcingOps]
  );

  const reorderList = useMemo(() => enriched.filter((e) => e.belowReorder), [enriched]);

  const nosScarcity = useMemo(
    () =>
      enriched
        .filter((e) => e.isNOS && (e.lastOne || e.goneForever))
        .sort((a, b) => (a.goneForever === b.goneForever ? 0 : a.goneForever ? -1 : 1)),
    [enriched]
  );

  const reportRows = useMemo(() => {
    let rows = enriched
      .filter((e) => reportFilter === "all" || e.risk.key === reportFilter)
      .filter(
        (e) => !q || e.sku.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
      );
    rows.sort((a, b) => (sortDir === "asc" ? a.dts - b.dts : b.dts - a.dts));
    return rows;
  }, [enriched, reportFilter, q, sortDir]);

  const productRows = useMemo(
    () =>
      enriched
        .filter((e) => prodSup === "all" || e.sources.some((s) => s.sup === prodSup))
        .filter(
          (e) => !q || e.sku.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)
        ),
    [enriched, prodSup, q]
  );

  // detail panel
  const detail = useMemo(() => {
    if (!selectedId) return null;
    const e = enriched.find((p) => p.id === selectedId);
    if (!e) return null;
    const selSup = detailSup || e.recommended.sup;
    const selSource = e.sources.find((s) => s.sup === selSup) || e.recommended;

    let callout;
    if (e.diff) {
      const bits = [];
      if (e.savingsPerUnit > 0)
        bits.push(money0(e.savingsPerUnit * e.suggestedQty) + " cheaper");
      if (e.leadDiff > 0) bits.push(e.leadDiff + " days faster");
      callout =
        (e.reason === "Fastest" ? "Fastest in stock" : "Lowest landed cost") +
        (bits.length
          ? " · " + bits.join(", ") + " than your primary (" + e.primaryName + ")"
          : "");
    } else {
      callout = "Your primary supplier is already the best choice for this part.";
    }

    const detailSources = e.sources.map((s) => {
      const isSel = s.sup === selSup;
      return {
        ...s,
        cpuStr: money(s.cpu),
        isRecommended: s.sup === e.recommended.sup,
        isPrimary: !!s.primary,
        isSelected: isSel,
        borderColor: isSel ? "#232220" : "#e8e6e0",
        radioColor: isSel ? "#232220" : "#cfccc4",
        radioFill: isSel ? "#232220" : "transparent",
        setPrimaryLabel: s.primary ? "Primary supplier" : "Set as primary",
        setPrimaryColor: s.primary ? "#9a968e" : "#56524b",
      };
    });

    return {
      ...e,
      sources: detailSources,
      recCallout: callout,
      selSource,
      detailSupName: selSource?.supplierName || "Unknown",
      detailEstStr: money((Number(detailQty) || 0) * (selSource?.cpu || 0)),
    };
  }, [selectedId, enriched, detailSup, detailQty]);

  // PO
  const poIds = Object.keys(po);
  const poItems = useMemo(
    () =>
      poIds
        .map((id) => {
          const e = enriched.find((p) => p.id === id);
          if (!e) return null;
          const rec = po[id];
          const src = e.sources.find((s) => s.sup === rec.supId) || e.recommended;
          return {
            id,
            name: e.name,
            sku: e.sku,
            supName: src?.supplierName || "Unknown",
            qty: rec.qty,
            cpuStr: money(src?.cpu || 0),
            lineStr: money(rec.qty * (src?.cpu || 0)),
          };
        })
        .filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [po, enriched]
  );
  const poQty = poItems.reduce((s, i) => s + i.qty, 0);
  const poCost = useMemo(
    () =>
      poIds.reduce((s, id) => {
        const e = enriched.find((p) => p.id === id);
        if (!e) return s;
        const rec = po[id];
        const src = e.sources.find((x) => x.sup === rec.supId) || e.recommended;
        return s + rec.qty * (src?.cpu || 0);
      }, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [po, enriched]
  );
  const poSupCount = new Set(poIds.map((id) => po[id]?.supId)).size;

  const distDef = [
    { key: "out", label: "Out of stock", color: "#b42318" },
    { key: "critical", label: "Critical", color: "#d92d20" },
    { key: "warning", label: "Low", color: "#f79009" },
    { key: "attention", label: "Watch", color: "#2e90fa" },
    { key: "healthy", label: "Healthy", color: "#17b26a" },
  ];
  const distribution = distDef.map((d) => ({
    ...d,
    count: counts[d.key] || 0,
    width: counts.all
      ? (((counts[d.key] || 0) / counts.all) * 100).toFixed(2) + "%"
      : "0%",
  }));

  const navDef = [
    { id: "dashboard", label: "Overview", dot: "#232220" },
    {
      id: "report",
      label: "Sourcing report",
      dot: "#d92d20",
      badge: atRisk > 0 ? String(atRisk) : null,
    },
    { id: "products", label: "Products", dot: "#2e90fa" },
    { id: "suppliers", label: "Suppliers", dot: "#17b26a" },
  ];

  const kpis = [
    {
      label: "At risk",
      value: String(atRisk),
      sub:
        counts.out + " out · " + counts.critical + " critical · " + counts.warning + " low",
      dot: "#d92d20",
      valColor: "#232220",
      onClick: () => go("report"),
    },
    {
      label: "Out of stock",
      value: String(counts.out),
      sub: "need immediate reorder",
      dot: "#b42318",
      valColor: counts.out > 0 ? "#b42318" : "#232220",
      onClick: () => {
        setReportFilter("out");
        go("report");
      },
    },
    {
      label: "Reorder now",
      value: String(reorderList.length),
      sub: "below reorder point",
      dot: "#2e90fa",
      valColor: "#232220",
      onClick: () => go("report"),
    },
    {
      label: "Sourcing savings",
      value: money0(potentialSavings),
      sub: "by buying from best source",
      dot: "#17b26a",
      valColor: "#067647",
      onClick: () => {},
    },
  ];

  const reportTabsDef = [
    { key: "all", label: "All", dot: "#9a968e", count: counts.all },
    { key: "out", label: "Out", dot: "#b42318", count: counts.out },
    { key: "critical", label: "Critical", dot: "#d92d20", count: counts.critical },
    { key: "warning", label: "Low", dot: "#f79009", count: counts.warning },
    { key: "attention", label: "Watch", dot: "#2e90fa", count: counts.attention },
    { key: "healthy", label: "Healthy", dot: "#17b26a", count: counts.healthy },
  ];

  const pageSub =
    {
      dashboard: "What needs your attention today",
      report:
        enriched.length + " parts · " + atRisk + " at risk · choose the right supplier",
      products: enriched.length + " parts · " + supList.length + " suppliers",
      suppliers: supList.length + " active suppliers",
    }[screen] || "";

  const supFilterOpts = [
    { value: "all", label: "All suppliers" },
    ...supList.map((s) => ({ value: s.id, label: s.name })),
  ];

  const anyOverlay = !!selectedId || poOpen || supFormOpen;

  // ─── render ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: FONTS_CSS }} />

      <div
        className="rmp-app"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          width: "100%",
          background: "#f7f6f3",
          color: "#232220",
          fontSize: 14,
          lineHeight: 1.45,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {/* ── HEADER ── */}
        <header
          style={{
            flex: "none",
            background: "#fbfaf8",
            borderBottom: "1px solid #e8e6e0",
            padding: "0 28px",
          }}
        >
          {/* row 1: brand + controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, height: 60 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, flex: "none" }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  flex: "none",
                  borderRadius: 9,
                  background: "#232220",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  ...MONO,
                  fontWeight: 600,
                  fontSize: 13,
                  letterSpacing: "-0.5px",
                }}
              >
                RMP
              </div>
              <div style={{ lineHeight: 1.25 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13.5,
                    letterSpacing: "-0.2px",
                    whiteSpace: "nowrap",
                  }}
                >
                  Inventory Planner
                </div>
                <div style={{ fontSize: 11, color: "#9a968e", fontWeight: 500 }}>
                  Roberts Motor Parts
                </div>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            {/* sync status */}
            <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "none" }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flex: "none",
                  background: isLoading ? "#f79009" : "#17b26a",
                }}
              />
              <span
                style={{ fontSize: 12, color: "#6b6862", fontWeight: 500, whiteSpace: "nowrap" }}
              >
                {isLoading ? "Syncing…" : "Synced just now"}
              </span>
              <button
                onClick={refreshProducts}
                title="Refresh"
                className="rmp-btn-light"
                style={{
                  border: "1px solid #e3e1db",
                  background: "#fff",
                  borderRadius: 7,
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#6b6862",
                  marginLeft: 2,
                }}
              >
                <span
                  className={isLoading ? "rmp-spin" : ""}
                  style={{
                    display: "inline-block",
                    width: 13,
                    height: 13,
                    border: "1.6px solid currentColor",
                    borderTopColor: "transparent",
                    borderRadius: "50%",
                  }}
                />
              </button>
            </div>
            {/* search */}
            <div
              style={{
                position: "relative",
                width: 250,
                maxWidth: "28vw",
                flex: "none",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 13,
                  height: 13,
                  border: "1.6px solid #b5b1a8",
                  borderRadius: "50%",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  left: 21,
                  top: "calc(50% + 4px)",
                  width: 7,
                  height: "1.6px",
                  background: "#b5b1a8",
                  transform: "rotate(45deg)",
                }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search SKU or part…"
                style={{
                  width: "100%",
                  height: 38,
                  border: "1px solid #e3e1db",
                  borderRadius: 10,
                  background: "#fff",
                  padding: "0 14px 0 32px",
                  ...MONO,
                  fontSize: 12.5,
                  color: "#232220",
                }}
              />
            </div>
            {/* Draft PO */}
            <button
              onClick={() => setPoOpen(true)}
              className="rmp-btn-dark"
              style={{
                height: 38,
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "0 16px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                background: "#232220",
                color: "#fff",
                fontFamily: "inherit",
                fontWeight: 600,
                fontSize: 13,
                flex: "none",
              }}
            >
              Draft PO
              {poIds.length > 0 && (
                <span
                  style={{
                    ...MONO,
                    fontSize: 11,
                    fontWeight: 600,
                    background: "#fff",
                    color: "#232220",
                    borderRadius: 20,
                    padding: "1px 8px",
                  }}
                >
                  {poIds.length}
                </span>
              )}
            </button>
          </div>

          {/* row 2: nav pills */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              height: 56,
              borderTop: "1px solid #f0eee9",
            }}
          >
            {navDef.map((n) => {
              const active = screen === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => go(n.id)}
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border: "1px solid #e3e1db",
                    background: "transparent",
                    cursor: "pointer",
                    padding: "8px 16px",
                    borderRadius: 999,
                    fontFamily: "inherit",
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: "#56524b",
                  }}
                >
                  {active && (
                    <span
                      style={{
                        position: "absolute",
                        inset: -1,
                        background: "#232220",
                        borderRadius: 999,
                      }}
                    />
                  )}
                  <span
                    style={{
                      position: "relative",
                      zIndex: 1,
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      flex: "none",
                      background: n.dot,
                    }}
                  />
                  <span
                    style={{
                      position: "relative",
                      zIndex: 1,
                      color: active ? "#fff" : undefined,
                      fontWeight: active ? 600 : 500,
                    }}
                  >
                    {n.label}
                  </span>
                  {n.badge && (
                    <span
                      style={{
                        position: "relative",
                        zIndex: 1,
                        ...MONO,
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "1px 7px",
                        borderRadius: 20,
                        background: "#fee4e2",
                        color: "#b42318",
                      }}
                    >
                      {n.badge}
                    </span>
                  )}
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <div
              style={{
                fontSize: 12.5,
                color: "#9a968e",
                fontWeight: 500,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {pageSub}
            </div>
          </div>
        </header>

        {/* ── MAIN CONTENT ── */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>

            {/* SYNC PENDING — mirror has never completed a first sync */}
            {!isLoading && syncPending && variants.length === 0 && (
              <div style={{ padding: "24px 28px" }}>
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #e8e6e0",
                    borderRadius: 13,
                    padding: "20px 22px",
                    color: "#56524b",
                    fontSize: 13.5,
                  }}
                >
                  No catalog data yet — the first sync hasn&apos;t completed. It runs nightly, or
                  trigger it now with a POST to <code>/api/sync</code>.
                </div>
              </div>
            )}

            {/* LOADING SKELETON */}
            {isLoading && (
              <div style={{ padding: "24px 28px" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    gap: 16,
                    marginBottom: 20,
                  }}
                >
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="rmp-shimmer"
                      style={{ height: 104, borderRadius: 13 }}
                    />
                  ))}
                </div>
                <div
                  className="rmp-shimmer"
                  style={{ height: 340, borderRadius: 13 }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    justifyContent: "center",
                    marginTop: 22,
                    color: "#9a968e",
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  <span
                    className="rmp-spin"
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 14,
                      border: "2px solid #cfccc4",
                      borderTopColor: "#6b6862",
                      borderRadius: "50%",
                    }}
                  />
                  Syncing inventory &amp; supplier data…
                </div>
              </div>
            )}

            {/* ── DASHBOARD ── */}
            {!isLoading && screen === "dashboard" && (
              <div style={{ padding: "24px 28px" }}>
                {/* KPI row */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    gap: 16,
                  }}
                >
                  {kpis.map((k, i) => (
                    <div
                      key={i}
                      onClick={k.onClick}
                      className="rmp-kpi"
                      style={{
                        background: "#fff",
                        border: "1px solid #e8e6e0",
                        borderRadius: 13,
                        padding: "17px 18px",
                        cursor: "pointer",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: k.dot,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#6b6862",
                            textTransform: "uppercase",
                            letterSpacing: "0.03em",
                          }}
                        >
                          {k.label}
                        </span>
                      </div>
                      <div
                        style={{
                          ...MONO,
                          fontSize: 30,
                          fontWeight: 600,
                          letterSpacing: -1,
                          marginTop: 10,
                          color: k.valColor,
                        }}
                      >
                        {k.value}
                      </div>
                      <div
                        style={{ fontSize: 12, color: "#9a968e", fontWeight: 500, marginTop: 3 }}
                      >
                        {k.sub}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Risk distribution */}
                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #e8e6e0",
                    borderRadius: 13,
                    padding: "20px 22px",
                    marginTop: 16,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      marginBottom: 15,
                    }}
                  >
                    <div
                      style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.2px" }}
                    >
                      Inventory risk distribution
                    </div>
                    <div style={{ fontSize: 12.5, color: "#9a968e", fontWeight: 500 }}>
                      {enriched.length} parts tracked · click a band to filter
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      height: 18,
                      borderRadius: 6,
                      overflow: "hidden",
                      gap: 2,
                    }}
                  >
                    {distribution.map((d) => (
                      <div
                        key={d.key}
                        onClick={() => {
                          setReportFilter(d.key);
                          go("report");
                        }}
                        title={d.label}
                        className="rmp-dist"
                        style={{
                          width: d.width,
                          background: d.color,
                          cursor: "pointer",
                          minWidth: 3,
                          transition: "opacity .12s",
                        }}
                      />
                    ))}
                  </div>
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 15 }}
                  >
                    {distribution.map((d) => (
                      <button
                        key={d.key}
                        onClick={() => {
                          setReportFilter(d.key);
                          go("report");
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          padding: 0,
                        }}
                      >
                        <span
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: "50%",
                            background: d.color,
                          }}
                        />
                        <span
                          style={{ fontSize: 13, color: "#56524b", fontWeight: 500 }}
                        >
                          {d.label}
                        </span>
                        <span
                          style={{
                            ...MONO,
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#232220",
                          }}
                        >
                          {d.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Two-column: Needs attention + Smarter sourcing */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.35fr 1fr",
                    gap: 16,
                    marginTop: 16,
                    alignItems: "start",
                  }}
                >
                  {/* Needs attention now */}
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #e8e6e0",
                      borderRadius: 13,
                      boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "17px 20px 13px",
                      }}
                    >
                      <div
                        style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.2px" }}
                      >
                        Needs attention now
                      </div>
                      <button
                        onClick={() => {
                          setReportFilter("critical");
                          go("report");
                        }}
                        className="rmp-link"
                        style={{
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "#56524b",
                        }}
                      >
                        View all →
                      </button>
                    </div>
                    {attention.length === 0 ? (
                      <div
                        style={{
                          padding: "24px 20px",
                          textAlign: "center",
                          color: "#9a968e",
                          fontSize: 13,
                          borderTop: "1px solid #f3f1ec",
                        }}
                      >
                        All caught up! No critical items.
                      </div>
                    ) : (
                      attention.map((a) => (
                        <div
                          key={a.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 14,
                            padding: "13px 20px",
                            borderTop: "1px solid #f3f1ec",
                          }}
                        >
                          <span
                            style={{
                              width: 9,
                              height: 9,
                              borderRadius: "50%",
                              flex: "none",
                              background: a.risk.dot,
                            }}
                          />
                          <div
                            style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
                            onClick={() => openDetail(a.id)}
                          >
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: 13.5,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {a.name}
                            </div>
                            <div style={{ fontSize: 12, color: "#9a968e", ...MONO }}>
                              {a.sku} · order {a.suggestedQty} from {a.recommendedName} ·{" "}
                              {a.recommended.lead}d lead
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flex: "none" }}>
                            <div
                              style={{
                                ...MONO,
                                fontWeight: 600,
                                fontSize: 13,
                                color: a.risk.text,
                              }}
                            >
                              {a.dtsLabel}
                            </div>
                            <div style={{ fontSize: 11, color: "#9a968e" }}>to stockout</div>
                          </div>
                          <button
                            onClick={() =>
                              addToPO(a, a.recommended.sup, a.suggestedQty)
                            }
                            style={{
                              flex: "none",
                              border: "1px solid #232220",
                              background: inPO(a.id) ? "#232220" : "#fff",
                              color: inPO(a.id) ? "#fff" : "#232220",
                              borderRadius: 8,
                              padding: "7px 12px",
                              fontFamily: "inherit",
                              fontSize: 12.5,
                              fontWeight: 600,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {inPO(a.id) ? "Added" : "Reorder"}
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Smarter sourcing */}
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #e8e6e0",
                      borderRadius: 13,
                      boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ padding: "17px 20px 6px" }}>
                      <div
                        style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.2px" }}
                      >
                        Smarter sourcing
                      </div>
                      <div
                        style={{ fontSize: 12, color: "#9a968e", fontWeight: 500, marginTop: 2 }}
                      >
                        Switch supplier on these parts to save cost or time
                      </div>
                    </div>
                    {sourcingOps.length === 0 ? (
                      <div
                        style={{
                          padding: "24px 20px",
                          textAlign: "center",
                          color: "#9a968e",
                          fontSize: 13,
                          borderTop: "1px solid #f3f1ec",
                        }}
                      >
                        All flagged parts already on the best source.
                      </div>
                    ) : (
                      sourcingOps.map((o) => {
                        const bits = [];
                        if (o.savingsPerUnit > 0)
                          bits.push("Save " + money0(o.savingsPerUnit * o.suggestedQty));
                        if (o.leadDiff > 0) bits.push(o.leadDiff + "d faster");
                        return (
                          <div
                            key={o.id}
                            onClick={() => openDetail(o.id)}
                            className="rmp-card-row"
                            style={{
                              padding: "13px 20px",
                              borderTop: "1px solid #f3f1ec",
                              cursor: "pointer",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 10,
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 600,
                                  fontSize: 13.5,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {o.name}
                              </div>
                              <div
                                style={{
                                  ...MONO,
                                  fontWeight: 600,
                                  fontSize: 12.5,
                                  color: "#067647",
                                  whiteSpace: "nowrap",
                                  flex: "none",
                                }}
                              >
                                {bits.join(" · ")}
                              </div>
                            </div>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                marginTop: 6,
                                fontSize: 12,
                                color: "#6b6862",
                              }}
                            >
                              <span
                                style={{
                                  ...MONO,
                                  textDecoration: "line-through",
                                  color: "#b5b1a8",
                                }}
                              >
                                {o.primaryName}
                              </span>
                              <span style={{ color: "#b5b1a8" }}>→</span>
                              <span
                                style={{ ...MONO, fontWeight: 600, color: "#232220" }}
                              >
                                {o.recommendedName}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* NOS scarcity — last-one / gone-forever, no reorder logic applies */}
                {nosScarcity.length > 0 && (
                  <div
                    style={{
                      background: "#fff",
                      border: "1px solid #e8e6e0",
                      borderRadius: 13,
                      boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                      overflow: "hidden",
                      marginTop: 16,
                    }}
                  >
                    <div style={{ padding: "17px 20px 6px" }}>
                      <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.2px" }}>
                        NOS scarcity
                      </div>
                      <div style={{ fontSize: 12, color: "#9a968e", fontWeight: 500, marginTop: 2 }}>
                        Irreplaceable barn stock down to its last unit — nothing to reorder
                      </div>
                    </div>
                    {nosScarcity.map((n) => (
                      <div
                        key={n.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 14,
                          padding: "13px 20px",
                          borderTop: "1px solid #f3f1ec",
                          cursor: "pointer",
                        }}
                        onClick={() => openDetail(n.id)}
                      >
                        <span
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: "50%",
                            flex: "none",
                            background: n.risk.dot,
                          }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: 13.5,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {n.name}
                          </div>
                          <div style={{ fontSize: 12, color: "#9a968e", ...MONO }}>{n.sku}</div>
                        </div>
                        <div
                          style={{
                            ...MONO,
                            fontWeight: 600,
                            fontSize: 12,
                            color: n.risk.text,
                            background: n.risk.bg,
                            padding: "3px 9px",
                            borderRadius: 6,
                            flex: "none",
                          }}
                        >
                          {n.risk.label} · {n.onHand} on hand
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── SOURCING REPORT ── */}
            {!isLoading && screen === "report" && (
              <div style={{ padding: "20px 28px 28px" }}>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 16,
                  }}
                >
                  {reportTabsDef.map((t) => {
                    const active = reportFilter === t.key;
                    return (
                      <button
                        key={t.key}
                        onClick={() => setReportFilter(t.key)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          border: `1px solid ${active ? "#232220" : "#e3e1db"}`,
                          background: active ? "#232220" : "#fff",
                          color: active ? "#fff" : "#56524b",
                          borderRadius: 9,
                          padding: "7px 13px",
                          fontFamily: "inherit",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: t.dot,
                          }}
                        />
                        {t.label}
                        <span style={{ ...MONO, fontSize: 11.5, opacity: 0.7 }}>
                          {t.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #e8e6e0",
                    borderRadius: 13,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ overflowX: "auto" }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        minWidth: 980,
                      }}
                    >
                      <thead>
                        <tr style={{ background: "#fbfaf8" }}>
                          <th style={TH}>Part</th>
                          <th style={{ ...TH, textAlign: "right" }}>On hand</th>
                          <th style={{ ...TH, textAlign: "right" }}>Demand/day</th>
                          <th
                            onClick={() =>
                              setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                            }
                            style={{
                              ...TH,
                              color: "#56524b",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Days to stockout {sortDir === "asc" ? "↑" : "↓"}
                          </th>
                          <th style={TH}>Best source</th>
                          <th style={{ ...TH, textAlign: "right" }}>Suggest</th>
                          <th
                            style={{
                              padding: "12px 16px",
                              borderBottom: "1px solid #e8e6e0",
                            }}
                          />
                        </tr>
                      </thead>
                      <tbody>
                        {reportRows.map((r) => {
                          const reasonFg =
                            r.reason === "Fastest"
                              ? "#175cd3"
                              : r.reason === "Lowest cost"
                              ? "#067647"
                              : "#6b6862";
                          const reasonBg =
                            r.reason === "Fastest"
                              ? "#eff8ff"
                              : r.reason === "Lowest cost"
                              ? "#ecfdf3"
                              : "#f1efea";
                          return (
                            <tr
                              key={r.id}
                              className="rmp-row"
                              style={{ borderBottom: "1px solid #f3f1ec" }}
                            >
                              <td
                                style={{ padding: "13px 16px", cursor: "pointer" }}
                                onClick={() => openDetail(r.id)}
                              >
                                <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                                  {r.name}
                                </div>
                                <div
                                  style={{
                                    ...MONO,
                                    fontSize: 11.5,
                                    color: "#9a968e",
                                  }}
                                >
                                  {r.sku}
                                </div>
                              </td>
                              <td
                                style={{
                                  padding: "13px 14px",
                                  textAlign: "right",
                                  ...MONO,
                                  fontWeight: 500,
                                }}
                              >
                                {r.onHand}
                              </td>
                              <td
                                style={{
                                  padding: "13px 14px",
                                  textAlign: "right",
                                  ...MONO,
                                  color: "#6b6862",
                                }}
                              >
                                {r.demandStr}
                              </td>
                              <td style={{ padding: "13px 14px", minWidth: 150 }}>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 9,
                                  }}
                                >
                                  <span
                                    style={{
                                      ...MONO,
                                      fontWeight: 600,
                                      fontSize: 13,
                                      color: r.risk.text,
                                      width: 46,
                                    }}
                                  >
                                    {r.dtsLabel}
                                  </span>
                                  <div
                                    style={{
                                      flex: 1,
                                      height: 6,
                                      borderRadius: 4,
                                      background: "#f0eee9",
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        height: "100%",
                                        width: r.dtsWidth,
                                        background: r.risk.dot,
                                        borderRadius: 4,
                                      }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: "13px 16px" }}>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                  }}
                                >
                                  <span
                                    style={{
                                      ...MONO,
                                      fontWeight: 600,
                                      fontSize: 13,
                                    }}
                                  >
                                    {r.recommendedName}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      fontWeight: 600,
                                      textTransform: "uppercase",
                                      letterSpacing: "0.03em",
                                      color: reasonFg,
                                      background: reasonBg,
                                      padding: "2px 7px",
                                      borderRadius: 5,
                                    }}
                                  >
                                    {r.reason}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    fontSize: 12,
                                    color: "#9a968e",
                                    ...MONO,
                                    marginTop: 2,
                                  }}
                                >
                                  {r.bestCpuStr}/unit · {r.bestLeadStr} lead
                                </div>
                              </td>
                              <td
                                style={{
                                  padding: "13px 14px",
                                  textAlign: "right",
                                  ...MONO,
                                  fontWeight: 600,
                                  fontSize: 14,
                                }}
                              >
                                {r.suggestedQtyStr}
                              </td>
                              <td
                                style={{ padding: "13px 16px", textAlign: "right" }}
                              >
                                <button
                                  onClick={() =>
                                    addToPO(r, r.recommended.sup, r.suggestedQty)
                                  }
                                  style={{
                                    border: "1px solid #232220",
                                    background: inPO(r.id) ? "#232220" : "#fff",
                                    color: inPO(r.id) ? "#fff" : "#232220",
                                    borderRadius: 8,
                                    padding: "7px 13px",
                                    fontFamily: "inherit",
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {inPO(r.id) ? "Added" : "Reorder"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {reportRows.length === 0 && (
                    <div
                      style={{
                        padding: 40,
                        textAlign: "center",
                        color: "#9a968e",
                        fontSize: 13.5,
                      }}
                    >
                      No parts match this filter.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── PRODUCTS ── */}
            {!isLoading && screen === "products" && (
              <div style={{ padding: "20px 28px 28px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <span
                    style={{ fontSize: 12.5, fontWeight: 600, color: "#6b6862" }}
                  >
                    Supplier
                  </span>
                  <select
                    value={prodSup}
                    onChange={(e) => setProdSup(e.target.value)}
                    style={{
                      height: 36,
                      border: "1px solid #e3e1db",
                      borderRadius: 9,
                      background: "#fff",
                      padding: "0 32px 0 12px",
                      fontFamily: "inherit",
                      fontSize: 13,
                      color: "#232220",
                      cursor: "pointer",
                      appearance: "none",
                      backgroundImage:
                        "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22 viewBox=%220 0 10 10%22><path d=%22M1 3l4 4 4-4%22 stroke=%22%23999%22 stroke-width=%221.5%22 fill=%22none%22/></svg>')",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 11px center",
                    }}
                  >
                    {supFilterOpts.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <div style={{ flex: 1 }} />
                  <span
                    style={{ fontSize: 12.5, color: "#9a968e", fontWeight: 500 }}
                  >
                    {productRows.length} parts
                  </span>
                </div>

                <div
                  style={{
                    background: "#fff",
                    border: "1px solid #e8e6e0",
                    borderRadius: 13,
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ overflowX: "auto" }}>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        minWidth: 880,
                      }}
                    >
                      <thead>
                        <tr style={{ background: "#fbfaf8" }}>
                          <th style={TH}>Part</th>
                          <th style={TH}>Status</th>
                          <th style={{ ...TH, textAlign: "right" }}>On hand</th>
                          <th style={TH}>Sources</th>
                          <th style={TH}>Primary</th>
                          <th
                            style={{
                              padding: "12px 16px",
                              borderBottom: "1px solid #e8e6e0",
                            }}
                          />
                        </tr>
                      </thead>
                      <tbody>
                        {productRows.map((p) => (
                          <tr
                            key={p.id}
                            onClick={() => openDetail(p.id)}
                            className="rmp-row"
                            style={{
                              borderBottom: "1px solid #f3f1ec",
                              cursor: "pointer",
                            }}
                          >
                            <td style={{ padding: "13px 16px" }}>
                              <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                                {p.name}
                              </div>
                              <div
                                style={{ ...MONO, fontSize: 11.5, color: "#9a968e" }}
                              >
                                {p.sku}
                              </div>
                            </td>
                            <td style={{ padding: "13px 14px" }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: p.risk.text,
                                  background: p.risk.bg,
                                  padding: "3px 9px",
                                  borderRadius: 6,
                                }}
                              >
                                <span
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: "50%",
                                    background: p.risk.dot,
                                  }}
                                />
                                {p.risk.label}
                              </span>
                            </td>
                            <td
                              style={{
                                padding: "13px 14px",
                                textAlign: "right",
                                ...MONO,
                                fontWeight: 500,
                              }}
                            >
                              {p.onHand}
                            </td>
                            <td style={{ padding: "13px 16px" }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 5,
                                }}
                              >
                                <span
                                  style={{
                                    ...MONO,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "#56524b",
                                  }}
                                >
                                  {p.sourcesCount}
                                </span>
                                <span style={{ fontSize: 11.5, color: "#9a968e" }}>
                                  {p.sourceCodes}
                                </span>
                              </div>
                            </td>
                            <td
                              style={{
                                padding: "13px 16px",
                                ...MONO,
                                fontSize: 12.5,
                                fontWeight: 600,
                              }}
                            >
                              {p.primaryName}
                            </td>
                            <td
                              style={{ padding: "13px 16px", textAlign: "right" }}
                            >
                              <span
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: 600,
                                  color: "#56524b",
                                }}
                              >
                                Manage →
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {productRows.length === 0 && (
                    <div
                      style={{
                        padding: 40,
                        textAlign: "center",
                        color: "#9a968e",
                        fontSize: 13.5,
                      }}
                    >
                      No parts match.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── SUPPLIERS ── */}
            {!isLoading && screen === "suppliers" && (
              <div style={{ padding: "24px 28px 28px" }}>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
                  <button
                    onClick={openAddSupplier}
                    className="rmp-btn-dark"
                    style={{
                      background: "#2b2825",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      padding: "8px 16px",
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    + Add Supplier
                  </button>
                </div>
                {supList.length === 0 ? (
                  <div
                    style={{
                      padding: 40,
                      textAlign: "center",
                      color: "#9a968e",
                      fontSize: 13.5,
                    }}
                  >
                    No suppliers found. Add supplier data to your products to see them here.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
                      gap: 16,
                    }}
                  >
                    {supList.map((s) => (
                      <div
                        key={s.id}
                        style={{
                          background: "#fff",
                          border: "1px solid #e8e6e0",
                          borderRadius: 13,
                          padding: "18px 19px",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 15,
                                letterSpacing: "-0.2px",
                              }}
                            >
                              {s.name}
                            </div>
                            <div
                              style={{
                                ...MONO,
                                fontSize: 11.5,
                                color: "#9a968e",
                                marginTop: 1,
                              }}
                            >
                              {s.code}
                            </div>
                            {(s.city || s.state || s.country) && (
                              <div style={{ fontSize: 12, color: "#6b675f", marginTop: 3 }}>
                                {[s.city, s.state, s.country].filter(Boolean).join(", ")}
                              </div>
                            )}
                            {(s.email1 || s.email2) && (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 2,
                                  marginTop: 3,
                                }}
                              >
                                {[s.email1, s.email2].filter(Boolean).map((email) => (
                                  <div
                                    key={email}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 5,
                                      minWidth: 0,
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontSize: 12,
                                        color: "#6b675f",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {email}
                                    </span>
                                    <button
                                      onClick={(e) => handleEmailClick(e, email)}
                                      title="Copy email address"
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        width: 18,
                                        height: 18,
                                        padding: 0,
                                        border: "1px solid #e8e6e0",
                                        borderRadius: 4,
                                        background: "#fff",
                                        color: "#9a968e",
                                        cursor: "pointer",
                                        flexShrink: 0,
                                      }}
                                    >
                                      <svg
                                        width="11"
                                        height="11"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      >
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                      </svg>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
                            {s.specializedMfg && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  padding: "2px 7px",
                                  borderRadius: 99,
                                  background: "#eff8ff",
                                  color: "#175cd3",
                                  border: "1px solid #b2ddff",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                Specialized Mfg
                              </span>
                            )}
                            <button
                              onClick={() => openEditSupplier(s._raw)}
                              className="rmp-btn-light"
                              title="Edit supplier"
                              style={{
                                border: "1px solid #e8e6e0",
                                borderRadius: 6,
                                padding: "3px 8px",
                                fontFamily: "inherit",
                                fontSize: 14,
                                cursor: "pointer",
                                background: "#fff",
                                color: "#57534e",
                                lineHeight: 1,
                              }}
                            >
                              ✎
                            </button>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1fr",
                            gap: 1,
                            background: "#f0eee9",
                            borderRadius: 9,
                            overflow: "hidden",
                            marginTop: 15,
                          }}
                        >
                          {[
                            { val: s.avgLead + "d", lbl: "avg lead" },
                            { val: s.partsCount, lbl: "parts" },
                            { val: s.sharedCount, lbl: "shared" },
                          ].map(({ val, lbl }) => (
                            <div
                              key={lbl}
                              style={{ background: "#fff", padding: "11px 12px" }}
                            >
                              <div
                                style={{
                                  ...MONO,
                                  fontSize: 18,
                                  fontWeight: 600,
                                }}
                              >
                                {val}
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "#9a968e",
                                  fontWeight: 500,
                                }}
                              >
                                {lbl}
                              </div>
                            </div>
                          ))}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginTop: 15,
                            paddingTop: 14,
                            borderTop: "1px solid #f3f1ec",
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "#9a968e",
                                fontWeight: 500,
                              }}
                            >
                              Est. spend
                            </div>
                            <div
                              style={{
                                ...MONO,
                                fontWeight: 600,
                                fontSize: 15,
                              }}
                            >
                              {money0(s.spend)}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div
                              style={{
                                fontSize: 12,
                                color: "#9a968e",
                                fontWeight: 500,
                              }}
                            >
                              recommended for
                            </div>
                            <div
                              style={{
                                ...MONO,
                                fontWeight: 600,
                                fontSize: 15,
                                color: "#067647",
                              }}
                            >
                              {s.recCount} parts
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginTop: 13,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              color: "#6b6862",
                              fontWeight: 500,
                            }}
                          >
                            Competes on {s.sharedCount} shared parts
                          </span>
                          <button
                            onClick={() => {
                              setProdSup(s.id);
                              go("products");
                            }}
                            className="rmp-btn-light"
                            style={{
                              border: "1px solid #e3e1db",
                              background: "#fff",
                              borderRadius: 8,
                              padding: "6px 12px",
                              fontFamily: "inherit",
                              fontSize: 12.5,
                              fontWeight: 600,
                              cursor: "pointer",
                              color: "#232220",
                            }}
                          >
                            View parts →
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>

        {/* ── OVERLAY BACKDROP ── */}
        {anyOverlay && (
          <div
            onClick={() => {
              setSelectedId(null);
              setPoOpen(false);
              setSupFormOpen(false);
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(35,34,32,0.32)",
              zIndex: 40,
            }}
          />
        )}

        {/* ── PRODUCT DETAIL SLIDE-OVER ── */}
        {selectedId && detail && (
          <div
            className="rmp-slide"
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              height: "100vh",
              width: 480,
              maxWidth: "94vw",
              background: "#f7f6f3",
              zIndex: 50,
              boxShadow: "-12px 0 40px rgba(35,34,32,0.13)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* slide-over header */}
            <div
              style={{
                flex: "none",
                background: "#fff",
                borderBottom: "1px solid #e8e6e0",
                padding: "18px 22px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        color: detail.risk.text,
                        background: detail.risk.bg,
                        padding: "3px 9px",
                        borderRadius: 6,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: detail.risk.dot,
                        }}
                      />
                      {detail.risk.label}
                    </span>
                    <span style={{ ...MONO, fontSize: 12, color: "#9a968e" }}>
                      {detail.sku}
                    </span>
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 18,
                      letterSpacing: "-0.3px",
                      marginTop: 8,
                    }}
                  >
                    {detail.name}
                  </div>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  className="rmp-btn-light"
                  style={{
                    flex: "none",
                    border: "1px solid #e3e1db",
                    background: "#fff",
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    cursor: "pointer",
                    color: "#6b6862",
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4,1fr)",
                  gap: 1,
                  background: "#f0eee9",
                  borderRadius: 9,
                  overflow: "hidden",
                  marginTop: 15,
                }}
              >
                {[
                  { val: detail.onHand, lbl: "on hand" },
                  { val: detail.demandStr, lbl: "per day" },
                  { val: detail.dtsLabel, lbl: "to stockout", color: detail.risk.text },
                  { val: detail.reorderPoint, lbl: "reorder pt" },
                ].map(({ val, lbl, color }) => (
                  <div key={lbl} style={{ background: "#fff", padding: "10px 12px" }}>
                    <div
                      style={{ ...MONO, fontSize: 16, fontWeight: 600, color }}
                    >
                      {val}
                    </div>
                    <div style={{ fontSize: 11, color: "#9a968e" }}>{lbl}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* slide-over body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
              <div
                style={{
                  background: "#232220",
                  color: "#fff",
                  borderRadius: 11,
                  padding: "14px 16px",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "#b8b4ab",
                  }}
                >
                  Recommended source
                </div>
                <div
                  style={{ ...MONO, fontWeight: 600, fontSize: 17, marginTop: 4 }}
                >
                  {detail.recommendedName}
                </div>
                <div style={{ fontSize: 12.5, color: "#d8d5ce", marginTop: 3 }}>
                  {detail.recCallout}
                </div>
              </div>

              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "#9a968e",
                  margin: "20px 0 10px",
                }}
              >
                Compare suppliers · {detail.sourcesCount} carry this part
              </div>

              {detail.sources.map((src) => (
                <div
                  key={src.sup}
                  onClick={() => setDetailSup(src.sup)}
                  style={{
                    background: "#fff",
                    border: `1.5px solid ${src.borderColor}`,
                    borderRadius: 11,
                    padding: "14px 15px",
                    marginBottom: 10,
                    cursor: "pointer",
                    transition: "border-color .12s",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 9 }}
                    >
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          border: `2px solid ${src.radioColor}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flex: "none",
                        }}
                      >
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: src.radioFill,
                          }}
                        />
                      </span>
                      <span style={{ ...MONO, fontWeight: 600, fontSize: 14 }}>
                        {src.supplierName}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 5 }}>
                      {src.isRecommended && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.03em",
                            color: "#067647",
                            background: "#ecfdf3",
                            padding: "2px 7px",
                            borderRadius: 5,
                          }}
                        >
                          Best
                        </span>
                      )}
                      {src.isPrimary && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.03em",
                            color: "#56524b",
                            background: "#f1efea",
                            padding: "2px 7px",
                            borderRadius: 5,
                          }}
                        >
                          Primary
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3,1fr)",
                      gap: 10,
                      marginTop: 12,
                    }}
                  >
                    {[
                      { lbl: "Unit cost", val: src.cpuStr },
                      { lbl: "Lead time", val: src.lead + "d" },
                      { lbl: "MPN", val: src.mpn || "–" },
                    ].map(({ lbl, val }) => (
                      <div key={lbl}>
                        <div style={{ fontSize: 11, color: "#9a968e" }}>{lbl}</div>
                        <div style={{ ...MONO, fontWeight: 600, fontSize: 14 }}>
                          {val}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: 11,
                      paddingTop: 11,
                      borderTop: "1px solid #f3f1ec",
                    }}
                  >
                    <span style={{ fontSize: 11.5, color: "#9a968e", ...MONO }}>
                      Last order {src.lastDate || "–"}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: src.setPrimaryColor,
                      }}
                    >
                      {src.setPrimaryLabel}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* slide-over footer */}
            <div
              style={{
                flex: "none",
                background: "#fff",
                borderTop: "1px solid #e8e6e0",
                padding: "16px 22px",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#9a968e",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.03em",
                      marginBottom: 5,
                    }}
                  >
                    Order qty
                  </div>
                  <input
                    value={detailQty}
                    onChange={(e) =>
                      setDetailQty(
                        e.target.value === ""
                          ? ""
                          : Math.max(0, parseInt(e.target.value) || 0)
                      )
                    }
                    type="number"
                    style={{
                      width: 88,
                      height: 42,
                      border: "1px solid #e3e1db",
                      borderRadius: 9,
                      padding: "0 12px",
                      ...MONO,
                      fontSize: 16,
                      fontWeight: 600,
                      color: "#232220",
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#9a968e",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.03em",
                      marginBottom: 5,
                    }}
                  >
                    From {detail.detailSupName}
                  </div>
                  <div style={{ ...MONO, fontSize: 16, fontWeight: 600 }}>
                    {detail.detailEstStr}{" "}
                    <span style={{ fontSize: 12, color: "#9a968e", fontWeight: 500 }}>
                      est.
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (detail) {
                      addToPO(
                        detail,
                        detailSup,
                        Math.max(1, parseInt(detailQty) || 1)
                      );
                      setSelectedId(null);
                    }
                  }}
                  className="rmp-btn-dark"
                  style={{
                    height: 46,
                    flex: "none",
                    border: "none",
                    cursor: "pointer",
                    background: "#232220",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "0 22px",
                    fontFamily: "inherit",
                    fontWeight: 600,
                    fontSize: 14,
                  }}
                >
                  Add to PO
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── DRAFT PO DRAWER ── */}
        {poOpen && (
          <div
            className="rmp-slide"
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              height: "100vh",
              width: 440,
              maxWidth: "94vw",
              background: "#f7f6f3",
              zIndex: 50,
              boxShadow: "-12px 0 40px rgba(35,34,32,0.13)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                flex: "none",
                background: "#fff",
                borderBottom: "1px solid #e8e6e0",
                padding: "18px 22px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div
                  style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.3px" }}
                >
                  Draft purchase order
                </div>
                <div style={{ fontSize: 12.5, color: "#9a968e", fontWeight: 500 }}>
                  {poItems.length === 0
                    ? "Empty"
                    : poItems.length + " parts · " + poSupCount + " suppliers"}
                </div>
              </div>
              <button
                onClick={() => setPoOpen(false)}
                className="rmp-btn-light"
                style={{
                  border: "1px solid #e3e1db",
                  background: "#fff",
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  cursor: "pointer",
                  color: "#6b6862",
                  fontSize: 16,
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
              {poItems.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    textAlign: "center",
                    padding: "40px 20px",
                    color: "#9a968e",
                  }}
                >
                  <div
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 12,
                      border: "2px dashed #d8d5cd",
                      marginBottom: 14,
                    }}
                  />
                  <div
                    style={{ fontWeight: 600, fontSize: 14, color: "#56524b" }}
                  >
                    No items yet
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 4 }}>
                    Add parts from the report or product detail to build a PO.
                  </div>
                </div>
              ) : (
                poItems.map((it) => (
                  <div
                    key={it.id}
                    style={{
                      background: "#fff",
                      border: "1px solid #e8e6e0",
                      borderRadius: 11,
                      padding: "13px 14px",
                      marginBottom: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{it.name}</div>
                        <div style={{ ...MONO, fontSize: 11.5, color: "#9a968e" }}>
                          {it.sku} · from {it.supName}
                        </div>
                      </div>
                      <button
                        onClick={() => removePO(it.id)}
                        className="rmp-link"
                        style={{
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          color: "#b5b1a8",
                          fontSize: 13,
                          flex: "none",
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 11,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          border: "1px solid #e3e1db",
                          borderRadius: 8,
                          overflow: "hidden",
                        }}
                      >
                        <button
                          onClick={() => setPOQty(it.id, it.qty - 1)}
                          className="rmp-btn-light"
                          style={{
                            width: 30,
                            height: 30,
                            border: "none",
                            background: "#fff",
                            cursor: "pointer",
                            fontSize: 16,
                            color: "#6b6862",
                          }}
                        >
                          −
                        </button>
                        <span
                          style={{
                            width: 48,
                            textAlign: "center",
                            ...MONO,
                            fontWeight: 600,
                            fontSize: 14,
                            borderLeft: "1px solid #e3e1db",
                            borderRight: "1px solid #e3e1db",
                            height: 30,
                            lineHeight: "30px",
                          }}
                        >
                          {it.qty}
                        </span>
                        <button
                          onClick={() => setPOQty(it.id, it.qty + 1)}
                          className="rmp-btn-light"
                          style={{
                            width: 30,
                            height: 30,
                            border: "none",
                            background: "#fff",
                            cursor: "pointer",
                            fontSize: 16,
                            color: "#6b6862",
                          }}
                        >
                          +
                        </button>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ ...MONO, fontWeight: 600, fontSize: 14 }}>
                          {it.lineStr}
                        </div>
                        <div style={{ fontSize: 11, color: "#9a968e", ...MONO }}>
                          {it.cpuStr}/unit
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {poItems.length > 0 && (
              <div
                style={{
                  flex: "none",
                  background: "#fff",
                  borderTop: "1px solid #e8e6e0",
                  padding: "16px 22px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 13,
                    color: "#6b6862",
                    marginBottom: 5,
                  }}
                >
                  <span>Total units</span>
                  <span style={{ ...MONO, fontWeight: 600, color: "#232220" }}>
                    {poQty}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 13,
                    color: "#6b6862",
                    marginBottom: 13,
                  }}
                >
                  <span>Estimated cost</span>
                  <span
                    style={{
                      ...MONO,
                      fontWeight: 700,
                      fontSize: 17,
                      color: "#232220",
                    }}
                  >
                    {money(poCost)}
                  </span>
                </div>
                <button
                  onClick={() => {
                    showToast(
                      "Purchase order exported (" + poItems.length + " items)"
                    );
                    setPoOpen(false);
                  }}
                  className="rmp-btn-dark"
                  style={{
                    width: "100%",
                    height: 46,
                    border: "none",
                    cursor: "pointer",
                    background: "#232220",
                    color: "#fff",
                    borderRadius: 10,
                    fontFamily: "inherit",
                    fontWeight: 600,
                    fontSize: 14,
                  }}
                >
                  Export purchase order
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── TOAST ── */}
        {toast && (
          <div
            style={{
              position: "fixed",
              bottom: 26,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 60,
              background: "#232220",
              color: "#fff",
              padding: "11px 20px",
              borderRadius: 10,
              fontSize: 13.5,
              fontWeight: 500,
              boxShadow: "0 8px 28px rgba(35,34,32,0.28)",
              display: "flex",
              alignItems: "center",
              gap: 9,
            }}
          >
            <span
              style={{ width: 7, height: 7, borderRadius: "50%", background: "#17b26a" }}
            />
            {toast}
          </div>
        )}

        {/* ── SUPPLIER ADD/EDIT SLIDE-OVER ── */}
        {supFormOpen && (
          <div
            className="rmp-slide"
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              height: "100vh",
              width: 520,
              maxWidth: "96vw",
              background: "#f7f6f3",
              zIndex: 50,
              boxShadow: "-12px 0 40px rgba(35,34,32,0.13)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* header */}
            <div
              style={{
                flex: "none",
                background: "#fff",
                borderBottom: "1px solid #e8e6e0",
                padding: "18px 22px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.2px" }}>
                  {supFormMode === "add" ? "Add Supplier" : "Edit Supplier"}
                </div>
                <div style={{ fontSize: 12, color: "#9a968e", marginTop: 2 }}>
                  {supFormMode === "add"
                    ? "Fill in the details to create a new supplier"
                    : "Update supplier information"}
                </div>
              </div>
              <button
                onClick={() => setSupFormOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 20,
                  cursor: "pointer",
                  color: "#9a968e",
                  padding: "2px 6px",
                  borderRadius: 6,
                }}
              >
                ×
              </button>
            </div>

            {/* scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>
              {(() => {
                const sectionLabel = (text) => (
                  <div
                    key={text}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "#9a968e",
                      margin: "18px 0 10px",
                    }}
                  >
                    {text}
                  </div>
                );
                const inputStyle = (disabled) => ({
                  width: "100%",
                  border: "1px solid #e8e6e0",
                  borderRadius: 8,
                  padding: "8px 11px",
                  fontSize: 13.5,
                  fontFamily: "inherit",
                  background: disabled ? "#f7f6f3" : "#fff",
                  color: disabled ? "#9a968e" : "#232220",
                });
                const labelStyle = {
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#57534e",
                  marginBottom: 4,
                };
                const field = (label, key, opts = {}) => (
                  <div key={key} style={{ marginBottom: 14 }}>
                    {!opts.checkbox && (
                      <label style={labelStyle}>
                        {label}
                        {opts.required && <span style={{ color: "#b42318" }}> *</span>}
                      </label>
                    )}
                    {opts.textarea ? (
                      <textarea
                        rows={3}
                        value={supFormData[key] || ""}
                        onChange={(e) => setSupFormData((p) => ({ ...p, [key]: e.target.value }))}
                        style={{ ...inputStyle(false), resize: "vertical" }}
                      />
                    ) : opts.checkbox ? (
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={!!supFormData[key]}
                          onChange={(e) => setSupFormData((p) => ({ ...p, [key]: e.target.checked }))}
                          style={{ width: 16, height: 16, cursor: "pointer" }}
                        />
                        <span style={{ fontSize: 13, color: "#232220" }}>{label}</span>
                      </label>
                    ) : (
                      <input
                        type="text"
                        disabled={opts.disabled}
                        value={supFormData[key] || ""}
                        onChange={(e) => setSupFormData((p) => ({ ...p, [key]: e.target.value }))}
                        style={inputStyle(opts.disabled)}
                      />
                    )}
                  </div>
                );

                return (
                  <div>
                    {sectionLabel("Identity")}
                    {field("Supplier ID", "supplier_id", { required: true, disabled: supFormMode === "edit" })}
                    {field("Supplier Name", "supplier_name", { required: true })}

                    {sectionLabel("Contact")}
                    {field("Contact Name", "contact_name")}
                    {field("Contact Name 2", "contact_name_2")}
                    {field("Phone 1", "phone_1")}
                    {field("Phone 2", "phone_2")}
                    {field("Email 1", "email_1")}
                    {field("Email 2", "email_2")}
                    {field("Website", "website")}

                    {sectionLabel("Address")}
                    {field("Address", "address")}
                    {field("Address 2", "address_2")}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {field("City", "city")}
                      {field("State / Province", "state")}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {field("Zip / Postal Code", "zip")}
                      {field("Country", "country")}
                    </div>

                    {sectionLabel("Classification")}
                    {field("Specialized Manufacturer", "specialized_mfg", { checkbox: true })}

                    {sectionLabel("Notes")}
                    {field("Internal Notes", "notes", { textarea: true })}
                  </div>
                );
              })()}
            </div>

            {/* footer */}
            <div
              style={{
                flex: "none",
                background: "#fff",
                borderTop: "1px solid #e8e6e0",
                padding: "14px 22px",
                display: "flex",
                gap: 10,
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={() => setSupFormOpen(false)}
                className="rmp-btn-light"
                style={{
                  border: "1px solid #e8e6e0",
                  background: "#fff",
                  borderRadius: 8,
                  padding: "8px 18px",
                  fontFamily: "inherit",
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "#57534e",
                }}
              >
                Cancel
              </button>
              <button
                disabled={supFetcher.state !== "idle"}
                onClick={() => {
                  const trim = (v) => (v || "").trim();
                  const fields = [
                    { key: "supplier_id", value: trim(supFormData.supplier_id) },
                    { key: "supplier_name", value: trim(supFormData.supplier_name) },
                    { key: "contact_name", value: trim(supFormData.contact_name) },
                    { key: "contact_name_2", value: trim(supFormData.contact_name_2) },
                    { key: "address", value: trim(supFormData.address) },
                    { key: "address_2", value: trim(supFormData.address_2) },
                    { key: "city", value: trim(supFormData.city) },
                    { key: "state", value: trim(supFormData.state) },
                    { key: "zip", value: trim(supFormData.zip) },
                    { key: "country", value: trim(supFormData.country) },
                    { key: "phone_1", value: trim(supFormData.phone_1) },
                    { key: "phone_2", value: trim(supFormData.phone_2) },
                    { key: "email_1", value: trim(supFormData.email_1) },
                    { key: "email_2", value: trim(supFormData.email_2) },
                    { key: "notes", value: trim(supFormData.notes) },
                    { key: "specialized_mfg", value: supFormData.specialized_mfg ? "true" : "false" },
                  ];
                  // url-type field: Shopify rejects empty/invalid URLs, so only send when present
                  const website = trim(supFormData.website);
                  if (website) fields.push({ key: "website", value: website });

                  const data = new FormData();
                  data.append("intent", supFormMode === "add" ? "create" : "update");
                  data.append("fields", JSON.stringify(fields));
                  if (supFormMode === "edit") data.append("id", supFormData._gid || "");
                  supSubmitRef.current = true;
                  supFetcher.submit(data, { method: "post", action: "/api/suppliers" });
                }}
                className="rmp-btn-dark"
                style={{
                  background: "#2b2825",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 22px",
                  fontFamily: "inherit",
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: supFetcher.state !== "idle" ? "wait" : "pointer",
                  opacity: supFetcher.state !== "idle" ? 0.6 : 1,
                }}
              >
                {supFetcher.state !== "idle"
                  ? "Saving…"
                  : supFormMode === "add"
                  ? "Add Supplier"
                  : "Save Changes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
