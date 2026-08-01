import json
import os
import urllib.parse
import urllib.request

import yaml

NTFY_TOPIC = "tylerherman19-boatwatch-8f3k2"
API_BASE = "https://yourboatclub.com/boatclubappsreservation"
BOOKING_URL = "https://yourboatclub.com/boatclubappsreservation/reservation/index.html"


def fetch_json(url):
    with urllib.request.urlopen(url, timeout=20) as resp:
        return json.load(resp)


def get_locations():
    return fetch_json(f"{API_BASE}/wrapper/rest?service=locations")


def get_available(location_id, date_str):
    q = f"|locationids|{location_id}|fromdate|{date_str}|todate|{date_str}"
    url = (
        f"{API_BASE}/wrapperrs/restrs?service=availablereservations"
        f"&id=0&type=%7Cmember%7C0&search={urllib.parse.quote(q)}"
    )
    return fetch_json(url)


def notify(title, message):
    req = urllib.request.Request(
        f"https://ntfy.sh/{NTFY_TOPIC}",
        data=message.encode("utf-8"),
        headers={"Title": title, "Priority": "urgent", "Tags": "boat,rotating_light"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=10)


def main():
    with open("watches.yaml") as f:
        config = yaml.safe_load(f) or {}
    watches = config.get("watches") or []
    if not watches:
        print("No active watches. Exiting.")
        return

    try:
        with open("state.json") as f:
            state = json.load(f)
    except FileNotFoundError:
        state = {}

    locations = get_locations()
    name_to_id = {loc["name"]: loc["ID"] for loc in locations}

    changed = False
    for w in watches:
        lake = w["lake"]
        date_str = w["date"].replace("-", "")
        boat_type = w.get("boat_type")
        key = f"{lake}|{w['date']}"

        loc_id = name_to_id.get(lake)
        if loc_id is None:
            print(f"WARNING: unknown lake '{lake}', skipping")
            continue

        slots = get_available(loc_id, date_str)
        if boat_type:
            slots = [s for s in slots if s.get("boatType", "").lower() == boat_type.lower()]

        seen = set(state.get(key, []))
        new_slots = []
        for s in slots:
            sig = f"{s['boatID']}-{s['startTime']}-{s['resType']}"
            if sig not in seen:
                new_slots.append(s)
                seen.add(sig)

        if new_slots:
            changed = True
            state[key] = list(seen)
            lines = [
                f"{s['boatName']} ({s['resType']}) {s['startTime']}-{s['endTime']} "
                f"${s['fullFee']}"
                for s in new_slots
            ]
            notify(
                f"Boat opened: {lake} {w['date']}",
                "\n".join(lines) + f"\n\nBook: {BOOKING_URL}",
            )
            print(f"ALERTED: {key} -> {len(new_slots)} new slot(s)")
        else:
            print(f"No new slots: {key}")

    if changed:
        with open("state.json", "w") as f:
            json.dump(state, f, indent=2)


if __name__ == "__main__":
    main()
