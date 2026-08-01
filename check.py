import json
import os
import smtplib
import urllib.parse
import urllib.request
from email.mime.text import MIMEText

API_BASE = "https://yourboatclub.com/boatclubappsreservation"
BOOKING_URL = "https://yourboatclub.com/boatclubappsreservation/reservation/index.html"
SMS_TO = "7634432772@tmomail.net"


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


def notify(subject, body):
    gmail_address = os.environ["GMAIL_ADDRESS"]
    gmail_password = os.environ["GMAIL_APP_PASSWORD"]

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = gmail_address
    msg["To"] = SMS_TO

    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(gmail_address, gmail_password)
        server.sendmail(gmail_address, [SMS_TO], msg.as_string())


def main():
    with open("watches.json") as f:
        watches = json.load(f) or []
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
