# Telegram Module

Connects ANIMA to Telegram via [Grammy](https://grammy.dev/).

## Configuration

```yaml
modules:
  - id: telegram
    path: ./mods/telegram
    config:
      token: ${TELEGRAM_BOT_TOKEN}           # Required: Bot token from @BotFather
      mode: polling                          # "polling" or "webhook"
      webhookUrl: https://.../webhook        # Required if mode=webhook
      webhookSecret: ${WEBHOOK_SECRET}       # Optional: webhook verification
      linkSecret: ${LINK_SECRET}             # Optional: secret for /link command
```

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Show welcome message and linking instructions |
| `/link <userId> [secret]` | Link this Telegram chat to ANIMA user |
| `/unlink` | Unlink this chat |

## Modes

### Polling Mode (default)
Bot connects directly to Telegram servers via long-polling. Simple, no public URL needed.

### Webhook Mode
Telegram sends updates to your server. Requires:
- Public HTTPS URL
- Set `webhookUrl` to `https://your-domain.com/telegram/webhook`

## Linking Flow

1. User messages bot, gets "not linked" error
2. User runs `/link 123` (where 123 is their ANIMA user ID)
3. Chat is linked, user can now chat with ANIMA

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/telegram/` | GET | Module status |
| `/telegram/webhook` | POST | Telegram webhook (webhook mode only) |
