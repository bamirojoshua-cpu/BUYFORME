import { useEffect, useRef } from "react";
import dashboardBody from "./dashboard-body.html?raw";
import { bootstrapShopperDashboard } from "../../css/js/dashboard.js";

export default function App() {
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    bootstrapShopperDashboard().catch(console.error);
  }, []);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: dashboardBody }}
      suppressHydrationWarning
    />
  );
}
