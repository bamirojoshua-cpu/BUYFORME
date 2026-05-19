import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "../../css/brand.css";
import "../../css/call-ui.css";
import "../../css/responsive.css";
import "../../css/verified-badge.css";
import "../../css/shopper-dashboard.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
