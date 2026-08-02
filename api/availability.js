const API_BASE = "https://yourboatclub.com/boatclubappsreservation";
const BOOKING_URL = "https://yourboatclub.com/boatclubappsreservation/reservation/index.html";

const ORDERED_LAKES = [
  "Minnetonka - Browns Bay",
  "Minnetonka - Smiths Bay",
  "St. Croix River",
  "Big Sandy",
  "Champlin",
  "Cross Lake",
  "Forest Lake",
  "Gull Lake",
  "Leech Lake - Bluewater Lodge",
  "Leech Lake - Chase",
  "Mille Lacs - Garrison",
  "Prior Lake",
  "St. Paul - Watergate",
  "Vermilion",
  "Waconia",
  "White Bear Lake",
];

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Upstream fetch failed: ${res.status}`);
  return res.json();
}

function getLocations() {
  return fetchJson(`${API_BASE}/wrapper/rest?service=locations`);
}

function getAvailable(locationId, dateStr) {
  const q = `|locationids|${locationId}|fromdate|${dateStr}|todate|${dateStr}`;
  const url =
    `${API_BASE}/wrapperrs/restrs?service=availablereservations` +
    `&id=0&type=%7Cmember%7C0&search=${encodeURIComponent(q)}`;
  return fetchJson(url);
}

module.exports = async (req, res) => {
  if (req.headers["x-site-secret"] !== process.env.SITE_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }

  try {
    const dateStr = todayStr();
    const locations = await getLocations();
    const nameToId = {};
    for (const loc of locations) nameToId[loc.name] = loc.ID;

    const results = await Promise.all(
      ORDERED_LAKES.map(async (lake) => {
        const locId = nameToId[lake];
        if (locId == null) {
          return { lake, error: "unknown location" };
        }
        try {
          const slots = await getAvailable(locId, dateStr);
          const counts = {};
          for (const s of slots) {
            const t = s.boatType || "Other";
            counts[t] = (counts[t] || 0) + 1;
          }
          return {
            lake,
            counts,
            slots: slots.map((s) => ({
              boatName: s.boatName,
              boatType: s.boatType,
              resType: s.resType,
              startTime: s.startTime,
              endTime: s.endTime,
              fullFee: s.fullFee,
            })),
          };
        } catch (e) {
          return { lake, error: e.message };
        }
      })
    );

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ date: dateStr, bookingUrl: BOOKING_URL, locations: results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
