function getParadiseApiKey() {
  return (
    process.env.PARADISE_SECRET_KEY ||
    process.env.PARADISE_API_KEY ||
    process.env.X_API_KEY ||
    ""
  ).trim();
}

function pickFirst(obj, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = getParadiseApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: "Paradise API key is not configured" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const transactionId = String(body.transaction_id || "").trim();

    if (!transactionId) {
      return res.status(400).json({ error: "transaction_id is required" });
    }

    const response = await fetch(`https://multi.paradisepags.com/api/v1/query.php?action=get_transaction&id=${encodeURIComponent(transactionId)}`, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Paradise check transaction failed",
        details: data,
      });
    }

    const rawStatus = pickFirst(data, [
      "status",
      "payment.status",
      "paymentStatus",
      "transaction.status",
      "data.status",
    ]);

    const status = String(rawStatus || "").toLowerCase();

    return res.status(200).json({
      status,
      transaction_id: String(pickFirst(data, ["transaction_id", "id", "transaction.id"]) || transactionId),
      raw: data,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Internal error while checking PIX",
      details: String(error && error.message ? error.message : error),
    });
  }
};
