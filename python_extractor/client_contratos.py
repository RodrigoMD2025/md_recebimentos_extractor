import asyncio
import json
import logging
import os
import uuid
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
GITHUB_RUN_ID = os.getenv("GITHUB_RUN_ID")

URL_LOGIN = "http://sistema.musicdelivery.com.br/login?login_error"
URL_CONTRATOS = "http://sistema.musicdelivery.com.br/contratos"

MAX_RETRIES = 3
MAX_FALHAS = 5
SALVAR_A_CADA = 10


async def fazer_login(page):
    logging.info("Acessando página de login...")
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


async def obter_total_paginas(page):
    try:
        pagination = page.locator("ul.pagination")
        if await pagination.count() == 0:
            return 1

        links = pagination.locator("li a")
        max_page = 1

        for i in range(await links.count()):
            try:
                text = (await links.nth(i).inner_text()).strip()
                href = await links.nth(i).get_attribute("href") or ""

                if text.isdigit():
                    num = int(text)
                    if num > max_page:
                        max_page = num

                if "Última" in text or "Ultima" in text or "→" in text:
                    if href:
                        parts = href.rstrip("/").split("/")
                        last_part = parts[-1] if parts else "0"
                        if last_part.isdigit():
                            page_num = (int(last_part) // 30) + 1
                            if page_num > max_page:
                                max_page = page_num
            except Exception:
                continue

        logging.info(f"Total de páginas: {max_page}")
        return max_page
    except Exception:
        return 1


async def salvar_neon(contratos):
    if not contratos:
        return 0, 0

    conn = await asyncpg.connect(DATABASE_URL)
    inserts = 0
    updates = 0

    try:
        for c in contratos:
            result = await conn.execute("""
                INSERT INTO contratos (codigo, contratante, alias_matriz, data_inicio, data_termino, forma_envio, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (codigo) DO UPDATE SET
                    contratante = EXCLUDED.contratante,
                    alias_matriz = EXCLUDED.alias_matriz,
                    data_inicio = EXCLUDED.data_inicio,
                    data_termino = EXCLUDED.data_termino,
                    forma_envio = EXCLUDED.forma_envio,
                    status = EXCLUDED.status
            """,
                c["codigo"],
                c["contratante"],
                c["alias_matriz"],
                c["data_inicio"],
                c["data_termino"],
                c["forma_envio"],
                c["status"],
            )
            if result.startswith("INSERT"):
                inserts += 1
            else:
                updates += 1
    finally:
        await conn.close()

    return inserts, updates


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
    logging.info("=== EXTRATORES DE CONTRATOS MD ===")

    if not all([CLIENT_EMAIL, CLIENT_SENHA, DATABASE_URL]):
        logging.error("Variáveis CLIENT_EMAIL, CLIENT_SENHA e DATABASE_URL são obrigatórias.")
        return

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
            await browser.close()
            return

        logging.info("Navegando para contratos...")
        if not await navegar_pagina(page, URL_CONTRATOS):
            logging.error("Não foi possível acessar contratos")
            await browser.close()
            return

        total_paginas = await obter_total_paginas(page)

        todos_contratos = []
        inserts_total = 0
        updates_total = 0
        falhas_consecutivas = 0

        for pagina in range(1, total_paginas + 1):
            if falhas_consecutivas >= MAX_FALHAS:
                logging.error(f"{MAX_FALHAS} falhas seguidas. Parando.")
                break

            offset = (pagina - 1) * 30
            url = f"{URL_CONTRATOS}/{offset}"

            logging.info(f"Página {pagina}/{total_paginas} (offset={offset})...")

            if await navegar_pagina(page, url):
                novos = await extrair_tabela_pagina(page)
                if novos:
                    todos_contratos.extend(novos)
                    falhas_consecutivas = 0
                    logging.info(f"  OK: {len(novos)} | Total: {len(todos_contratos)}")
                else:
                    logging.warning("  Página vazia")
                    falhas_consecutivas += 1
            else:
                falhas_consecutivas += 1
                logging.error(f"  FALHA página {pagina}")

            # Salvamento periódico no Neon
            if pagina % SALVAR_A_CADA == 0 and todos_contratos:
                ins, ups = await salvar_neon(todos_contratos)
                inserts_total += ins
                updates_total += ups
                logging.info(f"  >> Neon: +{ins} inserts, +{ups} updates")
                todos_contratos = []

            await asyncio.sleep(2)

        # Salvar restante
        if todos_contratos:
            ins, ups = await salvar_neon(todos_contratos)
            inserts_total += ins
            updates_total += ups

        # Relatório final
        now = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        relatorio = (
            f"📋 <b>Extração de Contratos - Concluída</b>\n\n"
            f"🕐 <b>Data:</b> {now}\n"
            f"📄 <b>Páginas processadas:</b> {total_paginas}\n"
            f"📥 <b>Novos inserts:</b> {inserts_total}\n"
            f"🔄 <b>Updates:</b> {updates_total}\n"
            f"✅ <b>Total:</b> {inserts_total + updates_total} contratos processados"
        )

        await enviar_telegram(relatorio)
        logging.info(f"=== FIM: {inserts_total} inserts, {updates_total} updates ===")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
