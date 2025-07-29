# Extração de Recebimentos - GitHub Actions

Este projeto automatiza a extração de dados de recebimentos do sistema Music Delivery usando GitHub Actions.

## 🔧 Configuração

### 1. Secrets Necessários

Configure os seguintes secrets no seu repositório GitHub (`Settings > Secrets and variables > Actions`):

| Secret | Descrição | Exemplo |
|--------|-----------|---------|
| `BOT_TOKEN` | Token do bot do Telegram | `123456789:ABCDEFghijklmnop...` |
| `CLIENT_EMAIL` | Email de login do sistema | `seu@email.com` |
| `CLIENT_SENHA` | Senha do sistema | `SuaSenhaSegura123` |
| `DEFAULT_CHAT_ID` | Chat ID padrão do Telegram | `123456789` |

### 2. Estrutura do Repositório

```
seu-repositorio/
├── .github/
│   └── workflows/
│       └── recebimentos.yml
├── client_recebimentos.py
├── requirements.txt
└── README.md
```

### 3. Como Executar

#### Execução Manual (Workflow Dispatch)
1. Vá para `Actions` no seu repositório
2. Selecione "Extração de Recebimentos Music Delivery"
3. Clique em "Run workflow"
4. Opcionalmente, insira um Chat ID específico

#### Execução via API (Repository Dispatch)
```bash
curl -X POST \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Authorization: token SEU_GITHUB_TOKEN" \
  https://api.github.com/repos/SEU_USUARIO/SEU_REPO/dispatches \
  -d '{"event_type":"run-recebimentos","client_payload":{"chat_id":"123456789"}}'
```

#### Execução Agendada
Descomente as linhas de `schedule` no arquivo `recebimentos.yml` para execução automática.

## 📊 Funcionalidades

- ✅ Login automático no sistema
- ✅ Navegação por todos os meses do ano
- ✅ Extração completa dos dados de recebimentos
- ✅ Processamento de links de detalhes com retry
- ✅ Análise de playlists e faixas
- ✅ Geração de relatório em Excel
- ✅ Envio automático via Telegram
- ✅ Relatório de estatísticas detalhado
- ✅ Tratamento de erros e notificações

## 📈 Saída

O sistema gera:
1. **Relatório em Excel** com os dados extraídos
2. **Mensagem no Telegram** com estatísticas do processamento
3. **Logs detalhados** para debug

### Colunas do Relatório Excel:
- Contratante
- Código de Contrato
- Vencimento
- Valor Parcela
- Status
- Pago Em
- Link Detalhes
- Status Playlist
- Playlists
- Período
- Faixas

## 🚨 Tratamento de Erros

- **Retry automático** para links que falharam
- **Notificações de erro** via Telegram
- **Upload de logs** em caso de falha
- **Timeout configurável** para cada etapa

## ⚙️ Configurações Avançadas

### Modificar Ano do Relatório
Edite a variável `ANO_RELATORIO` no arquivo `recebimentos_extractor.py`:
```python
ANO_RELATORIO = "2024