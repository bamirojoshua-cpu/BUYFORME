/* Map shopper location text → ISO country code + flag assets */

/** @type {Record<string, string>} */
const COUNTRY_ALIASES = {
  turkey: "tr",
  turkiye: "tr",
  türkiye: "tr",
  istanbul: "tr",
  ankara: "tr",
  izmir: "tr",
  china: "cn",
  chinese: "cn",
  guangzhou: "cn",
  canton: "cn",
  yiwu: "cn",
  beijing: "cn",
  shanghai: "cn",
  shenzhen: "cn",
  uk: "gb",
  "united kingdom": "gb",
  britain: "gb",
  england: "gb",
  scotland: "gb",
  wales: "gb",
  london: "gb",
  manchester: "gb",
  usa: "us",
  us: "us",
  "u.s.": "us",
  "u.s.a.": "us",
  america: "us",
  "united states": "us",
  "united states of america": "us",
  nigeria: "ng",
  lagos: "ng",
  abuja: "ng",
  ghana: "gh",
  accra: "gh",
  kenya: "ke",
  nairobi: "ke",
  "south africa": "za",
  johannesburg: "za",
  dubai: "ae",
  uae: "ae",
  "united arab emirates": "ae",
  india: "in",
  mumbai: "in",
  delhi: "in",
  france: "fr",
  paris: "fr",
  germany: "de",
  berlin: "de",
  italy: "it",
  milan: "it",
  rome: "it",
  spain: "es",
  madrid: "es",
  japan: "jp",
  tokyo: "jp",
  korea: "kr",
  "south korea": "kr",
  seoul: "kr",
  canada: "ca",
  toronto: "ca",
  australia: "au",
  sydney: "au",
  brazil: "br",
  mexico: "mx",
  egypt: "eg",
  morocco: "ma",
  senegal: "sn",
  ivory: "ci",
  "côte d'ivoire": "ci",
  "cote d'ivoire": "ci",
};

const ACCENT_BY_CODE = {
  tr: "#c41e3a",
  cn: "#de2910",
  gb: "#012169",
  us: "#3c3b6e",
  ng: "#008751",
  gh: "#006b3f",
  ke: "#006600",
  za: "#007749",
  ae: "#00732f",
  in: "#ff9933",
  fr: "#0055a4",
  de: "#000000",
  jp: "#bc002d",
};

/**
 * @param {string | null | undefined} location
 * @returns {string | null} ISO 3166-1 alpha-2 lowercase
 */
export function countryCodeFromLocation(location) {
  if (!location) return null;
  const raw = String(location).trim().toLowerCase();
  if (!raw) return null;

  if (COUNTRY_ALIASES[raw]) return COUNTRY_ALIASES[raw];

  const segments = raw.split(/[,/|·–-]/).map((s) => s.trim()).filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (COUNTRY_ALIASES[seg]) return COUNTRY_ALIASES[seg];
  }

  for (const [key, code] of Object.entries(COUNTRY_ALIASES)) {
    if (raw.includes(key)) return code;
  }

  return null;
}

/**
 * @param {string} code ISO alpha-2
 * @param {number} [width]
 */
export function flagImageUrl(code, width = 1280) {
  if (!code) return null;
  return `https://flagcdn.com/w${width}/${code.toLowerCase()}.jpg`;
}

/**
 * @param {string | null} code ISO alpha-2
 */
export function flagEmoji(code) {
  if (!code || code.length !== 2) return "";
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    ...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

/**
 * @param {string | null} code
 */
export function accentColorForCountry(code) {
  if (!code) return "#1a9e6e";
  return ACCENT_BY_CODE[code.toLowerCase()] || "#1a9e6e";
}

/**
 * @param {HTMLElement | null} coverEl
 * @param {string | null | undefined} location
 */
export function applyProfileCover(coverEl, location) {
  const code = countryCodeFromLocation(location);

  if (!coverEl) {
    return { code, accent: accentColorForCountry(code) };
  }

  coverEl.removeAttribute("style");

  if (code) {
    const url = flagImageUrl(code);
    coverEl.classList.add("profile-cover--flag");
    coverEl.classList.remove("profile-cover--fallback");
    coverEl.style.backgroundImage = `url("${url}")`;
    coverEl.dataset.countryCode = code;
    const label = location ? String(location).trim() : code.toUpperCase();
    coverEl.setAttribute("aria-label", `Flag of ${label}`);
    coverEl.removeAttribute("aria-hidden");
  } else {
    coverEl.classList.remove("profile-cover--flag");
    coverEl.classList.add("profile-cover--fallback");
    coverEl.style.backgroundImage = "";
    coverEl.removeAttribute("data-country-code");
    coverEl.setAttribute("aria-hidden", "true");
    coverEl.removeAttribute("aria-label");
  }

  return { code, accent: accentColorForCountry(code) };
}
