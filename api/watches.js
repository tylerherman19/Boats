const REPO = "tylerherman19/Boats";
const FILE = "watches.json";
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

async function ghPut(content, sha, message) {
  const body = {
    message,
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
    const err = new Error(`GitHub write failed: ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
}

async function mutate(mutateFn, message) {
  const { content, sha } = await ghGet();
  const next = mutateFn(content);
  try {
    await ghPut(next, sha, message);
  } catch (e) {
    if (e.status === 409) {
      const retry = await ghGet();
      const retryNext = mutateFn(retry.content);
      await ghPut(retryNext, retry.sha, message);
    } else {
      throw e;
    }
  }
}

function lakesOf(w) {
  return w.lakes || (w.lake ? [w.lake] : []);
}

module.exports = async (req, res) => {
  if (req.headers["x-site-secret"] !== process.env.SITE_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    if (req.method === "GET") {
      const { content } = await ghGet();
      return res.status(200).json({ content });
    }

    if (req.method === "POST") {
      const { action, watch } = req.body || {};

      if (action === "add") {
        await mutate(
          (c) => { c.push(watch); return c; },
          `Add watch: ${lakesOf(watch).join(", ")} ${watch.date}`
        );
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

      const { content } = await ghGet();
      return res.status(200).json({ content });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
