const REPO = "tylerherman19/Boats";
const FILE = "settings.json";
const API = `https://api.github.com/repos/${REPO}/contents/${FILE}`;

async function ghGet() {
  const res = await fetch(API, {
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

async function ghPut(content, sha) {
  const body = {
    message: "Update SMS recipient",
    content: Buffer.from(JSON.stringify(content, null, 2) + "\n").toString("base64"),
    sha,
    branch: "main",
  };
  const res = await fetch(API, {
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
    throw new Error(`GitHub write failed: ${res.status} ${text}`);
  }
}

module.exports = async (req, res) => {
  if (req.headers["x-site-secret"] !== process.env.SITE_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    if (req.method === "GET") {
      const { content } = await ghGet();
      return res.status(200).json(content);
    }

    if (req.method === "POST") {
      const { sms_to } = req.body || {};
      if (!sms_to) return res.status(400).json({ error: "sms_to required" });
      const { sha } = await ghGet();
      await ghPut({ sms_to }, sha);
      return res.status(200).json({ sms_to });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
