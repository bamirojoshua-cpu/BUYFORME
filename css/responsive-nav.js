/* Mobile navigation helpers */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-nav-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const sel = btn.getAttribute("data-nav-toggle");
      const panel = sel ? document.querySelector(sel) : null;
      if (!panel) return;
      const open = panel.classList.toggle("is-open");
      document.body.classList.toggle("sidebar-open", open);
    });
  });

  document.body.addEventListener("click", e => {
    if (!document.body.classList.contains("sidebar-open")) return;
    const sidebar = document.querySelector(".sidebar.is-open");
    const btn = document.querySelector("[data-nav-toggle]");
    if (sidebar && !sidebar.contains(e.target) && !btn?.contains(e.target)) {
      sidebar.classList.remove("is-open");
      document.body.classList.remove("sidebar-open");
    }
  });
});
