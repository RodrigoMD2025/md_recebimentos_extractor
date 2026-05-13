const admin = require("firebase-admin");

/**
 * Inicializa o Firebase Admin SDK uma única vez.
 * Lê as credenciais a partir da variável de ambiente FIREBASE_SERVICE_ACCOUNT,
 * que deve conter o JSON do service account serializado como string.
 */
function initFirebase() {
  if (admin.apps.length > 0) {
    return; // já inicializado
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error(
      "Variável de ambiente FIREBASE_SERVICE_ACCOUNT não definida. " +
        "Configure o JSON do service account do Firebase."
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    throw new Error(
      "Falha ao fazer parse de FIREBASE_SERVICE_ACCOUNT: JSON inválido. " +
        err.message
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

/**
 * Verifica o Bearer token JWT do Firebase presente no header Authorization.
 *
 * @param {import("http").IncomingMessage} req - Objeto de requisição Node/Vercel
 * @returns {Promise<import("firebase-admin/auth").DecodedIdToken>} - Token decodificado
 * @throws {Error} Se o header estiver ausente, mal formatado ou o token for inválido
 */
async function verifyToken(req) {
  initFirebase();

  const authHeader = req.headers["authorization"] || req.headers["Authorization"];

  if (!authHeader) {
    const err = new Error("Header Authorization ausente.");
    err.statusCode = 401;
    throw err;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    const err = new Error(
      "Formato de Authorization inválido. Use: Bearer <token>"
    );
    err.statusCode = 401;
    throw err;
  }

  const token = parts[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded;
  } catch (firebaseErr) {
    const err = new Error(
      `Token Firebase inválido ou expirado: ${firebaseErr.message}`
    );
    err.statusCode = 401;
    throw err;
  }
}

/**
 * Define os headers CORS na resposta.
 * Usa a env ALLOWED_ORIGIN se definida; caso contrário, permite qualquer origem ("*").
 *
 * @param {import("http").ServerResponse} res             - Objeto de resposta Node/Vercel
 * @param {string}                        [allowedOrigin] - Override pontual da origin permitida
 * @param {string}                        [methods]       - Métodos HTTP permitidos
 */
function cors(res, allowedOrigin, methods = "GET, OPTIONS") {
  const origin = allowedOrigin || process.env.ALLOWED_ORIGIN || "*";

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
  res.setHeader("Access-Control-Max-Age", "86400"); // cache preflight por 24h
}

module.exports = { verifyToken, cors };
