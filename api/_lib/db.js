const { Pool } = require("pg");

/** @type {Pool|null} */
let pool = null;

/**
 * Retorna o singleton do Pool de conexão com o banco.
 * Cria o pool na primeira chamada usando DATABASE_URL do ambiente.
 *
 * @returns {Pool}
 */
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "Variável de ambiente DATABASE_URL não definida. Configure a connection string do Neon PostgreSQL."
      );
    }

    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      // Limites conservadores para funções serverless (Vercel)
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      console.error("[db] Erro inesperado no cliente ocioso do pool:", err);
    });
  }

  return pool;
}

/**
 * Executa uma query parametrizada no pool de conexão.
 *
 * @param {string} text   - SQL com placeholders $1, $2, ...
 * @param {any[]}  params - Valores para os placeholders
 * @returns {Promise<import("pg").QueryResult>}
 */
async function query(text, params) {
  const client = getPool();
  return client.query(text, params);
}

module.exports = { getPool, query };
