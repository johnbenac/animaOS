# Discord Module

Connects ANIMA to Discord via Gateway WebSocket.

## Configuration

```yaml
modules:
  - id: discord
    path: ./mods/discord
    config:
      token: ${DISCORD_BOT_TOKEN}    # Required: Bot token from Discord Developer Portal
      intents: 51351                  # Optional: Gateway intents (default: 51351)
```

## Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create New Application → Bot
3. Enable "Message Content Intent" (Privileged Gateway Intents)
4. Copy Bot Token
5. Invite bot to your server with appropriate permissions

## How It Works

- Connects to Discord Gateway via WebSocket
- Listens for MESSAGE_CREATE events
- Forwards messages to cognitive core (if channel is linked)
- Sends responses back via Discord HTTP API

## Linking

Unlike Telegram, Discord doesn't have built-in commands yet. Link via API:

```bash
curl -X POST http://localhost:3034/discord/link \
  -H "Content-Type: application/json" \
  -d '{"channelId": "123456", "userId": 1}'
```

Or implement commands in the module (PR welcome!).
