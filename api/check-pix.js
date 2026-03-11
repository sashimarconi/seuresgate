const GHOSTSPAY_API_BASE_URL = process.env.GHOSTSPAY_API_BASE_URL || "https://api.ghostspaysv2.com/functions/v1";

function getBasicAuthHeader() {
  const directBasic = String(process.env.GHOSTSPAY_BASIC_AUTH || "").trim();
  if (directBasic) {
    return directBasic.startsWith("Basic ") ? directBasic : `Basic ${directBasic}`;
  }

  const secretKey = process.env.GHOSTSPAY_SECRET_KEY;
  const companyId = process.env.GHOSTSPAY_COMPANY_ID;

  if (!secretKey || !companyId) {
    return null;
  }

  const credentials = Buffer.from(`${secretKey}:${companyId}`).toString("base64");
  return `Basic ${credentials}`;
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

  const authHeader = getBasicAuthHeader();
  if (!authHeader) {
    return res.status(500).json({
      error: "GhostsPay credentials are not configured",
      details: "Configure GHOSTSPAY_BASIC_AUTH or both GHOSTSPAY_SECRET_KEY and GHOSTSPAY_COMPANY_ID",
    });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const transactionId = String(body.transaction_id || "").trim();

    if (!transactionId) {
      return res.status(400).json({ error: "transaction_id is required" });
    }

    const response = await fetch(`${GHOSTSPAY_API_BASE_URL}/transactions/${encodeURIComponent(transactionId)}`, {
      method: "GET",
      headers: {
        Authorization: authHeader,
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
        error: "GhostsPay check transaction failed",
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
