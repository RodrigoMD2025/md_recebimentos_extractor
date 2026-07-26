import asyncio
import logging
import os
from datetime import datetime

import aiohttp
import asyncpg
from playwright.async_api import async_playwright

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("log_contratos.log", encoding="utf-8"),
    ],
)

TELEGRAM_BOT_TOKEN = os.getenv("BOT_TOKEN")
CLIENT_EMAIL = os.getenv("CLIENT_EMAIL")
CLIENT_SENHA = os.getenv("CLIENT_SENHA")
DEFAULT_CHAT_ID = os.getenv("DEFAULT_CHAT_ID")
DATABASE_URL = os.getenv("DATABASE_URL")
GITHUB_RUN_ID = os.getenv("GITHUB_RUN_ID", "")
GITHUB_RUN_NUMBER = os.getenv("GITHUB_RUN_NUMBER", "") or GITHUB_RUN_ID

URL_LOGIN = "http://sistema.musicdelivery.com.br/login?login_error"
URL_CONTRATOS = "http://sistema.musicdelivery.com.br/contratos"

MAX_RETRIES = 3

ENSURE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS extracoes_contratos (
    id                  SERIAL          PRIMARY KEY,
    github_run_id       TEXT            NOT NULL DEFAULT '',
    github_run_number   TEXT            NOT NULL DEFAULT '',
    total_extraidos     INTEGER         NOT NULL DEFAULT 0,
    inserts             INTEGER         NOT NULL DEFAULT 0,
    updates             INTEGER         NOT NULL DEFAULT 0,
    pages               INTEGER         NOT NULL DEFAULT 1,
    status              TEXT            NOT NULL DEFAULT 'ok',
    mensagem            TEXT            NOT NULL DEFAULT '',
    duracao_segundos    INTEGER         NOT NULL DEFAULT 0,
    criado_em           TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
"""


def format_duration(seconds: float) -> str:
    total = max(0, int(seconds))
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


async def fazer_login(page):
    logging.info("[etapa] Login no sistema Music Delivery...")
    await page.goto(URL_LOGIN, wait_until="domcontentloaded", timeout=60000)
    await asyncio.sleep(3)

    await page.wait_for_selector('input[type="text"], input[type="email"]', timeout=15000)
    await page.locator('input[type="text"], input[type="email"]').first.fill(CLIENT_EMAIL)
    await asyncio.sleep(0.5)

    await page.wait_for_selector('input[type="password"]', timeout=5000)
    await page.locator('input[type="password"]').first.fill(CLIENT_SENHA)
    await asyncio.sleep(0.5)

    await page.locator('button[type="submit"], input[type="submit"]').first.click()
    await asyncio.sleep(5)

    if "login" in page.url.lower():
        logging.error("Login falhou")
        return False

    logging.info(f"Login OK -> {page.url}")
    return True


async def extrair_tabela_pagina(page):
    contratos = []
    try:
        await page.wait_for_selector("table.table-striped", timeout=15000)
        await asyncio.sleep(1)

        rows = page.locator("table.table-striped tbody tr.table-row")
        count = await rows.count()

        for i in range(count):
            try:
                cells = rows.nth(i).locator("td")
                if await cells.count() >= 7:
                    codigo = (await cells.nth(0).inner_text()).strip()
                    if codigo and codigo != "Código de Contrato":
                        contratos.append({
                            "codigo": codigo,
                            "contratante": (await cells.nth(1).inner_text()).strip(),
                            "alias_matriz": (await cells.nth(2).inner_text()).strip(),
                            "data_inicio": (await cells.nth(3).inner_text()).strip(),
                            "data_termino": (await cells.nth(4).inner_text()).strip(),
                            "forma_envio": (await cells.nth(5).inner_text()).strip(),
                            "status": (await cells.nth(6).inner_text()).strip(),
                        })
            except Exception:
                continue
    except Exception as e:
        logging.warning(f"Tabela não encontrada: {e}")

    return contratos


async def navegar_pagina(page, url):
    for tentativa in range(1, MAX_RETRIES + 1):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            await asyncio.sleep(2)
            return True
        except Exception as e:
            logging.warning(f"Falha tentativa {tentativa}/{MAX_RETRIES}: {e}")
            if tentativa < MAX_RETRIES:
                espera = 5 * tentativa
                await asyncio.sleep(espera)
    return False


async def salvar_neon(contratos):
    if not contratos:
        return 0, 0

    conn = await asyncpg.connect(DATABASE_URL)
    inserts = 0
    updates = 0

    try:
        for c in contratos:
            row = await conn.fetchrow(
                """
                INSERT INTO contratos (codigo, contratante, alias_matriz, data_inicio, data_termino, forma_envio, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (codigo) DO UPDATE SET
                    contratante = EXCLUDED.contratante,
                    alias_matriz = EXCLUDED.alias_matriz,
                    data_inicio = EXCLUDED.data_inicio,
                    data_termino = EXCLUDED.data_termino,
                    forma_envio = EXCLUDED.forma_envio,
                    status = EXCLUDED.status
                RETURNING (xmax = 0) AS is_inserted
                """,
                c["codigo"],
                c["contratante"],
                c["alias_matriz"],
                c["data_inicio"],
                c["data_termino"],
                c["forma_envio"],
                c["status"],
            )
            if row and row["is_inserted"]:
                inserts += 1
            else:
                updates += 1
    finally:
        await conn.close()

    return inserts, updates


async def salvar_relatorio_extracao(
    *,
    total_extraidos,
    inserts,
    updates,
    pages,
    status,
    mensagem,
    duracao_segundos,
):
    """Persiste o resumo da execução para o dashboard consultar via API."""
    if not DATABASE_URL:
        logging.warning("DATABASE_URL ausente — relatório não será salvo no banco.")
        return

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(ENSURE_TABLE_SQL)
        await conn.execute(
            """
            INSERT INTO extracoes_contratos (
                github_run_id, github_run_number, total_extraidos,
                inserts, updates, pages, status, mensagem, duracao_segundos
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """,
            str(GITHUB_RUN_ID or ""),
            str(GITHUB_RUN_NUMBER or ""),
            int(total_extraidos),
            int(inserts),
            int(updates),
            int(pages),
            status,
            mensagem,
            int(duracao_segundos),
        )
        logging.info(
            f"Relatório salvo no Neon: inserts={inserts} updates={updates} "
            f"run_number={GITHUB_RUN_NUMBER}"
        )
    finally:
        await conn.close()


async def enviar_telegram(texto):
    if not TELEGRAM_BOT_TOKEN or not DEFAULT_CHAT_ID:
        logging.info("Telegram não configurado, ignorando notificação.")
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": DEFAULT_CHAT_ID,
        "text": texto,
        "parse_mode": "HTML",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status == 200:
                    logging.info("Relatório enviado ao Telegram.")
                else:
                    logging.warning(f"Falha ao enviar Telegram: {resp.status}")
    except Exception as e:
        logging.warning(f"Erro ao enviar Telegram: {e}")


async def main():
    inicio = datetime.now()
    logging.info("=== EXTRATORES DE CONTRATOS MD ===")
    logging.info(f"GitHub run_id={GITHUB_RUN_ID or '-'} run_number={GITHUB_RUN_NUMBER or '-'}")

    if not all([CLIENT_EMAIL, CLIENT_SENHA, DATABASE_URL]):
        logging.error("Variáveis CLIENT_EMAIL, CLIENT_SENHA e DATABASE_URL são obrigatórias.")
        return

    inserts_total = 0
    updates_total = 0
    total_extraidos = 0
    pages = 0
    status = "ok"
    mensagem = ""

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
            )
            page = await context.new_page()
            page.set_default_timeout(30000)

            if not await fazer_login(page):
                status = "error"
                mensagem = "Falha no login do sistema Music Delivery"
                await browser.close()
                raise RuntimeError(mensagem)

            logging.info("[etapa] Navegando para página de contratos...")
            if not await navegar_pagina(page, URL_CONTRATOS):
                status = "error"
                mensagem = "Não foi possível acessar a página de contratos"
                await browser.close()
                raise RuntimeError(mensagem)

            logging.info("[etapa] Extraindo primeira página da tabela...")
            contratos = await extrair_tabela_pagina(page)
            pages = 1
            total_extraidos = len(contratos)
            logging.info(f"  Encontrados: {total_extraidos} contratos")

            if contratos:
                logging.info("[etapa] Salvando no Neon (UPSERT)...")
                inserts_total, updates_total = await salvar_neon(contratos)
                logging.info(f"  >> Neon: +{inserts_total} inserts, +{updates_total} updates")
                if inserts_total > 0:
                    mensagem = f"{inserts_total} contrato(s) novo(s) e {updates_total} atualizado(s)"
                elif updates_total > 0:
                    mensagem = f"Nenhum contrato novo — {updates_total} registro(s) já existentes revalidados"
                else:
                    mensagem = "Nenhum registro processado"
            else:
                status = "warning"
                mensagem = "Nenhum contrato encontrado na primeira página"
                logging.warning(mensagem)

            await browser.close()

    except Exception as e:
        status = "error"
        mensagem = str(e)
        logging.error(f"Erro na extração: {e}")

    duracao = (datetime.now() - inicio).total_seconds()
    duracao_txt = format_duration(duracao)

    try:
        await salvar_relatorio_extracao(
            total_extraidos=total_extraidos,
            inserts=inserts_total,
            updates=updates_total,
            pages=pages or 1,
            status=status,
            mensagem=mensagem,
            duracao_segundos=int(duracao),
        )
    except Exception as e:
        logging.error(f"Falha ao salvar relatório da extração: {e}")

    now = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    relatorio = (
        f"📋 <b>Extração de Contratos - {'Concluída' if status == 'ok' else status.upper()}</b>\n\n"
        f"🕐 <b>Data:</b> {now}\n"
        f"⏱️ <b>Duração:</b> {duracao_txt}\n"
        f"🔢 <b>Run:</b> #{GITHUB_RUN_NUMBER or '-'}\n"
        f"📄 <b>Páginas processadas:</b> {pages or 1}\n"
        f"📦 <b>Extraídos:</b> {total_extraidos}\n"
        f"📥 <b>Novos inserts:</b> {inserts_total}\n"
        f"🔄 <b>Updates:</b> {updates_total}\n"
        f"📝 <b>Resumo:</b> {mensagem or '-'}"
    )

    await enviar_telegram(relatorio)
    logging.info(
        f"=== FIM status={status} duração={duracao_txt} "
        f"inserts={inserts_total} updates={updates_total} ==="
    )

    if status == "error":
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
