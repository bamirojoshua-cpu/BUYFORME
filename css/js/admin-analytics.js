/**
 * Admin overview analytics charts (pure CSS bars)
 */

function monthKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

function lastMonths(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(monthKey(d));
  }
  return out;
}

function fmtShort(key) {
  const [y, m] = key.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m) - 1]} '${String(y).slice(2)}`;
}

export function renderAnalyticsCharts(orders) {
  const container = document.getElementById("analyticsCharts");
  if (!container) return;

  const months = lastMonths(6);
  const paidStatuses = new Set(["paid", "funded", "purchased", "delivering", "delivered"]);

  const revenueByMonth = Object.fromEntries(months.map((m) => [m, 0]));
  const ordersByMonth = Object.fromEntries(months.map((m) => [m, 0]));
  const statusCounts = {};

  for (const o of orders || []) {
    const mk = monthKey(o.created_at);
    if (ordersByMonth[mk] !== undefined) ordersByMonth[mk]++;
    if (paidStatuses.has(o.status)) {
      if (revenueByMonth[mk] !== undefined) {
        revenueByMonth[mk] += Number(o.total_amount || o.budget || 0);
      }
    }
    statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
  }

  const maxRev = Math.max(1, ...Object.values(revenueByMonth));
  const maxOrd = Math.max(1, ...Object.values(ordersByMonth));

  const barChart = (data, max, color) => `
    <div class="analytics-bars">
      ${months.map((m) => {
        const v = data[m] || 0;
        const h = Math.round((v / max) * 100);
        return `<div class="analytics-bar-wrap" title="${fmtShort(m)}: ${typeof v === "number" && v % 1 ? v.toFixed(0) : v}">
          <div class="analytics-bar" style="height:${h}%;background:${color}"></div>
          <span>${fmtShort(m)}</span>
        </div>`;
      }).join("")}
    </div>`;

  const statusOrder = ["pending", "quoted", "accepted", "paid", "purchased", "delivering", "delivered", "cancelled"];
  const totalStatus = Object.values(statusCounts).reduce((a, b) => a + b, 0) || 1;

  container.innerHTML = `
    <div class="analytics-grid">
      <div class="analytics-card">
        <h3><i class="fas fa-chart-line"></i> Revenue (6 mo)</h3>
        ${barChart(revenueByMonth, maxRev, "var(--green)")}
      </div>
      <div class="analytics-card">
        <h3><i class="fas fa-chart-bar"></i> Orders (6 mo)</h3>
        ${barChart(ordersByMonth, maxOrd, "var(--blue)")}
      </div>
      <div class="analytics-card analytics-card--wide">
        <h3><i class="fas fa-chart-pie"></i> Orders by status</h3>
        <div class="analytics-status-list">
          ${statusOrder.filter((s) => statusCounts[s]).map((s) => {
            const n = statusCounts[s];
            const pct = Math.round((n / totalStatus) * 100);
            return `<div class="analytics-status-row">
              <span class="analytics-status-label">${s}</span>
              <div class="analytics-status-track"><div class="analytics-status-fill" style="width:${pct}%"></div></div>
              <span class="analytics-status-count">${n}</span>
            </div>`;
          }).join("") || "<p class='analytics-empty'>No orders yet</p>"}
        </div>
      </div>
    </div>`;
}
