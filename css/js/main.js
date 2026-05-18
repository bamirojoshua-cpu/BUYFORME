document.addEventListener("DOMContentLoaded", () => {
    // 1. Page Loader
    document.body.classList.add("loaded");

    // 2. Intersection Observer (The modern way to do Scroll Reveal)
    // This is much faster for performance than window.onscroll
    const revealElements = document.querySelectorAll('.step, .stat-card, .feature-item, .reveal');
    
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
            }
        });
    }, { threshold: 0.1 });

    revealElements.forEach(el => revealObserver.observe(el));

    // 3. Tab System (Dashboard)
    const tabButtons = document.querySelectorAll("[data-tab]");
    const sections = document.querySelectorAll(".tab-section");

    tabButtons.forEach(button => {
        button.addEventListener("click", () => {
            const target = button.getAttribute("data-tab");

            sections.forEach(section => section.style.display = "none");
            
            const targetElement = document.getElementById(target);
            if (targetElement) targetElement.style.display = "block";
        });
    });
});

// 4. Sticky Navbar on Scroll
window.addEventListener("scroll", () => {
    const navbar = document.querySelector(".navbar");
    if (window.scrollY > 50) {
        navbar.classList.add("scrolled");
    } else {
        navbar.classList.remove("scrolled");
    }
});

// 5. Button Ripple Effect
document.querySelectorAll(".btn").forEach(button => {
    button.addEventListener("click", function (e) {
        const circle = document.createElement("span");
        const diameter = Math.max(this.clientWidth, this.clientHeight);

        circle.style.width = circle.style.height = `${diameter}px`;
        circle.style.left = `${e.clientX - this.getBoundingClientRect().left - diameter / 2}px`;
        circle.style.top = `${e.clientY - this.getBoundingClientRect().top - diameter / 2}px`;
        circle.classList.add("ripple");

        const existingRipple = this.querySelector(".ripple");
        if (existingRipple) existingRipple.remove();

        this.appendChild(circle);
    });
});