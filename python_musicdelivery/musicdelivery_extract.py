#!/usr/bin/env python3
"""
Extrator CLI de clientes do sistema Music Delivery para SQLite.

Fluxo:
  1. Autentica em sistema.musicdelivery.com.br
  2. Percorre /clientes (30 registros por página)
  3. Abre a ficha de cada cliente (/clientes/edit/<id>)
  4. Em "Playlists e Vinhetas Relacionadas" (/clientes/info/<id>), abre o link
     de cada playlist (/playlists/edit/<id>) e lê metadados, músicas e a tabela
     "Clientes vinculados à Playlist" (código MD<n> cruza com contratos)
  5. Grava tudo em um banco SQLite, com retomada automática

Documentos anexos e a configuração de período sazonal não são coletados.

Uso:
  python3 musicdelivery_extract.py --db musicdelivery.db

Credenciais (nesta ordem):
  --login/--password  >  MD_LOGIN/MD_PASSWORD  >  CLIENT_EMAIL/CLIENT_SENHA  >  .env  >  prompt

As credenciais CLIENT_EMAIL/CLIENT_SENHA são as mesmas já usadas pelo extrator de
contratos no mesmo sistema Music Delivery, então não é preciso configurar um
login novo (MD_LOGIN/MD_PASSWORD continuam aceitos como override local).

Exemplo de .env:
  CLIENT_EMAIL=suporte@musicdelivery.com.br
  CLIENT_SENHA='sua-senha'
"""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import os
import random
import re
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BASE_URL = "http://sistema.musicdelivery.com.br"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
RETRY_STATUS = {429, 500, 502, 503, 504}
CHECKLIST_PREFIX = "Clientes[ChecklistCliente]"
CONTACT_RE = re.compile(r"^Clientes\[ContatosCliente\]\[(\d+)\]\[([^\]]+)\]$")

log = logging.getLogger("musicdelivery")


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

def clean(value: Any) -> str:
    """Normaliza espaços em branco de um texto."""
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def parse_int(value: Any) -> int | None:
    try:
        text = clean(value)
        if not text:
            return None
        return int(text)
    except (TypeError, ValueError):
        return None


def date_to_iso(value: Any) -> str | None:
    text = clean(value)
    if not text:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_env_file(path: Path) -> None:
    """Carrega um .env simples sem sobrescrever variáveis já definidas."""
    if not path.exists():
        return
    try:
        content = path.read_text(encoding="utf-8")
    except OSError as exc:
        log.warning("Não foi possível ler %s: %s", path, exc)
        return

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        key, sep, value = line.partition("=")
        if not sep:
            continue
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


def setup_logging(log_file: Path | None, verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    formatter = logging.Formatter(
        fmt="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stdout)]
    if log_file:
        try:
            log_file.parent.mkdir(parents=True, exist_ok=True)
            handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
        except OSError as exc:
            print(f"Aviso: não foi possível abrir o log {log_file}: {exc}", file=sys.stderr)
    logging.basicConfig(level=level, handlers=handlers, format="%(asctime)s %(levelname)-7s %(message)s", datefmt="%H:%M:%S")


# ---------------------------------------------------------------------------
# Banco de dados
# ---------------------------------------------------------------------------

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS clientes (
    id                       INTEGER PRIMARY KEY,
    nome_listagem            TEXT,
    nome_razaosocial         TEXT,
    nome_fantasia            TEXT,
    cnpj                     TEXT,
    telefone                 TEXT,
    celular                  TEXT,
    email                    TEXT,
    status                   INTEGER,
    contrato_vinculado       TEXT,
    data_inicio              TEXT,
    data_fim                 TEXT,
    data_inicio_iso          TEXT,
    data_fim_iso             TEXT,
    tipo                     TEXT,
    filiais_vinculadas       TEXT,
    endereco                 TEXT,
    cidade                   TEXT,
    estado                   TEXT,
    pais                     TEXT,
    cep                      TEXT,
    nome_responsavel         TEXT,
    rgcpf_responsavel        TEXT,
    email_responsavel        TEXT,
    telefone_responsavel     TEXT,
    celular_responsavel      TEXT,
    banco                    TEXT,
    agencia                  TEXT,
    conta                    TEXT,
    titular                  TEXT,
    forma_envio              TEXT,
    observacoes              TEXT,
    feedback                 TEXT,
    checklist_json           TEXT,
    responsavel_listagem     TEXT,
    playlists_listagem       TEXT,
    playlists_listagem_json  TEXT,
    forma_envio_listagem     TEXT,
    observacoes_listagem     TEXT,
    status_listagem          TEXT,
    url                      TEXT,
    dados_json               TEXT,
    coleta_avisos            TEXT,
    coleta_completa          INTEGER NOT NULL DEFAULT 0,
    coletado_em              TEXT,
    atualizado_em            TEXT
);

CREATE TABLE IF NOT EXISTS contatos_cliente (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id       INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    ordem            INTEGER NOT NULL,
    cargo_area       TEXT,
    nome             TEXT,
    email            TEXT,
    telefone_celular TEXT
);

CREATE TABLE IF NOT EXISTS playlists_cliente (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id      INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    ordem           INTEGER NOT NULL,
    playlist_id     INTEGER,
    nome            TEXT,
    codigo          TEXT,
    nao_mesclar     INTEGER,
    data_vinculacao TEXT,
    url             TEXT
);

-- Detalhes lidos em /playlists/edit/<id> (uma linha por playlist única).
CREATE TABLE IF NOT EXISTS playlists_detalhes (
    playlist_id     INTEGER PRIMARY KEY,
    titulo          TEXT,
    tipo_playlist   TEXT,
    genero          TEXT,
    idades          TEXT,
    classes_sociais TEXT,
    hour_start      TEXT,
    hour_end        TEXT,
    observacoes     TEXT,
    status_playlist INTEGER,
    musicas_count   INTEGER DEFAULT 0,
    musicas_json    TEXT,
    data_criacao    TEXT,
    coletado_em     TEXT
);

-- Tabela "Clientes vinculados à Playlist" (lado playlist da relação).
-- codigo_contrato é MD<n>, o mesmo formato de contratos.codigo no sistema atual.
CREATE TABLE IF NOT EXISTS playlist_clientes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id      INTEGER NOT NULL,
    cliente_id       INTEGER,
    nome_cliente     TEXT,
    codigo_contrato  TEXT,
    tocar_sazonal    INTEGER,
    data_inicial     TEXT,
    data_final       TEXT,
    UNIQUE (playlist_id, codigo_contrato, data_inicial)
);

CREATE TABLE IF NOT EXISTS execucoes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    iniciado_em      TEXT NOT NULL,
    finalizado_em    TEXT,
    paginas          INTEGER DEFAULT 0,
    clientes_novos   INTEGER DEFAULT 0,
    clientes_pulados INTEGER DEFAULT 0,
    erros            INTEGER DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'em_execucao',
    mensagem         TEXT
);

CREATE TABLE IF NOT EXISTS meta (
    chave TEXT PRIMARY KEY,
    valor TEXT
);

CREATE INDEX IF NOT EXISTS idx_clientes_nome   ON clientes(nome_razaosocial);
CREATE INDEX IF NOT EXISTS idx_clientes_cnpj   ON clientes(cnpj);
CREATE INDEX IF NOT EXISTS idx_clientes_status ON clientes(status);
CREATE INDEX IF NOT EXISTS idx_contatos_cli    ON contatos_cliente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_playlists_cli   ON playlists_cliente(cliente_id);
CREATE INDEX IF NOT EXISTS idx_plcli_playlist  ON playlist_clientes(playlist_id);
CREATE INDEX IF NOT EXISTS idx_plcli_contrato  ON playlist_clientes(codigo_contrato);
"""

CLIENT_COLUMNS = [
    "id", "nome_listagem", "nome_razaosocial", "nome_fantasia", "cnpj",
    "telefone", "celular", "email", "status", "contrato_vinculado",
    "data_inicio", "data_fim", "data_inicio_iso", "data_fim_iso", "tipo",
    "filiais_vinculadas", "endereco", "cidade", "estado", "pais", "cep",
    "nome_responsavel", "rgcpf_responsavel", "email_responsavel",
    "telefone_responsavel", "celular_responsavel", "banco", "agencia",
    "conta", "titular", "forma_envio", "observacoes", "feedback",
    "checklist_json", "responsavel_listagem", "playlists_listagem",
    "playlists_listagem_json", "forma_envio_listagem", "observacoes_listagem",
    "status_listagem", "url", "dados_json", "coleta_avisos",
    "coleta_completa", "coletado_em", "atualizado_em",
]

UPSERT_SQL = (
    f"INSERT INTO clientes ({', '.join(CLIENT_COLUMNS)}) "
    f"VALUES ({', '.join('?' for _ in CLIENT_COLUMNS)}) "
    "ON CONFLICT(id) DO UPDATE SET "
    + ", ".join(f"{c}=excluded.{c}" for c in CLIENT_COLUMNS if c != "id")
)


def open_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=60)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.executescript(SCHEMA)
    # Documentos anexados e configuração sazonal não fazem mais parte da coleta.
    conn.execute("DROP TABLE IF EXISTS documentos_cliente")
    conn.execute("DROP TABLE IF EXISTS configuracoes_cliente")
    # Migração: a data de criação só existe na listagem /playlists.
    colunas = {row[1] for row in conn.execute("PRAGMA table_info(playlists_detalhes)")}
    if "data_criacao" not in colunas:
        conn.execute("ALTER TABLE playlists_detalhes ADD COLUMN data_criacao TEXT")
    conn.commit()
    return conn


def set_meta(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute(
        "INSERT INTO meta (chave, valor) VALUES (?, ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor",
        (key, str(value)),
    )
    conn.commit()


def load_completed(conn: sqlite3.Connection) -> set[int]:
    rows = conn.execute("SELECT id FROM clientes WHERE coleta_completa = 1").fetchall()
    return {int(r[0]) for r in rows}


def save_client(
    conn: sqlite3.Connection,
    rec: dict[str, Any],
    contatos: list[dict[str, Any]],
    playlists: list[dict[str, Any]] | None,
    playlists_ok: bool,
    playlist_detalhes: dict[int, dict[str, Any]],
    playlist_clientes: dict[int, list[dict[str, Any]]],
) -> None:
    values = [rec.get(column) for column in CLIENT_COLUMNS]
    with conn:
        conn.execute(UPSERT_SQL, values)

        conn.execute("DELETE FROM contatos_cliente WHERE cliente_id = ?", (rec["id"],))
        conn.executemany(
            """
            INSERT INTO contatos_cliente
                (cliente_id, ordem, cargo_area, nome, email, telefone_celular)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    rec["id"], c.get("ordem"), c.get("cargo_area"),
                    c.get("nome"), c.get("email"), c.get("telefone_celular"),
                )
                for c in contatos
            ],
        )

        if playlists_ok and playlists is not None:
            conn.execute("DELETE FROM playlists_cliente WHERE cliente_id = ?", (rec["id"],))
            conn.executemany(
                """
                INSERT INTO playlists_cliente
                    (cliente_id, ordem, playlist_id, nome, codigo,
                     nao_mesclar, data_vinculacao, url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        rec["id"], p.get("ordem"), p.get("playlist_id"), p.get("nome"),
                        p.get("codigo"), p.get("nao_mesclar"), p.get("data_vinculacao"),
                        p.get("url"),
                    )
                    for p in playlists
                ],
            )

        # Detalhes e vínculos das playlists: gravados por playlist única (cache global).
        for playlist_id, detalhe in playlist_detalhes.items():
            save_playlist_detail(
                conn, playlist_id, detalhe, playlist_clientes.get(playlist_id, []),
            )


def save_playlist_detail(
    conn: sqlite3.Connection,
    playlist_id: int,
    detalhe: dict[str, Any],
    vinculos: list[dict[str, Any]],
) -> None:
    """Grava metadados/músicas de uma playlist e substitui seus vínculos."""
    conn.execute(
        """
        INSERT INTO playlists_detalhes
            (playlist_id, titulo, tipo_playlist, genero, idades,
             classes_sociais, hour_start, hour_end, observacoes,
             status_playlist, musicas_count, musicas_json, data_criacao,
             coletado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(playlist_id) DO UPDATE SET
            titulo=excluded.titulo, tipo_playlist=excluded.tipo_playlist,
            genero=excluded.genero, idades=excluded.idades,
            classes_sociais=excluded.classes_sociais,
            hour_start=excluded.hour_start, hour_end=excluded.hour_end,
            observacoes=excluded.observacoes,
            status_playlist=excluded.status_playlist,
            musicas_count=excluded.musicas_count,
            musicas_json=excluded.musicas_json,
            coletado_em=excluded.coletado_em
        """,
        (
            playlist_id, detalhe.get("titulo"), detalhe.get("tipo_playlist"),
            detalhe.get("genero"), json.dumps(detalhe.get("idades") or [], ensure_ascii=False),
            json.dumps(detalhe.get("classes_sociais") or [], ensure_ascii=False),
            detalhe.get("hour_start"), detalhe.get("hour_end"), detalhe.get("observacoes"),
            detalhe.get("status_playlist"), detalhe.get("musicas_count", 0),
            json.dumps(detalhe.get("musicas") or [], ensure_ascii=False),
            detalhe.get("data_criacao"),
            detalhe.get("coletado_em"),
        ),
    )
    conn.execute("DELETE FROM playlist_clientes WHERE playlist_id = ?", (playlist_id,))
    conn.executemany(
        """
        INSERT OR IGNORE INTO playlist_clientes
            (playlist_id, cliente_id, nome_cliente, codigo_contrato,
             tocar_sazonal, data_inicial, data_final)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                playlist_id, v.get("cliente_id"), v.get("nome_cliente"),
                v.get("codigo_contrato"), v.get("tocar_sazonal"),
                v.get("data_inicial"), v.get("data_final"),
            )
            for v in vinculos
        ],
    )


# ---------------------------------------------------------------------------
# HTTP / autenticação
# ---------------------------------------------------------------------------

class AuthError(RuntimeError):
    pass


class ParseError(RuntimeError):
    pass


class RateLimiter:
    def __init__(self, delay: float):
        self.delay = max(0.0, delay)
        self.last = 0.0

    def wait(self) -> None:
        if self.delay <= 0:
            return
        now = time.monotonic()
        remaining = self.delay - (now - self.last)
        if remaining > 0:
            time.sleep(remaining)
        self.last = time.monotonic()


@dataclass
class ScraperConfig:
    base_url: str = BASE_URL
    tipo: str = "admin"
    login: str = ""
    password: str = ""
    delay: float = 0.20
    timeout: float = 60.0
    retries: int = 4
    user_agent: str = DEFAULT_USER_AGENT


class MusicDeliveryClient:
    def __init__(self, config: ScraperConfig):
        self.cfg = config
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": config.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
        })
        self.limiter = RateLimiter(config.delay)
        self.logged_in = False

    # -- infraestrutura -----------------------------------------------------

    def _request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        last_exc: Exception | None = None
        for attempt in range(self.cfg.retries + 1):
            self.limiter.wait()
            try:
                response = self.session.request(
                    method,
                    url,
                    timeout=(15, self.cfg.timeout),
                    allow_redirects=True,
                    **kwargs,
                )
                if response.status_code in RETRY_STATUS:
                    raise requests.HTTPError(
                        f"HTTP {response.status_code}", response=response
                    )
                response.raise_for_status()
                return response
            except requests.RequestException as exc:
                last_exc = exc
                if attempt >= self.cfg.retries:
                    break
                wait = min(30.0, (2 ** attempt) + random.uniform(0.0, 0.7))
                log.warning(
                    "Falha em %s (%s); nova tentativa em %.1fs (%d/%d)",
                    url, exc, wait, attempt + 1, self.cfg.retries,
                )
                time.sleep(wait)
        assert last_exc is not None
        raise last_exc

    @staticmethod
    def _is_login_response(response: requests.Response) -> bool:
        path = urlparse(response.url).path.rstrip("/")
        if path.endswith("/login"):
            return True
        # Fallback: página com o formulário de login.
        return (
            'id="login-password"' in response.text
            and 'name="password"' in response.text
            and 'id="login-username"' in response.text
        )

    def login(self) -> None:
        log.debug("Autenticando como %s (%s)", self.cfg.login, self.cfg.tipo)
        self.session.cookies.clear()
        self.logged_in = False

        # GET inicial para criar a sessão/cookies do formulário.
        self._request("GET", self.cfg.base_url + "/login")
        response = self._request(
            "POST",
            self.cfg.base_url + "/login",
            data={
                "tipo": self.cfg.tipo,
                "login": self.cfg.login,
                "password": self.cfg.password,
            },
        )
        if self._is_login_response(response):
            raise AuthError(
                "Login recusado. Verifique o e-mail/senha e o tipo de usuário "
                f"({self.cfg.tipo})."
            )
        self.logged_in = True
        log.info("Login realizado com sucesso.")

    def get(self, url: str) -> requests.Response:
        for attempt in range(2):
            response = self._request("GET", url)
            if not self._is_login_response(response):
                return response
            if attempt == 0:
                log.warning("Sessão expirada; refazendo login...")
                self.login()
                continue
            raise AuthError("A sessão expirou e o novo login não foi aceito.")
        raise AuthError("Não foi possível obter uma sessão autenticada.")


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_listing_page(html: str, page_url: str) -> tuple[list[dict[str, Any]], str | None]:
    soup = BeautifulSoup(html, "html.parser")
    table = None
    for candidate in soup.find_all("table"):
        headers = [clean(th.get_text(" ", strip=True)).lower() for th in candidate.find_all("th")]
        if headers and headers[0] == "cliente":
            table = candidate
            break
    if table is None:
        raise ParseError("Tabela de clientes não encontrada na listagem.")

    clients: list[dict[str, Any]] = []
    for row in table.find_all("tr")[1:]:
        cells = row.find_all("td")
        if not cells:
            continue
        first = cells[0]
        name = clean(first.get_text(" ", strip=True))
        link = None
        client_id = None
        for anchor in first.find_all("a", href=True):
            match = re.search(r"/clientes/edit/(\d+)", anchor["href"])
            if match:
                link = anchor
                client_id = int(match.group(1))
                break
        if client_id is None:
            if name and "nenhum registro" not in name.lower():
                log.warning("Linha de cliente sem link ignorada: %s", name[:80])
            continue
        if link is not None:
            name = clean(link.get_text(" ", strip=True)) or name

        def cell_text(index: int) -> str:
            return clean(cells[index].get_text(" ", strip=True)) if index < len(cells) else ""

        playlists: list[dict[str, Any]] = []
        if len(cells) > 2:
            for anchor in cells[2].find_all("a", href=True):
                match = re.search(r"/playlists/edit/(\d+)", anchor["href"])
                if match:
                    playlists.append({
                        "playlist_id": int(match.group(1)),
                        "nome": clean(anchor.get_text(" ", strip=True)),
                        "url": urljoin(page_url, anchor["href"]),
                    })

        clients.append({
            "id": client_id,
            "nome": name,
            "responsavel": cell_text(1),
            "playlists": playlists,
            "playlists_text": cell_text(2),
            "forma_envio": cell_text(3),
            "observacoes": cell_text(4),
            "status": cell_text(5),
            "url_edicao": urljoin(page_url, link["href"]) if link is not None else None,
        })

    next_url = None
    pagination = soup.find("ul", class_="pagination")
    if pagination is not None:
        for li in pagination.find_all("li"):
            classes = li.get("class") or []
            if "disabled" in classes:
                continue
            anchor = li.find("a", href=True)
            if not anchor:
                continue
            label = clean(anchor.get_text(" ", strip=True))
            if label in {">", "›", "»", "Próxima", "Próxima →", "Next"}:
                href = anchor["href"].strip()
                if href.lower().startswith("javascript"):
                    continue
                next_url = urljoin(page_url, href)
                break
    return clients, next_url


def parse_detail_page(html: str, listing: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    soup = BeautifulSoup(html, "html.parser")
    form = soup.find("form", id="FormAction")
    if form is None:
        form = soup.find("form", action=re.compile(r"/clientes/edit"))
    if form is None:
        raise ParseError("Formulário de cadastro do cliente não encontrado.")

    fields: dict[str, str] = {}
    for element in form.find_all(["input", "select", "textarea"]):
        name = clean(element.get("name"))
        if not name:
            continue
        if name == "DocumentoCliente" or name.startswith("Clientes[senha]"):
            continue
        if name.startswith(CHECKLIST_PREFIX):
            continue

        if element.name == "input":
            input_type = clean(element.get("type")).lower() or "text"
            if input_type == "file":
                continue
            if input_type == "radio":
                if element.has_attr("checked"):
                    fields[name] = element.get("value") or "1"
                else:
                    fields.setdefault(name, "0")
            elif input_type == "checkbox":
                fields[name] = "1" if element.has_attr("checked") else "0"
            else:
                fields[name] = element.get("value", "")
        elif element.name == "select":
            options = element.find_all("option")
            selected = next((o for o in options if o.has_attr("selected")), None)
            option = selected or (options[0] if options else None)
            fields[name] = option.get("value", "") if option is not None else ""
        else:
            fields[name] = element.get_text()

    def field(name: str, default: str = "") -> str:
        return fields.get(name, default)

    client_id = parse_int(field("Clientes[id]")) or listing["id"]
    if client_id != listing["id"]:
        log.warning(
            "ID divergente na ficha (listagem=%s, formulário=%s); usando o da listagem.",
            listing["id"], client_id,
        )
    client_id = listing["id"]

    contacts_map: dict[int, dict[str, str]] = {}
    for name, value in fields.items():
        match = CONTACT_RE.match(name)
        if not match:
            continue
        index = int(match.group(1))
        contact_field = match.group(2).strip()
        contacts_map.setdefault(index, {})[contact_field] = value
    contatos = [
        {
            "ordem": index + 1,
            "cargo_area": clean(data.get("cargo_area")),
            "nome": clean(data.get("nome")),
            "email": clean(data.get("email")),
            "telefone_celular": clean(data.get("telefone_celular")),
        }
        for index, data in sorted(contacts_map.items())
        if any(clean(v) for v in data.values())
    ]

    tipo = None
    for label in form.select("label.radio-inline"):
        radio = label.find("input", {"name": "Clientes[id_matriz]"})
        if radio is not None and radio.has_attr("checked"):
            tipo = clean(label.get_text(" ", strip=True))
            break

    filiais: list[str] = []
    label_filiais = form.find("label", string=re.compile(r"Filiais Vinculadas", re.I))
    if label_filiais is not None:
        ordered_list = label_filiais.find_next("ol")
        if ordered_list is not None:
            filiais = [
                clean(li.get_text(" ", strip=True))
                for li in ordered_list.find_all("li")
                if clean(li.get_text(" ", strip=True))
            ]
            if not filiais:
                text = clean(ordered_list.get_text(" ", strip=True))
                if text and "não existem" not in text.lower():
                    filiais = [text]

    checklist: dict[str, bool] = {}
    for checkbox in form.select(f'input[name^="{CHECKLIST_PREFIX}"]'):
        label = checkbox.find_parent("label")
        label_text = (
            clean(label.get_text(" ", strip=True)) if label is not None else ""
        ) or clean(checkbox.get("aria-label")) or clean(checkbox.get("name"))
        if label_text:
            checklist[label_text] = checkbox.has_attr("checked")

    documentos: list[dict[str, Any]] = []
    for table in soup.find_all("table"):
        headers = [clean(th.get_text(" ", strip=True)).lower() for th in table.find_all("th")]
        if any("documentos" in h for h in headers) and any("data de upload" in h for h in headers):
            body = table.find_next("table")
            if body is not None:
                for row in body.find_all("tr"):
                    cells = row.find_all("td")
                    if len(cells) < 2:
                        continue
                    document_name = clean(cells[0].get_text(" ", strip=True))
                    if not document_name or "nenhum registro" in document_name.lower():
                        continue
                    anchor = None
                    for cell in cells:
                        anchor = cell.find("a", href=re.compile(r"/clientes/download/"))
                        if anchor is not None:
                            break
                    documentos.append({
                        "ordem": len(documentos) + 1,
                        "documento_id": parse_int(row.get("id")),
                        "nome": document_name,
                        "data_upload": clean(cells[1].get_text(" ", strip=True)),
                        "url": urljoin(BASE_URL, anchor["href"]) if anchor is not None else None,
                    })
            break

    status_value = 1 if field("Clientes[status]") == "1" else 0
    scalar_fields = {
        key: value for key, value in fields.items()
        if not key.startswith("Clientes[ContatosCliente]")
        and not key.startswith(CHECKLIST_PREFIX)
    }
    dados = {
        "campos": scalar_fields,
        "contatos": contatos,
        "checklist": checklist,
        "documentos": documentos,
        "filiais_vinculadas": filiais,
        "listagem": listing,
    }

    now = utc_now()
    rec = {
        "id": client_id,
        "nome_listagem": clean(listing.get("nome")),
        "nome_razaosocial": clean(field("Clientes[nome_razaosocial]")),
        "nome_fantasia": clean(field("Clientes[nome_fantasia]")),
        "cnpj": clean(field("Clientes[cnpj]")),
        "telefone": clean(field("Clientes[telefone]")),
        "celular": clean(field("Clientes[celular]")),
        "email": clean(field("Clientes[email]")),
        "status": status_value,
        "contrato_vinculado": clean(field("Contratos[id]")),
        "data_inicio": clean(field("Clientes[data_inicio]")),
        "data_fim": clean(field("Clientes[data_fim]")),
        "data_inicio_iso": date_to_iso(field("Clientes[data_inicio]")),
        "data_fim_iso": date_to_iso(field("Clientes[data_fim]")),
        "tipo": tipo,
        "filiais_vinculadas": json.dumps(filiais, ensure_ascii=False),
        "endereco": clean(field("Clientes[endereco]")),
        "cidade": clean(field("Clientes[cidade]")),
        "estado": clean(field("Clientes[estado]")),
        "pais": clean(field("Clientes[pais]")),
        "cep": clean(field("Clientes[cep]")),
        "nome_responsavel": clean(field("Clientes[nome_responsavel]")),
        "rgcpf_responsavel": clean(field("Clientes[rgcpf_responsavel]")),
        "email_responsavel": clean(field("Clientes[email_responsavel]")),
        "telefone_responsavel": clean(field("Clientes[telefone_responsavel]")),
        "celular_responsavel": clean(field("Clientes[celular_responsavel]")),
        "banco": clean(field("Clientes[banco]")),
        "agencia": clean(field("Clientes[agencia]")),
        "conta": clean(field("Clientes[conta]")),
        "titular": clean(field("Clientes[titular]")),
        "forma_envio": clean(field("Clientes[forma_envio]")),
        "observacoes": clean(field("Clientes[observacoes]")),
        "feedback": clean(field("Clientes[feedback]")),
        "checklist_json": json.dumps(checklist, ensure_ascii=False),
        "responsavel_listagem": clean(listing.get("responsavel")),
        "playlists_listagem": clean(listing.get("playlists_text")),
        "playlists_listagem_json": json.dumps(listing.get("playlists", []), ensure_ascii=False),
        "forma_envio_listagem": clean(listing.get("forma_envio")),
        "observacoes_listagem": clean(listing.get("observacoes")),
        "status_listagem": clean(listing.get("status")),
        "url": BASE_URL + f"/clientes/edit/{client_id}",
        "dados_json": json.dumps(dados, ensure_ascii=False),
        "coleta_avisos": None,
        "coleta_completa": 1,
        "coletado_em": now,
        "atualizado_em": now,
    }
    return rec, contatos, documentos


def parse_playlists_page(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    table = None
    for candidate in soup.find_all("table"):
        headers = [clean(th.get_text(" ", strip=True)).lower() for th in candidate.find_all("th")]
        if any("nome da playlist" in h for h in headers):
            table = candidate
            break
    if table is None:
        raise ParseError("Tabela de playlists não encontrada na página de playlists.")

    # A página costuma separar o cabeçalho e o corpo em duas <table>.
    body = table if table.find("td") is not None else table.find_next("table")
    if body is None:
        raise ParseError("Corpo da tabela de playlists não encontrado.")

    playlists: list[dict[str, Any]] = []
    for row in body.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 4:
            continue
        name = clean(cells[0].get_text(" ", strip=True))
        if not name or "nenhum registro" in name.lower():
            continue
        anchor = cells[0].find("a", href=True)
        playlist_id = None
        if anchor is not None:
            match = re.search(r"/playlists/edit/(\d+)", anchor["href"])
            if match:
                playlist_id = int(match.group(1))
        playlists.append({
            "ordem": len(playlists) + 1,
            "playlist_id": playlist_id,
            "nome": name,
            "codigo": clean(cells[1].get_text(" ", strip=True)),
            "nao_mesclar": 1 if "não mesclar" in clean(cells[2].get_text(" ", strip=True)).lower() else 0,
            "data_vinculacao": clean(cells[3].get_text(" ", strip=True)),
            "url": urljoin(BASE_URL, anchor["href"]) if anchor is not None else None,
        })
    return playlists


def _table_with_headers(soup: BeautifulSoup, required: list[str]) -> Any:
    """Retorna o corpo de uma tabela cujos cabeçalhos contêm todos os termos.

    O sistema separa cabeçalho e corpo em duas <table> irmãs.
    """
    for candidate in soup.find_all("table"):
        headers = [clean(th.get_text(" ", strip=True)).lower() for th in candidate.find_all("th")]
        if not all(any(term in h for h in headers) for term in required):
            continue
        return candidate if candidate.find("td") is not None else candidate.find_next("table")
    return None


def parse_playlist_detail_page(html: str, playlist_id: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Lê /playlists/edit/<id>: metadados, músicas e 'Clientes vinculados à Playlist'."""
    soup = BeautifulSoup(html, "html.parser")
    title = clean(soup.title.get_text(" ", strip=True)).lower() if soup.title else ""
    form = soup.find("form", action=re.compile(r"/playlists"))
    if form is None or "playlists" not in title:
        raise ParseError("Formulário da playlist não encontrado.")

    def field(name: str) -> str:
        el = form.find(attrs={"name": name})
        if el is None:
            return ""
        if el.name == "input":
            return "1" if el.has_attr("checked") else clean(el.get("value"))
        if el.name == "select":
            sel = next((o for o in el.find_all("option") if o.has_attr("selected")), None)
            return clean(sel.get_text(" ", strip=True)) if sel else ""
        return clean(el.get_text(" ", strip=True))

    def multi(name: str) -> list[str]:
        values: list[str] = []
        for el in form.find_all(attrs={"name": name}):
            if el.name != "select":
                continue
            for option in el.find_all("option"):
                if option.has_attr("selected"):
                    values.append(clean(option.get_text(" ", strip=True)))
        return values

    titulo = field("Playlists[titulo]")
    if not titulo:
        raise ParseError("Título da playlist não encontrado.")

    # Os inputs "Playlists[Clientes][]" trazem cliente_id|contrato|inicio|fim
    # (contrato sem o prefixo MD), enquanto a tabela mostra "MD<n>".
    def numero_contrato(valor: str) -> str:
        return re.sub(r"\D", "", valor or "")

    contrato_cliente: dict[str, int | None] = {}
    for el in form.find_all(attrs={"name": "Playlists[Clientes][]"}):
        parts = clean(el.get("value")).split("|")
        if len(parts) >= 2 and parts[1].strip():
            contrato_cliente[numero_contrato(parts[1])] = parse_int(parts[0])

    vinculos: list[dict[str, Any]] = []
    cli_body = _table_with_headers(soup, ["nome do cliente", "código do contrato"])
    if cli_body is not None:
        for row in cli_body.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) < 5:
                continue
            nome = clean(cells[1].get_text(" ", strip=True))
            codigo = clean(cells[2].get_text(" ", strip=True))
            if not nome and not codigo:
                continue
            data_final = clean(cells[5].get_text(" ", strip=True)) if len(cells) > 5 else ""
            vinculos.append({
                "cliente_id": contrato_cliente.get(numero_contrato(codigo)),
                "nome_cliente": nome,
                "codigo_contrato": codigo,
                "tocar_sazonal": 1 if clean(cells[3].get_text(" ", strip=True)).upper() == "X" else 0,
                "data_inicial": clean(cells[4].get_text(" ", strip=True)),
                "data_final": data_final.split("(")[0].strip(),
            })

    # Duas tabelas de músicas aparecem na página: a busca (com Gêneros/Tags) e
    # a playlist em si (Título/Artista, ISRC, Data). Pega a que tem mais linhas.
    musicas: list[dict[str, Any]] = []
    musicas_body = None
    for candidate in soup.find_all("table"):
        headers = [clean(th.get_text(" ", strip=True)).lower() for th in candidate.find_all("th")]
        if "título/artista" not in headers or "isrc" not in headers:
            continue
        body = candidate if candidate.find("td") is not None else candidate.find_next("table")
        if body is None:
            continue
        if musicas_body is None or len(body.find_all("tr")) > len(musicas_body.find_all("tr")):
            musicas_body = body
    if musicas_body is not None:
        for row in musicas_body.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) < 4:
                continue
            titulo_musica = clean(cells[2].get_text(" ", strip=True))
            if not titulo_musica:
                continue
            musicas.append({
                "titulo_artista": titulo_musica,
                "isrc": clean(cells[3].get_text(" ", strip=True)),
                "data": clean(cells[4].get_text(" ", strip=True)) if len(cells) > 4 else "",
            })

    detalhe = {
        "titulo": titulo,
        "tipo_playlist": field("Playlists[tipoplaylist]"),
        "genero": field("Playlists[id_genero]"),
        "idades": multi("Playlists[id_idade][]"),
        "classes_sociais": multi("Playlists[id_classe_social][]"),
        "hour_start": field("Playlists[hour_start]"),
        "hour_end": field("Playlists[hour_end]"),
        "observacoes": field("Playlists[observacoes]"),
        "status_playlist": 1 if field("Playlists[status]") == "1" else 0,
        "musicas_count": len(form.find_all(attrs={"name": "Playlists[Musicas][]"})),
        "musicas": musicas,
        "codigo_contratos": sorted({v["codigo_contrato"] for v in vinculos if v["codigo_contrato"]}),
    }
    return detalhe, vinculos


def parse_playlists_listing_page(html: str) -> dict[int, str]:
    """Lê /playlists/<offset>: devolve {playlist_id: data de criação}."""
    soup = BeautifulSoup(html, "html.parser")
    body = _table_with_headers(soup, ["título", "data de criação"])
    if body is None:
        raise ParseError("Tabela de playlists não encontrada.")

    datas: dict[int, str] = {}
    for row in body.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 3:
            continue
        link = row.find("a", href=re.compile(r"/playlists/edit/(\d+)"))
        if link is None:
            continue
        match = re.search(r"/playlists/edit/(\d+)", link.get("href", ""))
        if match is None:
            continue
        data = clean(cells[2].get_text(" ", strip=True))
        if re.fullmatch(r"\d{2}/\d{2}/\d{4}", data):
            datas[int(match.group(1))] = data
    return datas


def collect_playlist_creation_dates(
    scraper: MusicDeliveryClient,
    conn: sqlite3.Connection,
) -> tuple[int, int]:
    """Lê a listagem /playlists e grava a data de criação de cada playlist.

    A data de criação não aparece em /playlists/edit/<id>, só na listagem, que
    é paginada de 30 em 30 e ordenada do id mais novo para o mais antigo.
    """
    alvo = {
        int(row[0])
        for row in conn.execute(
            "SELECT DISTINCT playlist_id FROM playlists_cliente WHERE playlist_id IS NOT NULL"
        )
    }
    if not alvo:
        return (0, 0)

    minimo = min(alvo)
    pendentes = set(alvo)
    atualizados = 0
    offset = 0
    paginas = 0
    while pendentes and offset <= 30000:
        try:
            response = scraper.get(BASE_URL + f"/playlists/{offset}")
            datas = parse_playlists_listing_page(response.text)
        except AuthError:
            raise
        except Exception as exc:
            log.warning("Listagem de playlists (offset %s): %s", offset, exc)
            break
        if not datas:
            break
        paginas += 1
        for playlist_id, data in datas.items():
            if playlist_id not in pendentes:
                continue
            conn.execute(
                """
                INSERT INTO playlists_detalhes (playlist_id, data_criacao) VALUES (?, ?)
                ON CONFLICT(playlist_id) DO UPDATE SET data_criacao=excluded.data_criacao
                """,
                (playlist_id, data),
            )
            pendentes.discard(playlist_id)
            atualizados += 1
        conn.commit()
        # A listagem é decrescente por id: passou do menor id alvo, acabou.
        if min(datas) <= minimo:
            break
        offset += len(datas)

    log.info(
        "Datas de criação: %d playlist(s) em %d página(s), %d sem data.",
        atualizados, paginas, len(pendentes),
    )
    return (atualizados, len(pendentes))


# ---------------------------------------------------------------------------
# Orquestração
# ---------------------------------------------------------------------------

@dataclass
class Summary:
    pages: int = 0
    new_clients: int = 0
    skipped: int = 0
    errors: int = 0
    started_at: str = ""


def scrape_client(
    scraper: MusicDeliveryClient,
    conn: sqlite3.Connection,
    listing: dict[str, Any],
    include_playlists: bool,
    include_playlist_details: bool,
    playlist_cache: dict[int, tuple[dict[str, Any], list[dict[str, Any]]]],
) -> dict[str, Any]:
    client_id = listing["id"]
    warnings: list[str] = []

    detail = scraper.get(BASE_URL + f"/clientes/edit/{client_id}")
    rec, contatos, _documentos = parse_detail_page(detail.text, listing)

    playlists: list[dict[str, Any]] | None = None
    playlists_ok = False
    if include_playlists:
        try:
            response = scraper.get(BASE_URL + f"/clientes/info/{client_id}")
            playlists = parse_playlists_page(response.text)
            playlists_ok = True
        except AuthError:
            raise
        except Exception as exc:
            warnings.append(f"playlists: {exc}")
            log.warning("Cliente %s: não foi possível coletar playlists: %s", client_id, exc)

    # Abre o link de cada playlist ("Playlists e Vinhetas Relacionadas") e lê
    # metadados, músicas e a tabela "Clientes vinculados à Playlist".
    detalhes: dict[int, dict[str, Any]] = {}
    vinculos: dict[int, list[dict[str, Any]]] = {}
    if include_playlist_details and playlists:
        for playlist in playlists:
            playlist_id = playlist.get("playlist_id")
            if not playlist_id:
                continue
            if playlist_id not in playlist_cache:
                try:
                    response = scraper.get(BASE_URL + f"/playlists/edit/{playlist_id}")
                    detalhe, vinc = parse_playlist_detail_page(response.text, playlist_id)
                    detalhe["coletado_em"] = utc_now()
                    playlist_cache[playlist_id] = (detalhe, vinc)
                except AuthError:
                    raise
                except Exception as exc:
                    warnings.append(f"playlist {playlist_id}: {exc}")
                    log.warning(
                        "Cliente %s: não foi possível coletar playlist %s: %s",
                        client_id, playlist_id, exc,
                    )
                    continue
            detalhe, vinc = playlist_cache[playlist_id]
            detalhes[playlist_id] = detalhe
            vinculos[playlist_id] = vinc

    rec["coleta_avisos"] = "; ".join(warnings) if warnings else None

    save_client(conn, rec, contatos, playlists, playlists_ok, detalhes, vinculos)
    return rec


def retry_missing_playlists(
    scraper: MusicDeliveryClient,
    conn: sqlite3.Connection,
    *,
    attempts: int = 2,
    delay: float = 0.8,
) -> tuple[int, int]:
    """Recupera playlists referenciadas que ficaram sem detalhe na coleta."""
    rows = conn.execute(
        """
        SELECT DISTINCT pc.playlist_id
          FROM playlists_cliente pc
          LEFT JOIN playlists_detalhes pd ON pd.playlist_id = pc.playlist_id
         WHERE pc.playlist_id IS NOT NULL AND pd.playlist_id IS NULL
         ORDER BY pc.playlist_id
        """
    ).fetchall()
    missing = [int(row[0]) for row in rows]
    if not missing:
        log.info("Playlists: nenhuma ausente para recuperar.")
        return (0, 0)

    log.info("Playlists: recuperando %d sem detalhe...", len(missing))
    recuperadas = falhas = 0
    for playlist_id in missing:
        for attempt in range(1, attempts + 1):
            try:
                response = scraper.get(BASE_URL + f"/playlists/edit/{playlist_id}")
                detalhe, vinculos = parse_playlist_detail_page(response.text, playlist_id)
                detalhe["coletado_em"] = utc_now()
                with conn:
                    save_playlist_detail(conn, playlist_id, detalhe, vinculos)
                recuperadas += 1
                log.info(
                    "  playlist %s recuperada (%d músicas, %d vínculos).",
                    playlist_id, detalhe.get("musicas_count", 0), len(vinculos),
                )
                break
            except AuthError:
                raise
            except Exception as exc:
                if attempt >= attempts:
                    falhas += 1
                    log.warning(
                        "  playlist %s: falhou após %d tentativas: %s",
                        playlist_id, attempts, exc,
                    )
                else:
                    log.debug("  playlist %s: tentativa %d falhou: %s", playlist_id, attempt, exc)
                    time.sleep(delay * attempt)
        time.sleep(delay)
    log.info("Playlists: %d recuperada(s), %d falha(s).", recuperadas, falhas)
    return (recuperadas, falhas)


def run(
    args: argparse.Namespace,
    scraper: MusicDeliveryClient,
    conn: sqlite3.Connection,
) -> Summary:
    summary = Summary(started_at=utc_now())
    cursor = conn.execute(
        "INSERT INTO execucoes (iniciado_em, status) VALUES (?, 'em_execucao')",
        (summary.started_at,),
    )
    execution_id = int(cursor.lastrowid)
    conn.commit()

    completed = set() if args.refresh else load_completed(conn)
    playlist_cache: dict[int, tuple[dict[str, Any], list[dict[str, Any]]]] = {}
    visited_pages: set[str] = set()
    page_url: str | None = BASE_URL + "/clientes"
    stop_reason = "fim da paginação"
    final_status = "erro"

    try:
        while page_url:
            if args.max_pages and summary.pages >= args.max_pages:
                stop_reason = f"limite de {args.max_pages} página(s)"
                break
            if page_url in visited_pages:
                stop_reason = "paginação repetida (proteção contra loop)"
                log.warning("URL de página repetida; encerrando: %s", page_url)
                break
            visited_pages.add(page_url)

            summary.pages += 1
            log.info("Página %d: %s", summary.pages, page_url)
            response = scraper.get(page_url)
            page_clients, next_url = parse_listing_page(response.text, page_url)
            log.info("  %d cliente(s) encontrado(s) na página.", len(page_clients))

            if not page_clients:
                stop_reason = "página sem clientes"
                break

            for listing in page_clients:
                if args.max_clients and summary.new_clients >= args.max_clients:
                    stop_reason = f"limite de {args.max_clients} cliente(s) novo(s)"
                    break
                client_id = listing["id"]
                if client_id in completed:
                    summary.skipped += 1
                    log.debug("Cliente %s já coletado; pulando.", client_id)
                    continue

                display_name = listing.get("nome") or f"id {client_id}"
                started = time.monotonic()
                try:
                    scrape_client(
                        scraper, conn, listing,
                        include_playlists=not args.skip_playlists,
                        include_playlist_details=not args.skip_playlist_details,
                        playlist_cache=playlist_cache,
                    )
                except AuthError:
                    raise
                except Exception as exc:
                    summary.errors += 1
                    log.error(
                        "Falha no cliente %s (%s): %s",
                        client_id, display_name[:80], exc,
                    )
                    log.debug("Detalhes da falha:", exc_info=True)
                    continue

                completed.add(client_id)
                summary.new_clients += 1
                elapsed = time.monotonic() - started
                log.info(
                    "[%d] id=%s %s (%.1fs)",
                    summary.new_clients, client_id, display_name[:90], elapsed,
                )

            if stop_reason.startswith("limite"):
                break
            page_url = next_url
            if page_url is None:
                stop_reason = "última página"
        final_status = "concluida_com_erros" if summary.errors else "concluida"
    except KeyboardInterrupt:
        stop_reason = "interrompido pelo usuário"
        final_status = "interrompida"
        raise
    finally:
        finished_at = utc_now()
        conn.execute(
            """
            UPDATE execucoes
               SET finalizado_em=?, paginas=?, clientes_novos=?,
                   clientes_pulados=?, erros=?, status=?, mensagem=?
             WHERE id=?
            """,
            (
                finished_at, summary.pages, summary.new_clients,
                summary.skipped, summary.errors, final_status, stop_reason,
                execution_id,
            ),
        )
        conn.execute(
            "INSERT INTO meta (chave, valor) VALUES ('ultima_execucao', ?) "
            "ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor",
            (finished_at,),
        )
        total = conn.execute("SELECT COUNT(*) FROM clientes WHERE coleta_completa=1").fetchone()[0]
        conn.execute(
            "INSERT INTO meta (chave, valor) VALUES ('total_clientes', ?) "
            "ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor",
            (str(total),),
        )
        conn.commit()

    # A data de criação vem da listagem /playlists, não da página da playlist.
    if not args.skip_playlists and not args.skip_playlist_details:
        try:
            collect_playlist_creation_dates(scraper, conn)
        except AuthError:
            raise
        except Exception as exc:
            log.warning("Coleta das datas de criação interrompida: %s", exc)

    if args.retry_playlists:
        try:
            retry_missing_playlists(scraper, conn)
        except AuthError:
            raise
        except Exception as exc:
            log.warning("Recuperação de playlists interrompida: %s", exc)

    return summary


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extrai clientes do Music Delivery para SQLite.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--db", type=Path, default=Path("musicdelivery.db"),
                        help="Arquivo SQLite de destino.")
    parser.add_argument("--env-file", type=Path, default=Path(__file__).resolve().parent / ".env",
                        help="Arquivo .env com CLIENT_EMAIL/CLIENT_SENHA (ou MD_LOGIN/MD_PASSWORD).")
    parser.add_argument("--login", default=None, help="E-mail/usuário (sobrescreve o .env).")
    parser.add_argument("--password", default=None, help="Senha (sobrescreve o .env; evite no histórico do shell).")
    parser.add_argument("--tipo", choices=("admin", "artist", "client"), default=None,
                        help="Tipo de usuário do login.")
    parser.add_argument("--delay", type=float, default=0.20,
                        help="Intervalo mínimo entre requisições, em segundos.")
    parser.add_argument("--timeout", type=float, default=60.0,
                        help="Timeout de leitura de cada requisição, em segundos.")
    parser.add_argument("--retries", type=int, default=4,
                        help="Tentativas adicionais em caso de erro HTTP/rede.")
    parser.add_argument("--max-pages", type=int, default=None,
                        help="Processa no máximo N páginas da listagem.")
    parser.add_argument("--max-clients", type=int, default=None,
                        help="Coleta no máximo N clientes novos nesta execução.")
    parser.add_argument("--refresh", action="store_true",
                        help="Recoleta clientes que já estão no banco.")
    parser.add_argument("--skip-playlists", action="store_true",
                        help="Não acessa a aba de playlists.")
    parser.add_argument("--skip-playlist-details", action="store_true",
                        help="Não abre o link de cada playlist (metadados/músicas/vínculos).")
    parser.add_argument("--retry-playlists", action="store_true",
                        help="Ao final, tenta novamente as playlists que ficaram sem detalhe.")
    parser.add_argument("--log-file", type=Path, default=Path("musicdelivery_extract.log"),
                        help="Arquivo de log (use '-' para desabilitar).")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Exibe mensagens de depuração.")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    log_path = None if str(args.log_file) == "-" else args.log_file
    setup_logging(log_path, args.verbose)

    load_env_file(args.env_file)

    # Reaproveita as credenciais do extrator de contratos (mesmo sistema).
    login = (
        args.login
        or os.environ.get("MD_LOGIN", "").strip()
        or os.environ.get("CLIENT_EMAIL", "").strip()
    )
    password = (
        args.password
        or os.environ.get("MD_PASSWORD", "")
        or os.environ.get("CLIENT_SENHA", "")
    )
    tipo = args.tipo or os.environ.get("MD_TIPO", "admin").strip() or "admin"

    if not login:
        log.error(
            "Informe o login com --login, CLIENT_EMAIL/MD_LOGIN ou no arquivo %s.",
            args.env_file,
        )
        return 2
    if not password:
        if not sys.stdin.isatty():
            log.error("Senha ausente. Defina CLIENT_SENHA/MD_PASSWORD ou use --password.")
            return 2
        password = getpass.getpass(f"Senha para {login}: ")
    if not password:
        log.error("Senha vazia.")
        return 2

    config = ScraperConfig(
        tipo=tipo,
        login=login,
        password=password,
        delay=args.delay,
        timeout=args.timeout,
        retries=args.retries,
    )
    scraper = MusicDeliveryClient(config)

    try:
        conn = open_db(args.db)
    except sqlite3.Error as exc:
        log.error("Não foi possível abrir o banco %s: %s", args.db, exc)
        return 1

    log.info("Banco: %s", args.db.resolve())
    log.info(
        "Coleta: playlists=%s, detalhes das playlists=%s, documentos/configurações=não, delay=%.2fs",
        "sim" if not args.skip_playlists else "não",
        "sim" if not args.skip_playlist_details else "não",
        args.delay,
    )

    try:
        scraper.login()
        summary = run(args, scraper, conn)
    except AuthError as exc:
        log.error("Falha de autenticação: %s", exc)
        return 2
    except KeyboardInterrupt:
        log.warning("Execução interrompida. O que já foi coletado está salvo no banco.")
        return 130
    except Exception as exc:
        log.exception("Erro fatal: %s", exc)
        return 1
    finally:
        conn.close()

    log.info("=" * 60)
    log.info("Resumo")
    log.info("  Páginas percorridas : %d", summary.pages)
    log.info("  Clientes novos      : %d", summary.new_clients)
    log.info("  Clientes pulados    : %d", summary.skipped)
    log.info("  Erros               : %d", summary.errors)
    log.info("  Banco               : %s", args.db.resolve())
    log.info("=" * 60)
    if summary.errors:
        log.warning("Houve %d erro(s). Rode novamente para tentar apenas o que faltou.", summary.errors)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
