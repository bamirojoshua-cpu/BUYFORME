/** BuyForMe landing page interactions */

(function () {
  const navbar = document.getElementById("navbar");
  if (navbar) {
    const THRESHOLD = 48;
    let ticking = false;

    function updateNavbar() {
      navbar.classList.toggle("scrolled", window.scrollY > THRESHOLD);
      ticking = false;
    }

    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          requestAnimationFrame(updateNavbar);
          ticking = true;
        }
      },
      { passive: true }
    );

    updateNavbar();
  }

  const hero = document.getElementById("hero");
  if (hero) {
    const MAX_BLUR = 16;
    const MAX_SHADE = 0.42;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hasFinePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let ticking = false;

    function updateHeroScroll() {
      const rect = hero.getBoundingClientRect();
      const height = rect.height || 1;
      const progress = Math.min(1, Math.max(0, -rect.top / (height * 0.75)));
      hero.style.setProperty("--hero-blur", `${(progress * MAX_BLUR).toFixed(2)}px`);
      hero.style.setProperty("--hero-shade", `${0.52 + progress * MAX_SHADE}`);
      ticking = false;
    }

    window.addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          requestAnimationFrame(updateHeroScroll);
          ticking = true;
        }
      },
      { passive: true }
    );

    updateHeroScroll();

    if (hasFinePointer && !prefersReducedMotion) {
      hero.addEventListener("mousemove", (e) => {
        const rect = hero.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        hero.style.setProperty("--spot-x", `${x}%`);
        hero.style.setProperty("--spot-y", `${y}%`);
        hero.style.setProperty("--parallax-x", `${(px * -28).toFixed(2)}px`);
        hero.style.setProperty("--parallax-y", `${(py * -18).toFixed(2)}px`);
      });

      hero.addEventListener("mouseleave", () => {
        hero.style.setProperty("--spot-x", "28%");
        hero.style.setProperty("--spot-y", "48%");
        hero.style.setProperty("--parallax-x", "0px");
        hero.style.setProperty("--parallax-y", "0px");
      });
    }
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => entry.target.classList.add("visible"), i * 80);
        }
      });
    },
    { threshold: 0.1 }
  );

  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
})();
