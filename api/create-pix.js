function getBasicAuthHeader() {
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

function findByKeysDeep(input, keys) {
  if (!input || typeof input !== "object") return undefined;
  const wanted = new Set(keys.map((k) => String(k).toLowerCase()));
  const stack = [input];

  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;

    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(String(key).toLowerCase()) && value !== undefined && value !== null && value !== "") {
        return value;
      }
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return undefined;
}

function collectStringsDeep(input, bucket = []) {
  if (typeof input === "string") {
    bucket.push(input);
    return bucket;
  }
  if (!input || typeof input !== "object") {
    return bucket;
  }
  if (Array.isArray(input)) {
    for (const item of input) collectStringsDeep(item, bucket);
    return bucket;
  }
  for (const value of Object.values(input)) {
    collectStringsDeep(value, bucket);
  }
  return bucket;
}

function normalizeBase64Image(value) {
  if (!value) return "";
  const str = String(value);
  if (str.startsWith("data:image")) return str;
  return `data:image/png;base64,${str}`;
}

function normalizeDocument(documentValue) {
  if (!documentValue) return undefined;
  const digits = String(documentValue).replace(/\D/g, "");
  if (!digits) return undefined;
  return {
    type: digits.length > 11 ? "CNPJ" : "CPF",
    number: digits,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = getBasicAuthHeader();
  if (!authHeader) {
    return res.status(500).json({ error: "GhostsPay credentials are not configured" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const amount = Number(body.amount_cents);
    const customer = body.customer || {};
    const productHash = body.product_hash || "prod_default";

    if (!Number.isFinite(amount) || amount < 100) {
      return res.status(400).json({ error: "amount_cents must be at least 100" });
    }

    const payload = {
      amount,
      paymentMethod: "PIX",
      customer: {
        name: customer.name || "Cliente",
        email: customer.email,
        phone: customer.phone,
        document: normalizeDocument(customer.document),
      },
      items: [
        {
          title: "Pagamento PIX",
          unitPrice: amount,
          quantity: 1,
          externalRef: productHash,
        },
      ],
      metadata: {
        product_hash: productHash,
      },
      pix: {
        expiresInDays: 1,
      },
    };

    const response = await fetch("https://api.ghostspaysv2.com/functions/v1/transactions", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
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
        error: "GhostsPay create transaction failed",
        details: data,
      });
    }

    let qrCode = pickFirst(data, [
      "qr_code",
      "pix.qr_code",
      "pix.qrCode",
      "payment.pix.qr_code",
      "payment.pix.qrCode",
      "pix.copyPaste",
      "copyPaste",
    ]) || "";

    if (!qrCode) {
      qrCode = findByKeysDeep(data, [
        "qrcode",
        "qrCode",
        "qr_code",
        "pixCode",
        "pix_code",
        "copyPaste",
        "copy_paste",
        "copiaecola",
        "copia_cola",
        "payload",
        "emv",
      ]) || "";
    }

    let qrCodeBase64 = pickFirst(data, [
      "qr_code_base64",
      "pix.qr_code_base64",
      "pix.qrCodeBase64",
      "payment.pix.qr_code_base64",
      "payment.pix.qrCodeBase64",
      "pix.qrImageBase64",
    ]) || "";

    if (!qrCodeBase64) {
      qrCodeBase64 = findByKeysDeep(data, [
        "qrcodeBase64",
        "qrCodeBase64",
        "qr_code_base64",
        "pixBase64",
        "pix_base64",
        "qrImageBase64",
        "imageBase64",
        "base64",
      ]) || "";
    }

    if (!qrCode || !qrCodeBase64) {
      const allStrings = collectStringsDeep(data);
      if (!qrCode) {
        const emvCandidate = allStrings.find((s) => /^000201\d{20,}/.test(s.trim()));
        if (emvCandidate) qrCode = emvCandidate.trim();
      }
      if (!qrCodeBase64) {
        const base64Candidate = allStrings.find((s) => /^[A-Za-z0-9+/=]{120,}$/.test(s));
        if (base64Candidate) qrCodeBase64 = base64Candidate;
      }
    }

    if (qrCodeBase64) {
      qrCodeBase64 = normalizeBase64Image(qrCodeBase64);
    }

    const transactionId = String(
      pickFirst(data, ["transaction_id", "id", "transaction.id", "payment.id"]) || ""
    );

    const expiresAt =
      pickFirst(data, ["expires_at", "pix.expires_at", "pix.expiresAt", "payment.pix.expiresAt"]) ||
      new Date(Date.now() + 10 * 60 * 1000).toISOString();

    return res.status(200).json({
      transaction_id: transactionId,
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64,
      expires_at: expiresAt,
      raw: data,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Internal error while creating PIX",
      details: String(error && error.message ? error.message : error),
    });
  }
};
