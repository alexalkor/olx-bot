// When is a subscribed search due? The cron runs hourly at minute 7.

const TZ = "Europe/Warsaw";

function warsawParts(d) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) % 24 };
}

export function warsawHour(now) { return warsawParts(now).hour; }
export function warsawDate(now) { return warsawParts(now).date; }

export function isDue(search, now) {
  const last = search.lastRunAt ? Date.parse(search.lastRunAt) : null;
  const mins = last == null ? Infinity : (now.getTime() - last) / 60000;
  switch (search.delivery) {
    case "1h": return mins >= 55;
    case "3h": return mins >= 175;
    case "daily":
      if (warsawHour(now) < 9) return false;
      return last == null || warsawDate(new Date(last)) !== warsawDate(now);
    default: return false;
  }
}
