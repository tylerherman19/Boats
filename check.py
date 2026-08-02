import json
import os
import smtplib
import urllib.parse
import urllib.request
from email.mime.text import MIMEText

API_BASE = "https://yourboatclub.com/boatclubappsreservation"
BOOKING_URL = "https://yourboatclub.com/boatclubappsreservation/reservation/index.html"
DEFAULT_SMS_TO = "7634432772@tmomail.net"


RES_TYPE_LABEL = {"FULL": "Full day", "AM": "AM", "PM": "PM"}


def format_time(t):
    if not t:
        return ""
    h, m = (int(p) for p in t.split(":"))
    period = "PM" if h >= 12 else "AM"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d} {period}"


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


def get_sms_to():
    try:
        with open("settings.json") as f:
            settings = json.load(f)
        return settings.get("sms_to") or DEFAULT_SMS_TO
    except FileNotFoundError:
        return DEFAULT_SMS_TO


def notify(sms_to, subject, body):
    gmail_address = os.environ["GMAIL_ADDRESS"]
    gmail_password = os.environ["GMAIL_APP_PASSWORD"]

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = gmail_address
    msg["To"] = sms_to

    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(gmail_address, gmail_password)
        server.sendmail(gmail_address, [sms_to], msg.as_string())


def lakes_of(w):
    return w.get("lakes") or ([w["lake"]] if "lake" in w else [])


def boat_types_of(w):
    return w.get("boat_types") or ([w["boat_type"]] if w.get("boat_type") else [])


def send_confirmation(sms_to):
    raw = os.environ.get("NEW_WATCH", "")
    if not raw:
        return
    try:
        watch = json.loads(raw)
    except json.JSONDecodeError:
        return

    lakes = lakes_of(watch)
    boat_types = boat_types_of(watch)
    boat_type_str = ", ".join(boat_types) if boat_types else "any boat"
    lake_str = ", ".join(lakes)
    notify(
        sms_to,
        "Boat Watch set",
        f"Your watch for {boat_type_str} is set for {lake_str} on {watch.get('date')}. "
        f"I'll text you if anything opens up.",
    )


def main():
    with open("watches.json") as f:
        watches = json.load(f) or []

    sms_to = get_sms_to()
    send_confirmation(sms_to)

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
        lakes = lakes_of(w)
        date_str = w["date"].replace("-", "")
        boat_types = [b.lower() for b in boat_types_of(w)]

        for lake in lakes:
            key = f"{lake}|{w['date']}"

            loc_id = name_to_id.get(lake)
            if loc_id is None:
                print(f"WARNING: unknown lake '{lake}', skipping")
                continue

            slots = get_available(loc_id, date_str)
            if boat_types:
                slots = [s for s in slots if s.get("boatType", "").lower() in boat_types]

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
                    f"{s['boatType']} - {RES_TYPE_LABEL.get(s['resType'], s['resType'])} "
                    f"({format_time(s['startTime'])}-{format_time(s['endTime'])}) "
                    f"{s['boatName']} - ${s['fullFee']}"
                    for s in new_slots
                ]
                notify(
                    sms_to,
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
