import argparse
import asyncio
import json
import logging
import os
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import aiohttp
import asyncpg
import pandas as pd
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright
from tqdm import tqdm

parser = argparse.ArgumentParser()
parser.add_argument("--ano", type=str, default="2025", help="Ano do relatório")
args = parser.parse_args()
ANO_RELATORIO = args.ano

# Configuração do log para GitHub Actions
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(),  # Para GitHub Actions logs
        logging.FileHandler("log_recebimentos.log", encoding="utf-8"),
    ],
)

# Configurações usando variáveis de ambiente
TELEGRAM_BOT_TOKEN = os.getenv("BOT_TOKEN")
CLIENT_EMAIL = os.getenv("CLIENT_EMAIL")
CLIENT_SENHA = os.getenv("CLIENT_SENHA")
DEFAULT_CHAT_ID = os.getenv("DEFAULT_CHAT_ID")
DATABASE_URL = os.getenv("DATABASE_URL")
GITHUB_RUN_ID = os.getenv("GITHUB_RUN_ID")

# URLs do sistema
URL_LOGIN = "http://sistema.musicdelivery.com.br/login?login_error"
URL_RECEBIMENTOS = (
    "http://sistema.musicdelivery.com.br/financeiro/royalties/recebimentos"
)


async def navegar_pelos_meses(page, meses, nomes_meses):
    """Navega por todos os meses para carregar os dados no sistema."""
    logging.info("Navegando pelos meses para carregar dados no sistema...")

    for mes, nome_mes in zip(meses[:-1], nomes_meses[:-1]):
        try:
            await page.click(f'xpath=//a[@data-mes="{mes}"]')
            await page.wait_for_timeout(500)
            logging.info(f"✅ Carregado dados de {nome_mes}")
        except Exception as e:
            logging.warning(f"⚠️ Erro ao carregar {nome_mes}: {e}")


async def extrair_dados_dezembro_completos(page):
    """Extrai os dados completos do ano após navegar por todos os meses."""
    logging.info("Extraindo dados completos do dezembro (acumulado do ano)...")

    try:
        # Clica em dezembro - contém todos os dados acumulados
        await page.click('xpath=//a[@data-mes="12"]')
        await page.wait_for_timeout(2000)

        rows = await page.locator(
            'xpath=//table[@class="table table-striped"]/tbody/tr'
        ).all()

        data = []
        logging.info(f"Processando {len(rows)} linhas da tabela...")

        for i, row in enumerate(rows):
            try:
                contratante = await row.locator("xpath=td[1]").text_content()
                codigo_contrato = await row.locator("xpath=td[2]").text_content()
                vencimento = await row.locator("xpath=td[3]").text_content()
                valor_parcela = await row.locator("xpath=td[4]").text_content()
                status = await row.locator("xpath=td[5]").text_content()
                pago_em = await row.locator("xpath=td[6]").text_content()

                detalhes_locator = row.locator(
                    'xpath=td[6]//a[contains(text(), "Detalhes")]'
                )
                detalhes_link = (
                    await detalhes_locator.get_attribute("href")
                    if await detalhes_locator.count() > 0
                    else None
                )

                data.append(
                    {
                        "Contratante": contratante.strip() if contratante else "",
                        "Código de Contrato": codigo_contrato.strip()
                        if codigo_contrato
                        else "",
                        "Vencimento": vencimento.strip() if vencimento else "",
                        "Valor Parcela": valor_parcela.strip() if valor_parcela else "",
                        "Status": status.strip() if status else "",
                        "Pago Em": pago_em.strip() if pago_em else "",
                        "Link Detalhes": detalhes_link,
                    }
                )

                if (i + 1) % 100 == 0:
                    logging.info(f"Processadas {i + 1}/{len(rows)} linhas...")

            except Exception as e:
                logging.warning(f"Erro ao processar linha {i + 1}: {e}")
                continue

        logging.info(f"✅ Extração concluída: {len(data)} registros coletados")
        return data

    except Exception as e:
        logging.error(f"Erro na extração da tabela: {e}")
        return []


async def extrair_detalhes_playlist(page, link, tentativa=1, max_tentativas=3):
    """Extrai informações sobre playlists e faixas de um link de detalhes."""
    timeouts = [60000, 90000, 120000]

    for i in range(tentativa - 1, max_tentativas):
        try:
            timeout_atual = timeouts[i]
            await page.goto(link, timeout=timeout_atual)
            html_content = await page.content()
            soup = BeautifulSoup(html_content, "html.parser")

            # Verifica se há playlists
            try:
                playlists = soup.select("div.col-lg-12.mb-xs-3 ul li a")
                periodo_element = soup.select_one("div.col-lg-12.mb-xs-3 h5")

                if playlists and periodo_element:
                    playlist_nomes = [p.text.strip() for p in playlists]
                    periodo_texto = periodo_element.text
                    periodo = (
                        periodo_texto.split("de")[-1].strip()
                        if "de" in periodo_texto
                        else "Sem dados"
                    )

                    tabelas = soup.select("table.table-striped")
                    quantidade_musicas = "0"
                    if len(tabelas) > 1:
                        faixas_td = tabelas[1].select_one("tbody tr td:nth-of-type(2)")
                        if faixas_td:
                            quantidade_musicas = faixas_td.text.strip()

                    return (
                        "Com Playlist",
                        ", ".join(playlist_nomes),
                        periodo,
                        quantidade_musicas,
                        True,
                    )
            except Exception:
                pass

            # Verifica se não há playlists
            try:
                mensagem_vazia = soup.select_one("table.table-striped td[colspan='6']")
                if (
                    mensagem_vazia
                    and "Nenhuma playlist relacionada" in mensagem_vazia.text
                ):
                    return "Sem Playlist", "N/A", "N/A", "0", True
            except Exception:
                pass

            return (
                "Status Desconhecido",
                "Erro na extração",
                "Erro na extração",
                "Erro",
                True,
            )

        except Exception as e:
            if i < max_tentativas - 1:
                await asyncio.sleep(2)
                continue
            else:
                return (
                    "Erro de Acesso",
                    "Erro de Acesso",
                    "Erro de Acesso",
                    "Erro",
                    False,
                )


async def processar_links_com_retry(page, df):
    """Processa links com sistema de retry."""
    logging.info("Iniciando processamento de links com detalhes...")

    # Inicializa colunas
    df["Status Playlist"] = ""
    df["Playlists"] = ""
    df["Período"] = ""
    df["Faixas"] = ""

    # Contadores
    links_processados_sucesso = 0
    links_com_erro = 0
    links_sem_detalhes = len(df[df["Link Detalhes"].isna()])

    df_com_links = df[df["Link Detalhes"].notna()]
    logging.info(f"📋 {len(df_com_links)} registros com links para processar")
    logging.info(f"📋 {links_sem_detalhes} registros sem links")

    # Primeira passada
    links_falharam = []

    for idx in df_com_links.index:
        link = df.at[idx, "Link Detalhes"]
        try:
            (
                status,
                playlist,
                periodo,
                faixas,
                sucesso,
            ) = await extrair_detalhes_playlist(page, link, 1, 1)
            df.at[idx, "Status Playlist"] = status
            df.at[idx, "Playlists"] = playlist
            df.at[idx, "Período"] = periodo
            df.at[idx, "Faixas"] = faixas

            if sucesso and not status.startswith("Erro"):
                links_processados_sucesso += 1
            else:
                links_falharam.append(idx)
                links_com_erro += 1

        except Exception as e:
            df.at[idx, "Status Playlist"] = "Erro de Processamento"
            links_falharam.append(idx)
            links_com_erro += 1

        # Log de progresso
        if (links_processados_sucesso + links_com_erro) % 50 == 0:
            logging.info(
                f"Processados {links_processados_sucesso + links_com_erro}/{len(df_com_links)} links..."
            )

    # Retry para links que falharam
    if links_falharam:
        logging.info(f"🔄 Iniciando retry para {len(links_falharam)} links...")
        links_retry_sucesso = 0

        for idx in links_falharam:
            link = df.at[idx, "Link Detalhes"]
            try:
                (
                    status,
                    playlist,
                    periodo,
                    faixas,
                    sucesso,
                ) = await extrair_detalhes_playlist(page, link, 2, 3)

                if sucesso and not status.startswith("Erro"):
                    df.at[idx, "Status Playlist"] = status
                    df.at[idx, "Playlists"] = playlist
                    df.at[idx, "Período"] = periodo
                    df.at[idx, "Faixas"] = faixas
                    links_retry_sucesso += 1
                    links_processados_sucesso += 1
                    links_com_erro -= 1

            except Exception as e:
                continue

        logging.info(f"✅ Retry bem-sucedido para {links_retry_sucesso} links")

    return links_processados_sucesso, links_com_erro, links_sem_detalhes


async def salvar_no_neon(df, execucao_id):
    """Salva os dados no banco Neon via asyncpg com UPSERT.

    Usa ON CONFLICT (ano, codigo_contrato, vencimento) para atualizar registros
    existentes sem gerar duplicatas. Retorna a contagem de inseridos e atualizados.
    """
    if not DATABASE_URL:
        logging.error("❌ DATABASE_URL não configurada – pulando salvamento no Neon")
        return 0, 0

    logging.info(f"💾 Conectando ao Neon para salvar {len(df)} registros...")

    conn = await asyncpg.connect(DATABASE_URL, ssl="require")
    inseridos = 0
    atualizados = 0

    # Replace NaN/NaT with None so asyncpg handles NULLs correctly
    df = df.where(pd.notnull(df), None)

    try:
        sql = """
            INSERT INTO recebimentos (
                ano, contratante, codigo_contrato, vencimento, valor_parcela,
                status_pagamento, pago_em, link_detalhes, status_playlist,
                playlists, periodo, faixas, execucao_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (ano, codigo_contrato, vencimento) DO UPDATE SET
                contratante      = EXCLUDED.contratante,
                valor_parcela    = EXCLUDED.valor_parcela,
                status_pagamento = EXCLUDED.status_pagamento,
                pago_em          = EXCLUDED.pago_em,
                link_detalhes    = EXCLUDED.link_detalhes,
                status_playlist  = EXCLUDED.status_playlist,
                playlists        = EXCLUDED.playlists,
                periodo          = EXCLUDED.periodo,
                faixas           = EXCLUDED.faixas,
                execucao_id      = EXCLUDED.execucao_id
            RETURNING (xmax = 0) AS is_inserted
        """

        for i, (_, row) in enumerate(df.iterrows()):
            result = await conn.fetchrow(
                sql,
                ANO_RELATORIO,
                str(row.get("Contratante") or ""),
                str(row.get("Código de Contrato") or ""),
                str(row.get("Vencimento") or ""),
                str(row.get("Valor Parcela") or ""),
                str(row.get("Status") or ""),
                str(row.get("Pago Em") or ""),
                row.get("Link Detalhes"),  # is None when missing
                str(row.get("Status Playlist") or ""),
                str(row.get("Playlists") or ""),
                str(row.get("Período") or ""),
                str(row.get("Faixas") or ""),
                execucao_id,
            )

            if result and result["is_inserted"]:
                inseridos += 1
            else:
                atualizados += 1

            if (i + 1) % 50 == 0:
                logging.info(
                    f"💾 Salvos {i + 1}/{len(df)} registros no Neon... "
                    f"({inseridos} novos, {atualizados} atualizados)"
                )

        logging.info(
            f"✅ Neon concluído: {inseridos} inseridos, {atualizados} atualizados "
            f"| execucao_id={execucao_id}"
        )
        return inseridos, atualizados

    except Exception as e:
        logging.error(f"❌ Erro ao salvar no Neon: {e}")
        raise

    finally:
        await conn.close()


async def enviar_mensagem_telegram(mensagem, chat_id):
    """Envia mensagem para o Telegram."""
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    data = {"chat_id": chat_id, "text": mensagem, "parse_mode": "HTML"}

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, data=data) as response:
                if response.status == 200:
                    logging.info("✅ Mensagem enviada para o Telegram")
                    return True
                else:
                    logging.error(f"❌ Erro ao enviar mensagem: {response.status}")
                    return False
    except Exception as e:
        logging.error(f"❌ Erro ao conectar com Telegram: {e}")
        return False


def gerar_relatorio_telegram(
    df,
    links_processados_sucesso,
    links_com_erro,
    links_sem_detalhes,
    tempo_execucao,
    inseridos=0,
    atualizados=0,
    execucao_id="",
):
    """Gera relatório de estatísticas incluindo resumo do salvamento no Neon."""
    agora = datetime.now(ZoneInfo("America/Sao_Paulo")).strftime("%d/%m/%Y às %H:%M:%S")

    total_links = links_processados_sucesso + links_com_erro
    taxa_sucesso = (
        (links_processados_sucesso / total_links * 100) if total_links > 0 else 0
    )

    total_registros = len(df)
    registros_com_playlist = len(df[df["Status Playlist"] == "Com Playlist"])
    registros_sem_playlist = len(df[df["Status Playlist"] == "Sem Playlist"])

    mensagem = f"""🤖 <b>RELATÓRIO AUTOMÁTICO - RECEBIMENTOS</b>

📅 <b>Data/Hora:</b> {agora}
📊 <b>Ano do Relatório:</b> {ANO_RELATORIO}
⏱️ <b>Tempo de Execução:</b> {tempo_execucao}
🔑 <b>Execução ID:</b> <code>{execucao_id}</code>

📋 <b>DADOS EXTRAÍDOS:</b>
• Total de registros: <b>{total_registros:,}</b>
• Registros com links: <b>{total_links:,}</b>
• Registros sem links: <b>{links_sem_detalhes:,}</b>

🔗 <b>PROCESSAMENTO DE LINKS:</b>
• ✅ Processados com sucesso: <b>{links_processados_sucesso:,}</b>
• ❌ Links com erro: <b>{links_com_erro:,}</b>
• 📊 Taxa de sucesso: <b>{taxa_sucesso:.1f}%</b>

🎵 <b>ANÁLISE DE PLAYLISTS:</b>
• Com Playlist: <b>{registros_com_playlist:,}</b>
• Sem Playlist: <b>{registros_sem_playlist:,}</b>

🗄️ <b>BANCO DE DADOS (NEON):</b>
• ✅ Inseridos: <b>{inseridos:,}</b>
• 🔄 Atualizados: <b>{atualizados:,}</b>
• 📦 Total salvo: <b>{inseridos + atualizados:,}</b>

🚀 <i>Relatório gerado automaticamente via GitHub Actions</i>"""

    return mensagem.strip()


async def enviar_notificacao_erro(erro_msg, chat_id):
    """Envia notificação de erro via Telegram."""
    try:
        agora = datetime.now(ZoneInfo("America/Sao_Paulo")).strftime(
            "%d/%m/%Y às %H:%M:%S"
        )

        mensagem = f"""🚨 <b>ERRO - EXTRAÇÃO RECEBIMENTOS</b>

❌ <b>Erro:</b> {erro_msg}
🕐 <b>Timestamp:</b> {agora}
🔧 <b>Origem:</b> GitHub Actions

<i>Verifique os logs para mais detalhes</i>"""

        await enviar_mensagem_telegram(mensagem, chat_id)
    except Exception as e:
        logging.error(f"Erro ao enviar notificação: {e}")


def obter_chat_id():
    """Obtém o chat_id do payload do GitHub ou usa o padrão."""
    github_event_path = os.getenv("GITHUB_EVENT_PATH")
    target_chat_id = None

    if github_event_path:
        try:
            with open(github_event_path, "r") as f:
                event_data = json.load(f)
                target_chat_id = event_data.get("client_payload", {}).get("chat_id")
                logging.info(f"Chat ID obtido do payload: {target_chat_id}")
        except Exception as e:
            logging.error(f"Erro ao ler GITHUB_EVENT_PATH: {e}")

    # Fallback para DEFAULT_CHAT_ID
    if not target_chat_id:
        target_chat_id = DEFAULT_CHAT_ID
        logging.info(f"📦 Usando DEFAULT_CHAT_ID: {target_chat_id}")

    try:
        return int(target_chat_id)
    except (ValueError, TypeError) as e:
        logging.error(f"❌ chat_id inválido: {target_chat_id} ({e})")
        return None


async def main():
    """Função principal da automação."""
    inicio_execucao = datetime.now()
    execucao_id = str(uuid.uuid4())[:8]
    chat_id = obter_chat_id()

    logging.info(f"🔑 Execução ID: {execucao_id}")

    if not chat_id:
        logging.error("❌ Não foi possível obter chat_id válido")
        return

    if not CLIENT_SENHA:
        logging.error("❌ CLIENT_SENHA não configurada")
        await enviar_notificacao_erro("CLIENT_SENHA não configurada", chat_id)
        return

    if not TELEGRAM_BOT_TOKEN:
        logging.error("❌ BOT_TOKEN não configurado")
        return

    logging.info("🤖 Iniciando extração de recebimentos...")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        try:
            # Login
            logging.info("Realizando login...")
            await page.goto(URL_LOGIN)
            await page.fill('xpath=//*[@id="login-username"]', CLIENT_EMAIL)
            await page.fill('xpath=//*[@id="login-password"]', CLIENT_SENHA)
            await page.locator(
                "xpath=/html/body/div[1]/div/div/div/div[2]/form/div[4]/div/button"
            ).click()
            await page.wait_for_load_state("networkidle")

            if "login_error" in page.url:
                raise Exception("Falha no login - verifique credenciais")

            logging.info("✅ Login realizado com sucesso")

            # Navegação e extração
            logging.info(f"Carregando dados do ano {ANO_RELATORIO}...")
            await page.goto(URL_RECEBIMENTOS)
            await page.click(
                'xpath=//*[@id="select2-royaltiesRecebimentosAnos-container"]'
            )
            await page.wait_for_selector(
                'xpath=//ul[contains(@class, "select2-results")]'
            )
            await page.click(f'xpath=//li[contains(text(), "{ANO_RELATORIO}")]')
            await page.wait_for_timeout(1000)

            meses = [
                "01",
                "02",
                "03",
                "04",
                "05",
                "06",
                "07",
                "08",
                "09",
                "10",
                "11",
                "12",
            ]
            nomes_meses = [
                "Janeiro",
                "Fevereiro",
                "Março",
                "Abril",
                "Maio",
                "Junho",
                "Julho",
                "Agosto",
                "Setembro",
                "Outubro",
                "Novembro",
                "Dezembro",
            ]

            # Navega pelos meses
            await navegar_pelos_meses(page, meses, nomes_meses)

            # Extrai dados do dezembro (acumulado)
            todos_os_dados = await extrair_dados_dezembro_completos(page)

            if not todos_os_dados:
                raise Exception("Nenhum dado foi extraído da tabela")

            df = pd.DataFrame(todos_os_dados)
            logging.info(f"✅ {len(df)} registros extraídos")

            # Processa links de detalhes
            (
                links_processados_sucesso,
                links_com_erro,
                links_sem_detalhes,
            ) = await processar_links_com_retry(page, df)

            # Salva dados no Neon (substitui exportação para Excel)
            inseridos, atualizados = await salvar_no_neon(df, execucao_id)

            # Calcula tempo de execução
            fim_execucao = datetime.now()
            tempo_execucao = str(fim_execucao - inicio_execucao).split(".")[0]

            # Gera e envia relatório com resumo do Neon
            mensagem_relatorio = gerar_relatorio_telegram(
                df,
                links_processados_sucesso,
                links_com_erro,
                links_sem_detalhes,
                tempo_execucao,
                inseridos=inseridos,
                atualizados=atualizados,
                execucao_id=execucao_id,
            )

            await enviar_mensagem_telegram(mensagem_relatorio, chat_id)

            logging.info("🎉 Processo concluído com sucesso!")

        except Exception as e:
            erro_msg = f"Erro durante execução: {str(e)}"
            logging.error(erro_msg)
            await enviar_notificacao_erro(erro_msg, chat_id)

        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
