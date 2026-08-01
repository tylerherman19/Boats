const nodemailer = require("nodemailer");

const REPO = "tylerherman19/Boats";
const WATCHES_API = `https://api.github.com/repos/${REPO}/contents/watches.json`;
const SETTINGS_API = `https://api.github.com/repos/${REPO}/contents/settings.json`;

async function ghGet(api) {
  const res = await fetch(api, {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);
  const data = await res.json();
  const content = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
  return { content, sha: data.sha };
}

async function ghPut(api, content, sha, message) {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(content, null, 2) + "\n").toString("base64"),
    sha,
    branch: "main",
  };
  const res = await fetch(api, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`GitHub write failed: ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
}

async function mutate(mutateFn, message) {
  const { content, sha } = await ghGet(WATCHES_API);
  const next = mutateFn(content);
  try {
    await ghPut(WATCHES_API, next, sha, message);
  } catch (e) {
    if (e.status === 409) {
      const retry = await ghGet(WATCHES_API);
      const retryNext = mutateFn(retry.content);
      await ghPut(WATCHES_API, retryNext, retry.sha, message);
    } else {
      throw e;
    }
  }
}

function lakesOf(w) {
  return w.lakes || (w.lake ? [w.lake] : []);
}

async function sendText(subject, body) {
  const { content: settings } = await ghGet(SETTINGS_API);
  const smsTo = settings.sms_to;
  if (!smsTo) return;

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.GMAIL_ADDRESS,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.GMAIL_ADDRESS,
    to: smsTo,
    subject,
    text: body,
  });
}

module.exports = async (req, res) => {
  if (req.headers["x-site-secret"] !== process.env.SITE_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    if (req.method === "GET") {
      const { content } = await ghGet(WATCHES_API);
      return res.status(200).json({ content });
    }

    if (req.method === "POST") {
      const { action, watch } = req.body || {};

      if (action === "add") {
        await mutate(
          (c) => { c.push(watch); return c; },
          `Add watch: ${lakesOf(watch).join(", ")} ${watch.date}`
        );
        try {
          await sendText(
            "Boat Watch set",
            `Watch set: ${lakesOf(watch).join(", ")} on ${watch.date}${watch.boat_type ? ` (${watch.boat_type})` : ""}. I'll text you if anything opens up.`
          );
        } catch (e) {
          console.error("confirmation text failed:", e.message);
        }
      } else if (action === "remove") {
        await mutate(
          (c) => c.filter((w) => {
            const wLakes = JSON.stringify(lakesOf(w));
            const tLakes = JSON.stringify(lakesOf(watch));
            return !(wLakes === tLakes && w.date === watch.date && w.boat_type === watch.boat_type);
          }),
          `Remove watch: ${watch.date}`
        );
      } else {
        return res.status(400).json({ error: "invalid action" });
      }

      const { content } = await ghGet(WATCHES_API);
      return res.status(200).json({ content });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
