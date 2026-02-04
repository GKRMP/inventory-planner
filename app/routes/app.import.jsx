import { useState, useCallback } from "react";
import { useLoaderData } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  DropZone,
  IndexTable,
  Badge,
  ProgressBar,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import AppNavigation from "../components/AppNavigation";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  // Fetch suppliers for validation
  const suppliersQuery = `
    {
      metaobjects(type: "supplier", first: 250) {
        edges {
          node {
            id
            fields {
              key
              value
            }
          }
        }
      }
    }
  `;

  const suppliersResponse = await admin.graphql(suppliersQuery);
  const suppliersData = await suppliersResponse.json();

  const suppliers = suppliersData.data.metaobjects.edges.map((e) => {
    const fields = {};
    e.node.fields.forEach((f) => {
      fields[f.key] = f.value;
    });
    return {
      id: e.node.id,
      supplier_id: fields.supplier_id,
      supplier_name: fields.supplier_name,
    };
  });

  return { suppliers };
}

// Parse CSV content
function parseCSV(content) {
  // Remove BOM if present
  const cleanContent = content.replace(/^\uFEFF/, "");
  const lines = cleanContent.split("\n").filter((line) => line.trim());

  if (lines.length < 2) {
    throw new Error("CSV file is empty or has no data rows");
  }

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0 || values.every((v) => !v.trim())) continue;

    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() || "";
    });

    // Only add if row has at least SKU and SupplierID
    if (row["SKU"] && row["SupplierID"]) {
      rows.push(row);
    }
  }

  return rows;
}

// Parse a single CSV line, handling quoted fields
function parseCSVLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);

  return values;
}

// Parse boolean values
function parseBool(value) {
  if (!value) return false;
  const lower = value.toString().toLowerCase().trim();
  return ["y", "yes", "1", "true"].includes(lower);
}

// Transform CSV rows to API format
function transformRows(rows) {
  return rows.map((row) => ({
    sku: row["SKU"],
    supplier_id: row["SupplierID"],
    mpn: row["MPN"] || "",
    is_primary: parseBool(row["IsPrimary"]),
    lead_time: parseInt(row["LeadTime"]) || 0,
    threshold: parseInt(row["Threshold"]) || 0,
    daily_demand: parseFloat(row["DailyDemand"]) || 0,
    last_order_date: row["LastOrderDate"] || "",
    last_order_cpu: parseFloat(row["LastOrderCPU"]) || 0,
    last_order_quantity: parseInt(row["LastOrderQty"]) || 0,
    notes: row["Notes"] || "",
  }));
}

export default function ImportPage() {
  const { suppliers } = useLoaderData();

  const [file, setFile] = useState(null);
  const [parsedData, setParsedData] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState(null);

  // Create supplier ID lookup
  const supplierIds = new Set(suppliers.map((s) => s.supplier_id));
  const supplierNames = {};
  suppliers.forEach((s) => {
    supplierNames[s.supplier_id] = s.supplier_name;
  });

  const handleDropZoneDrop = useCallback((_dropFiles, acceptedFiles) => {
    if (acceptedFiles.length > 0) {
      const uploadedFile = acceptedFiles[0];
      setFile(uploadedFile);
      setParseError(null);
      setParsedData([]);
      setImportResults(null);

      // Read and parse the file
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target.result;
          const rows = parseCSV(content);
          const transformed = transformRows(rows);
          setParsedData(transformed);
        } catch (error) {
          setParseError(error.message);
        }
      };
      reader.readAsText(uploadedFile);
    }
  }, []);

  const handleImport = async () => {
    if (parsedData.length === 0) return;

    setImporting(true);
    setImportProgress(0);
    setImportResults(null);

    try {
      const response = await fetch("/api/bulk-import-variant-suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantSuppliers: parsedData }),
      });

      const results = await response.json();
      setImportResults(results);
      setImportProgress(100);
    } catch (error) {
      setImportResults({ error: error.message });
    } finally {
      setImporting(false);
    }
  };

  const clearFile = () => {
    setFile(null);
    setParsedData([]);
    setParseError(null);
    setImportResults(null);
    setImportProgress(0);
  };

  // Validate parsed data
  const validationIssues = parsedData.map((row) => {
    const issues = [];
    if (!supplierIds.has(row.supplier_id)) {
      issues.push(`Unknown supplier ID: ${row.supplier_id}`);
    }
    return { ...row, issues };
  });

  const hasValidationErrors = validationIssues.some((r) => r.issues.length > 0);
  const validRows = validationIssues.filter((r) => r.issues.length === 0);

  return (
    <>
      <TitleBar title="Import Variant Suppliers" />
      <Page fullWidth>
        <BlockStack gap="400">
          <AppNavigation />

          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Import Variant-Supplier Relationships
              </Text>
              <Text variant="bodyMd" as="p" tone="subdued">
                Upload a CSV file to bulk import supplier data for your product variants.
              </Text>

              <Banner tone="info">
                <Text variant="bodyMd" as="p">
                  <strong>CSV Format:</strong> SKU, SupplierID, MPN, IsPrimary, LeadTime, Threshold, DailyDemand, LastOrderDate, LastOrderCPU, LastOrderQty, Notes
                </Text>
              </Banner>

              {!file && (
                <DropZone onDrop={handleDropZoneDrop} accept=".csv" type="file">
                  <DropZone.FileUpload actionHint="or drop CSV file to upload" />
                </DropZone>
              )}

              {file && (
                <InlineStack align="space-between">
                  <Text variant="bodyMd" as="p">
                    <strong>File:</strong> {file.name}
                  </Text>
                  <Button onClick={clearFile} tone="critical" variant="plain">
                    Remove
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>

          {parseError && (
            <Banner tone="critical" title="Parse Error">
              <Text variant="bodyMd" as="p">{parseError}</Text>
            </Banner>
          )}

          {parsedData.length > 0 && (
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingMd" as="h2">
                    Preview ({parsedData.length} rows)
                  </Text>
                  {hasValidationErrors && (
                    <Badge tone="warning">
                      {validationIssues.filter((r) => r.issues.length > 0).length} rows with issues
                    </Badge>
                  )}
                </InlineStack>

                <div style={{ maxHeight: "400px", overflow: "auto" }}>
                  <IndexTable
                    resourceName={{ singular: "row", plural: "rows" }}
                    itemCount={validationIssues.length}
                    headings={[
                      { title: "SKU" },
                      { title: "Supplier" },
                      { title: "MPN" },
                      { title: "Primary" },
                      { title: "Lead Time" },
                      { title: "Threshold" },
                      { title: "Daily Demand" },
                      { title: "Status" },
                    ]}
                    selectable={false}
                  >
                    {validationIssues.slice(0, 100).map((row, index) => (
                      <IndexTable.Row id={index.toString()} key={index} position={index}>
                        <IndexTable.Cell>
                          <Text variant="bodyMd" fontWeight="semibold" as="span">
                            {row.sku}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {supplierNames[row.supplier_id] || row.supplier_id}
                        </IndexTable.Cell>
                        <IndexTable.Cell>{row.mpn || "-"}</IndexTable.Cell>
                        <IndexTable.Cell>
                          {row.is_primary ? <Badge tone="success">Yes</Badge> : "No"}
                        </IndexTable.Cell>
                        <IndexTable.Cell>{row.lead_time} days</IndexTable.Cell>
                        <IndexTable.Cell>{row.threshold}</IndexTable.Cell>
                        <IndexTable.Cell>{row.daily_demand}</IndexTable.Cell>
                        <IndexTable.Cell>
                          {row.issues.length > 0 ? (
                            <Badge tone="critical">{row.issues.join(", ")}</Badge>
                          ) : (
                            <Badge tone="success">Valid</Badge>
                          )}
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                </div>

                {validationIssues.length > 100 && (
                  <Text variant="bodySm" as="p" tone="subdued">
                    Showing first 100 of {validationIssues.length} rows
                  </Text>
                )}

                {importing && (
                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p">Importing...</Text>
                    <ProgressBar progress={importProgress} />
                  </BlockStack>
                )}

                {!importing && !importResults && (
                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      onClick={handleImport}
                      disabled={parsedData.length === 0}
                    >
                      Import {validRows.length} Valid Rows
                    </Button>
                    {hasValidationErrors && (
                      <Text variant="bodySm" as="p" tone="subdued">
                        Rows with validation errors will be skipped
                      </Text>
                    )}
                  </InlineStack>
                )}
              </BlockStack>
            </Card>
          )}

          {importResults && (
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Import Results</Text>

                {importResults.error ? (
                  <Banner tone="critical" title="Import Failed">
                    <Text variant="bodyMd" as="p">{importResults.error}</Text>
                    {importResults.message && (
                      <Text variant="bodyMd" as="p">{importResults.message}</Text>
                    )}
                  </Banner>
                ) : (
                  <BlockStack gap="200">
                    <InlineStack gap="400">
                      <Badge tone="success">
                        Success: {importResults.success?.length || 0}
                      </Badge>
                      <Badge tone="warning">
                        Skipped: {importResults.skipped?.length || 0}
                      </Badge>
                      <Badge tone="critical">
                        Failed: {importResults.failed?.length || 0}
                      </Badge>
                    </InlineStack>

                    {importResults.skipped?.length > 0 && (
                      <Banner tone="warning" title="Skipped Rows">
                        <BlockStack gap="100">
                          {importResults.skipped.slice(0, 10).map((item, i) => (
                            <Text key={i} variant="bodySm" as="p">
                              {item.sku}: {item.reason}
                            </Text>
                          ))}
                          {importResults.skipped.length > 10 && (
                            <Text variant="bodySm" as="p" tone="subdued">
                              ... and {importResults.skipped.length - 10} more
                            </Text>
                          )}
                        </BlockStack>
                      </Banner>
                    )}

                    {importResults.failed?.length > 0 && (
                      <Banner tone="critical" title="Failed Rows">
                        <BlockStack gap="100">
                          {importResults.failed.slice(0, 10).map((item, i) => (
                            <Text key={i} variant="bodySm" as="p">
                              {item.sku}: {item.error}
                            </Text>
                          ))}
                          {importResults.failed.length > 10 && (
                            <Text variant="bodySm" as="p" tone="subdued">
                              ... and {importResults.failed.length - 10} more
                            </Text>
                          )}
                        </BlockStack>
                      </Banner>
                    )}

                    <Button onClick={clearFile}>Import Another File</Button>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          )}
        </BlockStack>
      </Page>
    </>
  );
}
