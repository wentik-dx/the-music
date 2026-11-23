# The Music — site / desktop PWA

Статический сайт и десктоп-оболочка для **The Music v1.2.0** — оффлайн-first музыкального плеера из Termux.

## Что лежит в репо

| Файл | Назначение |
| --- | --- |
| `index.html` | оболочка PWA: сайдбар, hotkey-подсказка, Upper-панель «Установить / Сайт / Настройки» |
| `app.html` | сам плеер, собранный в один оффлайн-бандл (HTML + CSS + JS + PNG-иконки) |
| `app.js` | service worker, beforeinstallprompt, MessageChannel, горячие клавиши, синхро темы |
| `sw.js` | кэш `the-music-v1.2`, network-first для API / cache-first для ассетов |
| `manifest.json` | PWA-манифест (standalone, встроенные иконки 192/512) |
| `build.sh` | локальная пересборка `app.html` из `../assets/app.html` |

##Деплой

Проект разворачивается как **Cloudflare Pages Direct Upload**:

```sh
CLOUDFLARE_ACCOUNT_ID=<account-id> \
CLOUDFLARE_API_TOKEN=<token-из-dashboard> \
npx wrangler pages deploy . --project-name=the-music --branch=main
```

Токен и аккаунт в репо **не хранятся** — задаются в окружении/CI Secrets.

## Локально

```sh
bash build.sh serve
# http://127.0.0.1:8080/
```

## Статус

- Плеер полностью оффлайн: поиск, плейлисты, декодер, заметки, аватары и счётчики работают без сети.
- Сетевые фичи (аккаунт, синк, публикации) деградируют красиво: операции лягут в `syncQueue`.
- Google-вход требует реальный `GOOGLE_CLIENT_ID`; без него открывается сайт регистрации.

Сделано в Termux для Android + WebView. <color=#9d8cff>норм имба, но не слишком пиздато</color>.
