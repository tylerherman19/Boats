const REPO = "tylerherman19/Boats";
const WATCHES_API = `https://api.github.com/repos/${REPO}/contents/watches.json`;
const DISPATCH_API = `https://api.github.com/repos/${REPO}/actions/workflows/watch.yml/dispatches`;

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
    return next;
  } catch (e) {
    if (e.status === 409) {
      const retry = await ghGet(WATCHES_API);
      const retryNext = mutateFn(retry.content);
      await ghPut(WATCHES_API, retryNext, retry.sha, message);
      return retryNext;
    } else {
      throw e;
    }
  }
}

function lakesOf(w) {
  return w.lakes || (w.lake ? [w.lake] : []);
}

function boatTypesOf(w) {
  return w.boat_types || (w.boat_type ? [w.boat_type] : []);
}

async function triggerCheck(newWatch) {
  await fetch(DISPATCH_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { new_watch: newWatch ? JSON.stringify(newWatch) : "" },
    }),
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
        const content = await mutate(
          (c) => { c.push(watch); return c; },
          `Add watch: ${lakesOf(watch).join(", ")} ${watch.date}`
        );
        try {
          await triggerCheck(watch);
        } catch (e) {
          console.error("trigger check failed:", e.message);
        }
        return res.status(200).json({ content });
      }

      if (action === "remove") {
        const content = await mutate(
          (c) => c.filter((w) => {
            const wLakes = JSON.stringify(lakesOf(w));
            const tLakes = JSON.stringify(lakesOf(watch));
            const wTypes = JSON.stringify(boatTypesOf(w));
            const tTypes = JSON.stringify(boatTypesOf(watch));
            return !(wLakes === tLakes && w.date === watch.date && wTypes === tTypes);
          }),
          `Remove watch: ${watch.date}`
        );
        return res.status(200).json({ content });
      }

      return res.status(400).json({ error: "invalid action" });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
