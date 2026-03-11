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
  return digits;
}

function isValidCpf(cpf) {
  const digits = String(cpf || "").replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const calcDigit = (base, factorStart) => {
    let sum = 0;
    for (let i = 0; i < base.length; i += 1) {
      sum += Number(base[i]) * (factorStart - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const first = calcDigit(digits.slice(0, 9), 10);
  const second = calcDigit(digits.slice(0, 10), 11);
  return first === Number(digits[9]) && second === Number(digits[10]);
}

function generateValidCpf() {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));

  const calcDigit = (arr, factorStart) => {
    let sum = 0;
    for (let i = 0; i < arr.length; i += 1) {
      sum += arr[i] * (factorStart - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  const d1 = calcDigit(base, 10);
  const d2 = calcDigit([...base, d1], 11);
  return [...base, d1, d2].join("");
}

function normalizePhone(phoneValue) {
  const digits = String(phoneValue || "").replace(/\D/g, "");
  if (digits.length === 11) return digits;
  if (digits.length === 10) return `${digits.slice(0, 2)}9${digits.slice(2)}`;
  return `11${String(Math.floor(900000000 + Math.random() * 99999999))}`;
}

function generateReference() {
  return `RESGATE-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function normalizeEmail(emailValue) {
  const email = String(emailValue || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  return `cliente${Date.now()}@email.com`;
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
    const amount = Number(body.amount_cents);
    const customer = body.customer || {};
    const productHash = String(body.product_hash || "").trim();
    const reference = String(body.reference || "").trim() || generateReference();

    if (!Number.isFinite(amount) || amount < 100) {
      return res.status(400).json({ error: "amount_cents must be at least 100" });
    }

    const incomingDocument = String(customer.document || "").replace(/\D/g, "");
    const cpf = isValidCpf(incomingDocument) ? incomingDocument : generateValidCpf();

    const payload = {
      amount,
      description: String(body.description || "Pagamento PIX").trim() || "Pagamento PIX",
      reference,
      source: "api_externa",
      customer: {
        name: customer.name || "Cliente",
        email: normalizeEmail(customer.email),
        phone: normalizePhone(customer.phone),
        document: normalizeDocument(cpf),
      },
    };

    if (productHash) {
      payload.productHash = productHash;
    }

    if (body.postback_url) {
      payload.postback_url = String(body.postback_url);
    }

    if (body.orderbump) {
      payload.orderbump = body.orderbump;
    }

    if (body.tracking && typeof body.tracking === "object") {
      payload.tracking = body.tracking;
    }

    if (Array.isArray(body.splits) && body.splits.length > 0) {
      payload.splits = body.splits;
    }

    const response = await fetch("https://multi.paradisepags.com/api/v1/transaction.php", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
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
        error: "Paradise create transaction failed",
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
      "pix_code",
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

    const status = String(
      pickFirst(data, ["status", "payment.status", "transaction.status"]) || ""
    ).toLowerCase();

    const expiresAt =
      pickFirst(data, ["expires_at", "pix.expires_at", "pix.expiresAt", "payment.pix.expiresAt"]) ||
      new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const refusedReason =
      pickFirst(data, ["refusedReason.description", "refused_reason.description", "message"]) ||
      "Transação recusada pelo gateway";

    const hasQrData = Boolean(qrCode || qrCodeBase64);
    const refusedStatuses = new Set(["refused", "failed", "canceled", "cancelled", "denied", "error"]);

    if (refusedStatuses.has(status) || !hasQrData) {
      return res.status(422).json({
        error: refusedReason,
        details: {
          status,
          transaction_id: transactionId,
          raw: data,
        },
      });
    }

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
