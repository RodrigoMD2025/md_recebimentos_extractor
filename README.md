# 🧑🏻‍💻​ Extração Automática de Relatorio

Automação completa para extração de dados de recebimentos do sistema MD usando GitHub Actions, com processamento de múltiplos anos e notificações via Telegram.

## 🚀 Características Principais

- ✅ **Extração Automática**: Login e navegação automatizada no sistema
- ✅ **Processamento Multi-Ano**: Execução em paralelo para os anos
- ✅ **Análise Detalhada**: Extração de playlists, períodos e contagem de faixas
- ✅ **Sistema de Retry**: Tentativas automáticas para links com falha
- ✅ **Notificações Telegram**: Relatórios detalhados e arquivos Excel
- ✅ **Logs Completos**: Monitoramento detalhado de cada etapa
- ✅ **Tratamento de Erros**: Notificações automáticas em caso de falha

## 📋 Estrutura do Projeto

```
projeto-recebimentos/
├── .github/
│   └── workflows/
│       └── recebimentos.yml       # Workflow do GitHub Actions
├── client_recebimentos.py         # Script principal de extração
├── requirements.txt               # Dependências Python
└── README.md                      # Este arquivo
```

## ⚙️ Configuração Inicial

### 1. Secrets do Repositório

Configure os seguintes secrets em `Settings > Secrets and variables > Actions`:

| Secret | Descrição | Obrigatório |
|--------|-----------|-------------|
| `BOT_TOKEN` | Token do bot do Telegram | ✅ |
| `CLIENT_EMAIL` | Email de login do sistema MD | ✅ |
| `CLIENT_SENHA` | Senha do sistema MD | ✅ |
| `DEFAULT_CHAT_ID` | Chat ID padrão do Telegram | ✅ |

### 2. Configuração do Bot Telegram

1. Crie um bot conversando com [@BotFather](https://t.me/BotFather)
2. Obtenha o token do bot
3. Obtenha seu Chat ID conversando com [@userinfobot](https://t.me/userinfobot)

## 🎯 Como Executar

### Execução Manual (Recomendado)

1. Acesse a aba **Actions** do seu repositório
2. Selecione **"Recebimentos MD"**
3. Clique em **"Run workflow"**
4. (Opcional) Insira um Chat ID específico
5. Clique em **"Run workflow"**

### Execução via API

```bash
curl -X POST \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Authorization: token SEU_GITHUB_TOKEN" \
  https://api.github.com/repos/SEU_USUARIO/SEU_REPO/dispatches \
  -d '{
    "event_type": "run-recebimentos",
    "client_payload": {
      "chat_id": "123456789"
    }
  }'
```

### Execução Agendada (Opcional)

Para ativar execução automática, adicione ao workflow:

```yaml
on:
  schedule:
    - cron: '0 9 1 * *'  # Todo dia 1º do mês às 9h UTC
```

## 📊 Dados Extraídos

### Informações Principais
- **Contratante**: Nome do contratante
- **Código de Contrato**: Identificador único
- **Vencimento**: Data de vencimento
- **Valor Parcela**: Valor a receber
- **Status**: Status do pagamento
- **Pago Em**: Data do pagamento

### Análise de Playlists
- **Status Playlist**: Com/Sem playlist
- **Playlists**: Nomes das playlists relacionadas
- **Período**: Período de referência
- **Faixas**: Quantidade de faixas musicais

## 📈 Relatórios Gerados

### 1. Arquivo Excel
- Nome: `relatorio_consolidado_YYYY.xlsx`
- Enviado automaticamente via Telegram
- Contém todos os dados extraídos

### 2. Relatório de Estatísticas

```
🤖 RELATÓRIO AUTOMÁTICO - RECEBIMENTOS

📅 Data/Hora: 29/07/2025 às 14:30:00
📊 Ano do Relatório: 2024
⏱️ Tempo de Execução: 0:15:30

📋 DADOS EXTRAÍDOS:
• Total de registros: 1,250
• Registros com links: 980
• Registros sem links: 270

🔗 PROCESSAMENTO DE LINKS:
• ✅ Processados com sucesso: 945
• ❌ Links com erro: 35
• 📊 Taxa de sucesso: 96.4%

🎵 ANÁLISE DE PLAYLISTS:
• Com Playlist: 720
• Sem Playlist: 225

🚀 Relatório gerado automaticamente via GitHub Actions
```

## 🔧 Configurações Avançadas

### Modificar Anos Processados

Edite o arquivo `.github/workflows/recebimentos.yml`:

```yaml
strategy:
  matrix:
    ano: ["2022", "2023", "2024", "2025"]  # Adicione novos anos aqui
```

### Ajustar Timeouts

No arquivo `client_recebimentos.py`:

```python
timeouts = [60000, 90000, 120000]  # 1min, 1.5min, 2min
```

### Modificar Ano Padrão

```python
parser.add_argument('--ano', type=str, default="2025", help="Ano do relatório")
```

## 🚨 Tratamento de Erros

### Sistema de Retry
- **1ª Tentativa**: Timeout de 60 segundos
- **2ª Tentativa**: Timeout de 90 segundos
- **3ª Tentativa**: Timeout de 120 segundos

### Notificações de Erro
```
🚨 ERRO - EXTRAÇÃO RECEBIMENTOS

❌ Erro: Falha no login - verifique credenciais
🕐 Timestamp: 29/07/2025 às 14:15:30
🔧 Origem: GitHub Actions

Verifique os logs para mais detalhes
```

### Upload de Logs
Em caso de falha, os logs são automaticamente salvos como artefatos do GitHub Actions com retenção de 7 dias.

## 📝 Logs e Monitoramento

### Níveis de Log
- **INFO**: Progresso normal da execução
- **WARNING**: Problemas não críticos
- **ERROR**: Erros que impedem a execução

### Exemplo de Log
```
2025-07-29 14:30:15 - INFO - 🤖 Iniciando extração de recebimentos...
2025-07-29 14:30:20 - INFO - ✅ Login realizado com sucesso
2025-07-29 14:30:25 - INFO - Carregando dados do ano 2024...
2025-07-29 14:35:10 - INFO - ✅ Extração concluída: 1,250 registros coletados
2025-07-29 14:45:30 - INFO - 🎉 Processo concluído com sucesso!
```

## 🛠️ Dependências

```txt
pandas>=2.0.0           # Manipulação de dados
playwright>=1.40.0      # Automação web
beautifulsoup4>=4.12.0  # Parse HTML
tqdm>=4.65.0            # Barras de progresso
aiohttp>=3.8.0          # Cliente HTTP assíncrono
aiofiles>=23.0.0        # Operações de arquivo assíncronas
openpyxl>=3.1.0         # Manipulação de Excel
```

## 🔒 Segurança

- ✅ Credenciais armazenadas como secrets
- ✅ Logs não expõem informações sensíveis
- ✅ Arquivos temporários são automaticamente removidos
- ✅ Comunicação via HTTPS
- ✅ Token do Telegram com escopo limitado

## 🐛 Solução de Problemas

### Erro de Login
```bash
❌ Falha no login - verifique credenciais
```
**Solução**: Verifique se `CLIENT_EMAIL` e `CLIENT_SENHA` estão corretos nos secrets.

### Erro de Telegram
```bash
❌ BOT_TOKEN não configurado
```
**Solução**: Configure o secret `BOT_TOKEN` com o token do seu bot.

### Timeout de Execução
```bash
Error: The operation was canceled.
```
**Solução**: O workflow tem timeout de 60 minutos. Para muitos dados, considere aumentar ou dividir o processamento.

## 📞 Suporte

Para problemas ou sugestões:
1. Verifique os logs do GitHub Actions
2. Consulte as mensagens de erro no Telegram
3. Analise os artefatos salvos em caso de falha

## 📄 Licença

Este projeto é de uso interno e contém informações proprietárias do sistema MD.

---

*Última atualização: Julho 2025*
