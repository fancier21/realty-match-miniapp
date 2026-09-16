# REALTY MATCH Mini App

Frontend MVP для подачи заявок в REALTY MATCH через Telegram Mini App.

Приложение отвечает только за UI, Telegram WebApp identity и HTTP-запрос. Классификация текста, валидация бизнес-полей, сохранение, matching и публикация выполняются существующим backend pipeline.

## Требования

- Node.js 20 или новее;
- npm;
- доступный backend endpoint `POST /api/miniapp/publish`.

## Локальная разработка

```bash
npm install
cp .env.example .env.local
npm run dev
```

В `.env.local` укажите адрес backend:

```text
VITE_API_BASE_URL=http://localhost:8000
```

Vite проксирует `/api` на `http://localhost:8000`, поэтому переменную можно не задавать при локальной разработке, если backend работает на этом адресе.

Для отправки заявки в локальной среде страницу нужно открыть внутри Telegram Mini App. В обычном браузере форма отображается, но Telegram `initData` отсутствует и отправка будет отклонена.

## Проверка и сборка

```bash
npm run typecheck
npm run build
npm run preview
```

Сборка создаётся в `dist/`.

## Публикация через GitHub Pages

Пакет `gh-pages` уже добавлен в проект:

```bash
npm run deploy
```

Команда запускает production-сборку и публикует `dist/` в ветку `gh-pages` текущего репозитория.

Перед публикацией:

1. В GitHub включите Pages для ветки `gh-pages` и директории `/ (root)`.
2. В DNS создайте `CNAME` для `app.realtymatch`, указывающий на GitHub Pages.
3. В настройках Pages укажите custom domain `app.realtymatch`.
4. Для production-сборки задайте URL backend:

   ```bash
   VITE_API_BASE_URL=https://api.realtymatch npm run build
   npm run deploy
   ```

   Либо сохраните значение в `.env.production` перед сборкой. Не помещайте в переменные `VITE_*` секреты: они попадают в клиентский bundle.

`public/CNAME` содержит custom domain и будет включён в опубликованную сборку.

Backend должен разрешить CORS для `https://app.realtymatch` и обработать preflight-запросы для `Content-Type` и `Idempotency-Key`. Cookies frontend не использует: Telegram `initData` передаётся в JSON и валидируется только на backend.

## Telegram

В `index.html` подключается официальный Telegram WebApp SDK. При старте приложение вызывает `Telegram.WebApp.ready()` и `expand()`.

На backend отправляется только подписанное Telegram значение `Telegram.WebApp.initData`. `initDataUnsafe` используется лишь для чтения `start_param` в UI и не используется для аутентификации или определения пользователя.

Ожидаемый запуск:

```text
https://t.me/<BOT_USERNAME>?startapp=publish
```

Для запроса используется:

```text
POST /api/miniapp/publish
Idempotency-Key: <uuid>
```

Повтор кнопки «Повторить» переиспользует тот же idempotency key. После изменения текста или направления создаётся новый key.

## API-контракт frontend

```json
{
  "init_data": "<signed Telegram WebApp initData>",
  "direction_hint": "demand",
  "text": "Ищу квартиру 1+1 в Батуми до $800",
  "start_param": "publish"
}
```

Frontend ожидает успешный HTTP-ответ с `success: true`. Ответ означает принятие заявки в обработку, а не гарантированную мгновенную публикацию: существующий persist-first pipeline может вернуть статус `queued` и выполнить доставку позже.
