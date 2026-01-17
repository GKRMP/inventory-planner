import { Routes, Route } from "react-router-dom";

import InventoryRisk from "./pages/InventoryRisk";
import Suppliers from "./pages/Suppliers";
import SupplierForm from "./pages/SupplierForm";
import SupplierParts from "./pages/SupplierParts";
import SupplierPartForm from "./pages/SupplierPartForm";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<InventoryRisk />} />

      <Route path="/inventory-risk" element={<InventoryRisk />} />

      <Route path="/suppliers" element={<Suppliers />} />
      <Route path="/suppliers/new" element={<SupplierForm />} />
      <Route path="/suppliers/:id" element={<SupplierForm />} />

      <Route path="/supplier-parts" element={<SupplierParts />} />
      <Route path="/supplier-parts/new" element={<SupplierPartForm />} />
      <Route path="/supplier-parts/:id" element={<SupplierPartForm />} />
    </Routes>
  );
}