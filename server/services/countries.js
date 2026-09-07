/**
 * Country name to ISO alpha-2 mapping (UPS pickup / collection).
 */
export const NAME2ISO = {
  "United Kingdom": "GB", "UK": "GB", "Great Britain": "GB", "England": "GB", "Scotland": "GB", "Wales": "GB", "Northern Ireland": "GB",
  "United States": "US", "United States of America": "US", "USA": "US", "US": "US",
  "Afghanistan": "AF", "Albania": "AL", "Algeria": "DZ", "American Samoa": "AS", "Andorra": "AD", "Angola": "AO",
  "Anguilla": "AI", "Antigua": "AG", "Argentina": "AR", "Armenia": "AM", "Aruba": "AW", "Australia": "AU",
  "Austria": "AT", "Azerbaijan": "AZ", "Bahamas": "BS", "Bahrain": "BH", "Bangladesh": "BD", "Barbados": "BB",
  "Belgium": "BE", "Belize": "BZ", "Benin": "BJ", "Bermuda": "BM", "Bhutan": "BT", "Bolivia": "BO",
  "Bosnia": "BA", "Botswana": "BW", "Brazil": "BR", "British Virgin Islands": "VG", "Brunei": "BN", "Bulgaria": "BG",
  "Burkina Faso": "BF", "Cambodia": "KH", "Cameroon": "CM", "Canada": "CA", "Cayman Islands": "KY",
  "Central African Republic": "CF", "Chad": "TD", "Chile": "CL", "China": "CN", "Colombia": "CO",
  "Costa Rica": "CR", "Croatia": "HR", "Cyprus": "CY", "Denmark": "DK", "Djibouti": "DJ", "Dominica": "DM",
  "Dominican Republic": "DO", "Ecuador": "EC", "Egypt": "EG", "El Salvador": "SV", "Estonia": "EE",
  "Ethiopia": "ET", "Faroe Islands": "FO", "Fiji": "FJ", "Finland": "FI", "France": "FR", "French Guiana": "GF",
  "French Polynesia/Tahiti": "PF", "Gabon": "GA", "Gambia": "GM", "Georgia": "GE", "Germany": "DE", "Ghana": "GH",
  "Gibraltar": "GI", "Greece": "GR", "Greenland": "GL", "Grenada": "GD", "Guadeloupe": "GP", "Guam": "GU",
  "Guatemala": "GT", "Guinea": "GN", "Guyana": "GY", "Haiti": "HT", "Honduras": "HN", "Hong Kong": "HK",
  "Hungary": "HU", "Iceland": "IS", "India": "IN", "Indonesia": "ID", "Iraq": "IQ", "Israel": "IL", "Italy": "IT",
  "Jamaica": "JM", "Japan": "JP", "Jordan": "JO", "Kazakhstan": "KZ", "Kenya": "KE", "Kuwait": "KW", "Laos": "LA",
  "Latvia": "LV", "Lebanon": "LB", "Lesotho": "LS", "Liberia": "LR", "Libya": "LY", "Liechtenstein": "LI",
  "Lithuania": "LT", "Luxembourg": "LU", "Madagascar": "MG", "Malawi": "MW", "Malaysia": "MY", "Maldives": "MV",
  "Malta": "MT", "Marshall Islands": "MH", "Martinique": "MQ", "Mauritius": "MU", "Mayotte": "YT", "Mexico": "MX",
  "Moldova": "MD", "Monaco": "MC", "Mongolia": "MN", "Montenegro": "ME", "Montserrat": "MS", "Mozambique": "MZ",
  "Namibia": "NA", "Nepal": "NP", "Netherlands": "NL", "New Caledonia": "NC", "New Zealand": "NZ", "Nicaragua": "NI",
  "Nigeria": "NG", "Norway": "NO", "Oman": "OM", "Pakistan": "PK", "Panama": "PA", "Papua New Guinea": "PG",
  "Paraguay": "PY", "Peru": "PE", "Philippines": "PH", "Poland": "PL", "Portugal": "PT", "Qatar": "QA",
  "Romania": "RO", "Rwanda": "RW", "San Marino": "SM", "Saudi Arabia": "SA", "Senegal": "SN", "Serbia": "RS",
  "Seychelles": "SC", "Singapore": "SG", "Slovakia": "SK", "Slovenia": "SI", "South Africa": "ZA", "Spain": "ES",
  "Sri Lanka": "LK", "St Kitts & Nevis": "KN", "St Lucia": "LC", "St Vincent": "VC", "Suriname": "SR",
  "Sweden": "SE", "Switzerland": "CH", "Taiwan": "TW", "Tajikistan": "TJ", "Tanzania": "TZ", "Thailand": "TH",
  "Togo": "TG", "Trinidad": "TT", "Tunisia": "TN", "Turkmenistan": "TM", "Turks & Caicos Islands": "TC",
  "Uganda": "UG", "United Arab Emirates": "AE", "Uruguay": "UY", "Uzbekistan": "UZ", "Vanuatu": "VU",
  "Vatican City": "VA", "Vietnam": "VN", "Wallis & Futuna Islands": "WF", "Yemen": "YE", "Zambia": "ZM",
  "Zimbabwe": "ZW", "Morocco": "MA", "Barbuda": "AG", "Canary Islands": "ES",
  "Congo Democratic Republic": "CD", "Congo Republic of": "CG", "Czech Republic": "CZ", "East Timor": "TL",
  "Eqatorial Guinea": "GQ", "Korea South": "KR", "Kyrgystan": "KG", "Macau": "MO", "Macedonia": "MK",
  "Republic of Kosovo": "XK", "Reunion Island": "RE", "Saipan": "MP", "St Pierre & Miquilon": "PM",
  "Swaziland": "SZ", "Tahiti": "PF", "Turkey": "TR"
};

export function nameToIso(name) {
  if (!name) return null;
  const s = String(name).trim();
  if (NAME2ISO[s]) return NAME2ISO[s];
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const hit = Object.keys(NAME2ISO).find(k => k.toLowerCase() === s.toLowerCase());
  return hit ? NAME2ISO[hit] : null;
}
