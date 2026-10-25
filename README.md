ESP32 Light EV Event Data Recorder Dashboard

A responsive static website that reads **your existing Arduino sketch's Firebase Realtime Database records**. No changes to the ESP32 firmware are required.

## Features
- Live temperature (°C), gas sensor ADC, voltage (V), acceleration (g), and motion state
- NORMAL / CRITICAL status, last update, offline indicator if data is over 20 seconds old
- Selectable historical line chart (up to the latest 120 Firebase history records; shows last 60 points per metric)
- Up to 30 most recent critical events
- Download loaded history and event records as CSV
- Demo button with **clearly labeled simulated sample readings** for presentation purposes
- Responsive desktop and mobile layouts

## Firebase data mapping
The dashboard **exactly matches** your ESP32 code:

- `edr/edr01/live` — one updated record, approximately every 5 seconds
- `edr/edr01/history` — a new record about every minute, plus critical records
- `edr/edr01/events` — a new record for each critical event

Expected fields: `ts` (Firebase server milliseconds), `uptime_ms`, `state`, `temp_c`, `gas`, `volt_v`, `gyro`, `acc_g`, and `event_no` for events.

## How to run (Mac / Windows / Linux)
1. Extract the ZIP.
2. Open a terminal in the `edr-light-ev-dashboard` folder.
3. Run `python3 -m http.server 5500` (on Windows `py -m http.server 5500` may work).
4. Open **http://localhost:5500**.
5. The website signs into Firebase **anonymously** and reads your existing records. The ESP32 must stay connected to Wi-Fi to keep updating; the browser may be anywhere with Internet access.

**Do not open `index.html` using `file://`**; use a local HTTP server or deploy it.

## Firebase security and authentication
The firmware uses Firebase Identity Toolkit anonymous signup and writes authenticated RTDB records. The website also signs in anonymously. In Firebase console:

- Go to **Authentication → Sign-in method** and enable **Anonymous**.
- Go to **Realtime Database → Rules**. If appropriate for this academic project, the following is a minimal path-restricted rule allowing authenticated users to **read** device data (existing broader write rules should be restricted separately to prevent tampering):

```json
{
  "rules": {
    "edr": {
      "edr01": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

**Security caution:** The example above still allows any signed-in anonymous user to write data and is NOT secure for production. It is only compatible with an anonymous ESP32 writer without modifying firmware. For public deployment with sensitive or safety-critical data, use **device-specific Firebase Auth identity / secure backend and least-privilege rules**, plus proper authorization for the dashboard reader. Do NOT use `.read: true` or `.write: true` on a public database. Firebase web `apiKey` is a project identifier and not a secret, but a protected project still needs proper Auth and DB rules.

If you already have working read/write database rules, first test without changing them. Authentication read failures will appear in the banner and browser console.

## Deploy to Firebase Hosting (recommended)
Install Node.js, then in the project directory:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only hosting
```

This project includes `firebase.json` and `.firebaserc`. If your Firebase CLI setup does not have the project added yet, use `firebase use edr-light-ev` or `firebase use --add`. Firebase Hosting provides HTTPS automatically.

Alternatively, deploy `index.html`, `styles.css` and `app.js` to Netlify, Vercel static hosting, or Render Static Site. For those hosts, the configured Firebase Auth authorized domain must include your domain; otherwise sign-in may fail.

## Notes on interpretations of sensor values
- `gas` is a **raw 12-bit ADC value**, **not measured gas concentration in ppm**.
- `acc_g` is acceleration magnitude in units of gravity, **not individual gyro axes**. `gyro` only reports `MOVING`, `STILL` or `--`.
- ESP32 thresholds: 45°C, gas ADC ≥ 3000, voltage below 10.5 V (if at least 1.0 V), voltage above 14.8 V, acceleration ≥ 2.5 g, freefall ≤ 0.30 g. The ESP32 itself decides `state` after its persistence filters.
- **Important:** your firmware has `SIMULATE_IDLE_VOLTAGE = true`. If no voltage input is detected, it sends a small simulated value. The website displays the number it receives; disable simulated voltage in the Arduino firmware for real battery measurements.
- The dashboard uses `ts` for freshness; if an old record stays in the database the site correctly indicates offline/stale.
- Chart and Firebase libraries load from public CDNs, so Internet access is needed for them.
- This is a student prototype, **not a certified automotive safety system**.
